#!/usr/bin/env python3
from database import get_db

# Test get_db() function
db = get_db()
print(f"Database connected: {db.is_connected()}")
print(f"Database instance: {db}")
print(f"Collection: {db.collection}")

posts = db.get_recent(10)
print(f"\nFound {len(posts)} posts")

if posts:
    for p in posts[:2]:
        print(f"\nPost: {p.get('shortcode')}")
        print(f"  Has _id: {'_id' in p}")
