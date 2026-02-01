#!/usr/bin/env python3
"""
MongoDB Database Manager for SuperBrain
Handles caching and retrieval of Instagram analysis results
"""

from pymongo import MongoClient, ASCENDING
from datetime import datetime
import os
from pathlib import Path

class Database:
    """MongoDB database manager with caching functionality"""
    
    def __init__(self):
        """Initialize database connection"""
        self.client = None
        self.db = None
        self.collection = None
        self._connect()
    
    def _connect(self):
        """Connect to MongoDB Atlas"""
        # Read connection string from config file
        config_file = Path(__file__).parent / '.mongodb_config'
        
        if not config_file.exists():
            print("⚠️  MongoDB not configured. Create .mongodb_config file with connection string.")
            print("   Example: mongodb+srv://username:password@cluster.mongodb.net/")
            return
        
        try:
            with open(config_file, 'r') as f:
                # Read all lines and get the first non-comment, non-empty line
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        connection_string = line
                        break
                else:
                    print("⚠️  No valid connection string found in .mongodb_config")
                    return
            
            # Connect to MongoDB
            self.client = MongoClient(connection_string, serverSelectionTimeoutMS=5000)
            
            # Test connection
            self.client.server_info()
            
            # Select database and collection
            self.db = self.client['superbrain']
            self.collection = self.db['analyses']
            self.queue_collection = self.db['processing_queue']
            
            # Create index on shortcode for fast lookups
            self.collection.create_index([("shortcode", ASCENDING)], unique=True)
            self.queue_collection.create_index([("shortcode", ASCENDING)], unique=True)
            self.queue_collection.create_index([("status", ASCENDING)])
            
            print("✓ Connected to MongoDB Atlas")
            
        except Exception as e:
            print(f"⚠️  MongoDB connection failed: {e}")
            self.client = None
    
    def is_connected(self):
        """Check if database is connected"""
        return self.client is not None
    
    def check_cache(self, shortcode):
        """
        Check if shortcode already analyzed
        
        Returns:
            dict or None: Cached analysis if found, None otherwise
        """
        if not self.is_connected():
            return None
        
        try:
            result = self.collection.find_one({"shortcode": shortcode})
            return result
        except Exception as e:
            print(f"⚠️  Cache lookup error: {e}")
            return None
    
    def save_analysis(self, shortcode, url, username, title, summary, tags, music, category, 
                     visual_analysis="", audio_transcription="", text_analysis="", 
                     likes=0, post_date=None):
        """
        Save analysis result to database
        
        Args:
            shortcode: Instagram post shortcode
            url: Full Instagram URL
            username: Instagram username
            title: Generated title
            summary: Generated summary
            tags: List of tags
            music: Music information
            category: Content category
            visual_analysis: Visual analysis text
            audio_transcription: Audio transcription text
            text_analysis: Text analysis result
            likes: Number of likes
            post_date: Post date
        
        Returns:
            bool: True if saved successfully
        """
        if not self.is_connected():
            print("⚠️  Database not connected. Analysis not saved.")
            return False
        
        try:
            document = {
                "shortcode": shortcode,
                "url": url,
                "username": username,
                "analyzed_at": datetime.utcnow(),
                "post_date": post_date,
                "likes": likes,
                "title": title,
                "summary": summary,
                "tags": tags if isinstance(tags, list) else tags.split(),
                "music": music,
                "category": category,
                "visual_analysis": visual_analysis,
                "audio_transcription": audio_transcription,
                "text_analysis": text_analysis
            }
            
            # Insert or update
            self.collection.update_one(
                {"shortcode": shortcode},
                {"$set": document},
                upsert=True
            )
            
            print("✓ Analysis saved to database")
            return True
            
        except Exception as e:
            print(f"⚠️  Error saving to database: {e}")
            return False
    
    def get_recent(self, limit=10):
        """Get recent analyses"""
        if not self.is_connected():
            return []
        
        try:
            results = self.collection.find().sort("analyzed_at", -1).limit(limit)
            return list(results)
        except Exception as e:
            print(f"⚠️  Error retrieving recent: {e}")
            return []
    
    def get_by_category(self, category):
        """Get all analyses by category"""
        if not self.is_connected():
            return []
        
        try:
            results = self.collection.find({"category": category})
            return list(results)
        except Exception as e:
            print(f"⚠️  Error retrieving by category: {e}")
            return []
    
    def search_tags(self, tag):
        """Search analyses by tag"""
        if not self.is_connected():
            return []
        
        try:
            # Search in tags array
            results = self.collection.find({"tags": {"$regex": tag, "$options": "i"}})
            return list(results)
        except Exception as e:
            print(f"⚠️  Error searching tags: {e}")
            return []
    
    def get_stats(self):
        """Get database statistics"""
        if not self.is_connected():
            return {
                "document_count": 0,
                "storage_mb": 0,
                "categories": {},
                "capacity_used": "0%"
            }
        
        try:
            total = self.collection.count_documents({})
            
            # Count by category
            categories = self.collection.aggregate([
                {"$group": {"_id": "$category", "count": {"$sum": 1}}}
            ])
            
            category_counts = {cat['_id']: cat['count'] for cat in categories}
            
            # Get database stats for storage info
            db_stats = self.db.command("dbStats")
            storage_bytes = db_stats.get('dataSize', 0)
            storage_mb = storage_bytes / (1024 * 1024)
            
            return {
                "document_count": total,
                "storage_mb": round(storage_mb, 2),
                "categories": category_counts,
                "capacity_used": f"{min(100, int((storage_mb / 512) * 100))}%"
            }
        except Exception as e:
            print(f"⚠️  Error getting stats: {e}")
            return {
                "document_count": 0,
                "storage_mb": 0,
                "categories": {},
                "capacity_used": "0%"
            }
    
    def close(self):
        """Close database connection"""
        if self.client:
            self.client.close()
    
    # ==================== QUEUE MANAGEMENT ====================
    
    def add_to_queue(self, shortcode, url):
        """
        Add item to processing queue
        
        Args:
            shortcode: Instagram post shortcode
            url: Full Instagram URL
        
        Returns:
            int: Queue position (1-based)
        """
        if not self.is_connected():
            return -1
        
        try:
            # Check if already in queue or processing
            existing = self.queue_collection.find_one({"shortcode": shortcode})
            if existing:
                if existing['status'] == 'queued':
                    return existing.get('position', -1)
                elif existing['status'] == 'processing':
                    return 0  # Currently processing
            
            # Get current max position
            max_pos = self.queue_collection.find_one(
                {"status": "queued"},
                sort=[("position", -1)]
            )
            position = (max_pos['position'] + 1) if max_pos else 1
            
            # Insert queue item
            self.queue_collection.update_one(
                {"shortcode": shortcode},
                {
                    "$set": {
                        "shortcode": shortcode,
                        "url": url,
                        "status": "queued",
                        "position": position,
                        "added_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                },
                upsert=True
            )
            
            return position
            
        except Exception as e:
            print(f"⚠️  Error adding to queue: {e}")
            return -1
    
    def get_queue(self):
        """
        Get all queued items
        
        Returns:
            list: List of queued items with shortcode and URL
        """
        if not self.is_connected():
            return []
        
        try:
            items = list(self.queue_collection.find(
                {"status": "queued"}
            ).sort("position", 1))
            
            return [{"shortcode": item['shortcode'], "url": item['url'], "position": item['position']} 
                    for item in items]
        except Exception as e:
            print(f"⚠️  Error getting queue: {e}")
            return []
    
    def get_processing(self):
        """
        Get all currently processing items
        
        Returns:
            list: List of processing shortcodes
        """
        if not self.is_connected():
            return []
        
        try:
            items = list(self.queue_collection.find({"status": "processing"}))
            return [item['shortcode'] for item in items]
        except Exception as e:
            print(f"⚠️  Error getting processing items: {e}")
            return []
    
    def mark_processing(self, shortcode):
        """Mark item as currently processing"""
        if not self.is_connected():
            return False
        
        try:
            self.queue_collection.update_one(
                {"shortcode": shortcode},
                {
                    "$set": {
                        "status": "processing",
                        "started_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return True
        except Exception as e:
            print(f"⚠️  Error marking as processing: {e}")
            return False
    
    def remove_from_queue(self, shortcode):
        """Remove item from queue (completed or failed)"""
        if not self.is_connected():
            return False
        
        try:
            self.queue_collection.delete_one({"shortcode": shortcode})
            
            # Reorder remaining queue positions
            queued_items = list(self.queue_collection.find(
                {"status": "queued"}
            ).sort("position", 1))
            
            for idx, item in enumerate(queued_items, 1):
                if item['position'] != idx:
                    self.queue_collection.update_one(
                        {"_id": item['_id']},
                        {"$set": {"position": idx, "updated_at": datetime.utcnow()}}
                    )
            
            return True
        except Exception as e:
            print(f"⚠️  Error removing from queue: {e}")
            return False
    
    def recover_interrupted_items(self):
        """
        Recover items that were processing when server crashed
        Moves them back to queued status
        
        Returns:
            int: Number of items recovered
        """
        if not self.is_connected():
            return 0
        
        try:
            # Find items stuck in processing status
            result = self.queue_collection.update_many(
                {"status": "processing"},
                {
                    "$set": {
                        "status": "queued",
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            # Reorder all queued items
            queued_items = list(self.queue_collection.find(
                {"status": "queued"}
            ).sort("added_at", 1))
            
            for idx, item in enumerate(queued_items, 1):
                self.queue_collection.update_one(
                    {"_id": item['_id']},
                    {"$set": {"position": idx, "updated_at": datetime.utcnow()}}
                )
            
            if result.modified_count > 0:
                print(f"🔄 Recovered {result.modified_count} interrupted items")
            
            return result.modified_count
            
        except Exception as e:
            print(f"⚠️  Error recovering items: {e}")
            return 0
    
    def delete_post(self, shortcode):
        """
        Delete a post from the database
        
        Args:
            shortcode: Instagram post shortcode
            
        Returns:
            bool: True if deleted, False if not found
        """
        if not self.is_connected():
            return False
        
        try:
            result = self.collection.delete_one({"shortcode": shortcode})
            return result.deleted_count > 0
        except Exception as e:
            print(f"⚠️  Error deleting post: {e}")
            return False
    
    def update_post(self, shortcode, updates):
        """
        Update a post's fields
        
        Args:
            shortcode: Instagram post shortcode
            updates: Dictionary of fields to update (category, title, summary)
            
        Returns:
            bool: True if updated, False if not found
        """
        if not self.is_connected():
            return False
        
        try:
            # Add updated timestamp
            updates['updated_at'] = datetime.utcnow()
            
            result = self.collection.update_one(
                {"shortcode": shortcode},
                {"$set": updates}
            )
            
            # Check if document was found and modified
            if result.matched_count == 0:
                print(f"⚠️  Post not found: {shortcode}")
                return False
            
            print(f"✓ Updated post: {shortcode}")
            return result.matched_count > 0
        except Exception as e:
            print(f"⚠️  Error updating post: {e}")
            return False


# Singleton instance
_db_instance = None

def get_db():
    """Get or create database instance"""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance
