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
from collections import deque
import secrets
import string
from pathlib import Path

# Import database module
from database import get_db

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

# Request queue management
processing_queue = deque()  # Queue of shortcodes being processed
currently_processing = set()  # Set of shortcodes currently being analyzed
max_concurrent = 2  # Maximum concurrent analyses

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
            "GET /cache/{shortcode}": "Check cache (requires auth)",
            "GET /recent": "Get recent analyses (requires auth)",
            "GET /stats": "Database statistics (requires auth)",
            "GET /category/{category}": "Get by category (requires auth)",
            "GET /search": "Search by tags (requires auth)"
        }
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
    
    # Extract shortcode from URL
    try:
        shortcode = request.url.split('/p/')[-1].strip('/').split('?')[0]
    except:
        raise HTTPException(status_code=400, detail="Invalid Instagram URL format")
    
    logger.info(f"📥 New request: {shortcode}")
    
    try:
        # Step 1: Check database cache first
        logger.info(f"🔍 [{shortcode}] Checking database cache...")
        db = get_db()
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
        
        if shortcode in currently_processing:
            logger.warning(f"⏳ [{shortcode}] Already being processed. Please wait...")
            raise HTTPException(
                status_code=409, 
                detail="This URL is already being analyzed. Please wait and try again in a moment."
            )
        
        # Step 3: Check queue size
        if len(currently_processing) >= max_concurrent:
            logger.warning(f"🚦 [{shortcode}] Queue full ({len(currently_processing)}/{max_concurrent}). Adding to queue...")
            processing_queue.append(shortcode)
            queue_position = len(processing_queue)
            raise HTTPException(
                status_code=503,
                detail=f"Server busy. Your request is queued (position: {queue_position}). Please try again in 30 seconds."
            )
        
        # Step 4: Start processing
        logger.info(f"🚀 [{shortcode}] Starting analysis...")
        currently_processing.add(shortcode)
        
        try:
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
            
            return AnalysisResponse(
                success=True,
                cached=False,
                data=filtered_data,
                processing_time=processing_time
            )
            
        finally:
            # Remove from processing set
            currently_processing.discard(shortcode)
            logger.info(f"🔓 [{shortcode}] Released from processing queue")
        
    except HTTPException:
        raise
    except subprocess.SubprocessError as e:
        logger.error(f"❌ [{shortcode}] Subprocess error: {str(e)}")
        currently_processing.discard(shortcode)
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")
    except Exception as e:
        logger.error(f"❌ [{shortcode}] Unexpected error: {str(e)}")
        currently_processing.discard(shortcode)
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


if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting SuperBrain API...")
    print("📖 API Docs: http://localhost:8000/docs")
    print("🔍 Interactive: http://localhost:8000/redoc")
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
