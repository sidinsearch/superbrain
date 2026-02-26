#!/usr/bin/env python3
"""
SQLite Database Manager for SuperBrain
Handles caching and retrieval of Instagram analysis results
Self-hosted, zero-config, file-based database
"""

import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime

# Database file lives at the backend root
DB_PATH = Path(__file__).resolve().parent.parent / 'superbrain.db'


class Database:
    """SQLite database manager with caching functionality"""

    def __init__(self):
        self.db_path = DB_PATH
        self._conn = None
        self._connect()

    def _connect(self):
        try:
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            # WAL mode for better concurrent read performance
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._create_tables()
            print(f"✓ Connected to SQLite database: {self.db_path}")
        except Exception as e:
            print(f"⚠️  SQLite connection failed: {e}")
            self._conn = None

    def _create_tables(self):
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS analyses (
                shortcode           TEXT PRIMARY KEY,
                url                 TEXT,
                username            TEXT,
                content_type        TEXT DEFAULT 'instagram',
                analyzed_at         TEXT,
                updated_at          TEXT,
                post_date           TEXT,
                likes               INTEGER DEFAULT 0,
                thumbnail           TEXT DEFAULT '',
                title               TEXT,
                summary             TEXT,
                tags                TEXT,
                music               TEXT,
                category            TEXT,
                visual_analysis     TEXT,
                audio_transcription TEXT,
                text_analysis       TEXT
            );

            CREATE TABLE IF NOT EXISTS processing_queue (
                shortcode   TEXT PRIMARY KEY,
                url         TEXT,
                status      TEXT DEFAULT 'queued',
                position    INTEGER,
                added_at    TEXT,
                started_at  TEXT,
                updated_at  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_analyses_category    ON analyses (category);
            CREATE INDEX IF NOT EXISTS idx_analyses_analyzed_at ON analyses (analyzed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_queue_status         ON processing_queue (status);
            CREATE INDEX IF NOT EXISTS idx_queue_position       ON processing_queue (position);
        """)
        self._conn.commit()

        # Migration: add content_type to databases that predate this column
        try:
            self._conn.execute("ALTER TABLE analyses ADD COLUMN content_type TEXT DEFAULT 'instagram'")
            self._conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists – expected on most runs

        # Migration: add thumbnail column
        try:
            self._conn.execute("ALTER TABLE analyses ADD COLUMN thumbnail TEXT DEFAULT ''")
            self._conn.commit()
        except sqlite3.OperationalError:
            pass

        # Migration: add retry columns to processing_queue
        for _col, _dflt in [
            ("retry_after",  "TEXT"),
            ("attempts",     "INTEGER DEFAULT 0"),
            ("reason",       "TEXT"),
            ("content_type", "TEXT"),
        ]:
            try:
                self._conn.execute(
                    f"ALTER TABLE processing_queue ADD COLUMN {_col} {_dflt}"
                )
                self._conn.commit()
            except sqlite3.OperationalError:
                pass  # already exists

        try:
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_queue_retry ON processing_queue (status, retry_after)"
            )
            self._conn.commit()
        except sqlite3.OperationalError:
            pass

        # Create content_type index only after the column is guaranteed to exist
        try:
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_analyses_content_type ON analyses (content_type)"
            )
            self._conn.commit()
        except sqlite3.OperationalError:
            pass

        # Migration: add is_hidden for soft-delete support
        try:
            self._conn.execute("ALTER TABLE analyses ADD COLUMN is_hidden INTEGER DEFAULT 0")
            self._conn.commit()
        except sqlite3.OperationalError:
            pass

        # Collections table
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS collections (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                icon        TEXT DEFAULT '📁',
                post_ids    TEXT DEFAULT '[]',
                created_at  TEXT,
                updated_at  TEXT
            );
        """)
        self._conn.commit()
        # Seed default Watch Later if missing
        cur = self._conn.cursor()
        cur.execute("SELECT id FROM collections WHERE id = 'default_watch_later'")
        if cur.fetchone() is None:
            now = datetime.utcnow().isoformat()
            self._conn.execute(
                "INSERT INTO collections (id, name, icon, post_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ('default_watch_later', 'Watch Later', '⏰', '[]', now, now)
            )
            self._conn.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _row_to_dict(self, row):
        if row is None:
            return None
        d = dict(row)
        if d.get('tags'):
            try:
                d['tags'] = json.loads(d['tags'])
            except Exception:
                d['tags'] = []
        else:
            d['tags'] = []
        return d
    
    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def is_connected(self):
        return self._conn is not None

    # ------------------------------------------------------------------
    # Cache / Analyses
    # ------------------------------------------------------------------

    def check_cache(self, shortcode):
        """Return cached analysis dict or None."""
        if not self.is_connected():
            return None
        try:
            cur = self._conn.cursor()
            cur.execute("SELECT * FROM analyses WHERE shortcode = ?", (shortcode,))
            return self._row_to_dict(cur.fetchone())
        except Exception as e:
            print(f"⚠️  Cache lookup error: {e}")
            return None

    def save_analysis(self, shortcode, url, username, title, summary, tags, music, category,
                      visual_analysis="", audio_transcription="", text_analysis="",
                      likes=0, post_date=None, content_type="instagram", thumbnail=""):
        """Insert or update an analysis record. Returns True on success."""
        if not self.is_connected():
            print("⚠️  Database not connected. Analysis not saved.")
            return False
        try:
            print(f"📝 Saving to database with shortcode: {shortcode}")
            now = datetime.utcnow().isoformat()
            tags_json = json.dumps(tags if isinstance(tags, list) else tags.split())

            self._conn.execute("""
                INSERT INTO analyses
                    (shortcode, url, username, content_type, analyzed_at, updated_at, post_date, likes,
                     thumbnail, title, summary, tags, music, category,
                     visual_analysis, audio_transcription, text_analysis)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(shortcode) DO UPDATE SET
                    url                 = excluded.url,
                    username            = excluded.username,
                    content_type        = excluded.content_type,
                    updated_at          = excluded.updated_at,
                    post_date           = excluded.post_date,
                    likes               = excluded.likes,
                    thumbnail           = excluded.thumbnail,
                    title               = excluded.title,
                    summary             = excluded.summary,
                    tags                = excluded.tags,
                    music               = excluded.music,
                    category            = excluded.category,
                    visual_analysis     = excluded.visual_analysis,
                    audio_transcription = excluded.audio_transcription,
                    text_analysis       = excluded.text_analysis
            """, (shortcode, url, username, content_type, now, now, post_date, likes,
                  thumbnail, title, summary, tags_json, music, category,
                  visual_analysis, audio_transcription, text_analysis))
            self._conn.commit()
            print(f"✓ Analysis saved to database ({shortcode})")
            return True
        except Exception as e:
            print(f"⚠️  Error saving to database: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def get_recent(self, limit=10):
        """Return the most recently analysed posts (excludes soft-deleted)."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT * FROM analyses WHERE (is_hidden IS NULL OR is_hidden = 0) ORDER BY analyzed_at DESC LIMIT ?", (limit,)
            )
            return [self._row_to_dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error retrieving recent: {e}")
            return []

    def get_by_category(self, category, limit=20):
        """Return all analyses for a given category (excludes soft-deleted)."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT * FROM analyses WHERE category = ? AND (is_hidden IS NULL OR is_hidden = 0) ORDER BY analyzed_at DESC LIMIT ?",
                (category, limit)
            )
            return [self._row_to_dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error retrieving by category: {e}")
            return []

    def search_tags(self, tags, limit=20):
        """
        Search analyses by one or more tags (case-insensitive substring match
        against the JSON-encoded tags column).

        Args:
            tags: str or list[str]
            limit: int
        """
        if not self.is_connected():
            return []
        try:
            if isinstance(tags, str):
                tags = [tags]
            cur = self._conn.cursor()
            conditions = " OR ".join(["LOWER(tags) LIKE ?" for _ in tags])
            params = [f"%{t.lower()}%" for t in tags] + [limit]
            cur.execute(
                f"SELECT * FROM analyses WHERE ({conditions}) AND (is_hidden IS NULL OR is_hidden = 0) ORDER BY analyzed_at DESC LIMIT ?",
                params
            )
            return [self._row_to_dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error searching tags: {e}")
            return []

    def get_stats(self):
        """Return basic statistics about the database."""
        if not self.is_connected():
            return {"document_count": 0, "storage_mb": 0, "categories": {}, "capacity_used": "N/A"}
        try:
            cur = self._conn.cursor()

            cur.execute("SELECT COUNT(*) FROM analyses")
            total = cur.fetchone()[0]

            cur.execute(
                "SELECT COALESCE(category,'Uncategorized') as cat, COUNT(*) as cnt "
                "FROM analyses GROUP BY cat"
            )
            category_counts = {r["cat"]: r["cnt"] for r in cur.fetchall()}

            storage_bytes = self.db_path.stat().st_size if self.db_path.exists() else 0
            storage_mb = round(storage_bytes / (1024 * 1024), 2)

            return {
                "document_count": total,
                "storage_mb": storage_mb,
                "categories": category_counts,
                "capacity_used": "N/A (local SQLite)"
            }
        except Exception as e:
            print(f"⚠️  Error getting stats: {e}")
            return {"document_count": 0, "storage_mb": 0, "categories": {}, "capacity_used": "N/A"}

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
    
    # ==================== RETRY QUEUE ====================

    def queue_for_retry(self, shortcode: str, url: str, content_type: str,
                        reason: str, retry_hours: float = 24.0) -> bool:
        """
        Schedule an item to be retried after `retry_hours` from now.
        Sets status='retry' and populates retry_after, reason, content_type.
        Returns True on success.
        """
        if not self.is_connected():
            return False
        try:
            from datetime import timezone, timedelta
            now      = datetime.utcnow()
            retry_at = (now + timedelta(hours=retry_hours)).isoformat()
            now_str  = now.isoformat()

            # Get current attempts count
            cur = self._conn.cursor()
            cur.execute(
                "SELECT attempts FROM processing_queue WHERE shortcode = ?", (shortcode,)
            )
            row = cur.fetchone()
            attempts = (row["attempts"] or 0) + 1 if row else 1

            self._conn.execute("""
                INSERT INTO processing_queue
                    (shortcode, url, content_type, status, position,
                     added_at, updated_at, retry_after, attempts, reason)
                VALUES (?, ?, ?, 'retry', 0, ?, ?, ?, ?, ?)
                ON CONFLICT(shortcode) DO UPDATE SET
                    url          = excluded.url,
                    content_type = excluded.content_type,
                    status       = 'retry',
                    updated_at   = excluded.updated_at,
                    retry_after  = excluded.retry_after,
                    attempts     = excluded.attempts,
                    reason       = excluded.reason
            """, (shortcode, url, content_type, now_str, now_str,
                  retry_at, attempts, reason))
            self._conn.commit()
            print(f"⏰ Queued for retry in {retry_hours:.0f}h: {shortcode} ({reason})")
            return True
        except Exception as e:
            print(f"⚠️  Error queuing for retry: {e}")
            return False

    def get_retry_ready(self):
        """Return retry items whose retry_after time has passed."""
        if not self.is_connected():
            return []
        try:
            now = datetime.utcnow().isoformat()
            cur = self._conn.cursor()
            cur.execute("""
                SELECT shortcode, url, content_type, reason, attempts, retry_after
                FROM processing_queue
                WHERE status = 'retry' AND retry_after <= ?
                ORDER BY retry_after
            """, (now,))
            return [
                {
                    "shortcode":    r["shortcode"],
                    "url":          r["url"],
                    "content_type": r["content_type"],
                    "reason":       r["reason"],
                    "attempts":     r["attempts"],
                    "retry_after":  r["retry_after"],
                }
                for r in cur.fetchall()
            ]
        except Exception as e:
            print(f"⚠️  Error getting retry-ready items: {e}")
            return []

    def get_retry_queue(self):
        """Return all items currently awaiting retry (status='retry')."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute("""
                SELECT shortcode, url, content_type, reason, attempts,
                       retry_after, added_at
                FROM processing_queue
                WHERE status = 'retry'
                ORDER BY retry_after
            """)
            return [dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error getting retry queue: {e}")
            return []

    # ==================== QUEUE MANAGEMENT ====================

    def add_to_queue(self, shortcode, url):
        """Add item to processing queue. Returns queue position (1-based), or -1 on error."""
        if not self.is_connected():
            return -1
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT status, position FROM processing_queue WHERE shortcode = ?", (shortcode,)
            )
            existing = cur.fetchone()
            if existing:
                if existing["status"] == "queued":
                    return existing["position"]
                if existing["status"] == "processing":
                    return 0

            cur.execute(
                "SELECT MAX(position) FROM processing_queue WHERE status = 'queued'"
            )
            row = cur.fetchone()
            position = (row[0] + 1) if row[0] is not None else 1

            now = datetime.utcnow().isoformat()
            self._conn.execute("""
                INSERT INTO processing_queue (shortcode, url, status, position, added_at, updated_at)
                VALUES (?, ?, 'queued', ?, ?, ?)
                ON CONFLICT(shortcode) DO UPDATE SET
                    url        = excluded.url,
                    status     = 'queued',
                    position   = excluded.position,
                    updated_at = excluded.updated_at
            """, (shortcode, url, position, now, now))
            self._conn.commit()
            return position
        except Exception as e:
            print(f"⚠️  Error adding to queue: {e}")
            return -1

    def get_queue(self):
        """Return list of queued items ordered by position."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT shortcode, url, position FROM processing_queue "
                "WHERE status = 'queued' ORDER BY position"
            )
            return [
                {"shortcode": r["shortcode"], "url": r["url"], "position": r["position"]}
                for r in cur.fetchall()
            ]
        except Exception as e:
            print(f"⚠️  Error getting queue: {e}")
            return []

    def get_processing(self):
        """Return list of shortcodes currently being processed."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT shortcode FROM processing_queue WHERE status = 'processing'"
            )
            return [r["shortcode"] for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error getting processing items: {e}")
            return []

    def mark_processing(self, shortcode):
        """Mark a queued item as currently processing."""
        if not self.is_connected():
            return False
        try:
            now = datetime.utcnow().isoformat()
            self._conn.execute("""
                UPDATE processing_queue
                SET status = 'processing', started_at = ?, updated_at = ?
                WHERE shortcode = ?
            """, (now, now, shortcode))
            self._conn.commit()
            return True
        except Exception as e:
            print(f"⚠️  Error marking as processing: {e}")
            return False

    def remove_from_queue(self, shortcode):
        """Remove an item from the queue and compact positions."""
        if not self.is_connected():
            return False
        try:
            self._conn.execute(
                "DELETE FROM processing_queue WHERE shortcode = ?", (shortcode,)
            )
            self._conn.commit()

            cur = self._conn.cursor()
            cur.execute(
                "SELECT shortcode FROM processing_queue "
                "WHERE status = 'queued' ORDER BY position"
            )
            for idx, item in enumerate(cur.fetchall(), 1):
                self._conn.execute(
                    "UPDATE processing_queue SET position = ? WHERE shortcode = ?",
                    (idx, item["shortcode"])
                )
            self._conn.commit()
            return True
        except Exception as e:
            print(f"⚠️  Error removing from queue: {e}")
            return False

    def recover_interrupted_items(self):
        """
        Move items stuck in 'processing' back to 'queued' (e.g. after a crash).
        Returns the number of items recovered.
        """
        if not self.is_connected():
            return 0
        try:
            now = datetime.utcnow().isoformat()
            cur = self._conn.cursor()
            cur.execute("""
                UPDATE processing_queue
                SET status = 'queued', updated_at = ?
                WHERE status = 'processing'
            """, (now,))
            count = cur.rowcount
            self._conn.commit()

            cur.execute(
                "SELECT shortcode FROM processing_queue "
                "WHERE status = 'queued' ORDER BY added_at"
            )
            for idx, item in enumerate(cur.fetchall(), 1):
                self._conn.execute(
                    "UPDATE processing_queue SET position = ? WHERE shortcode = ?",
                    (idx, item["shortcode"])
                )
            self._conn.commit()

            if count > 0:
                print(f"🔄 Recovered {count} interrupted items")
            return count
        except Exception as e:
            print(f"⚠️  Error recovering items: {e}")
            return 0
    
    # ------------------------------------------------------------------
    # Post management
    # ------------------------------------------------------------------

    def delete_post(self, shortcode):
        """Soft-delete a post (is_hidden=1). Data kept for re-add reuse. Returns True if updated."""
        if not self.is_connected():
            return False
        try:
            cur = self._conn.execute(
                "UPDATE analyses SET is_hidden = 1, updated_at = ? WHERE shortcode = ?",
                (datetime.utcnow().isoformat(), shortcode)
            )
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error soft-deleting post: {e}")
            return False

    def hard_delete_post(self, shortcode):
        """Permanently remove a post row — used for force re-analysis. Returns True if deleted."""
        if not self.is_connected():
            return False
        try:
            cur = self._conn.execute(
                "DELETE FROM analyses WHERE shortcode = ?",
                (shortcode,)
            )
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error hard-deleting post: {e}")
            return False

    def restore_post(self, shortcode):
        """Restore a soft-deleted post (is_hidden=0). Returns True if updated."""
        if not self.is_connected():
            return False
        try:
            cur = self._conn.execute(
                "UPDATE analyses SET is_hidden = 0, updated_at = ? WHERE shortcode = ?",
                (datetime.utcnow().isoformat(), shortcode)
            )
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error restoring post: {e}")
            return False

    def update_post(self, shortcode, updates):
        """
        Update specific fields of a post.

        Args:
            shortcode: Instagram post shortcode
            updates: dict of allowed fields (category, title, summary)

        Returns:
            bool: True if updated
        """
        if not self.is_connected():
            return False
        try:
            updates["updated_at"] = datetime.utcnow().isoformat()
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [shortcode]
            cur = self._conn.execute(
                f"UPDATE analyses SET {set_clause} WHERE shortcode = ?", values
            )
            self._conn.commit()
            if cur.rowcount == 0:
                print(f"⚠️  Post not found: {shortcode}")
                return False
            print(f"✓ Updated post: {shortcode}")
            return True
        except Exception as e:
            print(f"⚠️  Error updating post: {e}")
            return False

    # ------------------------------------------------------------------
    # Collections
    # ------------------------------------------------------------------

    def _collection_row_to_dict(self, row):
        if row is None:
            return None
        d = dict(row)
        try:
            d['post_ids'] = json.loads(d.get('post_ids') or '[]')
        except Exception:
            d['post_ids'] = []
        return d

    def get_collections(self):
        """Return all collections ordered by created_at."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute("SELECT * FROM collections ORDER BY created_at ASC")
            return [self._collection_row_to_dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error getting collections: {e}")
            return []

    def get_collection(self, collection_id):
        """Return a single collection by id."""
        if not self.is_connected():
            return None
        try:
            cur = self._conn.cursor()
            cur.execute("SELECT * FROM collections WHERE id = ?", (collection_id,))
            return self._collection_row_to_dict(cur.fetchone())
        except Exception as e:
            print(f"⚠️  Error getting collection: {e}")
            return None

    def upsert_collection(self, collection_id, name, icon, post_ids, created_at=None, updated_at=None):
        """Insert or fully replace a collection. Returns the saved dict."""
        if not self.is_connected():
            return None
        try:
            now = datetime.utcnow().isoformat()
            self._conn.execute("""
                INSERT INTO collections (id, name, icon, post_ids, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name       = excluded.name,
                    icon       = excluded.icon,
                    post_ids   = excluded.post_ids,
                    updated_at = excluded.updated_at
            """, (
                collection_id, name, icon,
                json.dumps(post_ids if isinstance(post_ids, list) else []),
                created_at or now, updated_at or now
            ))
            self._conn.commit()
            return self.get_collection(collection_id)
        except Exception as e:
            print(f"⚠️  Error upserting collection: {e}")
            return None

    def update_collection_posts(self, collection_id, post_ids):
        """Replace the post_ids list for a collection."""
        if not self.is_connected():
            return False
        try:
            now = datetime.utcnow().isoformat()
            cur = self._conn.execute(
                "UPDATE collections SET post_ids = ?, updated_at = ? WHERE id = ?",
                (json.dumps(post_ids), now, collection_id)
            )
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error updating collection posts: {e}")
            return False

    def delete_collection(self, collection_id):
        """Delete a collection. Returns True if deleted."""
        if not self.is_connected():
            return False
        try:
            cur = self._conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error deleting collection: {e}")
            return False


# ------------------------------------------------------------------
# Singleton accessor
# ------------------------------------------------------------------

_db_instance = None


def get_db():
    """Get or create the shared Database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance
