import * as FileSystem from 'expo-file-system/legacy';
import offlineMediaManager from './OfflineMediaManager';
import apiService from './api';
import localDb from './localDb';
import type { Post } from '../types';

const mockFiles = new Map<string, { size: number; modificationTime?: number; isDirectory?: boolean }>();
const directoryUri = 'file:///documents/reels';

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents', totalDiskSpace: 10000, availableDiskSpace: 8000 },
  Directory: class {
    uri: string;
    exists = true;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
  },
  File: class {
    uri: string;
    constructor(parent: { uri: string }, name: string) { this.uri = `${parent.uri}/${name}`; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.size || 0; }
    delete() { mockFiles.delete(this.uri); }
    move(target: { uri: string }) {
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = target.uri;
    }
  },
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(), readDirectoryAsync: jest.fn(), deleteAsync: jest.fn(),
  createDownloadResumable: jest.fn(), FileSystemSessionType: { BACKGROUND: 0 },
}));
jest.mock('./api', () => ({
  __esModule: true,
  default: { getMediaUrl: jest.fn(), getMediaDownloadHeaders: jest.fn() },
}));
jest.mock('./localDb', () => ({
  __esModule: true,
  default: {
    updatePostLocalMedia: jest.fn(), clearAllPostLocalMedia: jest.fn(), clearPostLocalMediaByFilename: jest.fn(),
  },
}));

const post: Post = {
  shortcode: 'reel1', url: '', username: '', title: '', summary: '', tags: [], music: '', category: '',
  content_type: 'instagram', local_filename: 'reel1.mp4', media_file_size: 1024,
};

beforeEach(() => {
  mockFiles.clear();
  jest.mocked(FileSystem.getInfoAsync).mockImplementation(async uri => {
    const info = mockFiles.get(uri);
    return (info ? { exists: true, isDirectory: false, uri, ...info } : { exists: false, uri }) as never;
  });
  jest.mocked(FileSystem.readDirectoryAsync).mockImplementation(async () => (
    [...mockFiles.keys()].map(uri => uri.slice(directoryUri.length + 1))
  ));
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async uri => { mockFiles.delete(uri); });
  jest.mocked(apiService.getMediaUrl).mockResolvedValue('https://api.example.com/api/v1/media/reel1.mp4');
  jest.mocked(apiService.getMediaDownloadHeaders).mockResolvedValue({ Authorization: 'Bearer test-token' });
  jest.mocked(localDb.updatePostLocalMedia).mockResolvedValue(undefined);
  jest.mocked(localDb.clearAllPostLocalMedia).mockResolvedValue(undefined);
  jest.mocked(localDb.clearPostLocalMediaByFilename).mockResolvedValue(undefined);
});

it('rejects missing, empty, directory, and truncated cached files', async () => {
  const uri = `${directoryUri}/reel1.mp4`;
  expect(await offlineMediaManager.checkFileExists(uri, 1024)).toBe(false);
  for (const info of [{ size: 0 }, { size: 1024, isDirectory: true }, { size: 512 }]) {
    mockFiles.set(uri, info);
    expect(await offlineMediaManager.checkFileExists(uri, 1024)).toBe(false);
  }
  mockFiles.set(uri, { size: 1024 });
  expect(await offlineMediaManager.checkFileExists(uri, 1024)).toBe(true);
  expect(await offlineMediaManager.checkFileExists(uri, 0)).toBe(true);
});

it('reuses a verified download and skips the server', async () => {
  const uri = `${directoryUri}/reel1.mp4`;
  mockFiles.set(uri, { size: 1024 });

  expect(await offlineMediaManager.ensurePostMediaDownloaded({ ...post, local_media_uri: uri })).toBe(uri);
  expect(apiService.getMediaUrl).not.toHaveBeenCalled();
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

it('recovers an existing canonical file when the stored URI is stale', async () => {
  const uri = `${directoryUri}/reel1.mp4`;
  mockFiles.set(uri, { size: 1024 });

  expect(await offlineMediaManager.ensurePostMediaDownloaded({ ...post, local_media_uri: 'file:///stale.mp4' })).toBe(uri);
  expect(localDb.updatePostLocalMedia).toHaveBeenCalledWith('reel1', uri, 'reel1.mp4', 1024);
  expect(apiService.getMediaUrl).not.toHaveBeenCalled();
});

it('downloads absent media and persists the completed local URI', async () => {
  const uri = `${directoryUri}/reel1.mp4`;
  const download = jest.spyOn(offlineMediaManager, 'downloadReelToDevice').mockResolvedValue(uri);

  expect(await offlineMediaManager.ensurePostMediaDownloaded(post)).toBe(uri);
  expect(download).toHaveBeenCalledWith('https://api.example.com/api/v1/media/reel1.mp4', 'reel1.mp4');
  expect(localDb.updatePostLocalMedia).toHaveBeenCalledWith('reel1', uri, 'reel1.mp4', 1024);
});

it('deduplicates simultaneous downloads and authenticates the single native request', async () => {
  let finishDownload!: (result: { status: number }) => void;
  const downloadAsync = jest.fn(() => new Promise(resolve => { finishDownload = resolve; }));
  jest.mocked(FileSystem.createDownloadResumable).mockReturnValue({ downloadAsync } as never);
  const first = offlineMediaManager.downloadReelToDevice('https://api.example.com/reel1.mp4', 'reel1.mp4');
  const second = offlineMediaManager.downloadReelToDevice('https://api.example.com/reel1.mp4', 'reel1.mp4');
  await Promise.resolve();

  expect(FileSystem.createDownloadResumable).toHaveBeenCalledTimes(1);
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(
    'https://api.example.com/reel1.mp4', `${directoryUri}/reel1.mp4.download`,
    expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }), expect.any(Function),
  );
  mockFiles.set(`${directoryUri}/reel1.mp4.download`, { size: 1024 });
  finishDownload({ status: 200 });
  await expect(Promise.all([first, second])).resolves.toEqual([`${directoryUri}/reel1.mp4`, `${directoryUri}/reel1.mp4`]);
  expect(mockFiles.has(`${directoryUri}/reel1.mp4.download`)).toBe(false);
});

it.each(['../secret.mp4', '/secret.mp4', 'sub\\secret.mp4', 'notes.txt'])('rejects an unsafe filename: %s', async filename => {
  await expect(offlineMediaManager.downloadReelToDevice('https://api.example.com/media', filename)).rejects.toThrow('Unsafe media filename');
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

it('reports only completed nonempty MP4s in device storage totals', async () => {
  mockFiles.set(`${directoryUri}/first.mp4`, { size: 100, modificationTime: 1000 });
  mockFiles.set(`${directoryUri}/second.mp4`, { size: 200, modificationTime: 2000 });
  mockFiles.set(`${directoryUri}/empty.mp4`, { size: 0 });
  mockFiles.set(`${directoryUri}/pending.mp4.download`, { size: 500 });
  mockFiles.set(`${directoryUri}/notes.txt`, { size: 500 });

  expect(await offlineMediaManager.getStorageSummary()).toEqual({
    fileCount: 2, totalBytes: 300, totalDiskSpaceBytes: 10000, availableDiskSpaceBytes: 8000,
    oldestModificationTime: 1000000, newestModificationTime: 2000000,
  });
});

it('clears all device pointers after successfully clearing the cache', async () => {
  mockFiles.set(`${directoryUri}/first.mp4`, { size: 100 });
  mockFiles.set(`${directoryUri}/second.mp4`, { size: 200 });

  expect(await offlineMediaManager.clearSavedReels()).toEqual({ deletedCount: 2, failedCount: 0, bytesFreed: 300 });
  expect(mockFiles.size).toBe(0);
  expect(localDb.clearAllPostLocalMedia).toHaveBeenCalledTimes(1);
});

it('preserves failed deletions and clears only pointers for files actually deleted', async () => {
  mockFiles.set(`${directoryUri}/first.mp4`, { size: 100 });
  mockFiles.set(`${directoryUri}/second.mp4`, { size: 200 });
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('Permission denied'));

  expect(await offlineMediaManager.clearSavedReels()).toEqual({ deletedCount: 1, failedCount: 1, bytesFreed: 200 });
  expect(localDb.clearAllPostLocalMedia).not.toHaveBeenCalled();
  expect(localDb.clearPostLocalMediaByFilename).toHaveBeenCalledWith('second.mp4');
  expect(mockFiles.has(`${directoryUri}/first.mp4`)).toBe(true);
});

it('deletes files strictly older than the configured age, preserving recent and unknown ages', async () => {
  const now = Date.UTC(2026, 8, 5);
  const day = 86400000;
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockFiles.set(`${directoryUri}/old.mp4`, { size: 100, modificationTime: (now - 31 * day) / 1000 });
  mockFiles.set(`${directoryUri}/boundary.mp4`, { size: 200, modificationTime: (now - 30 * day) / 1000 });
  mockFiles.set(`${directoryUri}/recent.mp4`, { size: 300, modificationTime: now / 1000 });
  mockFiles.set(`${directoryUri}/unknown.mp4`, { size: 400 });

  expect(await offlineMediaManager.deleteSavedReelsOlderThan(30)).toEqual({ deletedCount: 1, failedCount: 0, bytesFreed: 100 });
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  expect(localDb.clearPostLocalMediaByFilename).toHaveBeenCalledWith('old.mp4');
});
