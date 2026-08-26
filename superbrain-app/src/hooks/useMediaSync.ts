import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Post } from '../types';
import offlineMediaManager, {
  OfflineMediaDownloadProgress,
  OfflineMediaSyncResult,
} from '../services/OfflineMediaManager';

type UseMediaSyncOptions = {
  enabled?: boolean;
  concurrency?: number;
  autoStart?: boolean;
  onPostMediaCached?: (shortcode: string, localUri: string) => void;
};

type UseMediaSyncState = {
  syncing: boolean;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  storageBytes: number;
  lastError?: string;
  progressByFilename: Record<string, OfflineMediaDownloadProgress>;
};

const INITIAL_STATE: UseMediaSyncState = {
  syncing: false,
  pendingCount: 0,
  completedCount: 0,
  failedCount: 0,
  storageBytes: 0,
  progressByFilename: {},
};

function isMediaCandidate(post: Post): boolean {
  return (
    post.content_type !== 'webpage' &&
    typeof post.local_filename === 'string' &&
    post.local_filename.trim().length > 0
  );
}

export function useMediaSync(
  posts: Post[],
  options: UseMediaSyncOptions = {},
): UseMediaSyncState & {
  syncNow: (targetPosts?: Post[]) => Promise<OfflineMediaSyncResult[]>;
  refreshStorageBytes: () => Promise<number>;
} {
  const {
    enabled = true,
    concurrency = 2,
    autoStart = true,
    onPostMediaCached,
  } = options;
  const [state, setState] = useState<UseMediaSyncState>(INITIAL_STATE);
  const lastAutoSyncKeyRef = useRef('');
  const runIdRef = useRef(0);

  const mediaPosts = useMemo(() => posts.filter(isMediaCandidate), [posts]);
  const mediaSyncKey = useMemo(
    () => mediaPosts
      .map(post => [
        post.shortcode,
        post.local_filename || '',
        post.media_file_size || 0,
      ].join(':'))
      .join('|'),
    [mediaPosts]
  );

  const refreshStorageBytes = useCallback(async () => {
    const storageBytes = await offlineMediaManager.getSavedReelsStorageBytes();
    setState(current => ({ ...current, storageBytes }));
    return storageBytes;
  }, []);

  const syncNow = useCallback(async (
    targetPosts: Post[] = mediaPosts,
  ): Promise<OfflineMediaSyncResult[]> => {
    if (!enabled) {
      return [];
    }

    const candidates = targetPosts.filter(isMediaCandidate);
    if (candidates.length === 0) {
      await refreshStorageBytes();
      return [];
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    setState(current => ({
      ...current,
      syncing: true,
      pendingCount: candidates.length,
      completedCount: 0,
      failedCount: 0,
      lastError: undefined,
    }));

    try {
      const results = await offlineMediaManager.syncPostsMedia(candidates, concurrency);
      const failed = results.filter(result => result.error);
      results.forEach(result => {
        if (result.localUri) {
          onPostMediaCached?.(result.shortcode, result.localUri);
        }
      });

      if (runIdRef.current === runId) {
        setState(current => ({
          ...current,
          syncing: false,
          pendingCount: 0,
          completedCount: results.length - failed.length,
          failedCount: failed.length,
          lastError: failed[0]?.error,
        }));
        await refreshStorageBytes();
      }

      return results;
    } catch (error: any) {
      if (runIdRef.current === runId) {
        setState(current => ({
          ...current,
          syncing: false,
          pendingCount: 0,
          failedCount: candidates.length,
          lastError: error?.message || 'Media sync failed',
        }));
      }
      return [];
    }
  }, [concurrency, enabled, mediaPosts, onPostMediaCached, refreshStorageBytes]);

  useEffect(() => {
    return offlineMediaManager.subscribe(progress => {
      setState(current => ({
        ...current,
        progressByFilename: {
          ...current.progressByFilename,
          [progress.filename]: progress,
        },
      }));
    });
  }, []);

  useEffect(() => {
    if (!enabled || !autoStart || !mediaSyncKey || mediaSyncKey === lastAutoSyncKeyRef.current) {
      return;
    }

    lastAutoSyncKeyRef.current = mediaSyncKey;
    syncNow().catch(error => {
      setState(current => ({
        ...current,
        syncing: false,
        lastError: error?.message || 'Media sync failed',
      }));
    });
  }, [autoStart, enabled, mediaSyncKey, syncNow]);

  return {
    ...state,
    syncNow,
    refreshStorageBytes,
  };
}

export default useMediaSync;
