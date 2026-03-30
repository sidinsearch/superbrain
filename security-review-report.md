# Security Review Report

**File/Component:** Superbrain Project (Backend API + Frontend)  
**Reviewed:** 2026-03-30  
**Reviewer:** security-reviewer agent  

## Summary

- **Critical Issues:** 2
- **High Issues:** 3  
- **Medium Issues:** 4  
- **Low Issues:** 2  
- **Risk Level:** HIGH  

## Critical Issues (Fix Immediately)

### 1. Command Injection Risk in Subprocess Calls
**Severity:** CRITICAL  
**Category:** OS Command Injection  
**Location:** `backend/api.py:198,507`  

**Issue:**
The API passes user-provided URLs directly to subprocess calls (`main.py`) via command-line arguments. While URL validation exists, the `validate_link()` function may have bypasses or edge cases. If malicious input reaches the subprocess, it could execute arbitrary commands.

**Impact:**
Remote code execution on the server, full system compromise.

**Remediation:**
```python
# GOOD: Use strict validation and argument sanitization
from urllib.parse import urlparse

def safe_url_argument(url: str) -> str:
    """Validate URL and return safe argument for subprocess"""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError("Only HTTP/HTTPS URLs allowed")
    if not parsed.netloc:
        raise ValueError("Invalid URL")
    # Additional validation for Instagram/YouTube URLs
    allowed_domains = ['instagram.com', 'youtube.com', 'youtu.be']
    if not any(domain in parsed.netloc for domain in allowed_domains):
        raise ValueError("Domain not allowed")
    return url

# Use in subprocess call:
safe_url = safe_url_argument(request.url)
process = subprocess.Popen(
    [sys.executable, "main.py", safe_url],
    # ... rest of the call
)
```

### 2. CORS Overly Permissive
**Severity:** HIGH  
**Category:** Security Misconfiguration  
**Location:** `backend/api.py:105`  

**Issue:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows ANY origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
This configuration allows any website to make authenticated requests to your API, potentially stealing user data or performing actions on behalf of users.

**Impact:**
Cross-site request forgery, data theft, unauthorized actions.

**Remediation:**
```python
# GOOD: Restrict origins in production
import os

allowed_origins = os.getenv('ALLOWED_ORIGINS', '').split(',')
if not allowed_origins or allowed_origins == ['']:
    # Development only - restrict in production
    allowed_origins = ["http://localhost:3000", "http://localhost:8081"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
)
```

## High Priority Issues

### 3. No Rate Limiting
**Severity:** HIGH  
**Category:** Broken Access Control  
**Location:** Entire API  

**Issue:**
No rate limiting implemented on any API endpoints. Attackers could:
- Perform brute force attacks on API key
- Execute DoS attacks
- Overload the server with expensive analysis requests

**Impact:**
Service disruption, resource exhaustion, security compromise.

**Remediation:**
```python
# Install: pip install slowapi
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/analyze")
@limiter.limit("10/hour")  # Adjust based on needs
async def analyze_instagram(request: Request, ...):
    # ... existing code
```

### 4. Sync Code File Storage
**Severity:** MEDIUM  
**Category:** Sensitive Data Exposure  
**Location:** `backend/api.py:39-80`  

**Issue:**
API token and sync code stored in plain text file `sync_code.txt`. If the file system is compromised or backup is exposed, tokens are leaked.

**Impact:**
Unauthorized API access if file is exposed.

**Remediation:**
```python
# Consider using environment variables for production
import os
from cryptography.fernet import Fernet

# Or use encrypted storage
class SecureTokenStorage:
    def __init__(self):
        self.key = os.getenv('ENCRYPTION_KEY') or Fernet.generate_key()
        self.cipher = Fernet(self.key)
    
    def save_token(self, token: str, path: Path):
        encrypted = self.cipher.encrypt(token.encode())
        path.write_bytes(encrypted)
    
    def load_token(self, path: Path) -> str:
        encrypted = path.read_bytes()
        return self.cipher.decrypt(encrypted).decode()
```

### 5. Logging Partial API Keys
**Severity:** MEDIUM  
**Category:** Information Disclosure  
**Location:** `backend/api.py:88`  

**Issue:**
```python
logger.warning(f"🚫 Invalid API key attempt: {x_api_key[:10]}...")
```
Logging first 10 characters of API key aids attackers in brute force attacks.

**Impact:**
Information disclosure, aids brute force attacks.

**Remediation:**
```python
# GOOD: Log only that attempt failed, not the key
logger.warning("🚫 Invalid API key attempt from IP: %s", request.client.host)
```

## Medium Priority Issues

### 6. No HTTPS Enforcement
**Severity:** MEDIUM  
**Category:** Security Misconfiguration  
**Location:** Entire API  

**Issue:**
No HTTPS redirection or HSTS headers configured.

**Impact:**
Man-in-the-middle attacks, session hijacking.

**Remediation:**
```python
# Add middleware for HTTPS in production
from fastapi.middleware.trustedhost import TrustedHostMiddleware

if os.getenv('ENVIRONMENT') == 'production':
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["yourdomain.com", "*.yourdomain.com"]
    )
    
    # Add HSTS header
    @app.middleware("http")
    async def add_hsts_header(request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
```

### 7. No Security Headers
**Severity:** MEDIUM  
**Category:** Security Misconfiguration  
**Location:** Entire API  

**Issue:**
Missing security headers like Content-Security-Policy, X-Frame-Options.

**Impact:**
XSS, clickjacking attacks.

**Remediation:**
```python
# Add security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    return response
```

### 8. Subprocess Timeout Inconsistency
**Severity:** LOW  
**Category:** Resource Management  
**Location:** `backend/api.py:317,507`  

**Issue:**
Caption fetch has timeout (15 seconds), but other subprocess calls may not have proper timeouts.

**Impact:**
Potential resource exhaustion, hanging processes.

**Remediation:**
```python
# Add timeouts to all subprocess calls
import signal

def run_with_timeout(cmd, timeout=300):  # 5 minutes default
    """Run subprocess with timeout"""
    try:
        result = subprocess.run(
            cmd,
            timeout=timeout,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        return result
    except subprocess.TimeoutExpired:
        # Kill process tree if needed
        logger.error(f"Process timed out after {timeout} seconds")
        raise
```

### 9. Input Validation on Updates
**Severity:** MEDIUM  
**Category:** Broken Access Control  
**Location:** `backend/api.py:1027`  

**Issue:**
```python
async def update_post(shortcode: str, updates: dict, token: str = Depends(verify_token)):
    # Only allow specific fields to be updated
    allowed_fields = {'category', 'title', 'summary'}
    filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
```
While field filtering exists, the values aren't validated for type or content.

**Impact:**
Data corruption, injection attacks.

**Remediation:**
```python
from pydantic import BaseModel, Field

class PostUpdate(BaseModel):
    category: Optional[str] = Field(None, max_length=50, pattern=r'^[a-zA-Z0-9_-]+$')
    title: Optional[str] = Field(None, max_length=200)
    summary: Optional[str] = Field(None, max_length=5000)

@app.put("/post/{shortcode}")
async def update_post(shortcode: str, updates: PostUpdate, token: str = Depends(verify_token)):
    # Use validated updates
    filtered_updates = updates.dict(exclude_none=True)
```

## Low Priority Issues

### 10. Database File Security
**Severity:** LOW  
**Category:** Sensitive Data Exposure  
**Location:** `backend/core/database.py:15`  

**Issue:**
SQLite database file stored in plain text. If server is compromised, all data is exposed.

**Impact:**
Data exposure if file system is compromised.

**Remediation:**
```python
# Consider encryption at rest
import sqlite3
from sqlcipher3 import dbapi2 as sqlite_encrypted

# Or use environment variable for encryption key
db_key = os.getenv('DATABASE_ENCRYPTION_KEY')
if db_key:
    # Use encrypted database
    conn = sqlite_encrypted.connect('superbrain.db')
    conn.execute(f"PRAGMA key='{db_key}'")
```

### 11. Dependency Vulnerabilities (Frontend)
**Severity:** LOW  
**Category:** Using Components with Known Vulnerabilities  
**Location:** `superbrain-app/package.json`  

**Issue:**
Multiple high severity vulnerabilities in frontend dependencies (axios, minimatch, node-forge, etc.).

**Impact:**
Various attacks depending on vulnerability.

**Remediation:**
```bash
cd superbrain-app
npm audit fix
# Review and update dependencies regularly
```

## Security Checklist

- [x] No hardcoded secrets (API keys, passwords) - Secrets are in env vars or .env.example
- [x] All inputs validated - Using Pydantic models for request validation
- [x] SQL injection prevention - Parameterized queries in database module
- [x] XSS prevention - No dangerouslySetInnerHTML in frontend
- [ ] CSRF protection - Not implemented (using API key auth instead)
- [x] Authentication required - X-API-Key header required
- [ ] Authorization verified - No role-based access control
- [ ] Rate limiting enabled - **MISSING**
- [ ] HTTPS enforced - **MISSING**
- [ ] Security headers set - **MISSING**
- [ ] Dependencies up to date - Frontend has vulnerabilities
- [ ] No vulnerable packages - Backend dependencies need audit
- [x] Logging sanitized - Mostly, except API key partial logging
- [x] Error messages safe - Generic error messages in production

## Recommendations

### Immediate Actions (Next 24 hours)
1. **Fix CORS configuration** - Restrict origins to known domains
2. **Add rate limiting** - Prevent brute force and DoS attacks
3. **Remove partial API key logging** - Log only failure, not the key

### Short-term (Next week)
1. **Add security headers** - Prevent XSS, clickjacking
2. **Implement HTTPS enforcement** - Add HSTS header
3. **Add subprocess timeouts** - Prevent resource exhaustion
4. **Update frontend dependencies** - Run `npm audit fix`

### Long-term (Next month)
1. **Implement role-based access control** - Different user roles
2. **Add request logging/audit trail** - Track all API activity
3. **Database encryption** - Encrypt SQLite database at rest
4. **Regular security audits** - Schedule monthly security reviews
5. **Implement 2FA for sensitive operations** - Additional security layer

## Conclusion

The Superbrain project has a solid foundation with good practices like parameterized SQL queries, input validation with Pydantic, and API key authentication. However, critical security issues including CORS misconfiguration, lack of rate limiting, and potential command injection risks need immediate attention. The frontend also has dependency vulnerabilities that should be addressed.

**Overall Risk Assessment: HIGH** - Critical vulnerabilities exist that could lead to remote code execution or data compromise. These should be fixed before any production deployment.