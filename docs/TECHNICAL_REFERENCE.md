# SuperBrain Technical Reference Guide

## Quick Start for Developers

### Backend Setup
```bash
# Prerequisites
- Python 3.11+
- Git

# Clone and setup
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Interactive setup wizard (handles everything)
python start.py

# Or manual startup
python -m uvicorn api:app --host 0.0.0.0 --port 5000 --reload
```

### Frontend Setup
```bash
# Prerequisites
- Node.js 18+
- Expo CLI

cd superbrain-app
npm install

# Run on Android emulator/device
npm run android

# Or start Expo dev server
npm start
```

### Docker Deployment
```bash
cd backend/
docker-compose up --build

# Health check
curl http://localhost:5000/ping
```

---

## API Authentication

### Access Token Flow
1. **Backend Startup**: Generates/loads `token.txt` with an 8-character alphanumeric Access Token.
    ```
    ABCD1234
    ```

2. **Mobile App**: User enters server URL + Access Token in Settings.
    - Stored in AsyncStorage: `apiUrl`, `apiToken`
    - Invalid/legacy token formats are cleaned automatically by the app service.

3. **Request Header**:
    ```http
    X-API-Key: ABCD1234
    ```

4. **Validation** (`api.py verify_token`):
    ```python
    if x_api_key != API_TOKEN:
         raise HTTPException(401, "Invalid Access Token")
    ```

### Token Rotation
```bash
# Backend endpoint
POST /reset/api-token
Headers: X-API-Key: <current-token>

# Response
{"success": true, "new_token": "WXYZ6789", "message": "..."}
```

---

## Configuration Management

### API Keys Storage
**Location**: `config/.api_keys` (gitignored)

**Format**:
```
GROQ_API_KEY=gsk_xxxxx...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-...
```

**Loading** (ModelRouter):
```python
API_KEYS_FILE = CONFIG_DIR / ".api_keys"

def _load_api_keys(self):
    keys = {}
    if API_KEYS_FILE.exists():
        with open(API_KEYS_FILE) as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    keys[k.strip()] = v.strip()
    return keys
```

### Environment Variables (Frontend)
**Source**: `package.json` → `EXPO_PUBLIC_*` pattern

```bash
# .env.local (expo reads these)
EXPO_PUBLIC_API_URL=http://10.0.2.2:5000   # Android emulator localhost
EXPO_PUBLIC_API_URL=http://192.168.1.100:5000  # LAN
EXPO_PUBLIC_API_URL=https://ngrok-url.ngrok.io  # Remote
```

### Dynamic Model Rankings
**File**: `config/model_rankings.json`

**Format**:
```json
{
  "groq/text": {
    "attempts": 42,
    "failures": 2,
    "ema_response_time_sec": 1.45,
    "last_success": "2025-03-31T14:23:10.123Z",
    "cooldown_until": null
  },
  "gemini/vision": {
    "attempts": 23,
    "failures": 0,
    "ema_response_time_sec": 3.2,
    "last_success": "2025-03-31T14:25:33.456Z",
    "cooldown_until": "2025-03-31T14:55:00.000Z"  # Rate-limited until this time
  }
}
```

**Update Mechanism** (ModelRouter):
- After successful response: Update EMA using formula:
  ```
  ema_new = (1 - α) * ema_old + α * response_time
  where α = 0.3 (smoothing factor)
  ```
- On failure: Mark cooldown timestamp
- On startup: Load rankings and apply cooldowns

---

## Database Queries by Feature

### HomeScreen - Get Recent Posts
```python
# backend/api.py
@app.get("/recent")
async def get_recent_posts(
    limit: int = Query(10, ge=1, le=100),
    x_api_key: str = Header(...)
):
    db = get_db()
    query = "SELECT * FROM analyses WHERE is_hidden = 0 ORDER BY analyzed_at DESC LIMIT ?"
    posts = db._conn.execute(query, (limit,)).fetchall()
    return [dict(p) for p in posts]
```

### LibraryScreen - Get Collections
```python
# frontend/src/services/collections.ts
async getCollections(): Promise<Collection[]> {
    const headers = await this.getHeaders();
    const response = await axios.get(`${this.apiUrl}/collections`, { headers });
    return response.data.collections.map(c => ({
        ...c,
        postIds: JSON.parse(c.post_ids)
    }));
}
```

### PostDetailScreen - Get Single Post
```python
# backend/api.py
@app.get("/cache/{shortcode}")
async def get_post_by_shortcode(
    shortcode: str,
    x_api_key: str = Header(...)
):
    db = get_db()
    query = "SELECT * FROM analyses WHERE shortcode = ?"
    row = db._conn.execute(query, (shortcode,)).fetchone()
    if not row:
        raise HTTPException(404, "Post not found")
    return dict(row)
```

### Search - Full-text Search
```python
# backend/api.py
@app.get("/search")
async def search_posts(
    q: str = Query(..., min_length=2),
    category: Optional[str] = None,
    limit: int = Query(20, le=100),
    x_api_key: str = Header(...)
):
    db = get_db()
    where_clauses = ["is_hidden = 0"]
    params = [f"%{q}%", f"%{q}%"]
    
    where_clauses.append("(title LIKE ? OR summary LIKE ?)")
    
    if category:
        where_clauses.append("category = ?")
        params.append(category)
    
    query = f"""
        SELECT * FROM analyses
        WHERE {' AND '.join(where_clauses)}
        ORDER BY analyzed_at DESC
        LIMIT ?
    """
    params.append(limit)
    posts = db._conn.execute(query, params).fetchall()
    return [dict(p) for p in posts]
```

---

## Analyzer Integration

### Adding a New Analyzer

**Step 1**: Create `analyzers/new_analyzer.py`
```python
#!/usr/bin/env python3
"""
New Content Type Analyzer
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.model_router import get_router

def analyze_new_content(url: str, raw_content: str) -> dict:
    """
    Analyze new content type.
    
    Returns:
        dict with keys: success (bool), analysis (str) or error (str)
    """
    prompt = """Analyze this content and provide insights.
    
    CONTENT:
    {raw_content}
    
    TASK: Extract main points, categorize, and summarize."""
    
    router = get_router()
    try:
        analysis = router.generate_text(prompt)  # Routes automatically
        return {"success": True, "analysis": analysis}
    except RuntimeError as e:
        return {"success": False, "error": str(e)}
```

**Step 2**: Update `main.py`
```python
from analyzers.new_analyzer import analyze_new_content

# In generate_final_summary():
if results['new_content']:
    new_summary = "NEW CONTENT ANALYSIS:\n"
    for item in results['new_content']:
        if item['output']:
            new_summary += f"- {item['output'][:500]}\n"
```

**Step 3**: Update `api.py` POST /analyze
```python
# In analyze_endpoint():
if is_new_content_type:
    main_result = subprocess.run(
        [BACKEND_PYTHON, "analyzers/new_analyzer.py", temp_file.name],
        capture_output=True, text=True, timeout=120
    )
```

---

## Frontend Service Integration

### Adding a New Endpoint

**Step 1**: Backend (api.py)
```python
@app.get("/new-feature/{param}")
async def new_feature_endpoint(
    param: str = Query(...),
    x_api_key: str = Header(...)
):
    """New feature endpoint"""
    return {"result": "data"}
```

**Step 2**: Frontend Service (api.ts)
```typescript
async getNewFeature(param: string): Promise<any> {
    try {
        const headers = await this.getHeaders();
        const baseUrl = await this.getBaseUrl();
        const response = await axios.get(
            `${baseUrl}/new-feature/${param}`,
            { headers }
        );
        return response.data;
    } catch (error) {
        throw error;
    }
}
```

**Step 3**: Use in Screen Component
```typescript
import apiService from '../services/api';

export default function NewScreen() {
    const [data, setData] = useState(null);
    
    useEffect(() => {
        apiService.getNewFeature('test-param')
            .then(setData)
            .catch(err => console.error(err));
    }, []);
    
    return <View>{/* render data */}</View>;
}
```

---

## Error Handling Patterns

### Backend Error Responses
```python
# 400 Bad Request
raise HTTPException(400, "Invalid URL format")

# 401 Unauthorized
raise HTTPException(401, "Invalid API key")

# 404 Not Found
raise HTTPException(404, "Post not found")

# 503 Service Unavailable (Queue full)
raise HTTPException(
    503,
    "Request queued. Try again in 30 seconds."
)

# 500 Internal Server Error
raise HTTPException(500, "Analysis failed. All models offline.")
```

### Frontend Error Handling
```typescript
async analyzePost(url: string): Promise<ApiResponse> {
    try {
        const response = await axios.post<ApiResponse>(
            `${baseUrl}/analyze`,
            { url },
            { headers }
        );
        return response.data;
    } catch (error: any) {
        if (error.response?.status === 503) {
            // Queued - return special response
            return {
                success: false,
                cached: false,
                error: error.response.data.detail || 'Request queued',
            };
        }
        if (error.response?.status === 401) {
            // Auth failed
            await this.clearToken();
        }
        throw error;
    }
}
```

---

## Performance Optimization Tips

### Database
1. **Use indices wisely**: Already have `category`, `analyzed_at`, `content_type`
2. **WAL mode**: Enabled by default; good for concurrent reads
3. **Soft deletes**: Use `is_hidden` flag instead of DELETE

```python
# Good: Uses index
db.execute("SELECT * FROM analyses WHERE category = ? ORDER BY analyzed_at DESC LIMIT 50")

# Bad: Full table scan
db.execute("SELECT * FROM analyses WHERE title LIKE '%keyword%'")
# Solution: Add FTS table if needed
```

### Model Router
1. **EMA ranking works automatically** — don't bypass
2. **Respect cooldown periods** — prevents rate-limit hammering
3. **Monitor model availability** — check dashboard before load spikes

### Mobile App
1. **Cache aggressively**: Use `postsCache.ts`
2. **Lazy load**: Post thumbnails, transcriptions
3. **Batch requests**: Get multiple posts in one call if possible
4. **Use AsyncStorage**: For frequently accessed values (API token, url)

---

## Monitoring & Debugging

### Backend Logs
```bash
# Live logs
docker logs -f superbrain-backend

# Structured logging (JSON)
docker logs superbrain-backend | grep -E "ERROR|CRITICAL"
```

### Check Model Router Status
```bash
# Inside container
docker exec superbrain-backend python model_router.py

# Output shows current rankings:
# Model               Response Time    Failures    Status
# groq/text           1.23 sec         0           ✓ Online
# gemini/vision       3.54 sec         0           ✓ Online (cooldown 5m)
# openrouter/text     4.12 sec         2           ✓ Online
```

### Database Statistics
```bash
# Via API
curl -H "X-API-Key: <token>" http://localhost:5000/stats

# Via CLI
sqlite3 superbrain.db
> SELECT COUNT(*) FROM analyses;
> SELECT category, COUNT(*) FROM analyses GROUP BY category;
```

### Mobile App Debugging
```bash
# View network requests (React Native Debugger)
npm start  # Starts dev server
# Open Chrome DevTools: chrome://inspect

# AsyncStorage inspection
import AsyncStorage from '@react-native-async-storage/async-storage';
AsyncStorage.getAllKeys().then(keys => console.log(keys));
```

---

## Deployment Scenarios

### Scenario 1: Personal Use (Local Network)
```bash
# Backend on laptop/NAS
docker-compose up

# Get IP
ip addr show  # e.g., 192.168.1.100

# Mobile app settings
API URL: http://192.168.1.100:5000
API Token: (from console output)
```

### Scenario 2: Remote Access (VPS)
```bash
# Backend on VPS with Ngrok
python start.py
# Select: Setup Ngrok
# Get Ngrok URL: https://abc123.ngrok.io

# Mobile app settings
API URL: https://abc123.ngrok.io
API Token: (from console output)
```

### Scenario 3: Cloud Deployment (AWS/GCP)
```bash
# Push Docker image
docker build -t superbrain:latest .
docker tag superbrain:latest gcr.io/project/superbrain:latest
docker push gcr.io/project/superbrain:latest

# Deploy to Cloud Run / ECS / Kubernetes
# Ensure volumes persist:
# - /app/config/
# - /app/superbrain.db
```

---

## API Key Management

### Setting Up Groq
1. Get API key: https://groq.com/
2. Store in `config/.api_keys`:
   ```
   GROQ_API_KEY=gsk_xxxxx
   ```
3. Restart backend
4. Verify: Test from `/status` endpoint

### Setting Up Gemini
1. Get API key: https://makersuite.google.com/app/apikey
2. Store in `config/.api_keys`:
   ```
   GEMINI_API_KEY=AIzaSyxxxxx
   ```
3. Restart backend
4. Verify: Test from AI Provider screen in app

### Setting Up OpenRouter
1. Get API key: https://openrouter.ai/keys
2. Store in `config/.api_keys`:
   ```
   OPENROUTER_API_KEY=sk-or-xxxxx
   ```
3. Backend auto-discovers free models every 6 hours
4. Verify: Check `config/openrouter_free_models.json`

### Setting Up Ollama (Local, Optional)
1. Install: https://ollama.ai/
2. Pull model: `ollama pull mistral`
3. Backend auto-detects on `localhost:11434`
4. Used as fallback when cloud providers exhausted

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Invalid API key" | Sync code wrong | Check console on backend startup |
| Analysis times out | No AI provider available | Check API keys in `config/.api_keys` |
| Mobile can't connect | Wrong API URL | Verify IP (not localhost from phone) |
| High memory usage | Temp files not cleaned | Implement cleanup in `backend/reset.py` |
| Slow searches | No indices on category | Indices already exist; check query |
| Rate limit errors | Too many requests | Wait 30 min or try different provider |
| Database locked | Concurrent writes | SQLite WAL mode handles this |

---

## File Permissions & Paths

```bash
# Backend directory structure
backend/
├── config/
│   ├── .api_keys           (readable: app only, writable: app)
│   ├── model_rankings.json (readable/writable: app)
│   └── openrouter_free_models.json (readable/writable: app)
│
├── temp/                   (writable: app)
│   └── [audio/video files] (temp, auto-cleaned)
│
└── superbrain.db           (readable/writable: app)

# Permissions
config/.api_keys:           600 (-rw-------)  # Secrets only
config/*.json:              644 (-rw-r--r--)
temp/:                      755 (drwxr-xr-x)
superbrain.db:              644 (-rw-r--r--)
```

---

## Contribution Guidelines

### Adding Features
1. Create feature branch: `git checkout -b feature/name`
2. Update API version in comments
3. Add tests to `tests/` directory
4. Update `CODEBASE_AUDIT.md` with changes
5. Submit PR with description

### Code Style
- **Backend**: PEP 8, use type hints
- **Frontend**: ESLint (configured in biome.json)
- **Commits**: Descriptive messages

### Testing Before PR
```bash
# Backend
cd backend
python -m pytest tests/

# Frontend
cd superbrain-app
npm run lint  # Biome lint check
npm run format  # Biome format
```

---

## Version Information

| Component | Version | Release |
|-----------|---------|---------|
| Python | 3.11+ | 2024 |
| FastAPI | 0.111+ | 2025 |
| React Native | 0.81.5 | 2025 |
| Expo SDK | 54 | 2025 |
| Docker | 20.10+ | Any |

---

## Support & Debugging Resources

**GitHub Issues**: https://github.com/sidinsearch/superbrain/issues

**Key Logs to Collect**:
```bash
# Backend startup log
docker logs superbrain-backend > backend.log

# Frontend error (React Native)
npm start  # Check terminal output

# Database state
sqlite3 superbrain.db ".schema"

# API test
curl -H "X-API-Key: TOKEN" \
     -d '{"url":"https://instagram.com/p/..."}' \
     -H "Content-Type: application/json" \
     -X POST http://localhost:5000/analyze
```

