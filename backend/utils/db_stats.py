#!/usr/bin/env python3
"""
SQLite Database Statistics
Shows storage usage, document count, and collection info
"""

import sys
from pathlib import Path

# Ensure backend root is in sys.path (needed when run directly)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_db


def format_bytes(bytes_size):
    """Convert bytes to human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"


def get_database_stats():
    """Get comprehensive database statistics"""

    print("=" * 80)
    print("📊 SUPERBRAIN DATABASE STATISTICS (SQLite)")
    print("=" * 80)
    print()

    db = get_db()

    if not db.is_connected():
        print("❌ Not connected to database")
        return

    try:
        stats = db.get_stats()
        doc_count = stats['document_count']
        storage_mb = stats['storage_mb']
        category_counts = stats['categories']
        storage_bytes = storage_mb * 1024 * 1024

        # ── Storage ──────────────────────────────────────────────────────
        print("💾 STORAGE USAGE")
        print("-" * 80)
        print(f"Database file:       {db.db_path}")
        print(f"File size:           {format_bytes(storage_bytes)}")
        print(f"Storage (MB):        {storage_mb} MB")
        print()

        # ── Documents ────────────────────────────────────────────────────
        print("📄 DOCUMENT INFORMATION")
        print("-" * 80)
        print(f"Total Posts:         {doc_count}")
        if doc_count > 0 and storage_bytes > 0:
            print(f"Average Post Size:   {format_bytes(storage_bytes / doc_count)}")
        print()

        # ── Schema ───────────────────────────────────────────────────────
        print("📋 COLUMNS IN analyses TABLE")
        print("-" * 80)
        columns = [
            "shortcode", "url", "username", "analyzed_at", "updated_at",
            "post_date", "likes", "title", "summary", "tags",
            "music", "category", "visual_analysis", "audio_transcription", "text_analysis"
        ]
        for i, col in enumerate(columns, 1):
            print(f"{i:2}. {col}")
        print()

        # ── Categories ───────────────────────────────────────────────────
        print("📂 CATEGORY BREAKDOWN")
        print("-" * 80)
        if category_counts:
            for name, count in sorted(category_counts.items(), key=lambda x: -x[1]):
                print(f"{name:<20} {count:>5} posts")
        else:
            print("No posts yet")
        print()

        # ── Recent ───────────────────────────────────────────────────────
        print("📅 RECENT POSTS (Last 5)")
        print("-" * 80)
        recent = db.get_recent(5)
        if recent:
            for i, doc in enumerate(recent, 1):
                title = (doc.get('title') or 'No title')[:50]
                date = doc.get('analyzed_at', 'Unknown')
                category = doc.get('category', 'N/A')
                print(f"{i}. [{category}] {title}")
                print(f"   Analyzed: {date}")
        else:
            print("No posts yet")

        print()
        print("=" * 80)

    except Exception as e:
        print(f"❌ Error getting stats: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    get_database_stats()
