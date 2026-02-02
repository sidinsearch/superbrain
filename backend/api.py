"""
SuperBrain Instagram Content Analysis API
Version: 1.02
FastAPI REST endpoints for analyzing Instagram content with MongoDB caching
With request queuing, live progress logging, and API key authentication
"""

from fastapi import FastAPI, HTTPException, Query, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import Optional, List
import subprocess
import sys
import os
from datetime import datetime
import asyncio
import logging
import secrets
import string
import threading
import time
from pathlib import Path

# Import database module
from database import get_db
from link_checker import validate_link

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Token management
TOKEN_FILE = Path(__file__).parent / "token.txt"

def generate_token(length=32):
    """Generate a random API token"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def load_or_create_token():
    """Load existing token or create new one"""
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, 'r') as f:
            token = f.read().strip()
            if token:
                logger.info("="*80)
                logger.info(f"🔐 API Token: {token}")
                logger.info("="*80)
                return token
    
    # Create new token
    token = generate_token()
    with open(TOKEN_FILE, 'w') as f:
        f.write(token)
    
    logger.info("="*80)
    logger.info(f"🔐 API Token (NEW): {token}")
    logger.info("="*80)
    
    return token

# Load API token
API_TOKEN = load_or_create_token()

async def verify_token(x_api_key: str = Header(..., description="API authentication key")):
    """Verify API token from request header"""
    if x_api_key != API_TOKEN:
        logger.warning(f"🚫 Invalid API key attempt: {x_api_key[:10]}...")
        raise HTTPException(
            status_code=401,
            detail="Invalid API key. Check X-API-Key header."
        )
    return x_api_key

# Initialize FastAPI app
app = FastAPI(
    title="SuperBrain",
    description="AI-powered Instagram content analysis with caching",
    version="1.02"
)

# Enable CORS for all origins (adjust for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request queue management (persistent)
max_concurrent = 2  # Maximum concurrent analyses

# Initialize database and recover interrupted items on startup
db = get_db()
if db.is_connected():
    recovered = db.recover_interrupted_items()
    if recovered > 0:
        logger.info(f"🔄 Recovered {recovered} interrupted items from previous session")

# Background worker to process queue
def queue_worker():
    """Background thread that processes queued items automatically"""
    logger.info("🔧 Queue worker thread started")
    
    while True:
        try:
            # Check if we have capacity
            processing = db.get_processing()
            if len(processing) < max_concurrent:
                # Get next item from queue
                queue = db.get_queue()
                if queue:
                    item = queue[0]  # Get first item
                    shortcode = item['shortcode']
                    url = item['url']
                    
                    logger.info(f"📤 Processing from queue: {shortcode}")
                    
                    # Mark as processing
                    db.mark_processing(shortcode)
                    
                    # Run analysis
                    try:
                        process = subprocess.Popen(
                            [sys.executable, "main.py", url],
                            cwd=Path(__file__).parent,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                            bufsize=1
                        )
                        
                        # Wait for completion
                        process.wait()
                        
                        if process.returncode == 0:
                            logger.info(f"✅ Queue item completed: {shortcode}")
                        else:
                            logger.error(f"❌ Queue item failed: {shortcode}")
                        
                        # Remove from queue
                        db.remove_from_queue(shortcode)
                        
                    except Exception as e:
                        logger.error(f"❌ Error processing queue item {shortcode}: {e}")
                        db.remove_from_queue(shortcode)
            
            # Sleep before next check
            time.sleep(5)
            
        except Exception as e:
            logger.error(f"Queue worker error: {e}")
            time.sleep(10)

# Start worker thread
worker_thread = threading.Thread(target=queue_worker, daemon=True)
worker_thread.start()
logger.info("✅ Background queue worker initialized")

# Request/Response models
class AnalyzeRequest(BaseModel):
    url: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "url": "https://www.instagram.com/p/DRWKk5JiL0h/"
            }
        }

class AnalysisResponse(BaseModel):
    success: bool
    cached: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    processing_time: Optional[float] = None


# API Endpoints

@app.get("/")
async def root():
    """API information and health check (no authentication required)"""
    return {
        "name": "SuperBrain Instagram Analyzer API",
        "version": "1.02",
        "status": "operational",
        "authentication": "Required - Use X-API-Key header",
        "endpoints": {
            "POST /analyze": "Analyze Instagram content (requires auth)",
            "GET /caption": "Get post caption quickly (requires auth)",
            "GET /cache/{shortcode}": "Check cache (requires auth)",
            "GET /recent": "Get recent analyses (requires auth)",
            "GET /stats": "Database statistics (requires auth)",
            "GET /category/{category}": "Get by category (requires auth)",
            "GET /search": "Search by tags (requires auth)"
        }
    }


@app.get("/caption")
async def get_caption(url: str, token: str = Depends(verify_token)):
    """
    Quick caption fetch - returns Instagram post caption without running AI analysis
    Used for share screen preview
    """
    try:
        import instaloader
        import re
        
        logger.info(f"🔍 Quick caption fetch for: {url}")
        
        # Extract shortcode
        validation = validate_link(url)
        shortcode = validation['shortcode']
        
        # Use Instaloader to get caption quickly
        loader = instaloader.Instaloader()
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        
        caption = post.caption if post.caption else ""
        
        if caption:
            # Split by lines and remove hashtag sections
            lines = caption.split('\n')
            clean_lines = []
            
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#'):
                    clean_lines.append(line)
                elif line.startswith('#'):
                    break
            
            caption_text = ' '.join(clean_lines).strip()
            caption_text = re.sub(r'#\w+', '', caption_text).strip()
            
            # Limit to 100 chars
            title = caption_text[:100] if len(caption_text) > 100 else caption_text
            title = title if title else "Instagram Post"
        else:
            title = "Instagram Post"
        
        logger.info(f"✅ Caption: {title}")
        
        return {
            "success": True,
            "shortcode": shortcode,
            "username": post.owner_username,
            "title": title
        }
        
    except Exception as e:
        logger.error(f"❌ Caption fetch failed: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "title": "Instagram Post",
            "shortcode": None,
            "username": ""
        }


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_instagram(request: AnalyzeRequest, token: str = Depends(verify_token)):
    """
    Analyze Instagram content from URL
    
    - Checks cache first for instant retrieval
    - If not cached, adds to processing queue
    - Handles multiple concurrent requests with queuing
    - Returns comprehensive summary with title, tags, music, category
    """
    start_time = datetime.now()
    
    # Extract shortcode from URL (handle both /p/ and /reel/)
    try:
        url_str = str(request.url)
        if '/p/' in url_str:
            shortcode = url_str.split('/p/')[-1].strip('/').split('?')[0]
        elif '/reel/' in url_str:
            shortcode = url_str.split('/reel/')[-1].strip('/').split('?')[0]
        elif '/tv/' in url_str:
            shortcode = url_str.split('/tv/')[-1].strip('/').split('?')[0]
        else:
            raise ValueError("URL must contain /p/, /reel/, or /tv/")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid Instagram URL format: {str(e)}")
    
    logger.info(f"📥 New request: {shortcode}")
    
    # Initialize database connection
    db = get_db()
    
    try:
        # Step 1: Check database cache first
        logger.info(f"🔍 [{shortcode}] Checking database cache...")
        cached_result = db.check_cache(shortcode)
        
        if cached_result:
            logger.info(f"⚡ [{shortcode}] Found in cache! Returning instantly.")
            
            # Remove MongoDB _id
            if '_id' in cached_result:
                del cached_result['_id']
            
            # Filter response
            filtered_data = {
                'url': cached_result.get('url', ''),
                'username': cached_result.get('username', ''),
                'title': cached_result.get('title', ''),
                'summary': cached_result.get('summary', ''),
                'tags': cached_result.get('tags', []),
                'music': cached_result.get('music', ''),
                'category': cached_result.get('category', '')
            }
            
            processing_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"✅ [{shortcode}] Response sent ({processing_time:.2f}s)")
            
            return AnalysisResponse(
                success=True,
                cached=True,
                data=filtered_data,
                processing_time=processing_time
            )
        
        # Step 2: Not in cache - check if already being processed
        logger.info(f"💾 [{shortcode}] Not in cache")
        
        # Check if already in queue or processing
        processing_items = db.get_processing()
        if shortcode in processing_items:
            logger.warning(f"⏳ [{shortcode}] Already being processed. Please wait...")
            raise HTTPException(
                status_code=409, 
                detail="This URL is already being analyzed. Please wait and try again in a moment."
            )
        
        # Step 3: Check queue size
        if len(processing_items) >= max_concurrent:
            logger.warning(f"🚦 [{shortcode}] Server at capacity ({len(processing_items)}/{max_concurrent}). Adding to queue...")
            queue_position = db.add_to_queue(shortcode, request.url)
            if queue_position > 0:
                logger.info(f"📝 [{shortcode}] Added to persistent queue (position: {queue_position})")
                raise HTTPException(
                    status_code=503,
                    detail=f"Server busy. Your request is queued (position: {queue_position}). It will be processed automatically. Check back in a few minutes."
                )
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to add to queue. Please try again."
                )
        
        # Step 4: Start processing
        logger.info(f"🚀 [{shortcode}] Starting analysis...")
        db.mark_processing(shortcode)
        
        # Run main.py as subprocess with real-time logging
        logger.info(f"📊 [{shortcode}] Phase 1: Downloading content...")
        
        process = subprocess.Popen(
            [sys.executable, "main.py", request.url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            bufsize=1
        )
        
        # Stream output in real-time
        stdout_lines = []
        for line in process.stdout:
            stdout_lines.append(line)
            line_clean = line.strip()
            
            # Log important progress markers
            if "Step 4: Visual Analysis" in line_clean:
                logger.info(f"🎬 [{shortcode}] Phase 2: Visual analysis (AI processing)...")
            elif "Step 5: Audio Transcription" in line_clean or "Phase 2: Audio" in line_clean:
                logger.info(f"🎙️ [{shortcode}] Phase 3: Audio transcription (Whisper)...")
            elif "Phase 3: Light Tasks" in line_clean:
                logger.info(f"⚡ [{shortcode}] Phase 4: Music ID + Text (parallel)...")
            elif "GENERATING COMPREHENSIVE SUMMARY" in line_clean:
                logger.info(f"🧠 [{shortcode}] Phase 5: Generating AI summary...")
            elif "Saving to Database" in line_clean:
                logger.info(f"💾 [{shortcode}] Phase 6: Saving to database...")
            elif "Cleaned up temp folder" in line_clean:
                logger.info(f"🗑️ [{shortcode}] Phase 7: Cleanup complete")
        
        process.wait()
        stdout = ''.join(stdout_lines)
        stderr = process.stderr.read()
        
        if process.returncode != 0:
            logger.error(f"❌ [{shortcode}] Analysis failed!")
            raise HTTPException(
                status_code=400,
                detail=f"Analysis failed: {stderr[:200]}"
            )
        
        logger.info(f"✅ [{shortcode}] Analysis complete! Fetching from database...")
        
        # Get result from database
        analysis = db.check_cache(shortcode)
        
        if not analysis:
            logger.error(f"❌ [{shortcode}] Not found in database after processing!")
            raise HTTPException(
                status_code=500,
                detail="Analysis completed but result not found in database"
            )
        
        # Remove MongoDB _id
        if '_id' in analysis:
            del analysis['_id']
        
        # Filter response
        filtered_data = {
            'url': analysis.get('url', ''),
            'username': analysis.get('username', ''),
            'title': analysis.get('title', ''),
            'summary': analysis.get('summary', ''),
            'tags': analysis.get('tags', []),
            'music': analysis.get('music', ''),
            'category': analysis.get('category', '')
        }
        
        processing_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"✅ [{shortcode}] Response sent ({processing_time:.2f}s total)")
        
        # Remove from processing queue
        db.remove_from_queue(shortcode)
        logger.info(f"🔓 [{shortcode}] Released from processing queue")
        
        return AnalysisResponse(
            success=True,
            cached=False,
            data=filtered_data,
            processing_time=processing_time
        )
        
    except HTTPException:
        db.remove_from_queue(shortcode)
        raise
    except subprocess.SubprocessError as e:
        logger.error(f"❌ [{shortcode}] Subprocess error: {str(e)}")
        db.remove_from_queue(shortcode)
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")
    except Exception as e:
        logger.error(f"❌ [{shortcode}] Unexpected error: {str(e)}")
        db.remove_from_queue(shortcode)
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.get("/cache/{shortcode}")
async def check_cache(shortcode: str, token: str = Depends(verify_token)):
    """
    Check if Instagram post is already analyzed and cached
    
    - Returns cached analysis if available
    - Returns 404 if not found
    - Requires API authentication
    """
    try:
        db = get_db()
        result = db.check_cache(shortcode)
        
        if not result:
            raise HTTPException(status_code=404, detail="Not found in cache")
        
        # Remove MongoDB _id
        if '_id' in result:
            del result['_id']
        
        # Filter response to only include essential fields
        filtered_data = {
            'url': result.get('url', ''),
            'username': result.get('username', ''),
            'title': result.get('title', ''),
            'summary': result.get('summary', ''),
            'tags': result.get('tags', []),
            'music': result.get('music', ''),
            'category': result.get('category', '')
        }
        
        return {
            "success": True,
            "cached": True,
            "data": filtered_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/recent")
async def get_recent_analyses(limit: int = Query(default=10, ge=1, le=100), token: str = Depends(verify_token)):
    """
    Get recent analyses from database
    
    - Returns most recently analyzed content
    - Default limit: 10, max: 100
    - Requires API authentication
    """
    try:
        db = get_db()
        results = db.get_recent(limit=limit)
        
        # Remove MongoDB _id from all results
        for result in results:
            if '_id' in result:
                del result['_id']
        
        return {
            "success": True,
            "count": len(results),
            "data": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def get_database_stats(token: str = Depends(verify_token)):
    """
    Get database statistics
    
    - Total documents
    - Storage usage
    - Category breakdown
    - Capacity information
    - Requires API authentication
    """
    try:
        db = get_db()
        stats = db.get_stats()
        
        return {
            "success": True,
            "data": stats
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/category/{category}")
async def get_by_category(
    category: str,
    limit: int = Query(default=20, ge=1, le=100),
    token: str = Depends(verify_token)
):
    """
    Get analyses by category
    
    Categories: product, places, food, fashion, fitness, education, 
                entertainment, pets, other
    - Requires API authentication
    """
    try:
        db = get_db()
        results = db.get_by_category(category, limit=limit)
        
        # Remove MongoDB _id
        for result in results:
            if '_id' in result:
                del result['_id']
        
        return {
            "success": True,
            "category": category,
            "count": len(results),
            "data": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
async def search_by_tags(
    tags: str = Query(..., description="Comma-separated tags to search"),
    limit: int = Query(default=20, ge=1, le=100),
    token: str = Depends(verify_token)
):
    """
    Search analyses by tags
    
    - Provide comma-separated tags
    - Example: travel,sikkim,budget
    - Requires API authentication
    """
    try:
        tag_list = [tag.strip() for tag in tags.split(',')]
        
        db = get_db()
        results = db.search_tags(tag_list, limit=limit)
        
        # Remove MongoDB _id
        for result in results:
            if '_id' in result:
                del result['_id']
        
        return {
            "success": True,
            "tags": tag_list,
            "count": len(results),
            "data": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check(token: str = Depends(verify_token)):
    """API health check with database connectivity test (requires auth)"""
    try:
        db = get_db()
        stats = db.get_stats()
        
        return {
            "status": "healthy",
            "database": "connected",
            "documents": stats.get('document_count', 0),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.get("/queue-status")
async def queue_status(token: str = Depends(verify_token)):
    """Get current queue and processing status"""
    try:
        processing = db.get_processing()
        queue = db.get_queue()
        
        return {
            "currently_processing": processing,
            "processing_count": len(processing),
            "queue": queue,
            "queue_count": len(queue),
            "max_concurrent": max_concurrent,
            "available_slots": max(0, max_concurrent - len(processing))
        }
    except Exception as e:
        logger.error(f"Error getting queue status: {e}")
        return {
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.delete("/post/{shortcode}")
async def delete_post(shortcode: str, token: str = Depends(verify_token)):
    """Delete a post by shortcode"""
    try:
        db = get_db()
        result = db.delete_post(shortcode)
        
        if result:
            logger.info(f"✅ Deleted post: {shortcode}")
            return {
                "success": True,
                "message": "Post deleted successfully",
                "shortcode": shortcode
            }
        else:
            raise HTTPException(status_code=404, detail="Post not found")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting post: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/post/{shortcode}")
async def update_post(shortcode: str, updates: dict, token: str = Depends(verify_token)):
    """Update a post's category, title, or summary"""
    try:
        db = get_db()
        
        # Only allow specific fields to be updated
        allowed_fields = {'category', 'title', 'summary'}
        filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
        
        if not filtered_updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        
        result = db.update_post(shortcode, filtered_updates)
        
        if result:
            logger.info(f"✅ Updated post: {shortcode} - {list(filtered_updates.keys())}")
            return {
                "success": True,
                "message": "Post updated successfully",
                "shortcode": shortcode,
                "updated_fields": list(filtered_updates.keys())
            }
        else:
            raise HTTPException(status_code=404, detail="Post not found")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating post: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting SuperBrain API...")
    print("📖 API Docs: http://localhost:5000/docs")
    print("🔍 Interactive: http://localhost:5000/redoc")
    uvicorn.run("api:app", host="0.0.0.0", port=5000, reload=False)
