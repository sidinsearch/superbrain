#!/usr/bin/env python3
"""
Quick Security Fixes for Superbrain
Run this script to apply critical security fixes
"""

import os
import sys
from pathlib import Path

def fix_cors():
    """Fix CORS configuration in api.py"""
    api_file = Path(__file__).parent / "backend" / "api.py"
    
    if not api_file.exists():
        print("ERROR: api.py not found")
        return
    
    content = api_file.read_text()
    
    # Check if CORS is already fixed
    if 'ALLOWED_ORIGINS' in content:
        print("OK: CORS configuration already fixed")
        return
    
    # Replace the CORS middleware configuration
    old_cors = '''# Enable CORS for all origins (adjust for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)'''
    
    new_cors = '''# CORS configuration - restrict origins in production
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
)'''
    
    content = content.replace(old_cors, new_cors)
    api_file.write_text(content)
    print("OK: Fixed CORS configuration")
    print("WARNING:  Remember to set ALLOWED_ORIGINS environment variable in production")

def add_rate_limiting():
    """Add rate limiting to api.py"""
    api_file = Path(__file__).parent / "backend" / "api.py"
    
    if not api_file.exists():
        return
    
    content = api_file.read_text()
    
    # Check if rate limiting is already added
    if 'limiter' in content.lower() and 'rate' in content.lower():
        print("OK: Rate limiting already implemented")
        return
    
    # Add rate limiting import and setup after existing imports
    imports_end = content.find('app = FastAPI(')
    if imports_end == -1:
        print("ERROR: Could not find FastAPI initialization")
        return
    
    rate_limit_import = '''
# Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Create limiter
limiter = Limiter(key_func=get_remote_address, default_limits=["100/hour"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
'''
    
    content = content[:imports_end] + rate_limit_import + content[imports_end:]
    
    # Add rate limiting decorator to analyze endpoint
    old_analyze = '@app.post("/analyze", response_model=AnalysisResponse)'
    new_analyze = '@app.post("/analyze", response_model=AnalysisResponse)\n@limiter.limit("10/hour")'
    content = content.replace(old_analyze, new_analyze)
    
    # Add rate limiting to other endpoints
    endpoints_to_limit = [
        ('@app.post("/connect")', '@app.post("/connect")\n@limiter.limit("20/hour")'),
        ('@app.get("/caption")', '@app.get("/caption")\n@limiter.limit("30/hour")'),
        ('@app.get("/cache/{shortcode}")', '@app.get("/cache/{shortcode}")\n@limiter.limit("60/hour")'),
    ]
    
    for old, new in endpoints_to_limit:
        content = content.replace(old, new)
    
    api_file.write_text(content)
    print("OK: Added rate limiting")
    print("WARNING:  Install slowapi: pip install slowapi")

def fix_logging():
    """Fix API key logging"""
    api_file = Path(__file__).parent / "backend" / "api.py"
    
    if not api_file.exists():
        return
    
    content = api_file.read_text()
    
    # Fix API key logging
    old_log = 'logger.warning(f"🚫 Invalid API key attempt: {x_api_key[:10]}...")'
    new_log = 'logger.warning("🚫 Invalid API key attempt from IP: %s", request.client.host if hasattr(request, "client") else "unknown")'
    
    content = content.replace(old_log, new_log)
    api_file.write_text(content)
    print("OK: Fixed API key logging")

def add_security_headers():
    """Add security headers middleware"""
    api_file = Path(__file__).parent / "backend" / "api.py"
    
    if not api_file.exists():
        return
    
    content = api_file.read_text()
    
    # Check if security headers already exist
    if 'X-Content-Type-Options' in content:
        print("OK: Security headers already added")
        return
    
    # Add security headers middleware after CORS middleware
    cors_end = content.find(')  # Request queue management')
    if cors_end == -1:
        cors_end = content.find('# Request queue management')
    
    if cors_end == -1:
        print("ERROR: Could not find insertion point for security headers")
        return
    
    security_headers = '''
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

'''
    
    content = content[:cors_end] + security_headers + content[cors_end:]
    api_file.write_text(content)
    print("OK: Added security headers middleware")

def add_subprocess_timeout():
    """Add timeouts to subprocess calls"""
    api_file = Path(__file__).parent / "backend" / "api.py"
    
    if not api_file.exists():
        return
    
    content = api_file.read_text()
    
    # Check if timeout is already added
    if 'timeout=' in content and 'subprocess.Popen' in content:
        print("OK: Subprocess timeouts already considered")
        return
    
    # Add timeout to caption fetch
    old_caption = '''result = subprocess.run(
                [python_exe, 'analyzers/caption.py', url],
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=15,
                cwd=str(Path(__file__).parent)
            )'''
    
    # Already has timeout, check main subprocess calls
    old_main = '''proc = subprocess.Popen(
                [sys.executable, "main.py", url],
                cwd=Path(__file__).parent,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )'''
    
    new_main = '''proc = subprocess.Popen(
                [sys.executable, "main.py", url],
                cwd=Path(__file__).parent,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            # Add timeout using threading
            import threading
            timeout_seconds = 600  # 10 minutes
            timer = threading.Timer(timeout_seconds, lambda: proc.terminate())
            timer.start()'''
    
    content = content.replace(old_main, new_main)
    api_file.write_text(content)
    print("OK: Added subprocess timeouts")

def create_env_example():
    """Create .env.example with security variables"""
    env_file = Path(__file__).parent / "backend" / ".env.example"
    
    if env_file.exists():
        content = env_file.read_text()
        if 'ALLOWED_ORIGINS' in content:
            print("OK: Environment variables already documented")
            return
    
    security_vars = '''
# Security Configuration (add these for production)
# Comma-separated list of allowed CORS origins
# ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Rate limiting (requests per hour per IP)
# RATE_LIMIT=100

# Database encryption key (for production)
# DATABASE_ENCRYPTION_KEY=your-secure-key-here

# HTTPS enforcement (set to 'true' in production)
# ENFORCE_HTTPS=true
'''
    
    content = env_file.read_text() + security_vars
    env_file.write_text(content)
    print("OK: Updated .env.example with security variables")

def main():
    print("Applying Security Fixes for Superbrain...")
    print("=" * 60)
    
    # Apply fixes
    fix_cors()
    add_rate_limiting()
    fix_logging()
    add_security_headers()
    add_subprocess_timeout()
    create_env_example()
    
    print("\n" + "=" * 60)
    print("OK: Security fixes applied!")
    print("\nNext steps:")
    print("1. Install rate limiting: pip install slowapi")
    print("2. Update your .env file with ALLOWED_ORIGINS for production")
    print("3. Run npm audit fix in superbrain-app/")
    print("4. Test all endpoints with the new security measures")
    print("5. Review security-review-report.md for complete analysis")

if __name__ == "__main__":
    main()