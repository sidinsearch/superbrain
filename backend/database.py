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
                connection_string = f.read().strip()
            
            # Connect to MongoDB
            self.client = MongoClient(connection_string, serverSelectionTimeoutMS=5000)
            
            # Test connection
            self.client.server_info()
            
            # Select database and collection
            self.db = self.client['superbrain']
            self.collection = self.db['analyses']
            
            # Create index on shortcode for fast lookups
            self.collection.create_index([("shortcode", ASCENDING)], unique=True)
            
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
            return {}
        
        try:
            total = self.collection.count_documents({})
            
            # Count by category
            categories = self.collection.aggregate([
                {"$group": {"_id": "$category", "count": {"$sum": 1}}}
            ])
            
            category_counts = {cat['_id']: cat['count'] for cat in categories}
            
            return {
                "total_analyses": total,
                "categories": category_counts
            }
        except Exception as e:
            print(f"⚠️  Error getting stats: {e}")
            return {}
    
    def close(self):
        """Close database connection"""
        if self.client:
            self.client.close()


# Singleton instance
_db_instance = None

def get_db():
    """Get or create database instance"""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance
