import AsyncStorage from '@react-native-async-storage/async-storage';
import { Collection } from '../types';
import apiService from './api';

const COLLECTIONS_KEY = '@superbrain_collections';
const PENDING_SYNC_KEY = '@superbrain_pending_sync';

// ─────────────────────────────────────────────────────────────────
// Offline pending-sync queue
// ─────────────────────────────────────────────────────────────────

type PendingMutation =
  | { type: 'upsert'; collection: Collection }
  | { type: 'update_posts'; id: string; postIds: string[] }
  | { type: 'delete'; id: string };

function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as any;
  if (err.response !== undefined) return false; // got HTTP response → server error, not offline
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  return (
    code === 'ECONNABORTED' ||
    code === 'ERR_NETWORK' ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused')
  );
}

async function loadPending(): Promise<PendingMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function savePending(mutations: PendingMutation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(mutations));
  } catch { /* best effort */ }
}

async function enqueueMutation(mutation: PendingMutation): Promise<void> {
  const pending = await loadPending();
  const id = mutation.type === 'upsert' ? mutation.collection.id : mutation.id;
  // De-duplicate: replace older entry of same type+id
  const filtered = pending.filter(m => {
    const mId = m.type === 'upsert' ? m.collection.id : m.id;
    return !(mId === id && m.type === mutation.type);
  });
  filtered.push(mutation);
  await savePending(filtered);
}

/** Replay all pending mutations. Removes ones that succeed or get a 4xx. Keeps network failures. */
async function flushPendingMutations(): Promise<void> {
  const pending = await loadPending();
  if (pending.length === 0) return;
  console.log(`[Collections] flushing ${pending.length} pending mutation(s)`);
  const remaining: PendingMutation[] = [];
  for (const m of pending) {
    try {
      if (m.type === 'upsert') {
        await apiService.upsertCollection(m.collection);
      } else if (m.type === 'update_posts') {
        await apiService.updateCollectionPosts(m.id, m.postIds);
      } else if (m.type === 'delete') {
        await apiService.deleteCollection(m.id);
      }
    } catch (e) {
      if (isNetworkError(e)) remaining.push(m); // keep for next flush
      // else discard (4xx/5xx = permanent error)
    }
  }
  await savePending(remaining);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function clean(collections: Collection[]): Collection[] {
  return collections.map(col => ({
    ...col,
    postIds: (col.postIds || []).filter((id: string) => id && id.trim()),
  }));
}

const DEFAULT_WATCH_LATER: Collection = {
  id: 'default_watch_later',
  name: 'Watch Later',
  icon: '⏰',
  postIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─────────────────────────────────────────────────────────────────
// Local cache helpers
// ─────────────────────────────────────────────────────────────────

async function readLocal(): Promise<Collection[]> {
  try {
    const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
    let cols: Collection[] = raw ? JSON.parse(raw) : [];
    if (cols.length === 0) cols = [{ ...DEFAULT_WATCH_LATER }];
    return clean(cols);
  } catch {
    return [{ ...DEFAULT_WATCH_LATER }];
  }
}

async function writeLocal(collections: Collection[]): Promise<void> {
  try {
    await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(clean(collections)));
  } catch (e) {
    console.error('Error saving collections locally:', e);
  }
}

// ─────────────────────────────────────────────────────────────────
// Backend sync helpers
// ─────────────────────────────────────────────────────────────────

async function isBackendAvailable(): Promise<boolean> {
  try {
    const token = await apiService.getApiToken();
    return !!token;
  } catch {
    return false;
  }
}

/** Pull latest from backend and overwrite local cache. Returns the collections. */
async function pullFromBackend(): Promise<Collection[] | null> {
  try {
    const remote = await apiService.getCollections();
    if (remote && remote.length > 0) {
      await writeLocal(remote);
      return clean(remote);
    }
    return null;
  } catch (e) {
    console.warn('[Collections] pull from backend failed:', e);
    return null;
  }
}

/** Try to push upsert; enqueue if offline. */
async function pushUpsert(col: Collection): Promise<void> {
  try {
    await apiService.upsertCollection(col);
  } catch (e) {
    if (isNetworkError(e)) await enqueueMutation({ type: 'upsert', collection: col });
    else console.warn('[Collections] push upsert failed:', e);
  }
}

/** Try to push post_ids; enqueue if offline. */
async function pushPostIds(collectionId: string, postIds: string[]): Promise<void> {
  try {
    await apiService.updateCollectionPosts(collectionId, postIds);
  } catch (e) {
    if (isNetworkError(e)) await enqueueMutation({ type: 'update_posts', id: collectionId, postIds });
    else console.warn('[Collections] push postIds failed:', e);
  }
}

/** Try to push delete; enqueue if offline. */
async function pushDelete(id: string): Promise<void> {
  try {
    await apiService.deleteCollection(id);
  } catch (e) {
    if (isNetworkError(e)) await enqueueMutation({ type: 'delete', id });
    else console.warn('[Collections] push delete failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────

class CollectionsService {

  /**
   * Sync from backend on startup. Call this once after the token is confirmed.
   * First flushes any offline mutations, then pulls authoritative server state.
   */
  async syncFromBackend(): Promise<void> {
    await flushPendingMutations();
    const remote = await pullFromBackend();
    if (remote) {
      console.log('[Collections] synced from backend:', remote.length, 'collections');
    }
  }

  async getCollections(): Promise<Collection[]> {
    // Try backend first; fall back to local cache
    if (await isBackendAvailable()) {
      const remote = await pullFromBackend();
      if (remote) return remote;
    }
    return readLocal();
  }

  async saveCollections(collections: Collection[]): Promise<void> {
    const cleaned = clean(collections);
    await writeLocal(cleaned);
    for (const col of cleaned) pushUpsert(col);
  }

  async createCollection(name: string, icon: string): Promise<Collection> {
    const newCol: Collection = {
      id: Date.now().toString(),
      name,
      icon,
      postIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const cols = await readLocal();
    cols.push(newCol);
    await writeLocal(cols);
    pushUpsert(newCol);
    return newCol;
  }

  async updateCollection(id: string, updates: Partial<Collection>): Promise<void> {
    const cols = await readLocal();
    const idx = cols.findIndex(c => c.id === id);
    if (idx !== -1) {
      cols[idx] = { ...cols[idx], ...updates, updatedAt: new Date().toISOString() };
      await writeLocal(cols);
      pushUpsert(cols[idx]);
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const cols = await readLocal();
    await writeLocal(cols.filter(c => c.id !== id));
    pushDelete(id);
  }

  async addPostToCollection(collectionId: string, postId: string): Promise<void> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    if (col && !col.postIds.includes(postId)) {
      col.postIds.push(postId);
      col.updatedAt = new Date().toISOString();
      await writeLocal(cols);
      pushPostIds(collectionId, col.postIds);
    }
  }

  async removePostFromCollection(collectionId: string, postId: string): Promise<void> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    if (col) {
      col.postIds = col.postIds.filter(id => id !== postId);
      col.updatedAt = new Date().toISOString();
      await writeLocal(cols);
      pushPostIds(collectionId, col.postIds);
    }
  }

  async getCollectionPosts(collectionId: string): Promise<string[]> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    return col ? col.postIds : [];
  }
}

export const collectionsService = new CollectionsService();
export default collectionsService;
