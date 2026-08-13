/**
 * Local SQLite database for SuperBrain (expo-sqlite).
 *
 * Stores posts on the device file system at:
 *   /data/data/<package>/databases/superbrain_local.db
 *
 * This replaces the old AsyncStorage-based cache and has:
 *  • No storage limit (only device disk)
 *  • Instant reads (no JSON parse overhead)
 *  • Proper SQL queries (search, filter, sort)
 *  • Persistence across app restarts — no re-fetch needed
 */

import * as SQLite from 'expo-sqlite';
import { Post } from '../types';

const DB_NAME = 'superbrain_local.db';

let _db: SQLite.SQLiteDatabase | null = null;

// ─── Database lifecycle ────────────────────────────────────────────

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync('PRAGMA journal_mode = WAL;');
  await createTables(_db);
  return _db;
}

async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS posts (
      shortcode     TEXT PRIMARY KEY,
      url           TEXT,
      username      TEXT,
      content_type  TEXT DEFAULT 'instagram',
      analyzed_at   TEXT,
      updated_at    TEXT,
      post_date     TEXT,
      likes         INTEGER DEFAULT 0,
      thumbnail     TEXT DEFAULT '',
      title         TEXT,
      summary       TEXT,
      tags          TEXT DEFAULT '[]',
      music         TEXT,
      category      TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_posts_analyzed_at ON posts(analyzed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category    ON posts(category);
    CREATE INDEX IF NOT EXISTS idx_posts_updated_at  ON posts(updated_at);
  `);
}

// ─── Post CRUD ─────────────────────────────────────────────────────

/** Convert a raw DB row into the Post type used by the UI. */
function rowToPost(row: any): Post {
  const post: Post = {
    shortcode: row.shortcode,
    url: row.url ?? '',
    username: row.username ?? '',
    title: row.title ?? '',
    summary: row.summary ?? '',
    tags: [],
    music: row.music ?? '',
    category: row.category ?? '',
    content_type: row.content_type ?? 'instagram',
    thumbnail: row.thumbnail ?? '',
    thumbnail_url: row.thumbnail ?? '',
    likes: row.likes ?? 0,
    post_date: row.post_date ?? undefined,
    analyzed_at: row.analyzed_at ?? undefined,
  };
  // Parse JSON tags
  if (row.tags) {
    try {
      post.tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags;
    } catch {
      post.tags = [];
    }
  }
  return post;
}

/** Bulk upsert posts from backend sync. */
async function upsertPosts(posts: Post[]): Promise<void> {
  if (posts.length === 0) return;
  const db = await getDb();
  // Use a single transaction for performance
  await db.withTransactionAsync(async () => {
    for (const p of posts) {
      const tagsJson = Array.isArray(p.tags) ? JSON.stringify(p.tags) : (p.tags || '[]');
      await db.runAsync(
        `INSERT OR REPLACE INTO posts
          (shortcode, url, username, content_type, analyzed_at, updated_at,
           post_date, likes, thumbnail, title, summary, tags, music, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.shortcode,
          p.url ?? '',
          p.username ?? '',
          p.content_type ?? 'instagram',
          p.analyzed_at ?? null,
          (p as any).updated_at ?? null,
          p.post_date ?? null,
          p.likes ?? 0,
          p.thumbnail_url || p.thumbnail || '',
          p.title ?? '',
          p.summary ?? '',
          tagsJson,
          p.music ?? '',
          p.category ?? '',
        ]
      );
    }
  });
}

/** Get all posts ordered by analyzed_at DESC. */
async function getAllPosts(): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM posts ORDER BY analyzed_at DESC'
  );
  return rows.map(rowToPost);
}

/** Get posts by category. */
async function getPostsByCategory(category: string): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM posts WHERE category = ? ORDER BY analyzed_at DESC',
    [category]
  );
  return rows.map(rowToPost);
}

/** Search posts across title, summary, tags. */
async function searchPosts(query: string): Promise<Post[]> {
  const db = await getDb();
  const like = `%${query}%`;
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM posts
     WHERE LOWER(title) LIKE LOWER(?)
        OR LOWER(summary) LIKE LOWER(?)
        OR LOWER(tags) LIKE LOWER(?)
     ORDER BY analyzed_at DESC`,
    [like, like, like]
  );
  return rows.map(rowToPost);
}

/** Delete a single post from local DB. */
async function deletePost(shortcode: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM posts WHERE shortcode = ?', [shortcode]);
}

/** Delete multiple posts by shortcode. */
async function deletePosts(shortcodes: string[]): Promise<void> {
  if (shortcodes.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const sc of shortcodes) {
      await db.runAsync('DELETE FROM posts WHERE shortcode = ?', [sc]);
    }
  });
}

/** Get total post count. */
async function getPostCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM posts'
  );
  return row?.cnt ?? 0;
}

/** Get a single post by shortcode. */
async function getPost(shortcode: string): Promise<Post | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM posts WHERE shortcode = ?',
    [shortcode]
  );
  return row ? rowToPost(row) : null;
}

/** Update specific fields on a post. */
async function updatePost(
  shortcode: string,
  updates: Partial<Pick<Post, 'title' | 'summary' | 'category'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.summary !== undefined) { sets.push('summary = ?'); vals.push(updates.summary); }
  if (updates.category !== undefined) { sets.push('category = ?'); vals.push(updates.category); }
  if (sets.length === 0) return;
  vals.push(shortcode);
  await db.runAsync(
    `UPDATE posts SET ${sets.join(', ')} WHERE shortcode = ?`,
    vals
  );
}

// ─── Sync metadata ─────────────────────────────────────────────────

async function getLastSyncTime(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'last_synced_at'"
  );
  return row?.value ?? null;
}

async function setLastSyncTime(isoTimestamp: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_synced_at', ?)",
    [isoTimestamp]
  );
}

async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
    [key, value]
  );
}

// ─── Utilities ─────────────────────────────────────────────────────

/** Drop all data — used for hard reset. */
async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM posts; DELETE FROM sync_meta;');
}

/** Check if the local DB has any posts at all. */
async function isEmpty(): Promise<boolean> {
  return (await getPostCount()) === 0;
}

// ─── Export ────────────────────────────────────────────────────────

const localDb = {
  getDb,
  upsertPosts,
  getAllPosts,
  getPostsByCategory,
  searchPosts,
  deletePost,
  deletePosts,
  getPostCount,
  getPost,
  updatePost,
  getLastSyncTime,
  setLastSyncTime,
  getSyncMeta,
  setSyncMeta,
  clearAll,
  isEmpty,
};

export default localDb;
