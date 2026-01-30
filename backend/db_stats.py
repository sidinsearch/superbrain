#!/usr/bin/env python3
"""
MongoDB Database Statistics
Shows storage usage, document count, and collection info
"""

from database import get_db
from pymongo import MongoClient

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
    print("📊 MONGODB DATABASE STATISTICS")
    print("=" * 80)
    print()
    
    db = get_db()
    
    if not db.is_connected():
        print("❌ Not connected to MongoDB")
        return
    
    try:
        # Get database stats
        db_stats = db.db.command("dbStats")
        
        # Get collection stats
        collection_stats = db.db.command("collStats", "analyses")
        
        # Calculate usage
        data_size = db_stats.get('dataSize', 0)
        storage_size = db_stats.get('storageSize', 0)
        index_size = db_stats.get('indexSize', 0)
        total_size = storage_size + index_size
        
        free_tier_limit = 512 * 1024 * 1024  # 512 MB in bytes
        usage_percent = (total_size / free_tier_limit) * 100
        
        # Document count
        doc_count = db.collection.count_documents({})
        
        # Get sample document to show fields
        sample_doc = db.collection.find_one()
        
        # Display Storage Information
        print("💾 STORAGE USAGE")
        print("-" * 80)
        print(f"Data Size:           {format_bytes(data_size)}")
        print(f"Storage Size:        {format_bytes(storage_size)}")
        print(f"Index Size:          {format_bytes(index_size)}")
        print(f"Total Used:          {format_bytes(total_size)}")
        print(f"Free Tier Limit:     {format_bytes(free_tier_limit)} (512 MB)")
        print(f"Usage:               {usage_percent:.2f}%")
        print(f"Remaining:           {format_bytes(free_tier_limit - total_size)}")
        print()
        
        # Display Document Information
        print("📄 DOCUMENT INFORMATION")
        print("-" * 80)
        print(f"Total Documents:     {doc_count}")
        print(f"Average Doc Size:    {format_bytes(collection_stats.get('avgObjSize', 0))}")
        print()
        
        # Display Fields (Columns)
        if sample_doc:
            print("📋 FIELDS (COLUMNS) IN COLLECTION")
            print("-" * 80)
            fields = list(sample_doc.keys())
            for i, field in enumerate(fields, 1):
                field_type = type(sample_doc[field]).__name__
                print(f"{i:2}. {field:<25} [{field_type}]")
            print()
        
        # Display Category Breakdown
        print("📂 CATEGORY BREAKDOWN")
        print("-" * 80)
        
        categories = db.collection.aggregate([
            {"$group": {"_id": "$category", "count": {"$sum": 1}}}
        ])
        
        total_categorized = 0
        for cat in categories:
            category_name = cat['_id'] if cat['_id'] else 'Uncategorized'
            count = cat['count']
            total_categorized += count
            print(f"{category_name:<20} {count:>5} documents")
        
        if total_categorized == 0:
            print("No documents found")
        
        print()
        
        # Display Recent Analyses
        print("📅 RECENT ANALYSES (Last 5)")
        print("-" * 80)
        
        recent = db.get_recent(5)
        
        if recent:
            for i, doc in enumerate(recent, 1):
                title = doc.get('title', 'No title')[:50]
                date = doc.get('analyzed_at', 'Unknown')
                category = doc.get('category', 'N/A')
                print(f"{i}. [{category}] {title}...")
                print(f"   Analyzed: {date}")
        else:
            print("No analyses yet")
        
        print()
        print("=" * 80)
        
        # Storage capacity estimate
        if doc_count > 0:
            avg_doc_size = total_size / doc_count
            estimated_capacity = int(free_tier_limit / avg_doc_size)
            remaining_capacity = estimated_capacity - doc_count
            
            print(f"📈 CAPACITY ESTIMATE")
            print(f"   Average doc size: {format_bytes(avg_doc_size)}")
            print(f"   Estimated capacity: ~{estimated_capacity:,} documents")
            print(f"   Current usage: {doc_count:,} documents")
            print(f"   Remaining capacity: ~{remaining_capacity:,} documents")
        
        print("=" * 80)
        
    except Exception as e:
        print(f"❌ Error getting stats: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    get_database_stats()
