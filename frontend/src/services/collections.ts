import AsyncStorage from '@react-native-async-storage/async-storage';
import { Collection } from '../types';
import apiService from './api';

const COLLECTIONS_KEY = '@superbrain_collections';

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

/** Push a single updated collection to backend silently (fire-and-forget). */
function pushCollectionToBackend(col: Collection): void {
  isBackendAvailable().then(ok => {
    if (!ok) return;
    apiService.upsertCollection(col).catch(e =>
      console.warn('[Collections] push upsert failed:', e)
    );
  });
}

/** Push only the post_ids for a collection to backend silently. */
function pushPostIdsToBackend(collectionId: string, postIds: string[]): void {
  isBackendAvailable().then(ok => {
    if (!ok) return;
    apiService.updateCollectionPosts(collectionId, postIds).catch(e =>
      console.warn('[Collections] push postIds failed:', e)
    );
  });
}

// ─────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────

class CollectionsService {

  /**
   * Sync from backend on startup. Call this once after the token is confirmed.
   * Overwrites local cache with server data so fresh installs restore their library.
   */
  async syncFromBackend(): Promise<void> {
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
    // Push each collection to backend in background
    if (await isBackendAvailable()) {
      for (const col of cleaned) {
        apiService.upsertCollection(col).catch(() => {});
      }
    }
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
    pushCollectionToBackend(newCol);
    return newCol;
  }

  async updateCollection(id: string, updates: Partial<Collection>): Promise<void> {
    const cols = await readLocal();
    const idx = cols.findIndex(c => c.id === id);
    if (idx !== -1) {
      cols[idx] = { ...cols[idx], ...updates, updatedAt: new Date().toISOString() };
      await writeLocal(cols);
      pushCollectionToBackend(cols[idx]);
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const cols = await readLocal();
    await writeLocal(cols.filter(c => c.id !== id));
    if (await isBackendAvailable()) {
      apiService.deleteCollection(id).catch(() => {});
    }
  }

  async addPostToCollection(collectionId: string, postId: string): Promise<void> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    if (col && !col.postIds.includes(postId)) {
      col.postIds.push(postId);
      col.updatedAt = new Date().toISOString();
      await writeLocal(cols);
      pushPostIdsToBackend(collectionId, col.postIds);
    }
  }

  async removePostFromCollection(collectionId: string, postId: string): Promise<void> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    if (col) {
      col.postIds = col.postIds.filter(id => id !== postId);
      col.updatedAt = new Date().toISOString();
      await writeLocal(cols);
      pushPostIdsToBackend(collectionId, col.postIds);
    }
  }

  async getCollectionPosts(collectionId: string): Promise<string[]> {
    const cols = await readLocal();
    const col = cols.find(c => c.id === collectionId);
    return col ? col.postIds : [];
  }
}

export default new CollectionsService();
