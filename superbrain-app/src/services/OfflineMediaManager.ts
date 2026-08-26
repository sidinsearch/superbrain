import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Post } from '../types';
import apiService from './api';
import localDb from './localDb';

const REELS_DIRECTORY_NAME = 'reels';
const MAX_PARALLEL_MEDIA_DOWNLOADS = 2;
const STORAGE_SCAN_CHUNK_SIZE = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OfflineMediaDownloadProgress = {
  filename: string;
  bytesWritten: number;
  totalBytes: number;
  progress: number;
};

export type OfflineMediaSyncResult = {
  shortcode: string;
  filename: string;
  localUri?: string;
  skipped: boolean;
  error?: string;
};

export type SavedReelFile = {
  filename: string;
  uri: string;
  sizeBytes: number;
  modificationTime: number | null;
  ageDays: number | null;
};

export type OfflineMediaStorageSummary = {
  fileCount: number;
  totalBytes: number;
  totalDiskSpaceBytes: number;
  availableDiskSpaceBytes: number;
  oldestModificationTime: number | null;
  newestModificationTime: number | null;
};

export type OfflineMediaClearResult = {
  deletedCount: number;
  failedCount: number;
  bytesFreed: number;
};

type ProgressListener = (progress: OfflineMediaDownloadProgress) => void;

class OfflineMediaManager {
  private activeDownloads = new Map<string, Promise<string>>();
  private progressListeners = new Set<ProgressListener>();

  subscribe(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  getLocalReelUri(filename: string): string {
    return this.getReelFile(filename).uri;
  }

  async checkFileExists(uriOrFilename: string, expectedBytes?: number): Promise<boolean> {
    try {
      const fileUri = uriOrFilename.startsWith('file://')
        ? uriOrFilename
        : this.getReelFile(uriOrFilename).uri;
      const info = await LegacyFileSystem.getInfoAsync(fileUri);

      if (!info.exists || info.isDirectory || info.size <= 0) {
        return false;
      }

      return !expectedBytes || expectedBytes <= 0 || info.size === expectedBytes;
    } catch {
      return false;
    }
  }

  async getSavedReelsStorageBytes(): Promise<number> {
    const files = await this.listSavedReels();
    return files.reduce((total, file) => total + file.sizeBytes, 0);
  }

  async calculateSavedReelsStorageBytes(): Promise<number> {
    return this.getSavedReelsStorageBytes();
  }

  async listSavedReels(): Promise<SavedReelFile[]> {
    const directory = this.ensureReelsDirectory();
    try {
      const filenames = (await LegacyFileSystem.readDirectoryAsync(directory.uri))
        .filter(filename => filename.toLowerCase().endsWith('.mp4'));
      const savedFiles: SavedReelFile[] = [];

      for (let index = 0; index < filenames.length; index += STORAGE_SCAN_CHUNK_SIZE) {
        const chunk = filenames.slice(index, index + STORAGE_SCAN_CHUNK_SIZE);
        const chunkFiles = await Promise.all(chunk.map(async filename => {
          try {
            const safeFilename = this.assertSafeMp4Filename(filename);
            const file = new File(directory, safeFilename);
            const info = await LegacyFileSystem.getInfoAsync(file.uri);

            if (!info.exists || info.isDirectory || info.size <= 0) {
              return null;
            }

            const modificationTime = typeof info.modificationTime === 'number'
              ? info.modificationTime * 1000
              : null;

            return {
              filename: safeFilename,
              uri: info.uri || file.uri,
              sizeBytes: Math.max(0, info.size),
              modificationTime,
              ageDays: modificationTime ? Math.max(0, Math.floor((Date.now() - modificationTime) / DAY_MS)) : null,
            };
          } catch {
            return null;
          }
        }));

        savedFiles.push(...chunkFiles.filter((file): file is SavedReelFile => file !== null));
        await this.yieldToJs();
      }

      return savedFiles.sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
    } catch {
      return [];
    }
  }

  async getStorageSummary(): Promise<OfflineMediaStorageSummary> {
    const files = await this.listSavedReels();
    const modificationTimes = files
      .map(file => file.modificationTime)
      .filter((value): value is number => typeof value === 'number' && value > 0);

    return {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      totalDiskSpaceBytes: Paths.totalDiskSpace,
      availableDiskSpaceBytes: Paths.availableDiskSpace,
      oldestModificationTime: modificationTimes.length > 0 ? Math.min(...modificationTimes) : null,
      newestModificationTime: modificationTimes.length > 0 ? Math.max(...modificationTimes) : null,
    };
  }

  async clearSavedReels(): Promise<OfflineMediaClearResult> {
    const files = await this.listSavedReels();
    const deletedFilenames: string[] = [];
    let deletedCount = 0;
    let failedCount = 0;
    let bytesFreed = 0;

    for (const file of files) {
      try {
        await LegacyFileSystem.deleteAsync(file.uri, { idempotent: true });
        deletedCount += 1;
        bytesFreed += file.sizeBytes;
        deletedFilenames.push(file.filename);
      } catch {
        failedCount += 1;
      }

      if ((deletedCount + failedCount) % 10 === 0) {
        await this.yieldToJs();
      }
    }

    if (deletedFilenames.length === files.length) {
      await localDb.clearAllPostLocalMedia();
    } else {
      for (const filename of deletedFilenames) {
        await localDb.clearPostLocalMediaByFilename(filename);
      }
    }

    return { deletedCount, failedCount, bytesFreed };
  }

  async deleteSavedReelsOlderThan(maxAgeDays: number): Promise<OfflineMediaClearResult> {
    const safeMaxAgeDays = Math.max(1, Math.floor(maxAgeDays));
    const cutoffTime = Date.now() - safeMaxAgeDays * DAY_MS;
    const expiredFiles = (await this.listSavedReels()).filter(file => (
      typeof file.modificationTime === 'number' &&
      file.modificationTime > 0 &&
      file.modificationTime < cutoffTime
    ));

    let deletedCount = 0;
    let failedCount = 0;
    let bytesFreed = 0;

    for (const file of expiredFiles) {
      try {
        await LegacyFileSystem.deleteAsync(file.uri, { idempotent: true });
        await localDb.clearPostLocalMediaByFilename(file.filename);
        deletedCount += 1;
        bytesFreed += file.sizeBytes;
      } catch {
        failedCount += 1;
      }

      if ((deletedCount + failedCount) % 10 === 0) {
        await this.yieldToJs();
      }
    }

    return { deletedCount, failedCount, bytesFreed };
  }

  async deleteLocalReel(uriOrFilename: string): Promise<void> {
    try {
      const fileUri = uriOrFilename.startsWith('file://')
        ? uriOrFilename
        : this.getReelFile(uriOrFilename).uri;
      const info = await LegacyFileSystem.getInfoAsync(fileUri);
      if (info.exists) {
        await LegacyFileSystem.deleteAsync(fileUri, { idempotent: true });
      }
    } catch {
      // Best effort cleanup; stale DB pointers are handled by verification.
    }
  }

  async downloadReelToDevice(remoteUrl: string, filename: string): Promise<string> {
    const safeFilename = this.assertSafeMp4Filename(filename);
    const existingDownload = this.activeDownloads.get(safeFilename);
    if (existingDownload) {
      return existingDownload;
    }

    const downloadPromise = this.performDownload(remoteUrl, safeFilename);
    this.activeDownloads.set(safeFilename, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.activeDownloads.delete(safeFilename);
    }
  }

  async ensurePostMediaDownloaded(post: Post): Promise<string | null> {
    if (!this.isDownloadablePost(post)) {
      return null;
    }

    const filename = post.local_filename!;
    const expectedSize = post.media_file_size || 0;

    if (
      post.local_media_uri &&
      await this.checkFileExists(post.local_media_uri, expectedSize)
    ) {
      return post.local_media_uri;
    }

    const localUri = this.getLocalReelUri(filename);
    if (await this.checkFileExists(localUri, expectedSize)) {
      await localDb.updatePostLocalMedia(post.shortcode, localUri, filename, expectedSize);
      return localUri;
    }

    const remoteUrl = await apiService.getMediaUrl(filename);
    const downloadedUri = await this.downloadReelToDevice(remoteUrl, filename);
    await localDb.updatePostLocalMedia(post.shortcode, downloadedUri, filename, expectedSize);
    return downloadedUri;
  }

  async syncPostsMedia(
    posts: Post[],
    concurrency: number = MAX_PARALLEL_MEDIA_DOWNLOADS,
  ): Promise<OfflineMediaSyncResult[]> {
    const candidates = posts.filter(post => this.isDownloadablePost(post));
    const results: OfflineMediaSyncResult[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < candidates.length) {
        const post = candidates[cursor];
        cursor += 1;

        try {
          const localUri = await this.ensurePostMediaDownloaded(post);
          results.push({
            shortcode: post.shortcode,
            filename: post.local_filename || '',
            localUri: localUri || undefined,
            skipped: !localUri,
          });
        } catch (error: any) {
          results.push({
            shortcode: post.shortcode,
            filename: post.local_filename || '',
            skipped: false,
            error: error?.message || 'Media download failed',
          });
        }
      }
    };

    const workerCount = Math.min(concurrency, candidates.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  private async performDownload(remoteUrl: string, filename: string): Promise<string> {
    this.ensureReelsDirectory();

    const finalFile = this.getReelFile(filename);
    const partialFile = this.getReelFile(`${filename}.download`);
    const headers = await apiService.getMediaDownloadHeaders();

    try {
      if (partialFile.exists) {
        partialFile.delete();
      }
    } catch {
      // A fresh download can overwrite this path if native cleanup races.
    }

    const downloadTask = LegacyFileSystem.createDownloadResumable(
      remoteUrl,
      partialFile.uri,
      {
        headers,
        sessionType: LegacyFileSystem.FileSystemSessionType.BACKGROUND,
      },
      progress => {
        const totalBytes = progress.totalBytesExpectedToWrite || 0;
        const bytesWritten = progress.totalBytesWritten || 0;
        this.emitProgress({
          filename,
          bytesWritten,
          totalBytes,
          progress: totalBytes > 0 ? bytesWritten / totalBytes : 0,
        });
      }
    );

    const result = await downloadTask.downloadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`Media download failed with status ${result?.status ?? 'unknown'}`);
    }

    if (!partialFile.exists || partialFile.size <= 0) {
      throw new Error('Downloaded media file is empty');
    }

    try {
      if (finalFile.exists) {
        finalFile.delete();
      }
      partialFile.move(finalFile);
    } catch {
      if (!finalFile.exists && partialFile.exists) {
        partialFile.rename(filename);
      }
    }

    if (!finalFile.exists || finalFile.size <= 0) {
      throw new Error('Could not finalize downloaded media file');
    }

    return finalFile.uri;
  }

  private isDownloadablePost(post: Post): boolean {
    return (
      post.content_type !== 'webpage' &&
      typeof post.local_filename === 'string' &&
      post.local_filename.trim().length > 0
    );
  }

  private ensureReelsDirectory(): Directory {
    const directory = new Directory(Paths.document, REELS_DIRECTORY_NAME);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
    return directory;
  }

  private getReelFile(filename: string): File {
    return new File(this.ensureReelsDirectory(), this.assertSafeMp4Filename(filename));
  }

  private assertSafeMp4Filename(filename: string): string {
    const trimmed = filename.trim();
    const basename = trimmed.split(/[\\/]/).pop() || '';
    if (trimmed !== basename || !/^[A-Za-z0-9._-]+\.mp4(?:\.download)?$/i.test(trimmed)) {
      throw new Error(`Unsafe media filename: ${filename}`);
    }
    return trimmed;
  }

  private emitProgress(progress: OfflineMediaDownloadProgress): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private async yieldToJs(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export default new OfflineMediaManager();
