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

# Database file lives next to this script
DB_PATH = Path(__file__).parent / 'superbrain.db'


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
                analyzed_at         TEXT,
                updated_at          TEXT,
                post_date           TEXT,
                likes               INTEGER DEFAULT 0,
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
                      likes=0, post_date=None):
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
                    (shortcode, url, username, analyzed_at, updated_at, post_date, likes,
                     title, summary, tags, music, category,
                     visual_analysis, audio_transcription, text_analysis)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(shortcode) DO UPDATE SET
                    url                 = excluded.url,
                    username            = excluded.username,
                    updated_at          = excluded.updated_at,
                    post_date           = excluded.post_date,
                    likes               = excluded.likes,
                    title               = excluded.title,
                    summary             = excluded.summary,
                    tags                = excluded.tags,
                    music               = excluded.music,
                    category            = excluded.category,
                    visual_analysis     = excluded.visual_analysis,
                    audio_transcription = excluded.audio_transcription,
                    text_analysis       = excluded.text_analysis
            """, (shortcode, url, username, now, now, post_date, likes,
                  title, summary, tags_json, music, category,
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
        """Return the most recently analysed posts."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT * FROM analyses ORDER BY analyzed_at DESC LIMIT ?", (limit,)
            )
            return [self._row_to_dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"⚠️  Error retrieving recent: {e}")
            return []

    def get_by_category(self, category, limit=20):
        """Return all analyses for a given category."""
        if not self.is_connected():
            return []
        try:
            cur = self._conn.cursor()
            cur.execute(
                "SELECT * FROM analyses WHERE category = ? ORDER BY analyzed_at DESC LIMIT ?",
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
                f"SELECT * FROM analyses WHERE {conditions} ORDER BY analyzed_at DESC LIMIT ?",
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
        """Delete a post by shortcode. Returns True if deleted."""
        if not self.is_connected():
            return False
        try:
            cur = self._conn.execute(
                "DELETE FROM analyses WHERE shortcode = ?", (shortcode,)
            )
            self._conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"⚠️  Error deleting post: {e}")
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
# Singleton accessor
# ------------------------------------------------------------------

_db_instance = None


def get_db():
    """Get or create the shared Database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance
