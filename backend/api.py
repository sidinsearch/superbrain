"""
SuperBrain Instagram Content Analysis API
Version: 1.02
FastAPI REST endpoints for analyzing Instagram content with MongoDB caching
With request queuing, live progress logging, and API key authentication
"""

from fastapi import FastAPI, HTTPException, Query, Header, Depends, Request, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, HttpUrl
from typing import Optional, List, Dict, Any
import subprocess
import asyncio
import sys
import os
import json
import zipfile
import io
from datetime import datetime
import logging
import secrets
import string
import threading
import time
from pathlib import Path

# Import database module
from core.database import get_db
from core.link_checker import validate_link

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Sync Code management - single code for both auth and server discovery
SYNC_CODE_FILE = Path(__file__).parent / "sync_code.txt"

def generate_sync_code(length=8):
    """Generate a random 8-character sync code"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def generate_api_token(length=32):
    """Generate a random API token (internal)"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def create_sync_code():
    """Create sync code containing both API token and server URL info"""
    api_token = generate_api_token()
    # Encode info: sync_code will be just the short code, actual token stored separately
    return api_token, api_token[:8].upper()

def load_or_create_sync_code():
    """Load existing sync code or create new one"""
    if SYNC_CODE_FILE.exists():
        with open(SYNC_CODE_FILE, 'r') as f:
            content = f.read().strip()
            if content:
                parts = content.split(':')
                if len(parts) == 2:
                    api_token, sync_code = parts
                    logger.info("="*80)
                    logger.info(f"🔐 Sync Code: {sync_code}")
                    logger.info("="*80)
                    return api_token, sync_code
    
    # Create new sync code
    api_token, sync_code = create_sync_code()
    with open(SYNC_CODE_FILE, 'w') as f:
        f.write(f"{api_token}:{sync_code}")
    
    logger.info("="*80)
    logger.info(f"🔐 Sync Code (NEW): {sync_code}")
    logger.info("="*80)
    
    return api_token, sync_code

# Load sync code
API_TOKEN, SYNC_CODE = load_or_create_sync_code()

async def verify_token(request: Request, x_api_key: str = Header(..., description="API authentication key")):
    """
    Verify authentication - accepts either:
    1. Full API token (for programmatic access)
    2. Sync code (for mobile app connection)
    """
    # Accept both API_TOKEN and SYNC_CODE for authentication
    if x_api_key != API_TOKEN and x_api_key.upper() != SYNC_CODE.upper():
        logger.warning("Invalid API key attempt from IP: %s", request.client.host if hasattr(request, 'client') else 'unknown')
        raise HTTPException(
            status_code=401,
            detail="Invalid API key. Use sync code from server console."
        )
    return x_api_key

# Initialize FastAPI app
app = FastAPI(
    title="SuperBrain",
    description="AI-powered Instagram content analysis with caching",
    version="1.02"
)

# CORS configuration - restrict origins in production
import os

# Get allowed origins from environment variable or use defaults
allowed_origins_env = os.getenv('ALLOWED_ORIGINS', '')
if allowed_origins_env:
    allowed_origins = [origin.strip() for origin in allowed_origins_env.split(',')]
else:
    # Development defaults - RESTRICT IN PRODUCTION
    allowed_origins = [
        "http://localhost:3000",
        "http://localhost:8081", 
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8081",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
)

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # CSP - adjust based on your needs
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

# Request queue management (persistent)
max_concurrent = 1  # Process one post at a time - queue others sequentially

# Track active analysis subprocesses so they can be killed on delete
_active_processes: dict = {}        # shortcode -> subprocess.Popen
_active_processes_lock = threading.Lock()

_STATIC_DIR = Path(__file__).parent / "static"

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    ico = _STATIC_DIR / "favicon.ico"
    if ico.exists():
        return FileResponse(str(ico), media_type="image/x-icon")
    from fastapi.responses import Response
    return Response(status_code=204)

# Shared Instaloader instance for caption fetching (reuse session to avoid rate limits)
caption_loader = None
caption_loader_lock = threading.Lock()

def get_caption_loader():
    """Get or create shared Instaloader instance for caption fetching"""
    global caption_loader
    with caption_loader_lock:
        if caption_loader is None:
            import instaloader
            caption_loader = instaloader.Instaloader(
                download_pictures=False,
                download_videos=False,
                download_video_thumbnails=False,
                download_geotags=False,
                download_comments=False,
                save_metadata=False,
                compress_json=False,
                max_connection_attempts=1  # Fail fast
            )
        return caption_loader

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
    _retry_check_counter = 0
    
    while True:
        try:
            # ── Periodic retry-queue drain (every ~2.5 min) ─────────────────
            _retry_check_counter += 1
            if _retry_check_counter >= 30:
                _retry_check_counter = 0
                ready = db.get_retry_ready()
                if ready:
                    logger.info(f"🔄 Promoting {len(ready)} retry-ready item(s) back to queue")
                    for r_item in ready:
                        logger.info(
                            f"   ↩ {r_item['shortcode']} "
                            f"(reason={r_item['reason']}, attempts={r_item['attempts']})"
                        )
                        db.add_to_queue(r_item['shortcode'], r_item['url'])

            # Check if we have capacity
            processing = db.get_processing()
            if len(processing) < max_concurrent:
                # Get next item from queue
                queue = db.get_queue()
                if queue:
                    item = queue[0]  # Get first item
                    shortcode = item['shortcode']
                    url = item['url']
                    
                    logger.info(f"📋 Queue alert: Processing next in queue")
                    logger.info(f"📊 Queue status: {len(queue) - 1} remaining after this | Starting: {shortcode}")
                    logger.info(f"📤 [{shortcode}] Starting analysis from queue...")
                    
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

                        # Register so delete_post can kill it
                        with _active_processes_lock:
                            _active_processes[shortcode] = process

                        # Wait for completion
                        process.wait()

                        with _active_processes_lock:
                            _active_processes.pop(shortcode, None)

                        # If the post was deleted while processing, skip queue cleanup
                        # (delete_post already called remove_from_queue)
                        if process.returncode == -9 or process.returncode == -15:
                            logger.info(f"🛑 [{shortcode}] Analysis killed (post was deleted)")
                        elif process.returncode == 0:
                            logger.info(f"✅ Queue item completed: {shortcode}")
                            db.remove_from_queue(shortcode)
                        elif process.returncode == 2:
                            # main.py queued this item for retry — status already set in DB
                            logger.info(f"⏰ [{shortcode}] Quota exhausted — moved to retry queue")
                            db.remove_from_queue(shortcode)
                        else:
                            logger.error(f"❌ Queue item failed (rc={process.returncode}): {shortcode}")
                            db.remove_from_queue(shortcode)

                    except Exception as e:
                        with _active_processes_lock:
                            _active_processes.pop(shortcode, None)
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
    force: bool = False

    class Config:
        json_schema_extra = {
            "example": {
                "url": "https://www.instagram.com/p/DRWKk5JiL0h/",
                "force": False
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
        "authentication": "Required - Use sync code from server console with X-API-Key header",
        "message": "Run start.py on the server to get the sync code",
        "endpoints": {
            "POST /connect": "Connect with sync code to validate",
            "POST /analyze": "Analyze content (requires auth)",
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
    Quick caption fetch - calls caption.py as subprocess
    Simple and works every time
    """
    try:
        logger.info(f"🔍 Quick caption fetch for: {url}")
        
        # Extract shortcode for logging
        validation = validate_link(url)
        shortcode = validation['shortcode']
        
        # Run caption.py as subprocess - simple and reliable
        import subprocess
        import sys
        
        loop = asyncio.get_event_loop()
        
        def run_caption_script():
            # Use the same Python interpreter as the API (with all packages)
            python_exe = sys.executable
            print(f"[API] Using Python: {python_exe}")
            
            result = subprocess.run(
                [python_exe, 'analyzers/caption.py', url],
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=15,
                cwd=str(Path(__file__).parent)
            )
            print(f"[API] Subprocess stdout: {repr(result.stdout[:200])}")
            print(f"[API] Subprocess stderr: {repr(result.stderr[:200])}")
            print(f"[API] Subprocess returncode: {result.returncode}")
            return result.stdout.strip() if result.stdout else ""
        
        try:
            caption_text = await asyncio.wait_for(
                loop.run_in_executor(None, run_caption_script),
                timeout=20.0
            )
        except asyncio.TimeoutError:
            logger.error(f"❌ [{shortcode}] Caption fetch timed out")
            return {
                "success": True,
                "shortcode": shortcode,
                "username": "",
                "title": "Instagram Post",
                "full_caption": ""
            }
        
        print(f"[API] Final caption_text: {repr(caption_text)}")
        
        # Check if it's an error message
        if caption_text.startswith('❌') or caption_text.startswith('ℹ️'):
            logger.warning(f"⚠️ [{shortcode}] {caption_text}")
            return {
                "success": True,
                "shortcode": shortcode,
                "username": "",
                "title": "Instagram Post",
                "full_caption": ""
            }
        
        # Limit to 100 chars for title
        title = caption_text[:100] if len(caption_text) > 100 else caption_text
        title = title if title else "Instagram Post"
        
        logger.info(f"✅ [{shortcode}] Caption: {title}")
        
        return {
            "success": True,
            "shortcode": shortcode,
            "username": "",
            "title": title,
            "full_caption": caption_text
        }
        
    except Exception as e:
        logger.error(f"❌ Caption fetch failed: {str(e)}", exc_info=True)
        return {
            "success": True,
            "shortcode": "",
            "username": "",
            "title": "Instagram Post",
            "full_caption": "",
            "error": str(e)
        }


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_instagram(request: AnalyzeRequest, token: str = Depends(verify_token)):
    """
    Analyze content from URL (Instagram, YouTube, or web page)

    - Checks cache first for instant retrieval
    - If not cached, adds to processing queue
    - Handles multiple concurrent requests with queuing
    - Returns comprehensive summary with title, tags, music, category
    """
    start_time = datetime.now()

    # Detect content type and extract primary key
    try:
        url_str = str(request.url)
        validation = validate_link(url_str)
        if not validation['valid']:
            raise ValueError(validation['error'])
        shortcode    = validation['shortcode']
        content_type = validation['content_type']
        # Use the normalised URL (e.g. canonical YouTube URL)
        url_str = validation['url']
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {str(e)}")
    
    logger.info(f"📥 New request: {shortcode}")
    
    # Initialize database connection
    db = get_db()
    
    try:
        # Step 1: Check database cache first
        logger.info(f"🔍 [{shortcode}] Checking database cache...")
        cached_result = db.check_cache(shortcode)
        
        if cached_result:
            # Force re-analyze: hard-delete existing record and proceed with fresh analysis
            if request.force:
                logger.info(f"🔄 [{shortcode}] Force re-analyze requested — clearing cached data")
                db.hard_delete_post(shortcode)
                cached_result = None  # fall through to fresh analysis
            # Restore soft-deleted post if user is re-adding it
            elif cached_result.get('is_hidden') == 1:
                db.restore_post(shortcode)
                cached_result['is_hidden'] = 0
                logger.info(f"♻️ [{shortcode}] Restored from soft-delete. Returning cached data.")
            else:
                logger.info(f"⚡ [{shortcode}] Found in cache! Returning instantly.")

        if cached_result:
            # Filter response
            filtered_data = {
                'url': cached_result.get('url', ''),
                'username': cached_result.get('username', ''),
                'content_type': cached_result.get('content_type', content_type),
                'thumbnail': cached_result.get('thumbnail', ''),
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
        
        # Check if URL is already in queue - if so, remove the old queued item
        queue_items = db.get_queue()
        for item in queue_items:
            if item['shortcode'] == shortcode:
                logger.info(f"🔄 [{shortcode}] Duplicate found in queue - removing old entry and processing fresh request")
                db.remove_from_queue(shortcode)
                break
        
        # Step 3: Check queue size (re-fetch after potential duplicate removal)
        queue_items = db.get_queue()
        if len(processing_items) >= max_concurrent:
            logger.warning(f"🚦 [{shortcode}] Server busy - 1 post analyzing. Adding to queue...")
            queue_position = db.add_to_queue(shortcode, request.url)
            if queue_position > 0:
                logger.info(f"📝 [{shortcode}] ✅ Added to queue at position {queue_position}")
                logger.info(f"📊 Queue status: {len(queue_items) + 1} waiting | 1 analyzing")
                raise HTTPException(
                    status_code=503,
                    detail=f"Server busy analyzing 1 post. Your request is queued (position: {queue_position}). It will be processed automatically. Check back in a few minutes."
                )
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to add to queue. Please try again."
                )
        
        # Step 4: Start processing
        if len(queue_items) > 0:
            logger.info(f"📊 Queue status: {len(queue_items)} waiting | Starting: {shortcode}")
        logger.info(f"🚀 [{shortcode}] Starting analysis...")
        db.mark_processing(shortcode)
        
        # Run main.py as subprocess — executed in a thread pool so the asyncio
        # event loop stays free to serve /ping and other requests during analysis.
        logger.info(f"📊 [{shortcode}] Phase 1: Downloading content...")

        def _run_subprocess() -> tuple:
            proc = subprocess.Popen(
                [sys.executable, "main.py", url_str],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                cwd=str(Path(__file__).parent),
                bufsize=1
            )
            with _active_processes_lock:
                _active_processes[shortcode] = proc
            lines = []
            for line in proc.stdout:
                lines.append(line)
                lc = line.strip()
                if "Step 4: Visual Analysis" in lc:
                    logger.info(f"🎬 [{shortcode}] Phase 2: Visual analysis (AI processing)...")
                elif "Step 5: Audio Transcription" in lc or "Phase 2: Audio" in lc:
                    logger.info(f"🎙️ [{shortcode}] Phase 3: Audio transcription (Whisper)...")
                elif "Phase 3: Light Tasks" in lc:
                    logger.info(f"⚡ [{shortcode}] Phase 4: Music ID + Text (parallel)...")
                elif "GENERATING COMPREHENSIVE SUMMARY" in lc:
                    logger.info(f"🧠 [{shortcode}] Phase 5: Generating AI summary...")
                elif "Saving to Database" in lc:
                    logger.info(f"💾 [{shortcode}] Phase 6: Saving to database...")
                elif "Cleaned up temp folder" in lc:
                    logger.info(f"🗑️ [{shortcode}] Phase 7: Cleanup complete")
            proc.wait()
            with _active_processes_lock:
                _active_processes.pop(shortcode, None)
            return proc.returncode, ''.join(lines), proc.stderr.read()

        returncode, stdout, stderr = await asyncio.to_thread(_run_subprocess)
        
        if stderr.strip():
            # Log stderr from main.py to help diagnose issues
            logger.warning(f"⚠️  [{shortcode}] main.py stderr:\n{stderr[:1000]}")
        
        if returncode == 2:
            # main.py detected quota exhaustion and queued item for retry
            logger.info(f"⏰ [{shortcode}] Quota exhausted — queued for automatic retry")
            db.remove_from_queue(shortcode)
            raise HTTPException(
                status_code=202,
                detail="API quota exhausted. Your request has been queued for automatic retry in 24 hours."
            )
        
        if returncode != 0:
            # Extract last meaningful error line from stdout for the error message
            error_lines = [l.strip() for l in stdout.splitlines() if l.strip() and ('❌' in l or 'Error' in l or 'failed' in l.lower())]
            error_detail = error_lines[-1] if error_lines else (stderr.strip()[:200] or "Analysis failed")
            logger.error(f"❌ [{shortcode}] Analysis failed: {error_detail}")
            logger.debug(f"[{shortcode}] stdout tail:\n{stdout[-800:]}")
            raise HTTPException(
                status_code=400,
                detail=error_detail
            )
        
        logger.info(f"✅ [{shortcode}] Analysis complete! Fetching from database...")
        
        # Get result from database — retry up to 4 times in case the SQLite write
        # hasn't flushed yet (race condition between subprocess write and our read).
        analysis = None
        for _attempt in range(4):
            analysis = db.check_cache(shortcode)
            if analysis:
                if _attempt > 0:
                    logger.info(f"🔄 [{shortcode}] Found in database on retry {_attempt}")
                break
            if _attempt < 3:
                logger.warning(f"⏳ [{shortcode}] Not in DB yet (attempt {_attempt+1}/4), retrying in 1s…")
                await asyncio.sleep(1)
        
        if not analysis:
            logger.error(f"❌ [{shortcode}] Not found in database after 4 attempts!")
            raise HTTPException(
                status_code=500,
                detail="Analysis completed but result not found in database"
            )
        
        # Filter response
        filtered_data = {
            'url': analysis.get('url', ''),
            'username': analysis.get('username', ''),
            'content_type': analysis.get('content_type', content_type),
            'thumbnail': analysis.get('thumbnail', ''),
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


@app.get("/categories")
async def get_all_categories(token: str = Depends(verify_token)):
    """
    Get all categories with post counts
    - Requires API authentication
    """
    try:
        db = get_db()
        stats = db.get_stats()
        category_counts = stats.get('categories', {})
        
        # Convert to list format with icons
        categories = []
        for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
            categories.append({
                'id': cat.lower(),
                'name': cat,
                'count': count
            })
        
        return {
            "success": True,
            "categories": categories,
            "total": sum(c['count'] for c in categories)
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
        
        return {
            "success": True,
            "tags": tag_list,
            "count": len(results),
            "data": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ping")
async def ping():
    """Ultra-lightweight liveness check — no DB, no auth, instant response."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/status")
async def status():
    """
    Server status check - no auth required.
    """
    return {
        "status": "online",
        "version": "1.02",
        "message": "Server is running. Use sync code from server console to connect."
    }


class ConnectRequest(BaseModel):
    """Request model for /connect endpoint."""
    sync_code: str


@app.post("/connect")
async def connect(request: ConnectRequest):
    """
    Connect using sync code. 
    
    Returns the API token for the app to use. 
    The sync code can also be used directly as the authentication token.
    
    No auth required - this is for initial setup.
    """
    sync_code = request.sync_code
    
    # Validate sync_code is alphanumeric (should always be, but double-check)
    if not sync_code.isalnum():
        raise HTTPException(status_code=400, detail="Sync code must be alphanumeric (letters and numbers only).")
    
    if sync_code.upper() != SYNC_CODE.upper():
        raise HTTPException(status_code=401, detail="Invalid sync code. Check the code shown in the server console.")
    
    return {
        "success": True,
        "sync_code": SYNC_CODE,  # Can be used directly as API key
        "message": "Connection successful! Use the sync code as your API key."
    }


# ─────────────────────────────────────────────────────────────────
# Sync code management
# ─────────────────────────────────────────────────────────────────

@app.post("/reset/sync-code")
async def reset_sync_code(token: str = Depends(verify_token)):
    """
    Reset the sync code. A new sync code will be generated.
    - Requires API authentication
    """
    global API_TOKEN, SYNC_CODE
    
    try:
        # Generate new sync code
        api_token, sync_code = create_sync_code()
        
        # Save to file
        with open(SYNC_CODE_FILE, 'w') as f:
            f.write(f"{api_token}:{sync_code}")
        
        # Update globals
        API_TOKEN = api_token
        SYNC_CODE = sync_code
        
        logger.warning(f"🔐 Sync code was reset by a client. New code: {sync_code}")
        
        return {
            "success": True,
            "sync_code": sync_code,
            "message": "Sync code has been reset. Update this code in your mobile app."
        }
    except Exception as e:
        logger.error(f"Error resetting sync code: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────
# Collections endpoints
# ──────────────────────────────────────────────────────────────────

class CollectionUpsertRequest(BaseModel):
    id: str
    name: str
    icon: str = "📁"
    post_ids: List[str] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CollectionPostsRequest(BaseModel):
    post_ids: List[str]


# Allowed fields for import validation
ALLOWED_POST_FIELDS = {
    'shortcode', 'url', 'username', 'content_type', 'post_date',
    'likes', 'thumbnail', 'title', 'summary', 'tags', 'music', 'category',
    'visual_analysis', 'audio_transcription', 'text_analysis'
}

class ImportData(BaseModel):
    version: Optional[str] = None
    posts: List[dict] = []
    collections: List[dict] = []


@app.get("/collections")
async def get_collections(token: str = Depends(verify_token)):
    """Return all collections stored on the server."""
    try:
        db = get_db()
        return {"success": True, "data": db.get_collections()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/collections")
async def upsert_collection(req: CollectionUpsertRequest, token: str = Depends(verify_token)):
    """Create or fully replace a collection (upsert by id)."""
    try:
        db = get_db()
        saved = db.upsert_collection(
            req.id, req.name, req.icon, req.post_ids,
            req.created_at, req.updated_at
        )
        if saved:
            return {"success": True, "data": saved}
        raise HTTPException(status_code=500, detail="Failed to save collection")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/collections/{collection_id}/posts")
async def update_collection_posts(collection_id: str, req: CollectionPostsRequest,
                                   token: str = Depends(verify_token)):
    """Replace the post_ids list for a collection."""
    try:
        db = get_db()
        ok = db.update_collection_posts(collection_id, req.post_ids)
        if ok:
            return {"success": True, "data": db.get_collection(collection_id)}
        raise HTTPException(status_code=404, detail="Collection not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, token: str = Depends(verify_token)):
    """Delete a collection by id. The default Watch Later cannot be deleted."""
    if collection_id == "default_watch_later":
        raise HTTPException(status_code=403, detail="Cannot delete the default Watch Later collection")
    try:
        db = get_db()
        ok = db.delete_collection(collection_id)
        if ok:
            return {"success": True, "message": "Collection deleted"}
        raise HTTPException(status_code=404, detail="Collection not found")
    except HTTPException:
        raise
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
        
        retry_queue = db.get_retry_queue()
        return {
            "currently_processing": processing,
            "processing_count": len(processing),
            "queue": queue,
            "queue_count": len(queue),
            "retry_queue": retry_queue,
            "retry_count": len(retry_queue),
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
    """Delete a post by shortcode, killing any active analysis subprocess"""
    try:
        db = get_db()

        # Kill active analysis subprocess if this post is currently being processed
        with _active_processes_lock:
            proc = _active_processes.pop(shortcode, None)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            logger.info(f"🛑 Killed active analysis for: {shortcode}")

        # Remove from queue (handles both 'queued' and 'processing' states)
        db.remove_from_queue(shortcode)

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


@app.get("/queue/retry")
async def get_retry_queue(token: str = Depends(verify_token)):
    """Show all items currently scheduled for automatic retry"""
    try:
        items = db.get_retry_queue()
        return {
            "retry_queue": items,
            "count": len(items)
        }
    except Exception as e:
        logger.error(f"Error fetching retry queue: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/queue/retry/flush")
async def flush_retry_queue(token: str = Depends(verify_token)):
    """Immediately promote all retry-ready items to the active queue"""
    try:
        ready = db.get_retry_ready()
        for item in ready:
            db.add_to_queue(item['shortcode'], item['url'])
            logger.info(f"🔄 Flushed retry item: {item['shortcode']} ({item['reason']})")
        return {
            "flushed": len(ready),
            "items": [i['shortcode'] for i in ready]
        }
    except Exception as e:
        logger.error(f"Error flushing retry queue: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────
# Reset endpoints (admin only)
# ─────────────────────────────────────────────────────────────────

TOKEN_FILE = Path(__file__).parent / "token.txt"

@app.post("/reset/api-token")
async def reset_api_token(token: str = Depends(verify_token)):
    """
    Reset the API token. A new token will be generated.
    - Requires API authentication
    - Returns the new token
    """
    global API_TOKEN
    try:
        # Generate new token
        new_token = secrets.token_urlsafe(32)
        
        # Save to file
        TOKEN_FILE.write_text(new_token)
        
        # Update in-memory token so it takes effect immediately
        API_TOKEN = new_token
        
        logger.warning("API token was reset by a client")
        
        return {
            "success": True,
            "new_token": new_token,
            "message": "API token has been reset. Update this token in your mobile app settings."
        }
    except Exception as e:
        logger.error(f"Error resetting API token: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reset/database")
async def reset_database(
    token: str = Depends(verify_token),
    confirm: str = Body(..., description="Must be 'DELETE_ALL' to confirm")
):
    """
    Reset (clear) the database. This will delete all posts and collections.
    - Requires API authentication
    - Requires confirm='DELETE_ALL' in body
    """
    if confirm != "DELETE_ALL":
        raise HTTPException(status_code=400, detail="Confirmation required: pass confirm='DELETE_ALL'")
    
    try:
        db = get_db()

        # Delete all posts/collections/queue entries in SQLite
        conn = db._conn
        cur_posts = conn.execute("DELETE FROM analyses")
        conn.execute("DELETE FROM collections")
        conn.execute("DELETE FROM processing_queue")

        # Recreate default Watch Later collection
        now = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO collections (id, name, icon, post_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ('default_watch_later', 'Watch Later', 'time', '[]', now, now)
        )
        conn.commit()

        deleted_count = cur_posts.rowcount
        
        logger.warning(f"🗑️ Database was reset by a client. Deleted {deleted_count} posts.")
        
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Database cleared. {deleted_count} posts deleted."
        }
    except Exception as e:
        logger.error(f"Error resetting database: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────
# Import/Export endpoints
# ─────────────────────────────────────────────────────────────────

@app.get("/export")
async def export_data(
    token: str = Depends(verify_token),
    limit: int = Query(default=10000, ge=1, le=50000, description="Max posts to export"),
    offset: int = Query(default=0, ge=0, description="Offset for pagination"),
    format: str = Query(default="json", description="Export format: json or zip")
):
    """
    Export data as JSON or ZIP (posts, collections, settings).
    - Requires API authentication
    - Supports pagination with limit and offset
    """
    try:
        db = get_db()
        
        # Get posts with pagination using SQLite
        posts = db.get_all_posts(limit=limit, offset=offset)
        
        # Get all collections
        collections = db.get_all_collections()
        
        # Get stats
        stats = db.get_stats()
        
        export_payload = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "posts": posts,
            "collections": collections,
            "stats": stats
        }
        
        if format.lower() == "zip":
            # Create a zip file in memory
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
                # Write main export data
                zip_file.writestr("superbrain_export.json", json.dumps(export_payload, default=str))
            
            # Reset buffer pointer
            zip_buffer.seek(0)
            
            # Return as streaming response
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"superbrain_export_{timestamp}.zip"
            
            return StreamingResponse(
                iter([zip_buffer.getvalue()]), 
                media_type="application/zip", 
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        
        # Default JSON response
        return export_payload
    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/import")
async def import_data(
    data: dict,
    token: str = Depends(verify_token),
    mode: str = Query(default="merge", description="merge or replace")
):
    """
    Import data from JSON.
    - Requires API authentication
    - mode=merge: Add to existing data (skip duplicates by shortcode)
    - mode=replace: Replace all data (will clear database first)
    """
    return await _process_import_data(data, mode)

@app.post("/import/file")
async def import_data_file(
    file: UploadFile = File(...),
    token: str = Depends(verify_token),
    mode: str = Query(default="merge", description="merge or replace")
):
    """
    Import data from a ZIP or JSON file.
    - Requires API authentication
    - mode=merge or replace
    """
    try:
        content = await file.read()
        
        # Check if it's a ZIP file
        if file.filename.endswith('.zip') or file.content_type == 'application/zip' or content.startswith(b'PK'):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    # Look for superbrain_export.json or any json file
                    json_files = [name for name in z.namelist() if name.endswith('.json')]
                    
                    if not json_files:
                        raise HTTPException(status_code=400, detail="No JSON file found in the ZIP archive")
                    
                    # Prefer superbrain_export.json if it exists
                    target_file = "superbrain_export.json" if "superbrain_export.json" in json_files else json_files[0]
                    
                    with z.open(target_file) as f:
                        data = json.load(f)
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Invalid ZIP file")
        else:
            # Assume it's a direct JSON file
            try:
                data = json.loads(content.decode('utf-8'))
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid JSON file")
                
        return await _process_import_data(data, mode)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing import file: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

async def _process_import_data(data: dict, mode: str):
    try:
        # Validate input data structure
        validated = ImportData.model_validate(data)

        if mode not in {"merge", "replace"}:
            raise HTTPException(status_code=400, detail="Invalid import mode. Use 'merge' or 'replace'.")

        db = get_db()

        imported_posts = 0
        skipped_posts = 0

        # Handle mode=replace
        if mode == "replace":
            logger.warning("Import mode=replace: clearing database first")
            conn = db._conn
            conn.execute("DELETE FROM analyses")
            conn.execute("DELETE FROM collections")
            conn.execute("DELETE FROM processing_queue")
            # Ensure default Watch Later exists even if import has no collections
            now = datetime.utcnow().isoformat()
            conn.execute(
                "INSERT INTO collections (id, name, icon, post_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ('default_watch_later', 'Watch Later', 'time', '[]', now, now)
            )
            conn.commit()

        # Import posts - validate and filter allowed fields
        posts = validated.posts or []
        for post in posts:
            shortcode = post.get("shortcode")
            if not shortcode:
                continue

            # Filter to only allowed fields (prevent arbitrary field injection)
            filtered_post = {k: v for k, v in post.items() if k in ALLOWED_POST_FIELDS}

            # Check if exists (for merge mode)
            existing = db.check_cache(shortcode)
            if existing and mode == "merge":
                skipped_posts += 1
                continue

            db.save_analysis(
                shortcode=shortcode,
                url=filtered_post.get("url", ""),
                username=filtered_post.get("username", ""),
                title=filtered_post.get("title", ""),
                summary=filtered_post.get("summary", ""),
                tags=filtered_post.get("tags", []),
                music=filtered_post.get("music", ""),
                category=filtered_post.get("category", "other"),
                visual_analysis=filtered_post.get("visual_analysis", ""),
                audio_transcription=filtered_post.get("audio_transcription", ""),
                text_analysis=filtered_post.get("text_analysis", ""),
                likes=filtered_post.get("likes", 0),
                post_date=filtered_post.get("post_date"),
                content_type=filtered_post.get("content_type", "instagram"),
                thumbnail=filtered_post.get("thumbnail", ""),
            )
            imported_posts += 1

        # Import collections - validate and filter allowed fields
        collections = validated.collections or []
        imported_collections = 0
        for coll in collections:
            coll_id = coll.get("id")
            if not coll_id:
                continue

            post_ids = coll.get("post_ids")
            if post_ids is None:
                post_ids = coll.get("postIds", [])

            db.upsert_collection(
                collection_id=coll_id,
                name=coll.get("name", "Untitled"),
                icon=coll.get("icon", "folder"),
                post_ids=post_ids if isinstance(post_ids, list) else [],
                created_at=coll.get("created_at") or coll.get("createdAt"),
                updated_at=coll.get("updated_at") or coll.get("updatedAt"),
            )
            imported_collections += 1

        logger.info(f"📥 Import complete: {imported_posts} posts, {skipped_posts} skipped, {imported_collections} collections")

        return {
            "success": True,
            "imported_posts": imported_posts,
            "skipped_posts": skipped_posts,
            "imported_collections": imported_collections,
            "mode": mode
        }
    except Exception as e:
        logger.error(f"Error importing data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Settings endpoints for AI Providers and Instagram configuration
# These manage the .api_keys file and dynamically update the ModelRouter

class ProviderKeyUpdate(BaseModel):
    provider: str
    api_key: str

class InstagramCredentials(BaseModel):
    username: str
    password: str

def get_config_path(filename: str) -> Path:
    """Get path to config directory files."""
    return Path(__file__).parent / "config" / filename

@app.get("/settings/ai-providers")
async def get_ai_providers(token: str = Depends(verify_token)):
    """
    Get available AI providers and their key status.
    - Requires API authentication
    """
    from core.model_router import get_router
    router = get_router()
    providers = router.get_available_providers()
    
    return {
        "success": True,
        "providers": {
            "groq": {
                "name": "Groq",
                "has_key": providers.get("groq", False),
                "key_hint": "gsk_..." if providers.get("groq") else None
            },
            "gemini": {
                "name": "Google Gemini",
                "has_key": providers.get("gemini", False),
                "key_hint": "AIza..." if providers.get("gemini") else None
            },
            "openrouter": {
                "name": "OpenRouter",
                "has_key": providers.get("openrouter", False),
                "key_hint": "sk-or-..." if providers.get("openrouter") else None
            },
            "ollama": {
                "name": "Ollama (Local)",
                "has_key": providers.get("ollama", False),
                "key_hint": None
            }
        }
    }

@app.post("/settings/ai-providers")
async def set_ai_provider_key(
    data: ProviderKeyUpdate,
    token: str = Depends(verify_token)
):
    """
    Set an API key for an AI provider.
    - Requires API authentication
    - provider: groq, gemini, or openrouter
    """
    from core.model_router import get_router
    
    valid_providers = ["groq", "gemini", "openrouter"]
    if data.provider.lower() not in valid_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(valid_providers)}"
        )
    
    if not data.api_key or len(data.api_key.strip()) < 5:
        raise HTTPException(status_code=400, detail="Invalid API key")
    
    router = get_router()
    success = router.set_api_key(data.provider.lower(), data.api_key.strip())
    
    if success:
        logger.info(f"🔑 API key updated for {data.provider}")
        return {"success": True, "provider": data.provider, "message": "API key updated"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save API key")

@app.delete("/settings/ai-providers/{provider}")
async def delete_ai_provider_key(
    provider: str,
    token: str = Depends(verify_token)
):
    """
    Delete an API key for an AI provider.
    - Requires API authentication
    """
    from core.model_router import get_router
    
    valid_providers = ["groq", "gemini", "openrouter"]
    if provider.lower() not in valid_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(valid_providers)}"
        )
    
    router = get_router()
    success = router.delete_api_key(provider.lower())
    
    if success:
        logger.info(f"🔑 API key deleted for {provider}")
        return {"success": True, "provider": provider, "message": "API key deleted"}
    else:
        raise HTTPException(status_code=500, detail="Failed to delete API key")

@app.get("/settings/instagram")
async def get_instagram_credentials(token: str = Depends(verify_token)):
    """
    Get Instagram credentials (masked).
    - Requires API authentication
    """
    api_keys_file = get_config_path(".api_keys")
    
    username = None
    has_password = False
    
    if api_keys_file.exists():
        with open(api_keys_file, "r") as f:
            for line in f:
                if line.startswith("INSTAGRAM_USERNAME="):
                    username = line.split("=", 1)[1].strip()
                elif line.startswith("INSTAGRAM_PASSWORD="):
                    has_password = bool(line.split("=", 1)[1].strip())
    
    return {
        "success": True,
        "configured": username is not None and username != "",
        "username": username if username else None,
        "has_password": has_password
    }

@app.post("/settings/instagram")
async def set_instagram_credentials(
    data: InstagramCredentials,
    token: str = Depends(verify_token)
):
    """
    Set Instagram credentials.
    - Requires API authentication
    """
    if not data.username or not data.password:
        raise HTTPException(status_code=400, detail="Username and password required")
    
    api_keys_file = get_config_path(".api_keys")
    
    # Read existing content
    lines = []
    username_found = False
    password_found = False
    
    if api_keys_file.exists():
        with open(api_keys_file, "r") as f:
            for line in f:
                if line.startswith("INSTAGRAM_USERNAME="):
                    lines.append(f"INSTAGRAM_USERNAME={data.username}\n")
                    username_found = True
                elif line.startswith("INSTAGRAM_PASSWORD="):
                    lines.append(f"INSTAGRAM_PASSWORD={data.password}\n")
                    password_found = True
                else:
                    lines.append(line)
    
    if not username_found:
        lines.append(f"INSTAGRAM_USERNAME={data.username}\n")
    if not password_found:
        lines.append(f"INSTAGRAM_PASSWORD={data.password}\n")
    
    with open(api_keys_file, "w") as f:
        f.writelines(lines)
    
    logger.info(f"📸 Instagram credentials updated for {data.username}")
    
    return {
        "success": True,
        "username": data.username,
        "message": "Instagram credentials updated"
    }

@app.delete("/settings/instagram")
async def delete_instagram_credentials(token: str = Depends(verify_token)):
    """
    Delete Instagram credentials.
    - Requires API authentication
    """
    api_keys_file = get_config_path(".api_keys")
    
    if api_keys_file.exists():
        lines = []
        with open(api_keys_file, "r") as f:
            for line in f:
                if not line.startswith("INSTAGRAM_USERNAME=") and not line.startswith("INSTAGRAM_PASSWORD="):
                    lines.append(line)
        
        with open(api_keys_file, "w") as f:
            f.writelines(lines)
    
    logger.info("📸 Instagram credentials deleted")
    
    return {"success": True, "message": "Instagram credentials deleted"}


if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting SuperBrain API...")
    print("📖 API Docs: http://localhost:5000/docs")
    print("🔍 Interactive: http://localhost:5000/redoc")
    uvicorn.run("api:app", host="0.0.0.0", port=5000, reload=False)
