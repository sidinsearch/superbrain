#!/usr/bin/env python3
import sys
from pathlib import Path

# Ensure backend root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_db

db = get_db()
posts = db.get_recent(5)
print(f'Found {len(posts)} posts in database')
print()

for p in posts:
    print(f"Shortcode: {p.get('shortcode', 'N/A')}")
    print(f"Title: {p.get('title', 'N/A')}")
    print(f"Username: {p.get('username', 'N/A')}")
    print(f"URL: {p.get('url', 'N/A')}")
    print(f"Category: {p.get('category', 'N/A')}")
    print(f"Analyzed: {p.get('analyzed_at', 'N/A')}")
    print("-" * 60)
