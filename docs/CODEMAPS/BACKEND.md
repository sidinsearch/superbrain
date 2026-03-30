# Backend Codemap

**Last Updated:** 2026-03-31
**Location:** `backend/`

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        FASTAPI BACKEND (v1.02)                             │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    API Endpoints (api.py - 1376+ lines)           │   │
│  │  /connect  /analyze  /caption  /cache  /recent  /stats  /collections│   │
│  │  /queue  /post  /settings  /import  /export  /reset                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                              │                                             │
│          ┌───────────────────┼───────────────────┐                        │
│          ▼                   ▼                    ▼                        │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                 │
│  │   Database  │     │    Queue    │     │   Workers   │                 │
│  │  (MongoDB)  │     │  Manager    │     │   Thread    │                 │
│  └─────────────┘     └─────────────┘     └─────────────┘                 │
│                              │                                           │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │              Main Orchestrator (main.py)                           │   │
│  │  1. Download → 2. Visual → 3. Audio → 4. Music+Text              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│          ┌───────────────────┼───────────────────┐                        │
│          ▼                   ▼                    ▼                        │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                 │
│  │  Instagram  │     │   YouTube   │     │   Webpage   │                 │
│  │  Downloader │     │   Analyzer  │     │   Analyzer  │                 │
│  └─────────────┘     └─────────────┘     └─────────────┘                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Key Modules

### Core Modules

| Module | Purpose | Location |
|--------|---------|----------|
| `api.py` | FastAPI REST endpoints | Root (1376+ lines) |
| `main.py` | Content analysis orchestrator | Root |
| `database.py` | MongoDB operations | `core/` |
| `link_checker.py` | URL validation & type detection | `core/` |
| `model_router.py` | AI model routing | `core/` |
| `category_manager.py` | Category management | `core/` |

### Analyzers

| Module | Purpose | AI Service |
|--------|---------|------------|
| `visual_analyze.py` | Video/image analysis | Gemini Vision |
| `audio_transcribe.py` | Audio transcription | Whisper |
| `music_identifier.py` | Music detection | Shazam API |
| `text_analyzer.py` | Text/metadata analysis | Gemini |
| `youtube_analyzer.py` | YouTube video analysis | Gemini |
| `webpage_analyzer.py` | Webpage content extraction | Gemini |
| `caption.py` | Instagram caption fetching | Instaloader |

### Instagram Integration

| Module | Purpose |
|--------|---------|
| `instagram_downloader.py` | Download posts from Instagram |
| `instagram_login.py` | Instagram authentication |

### Utilities

| Module | Purpose |
|--------|---------|
| `utils/manage_token.py` | Token management utilities |
| `utils/db_stats.py` | Database statistics utilities |

## API Endpoints

### Connection & Authentication

```
POST /connect
  - Connect using sync code (no auth required)
  - Body: { sync_code: string }
  - Returns: { success, sync_code, api_token }

POST /reset/sync-code
  - Reset sync code (requires auth)
  - Returns: { success, sync_code, message }
  - Auth: X-API-Key header

POST /reset/api-token
  - Reset API token (requires auth)
  - Returns: { success, new_token, message }
  - Auth: X-API-Key header
```

### Analysis Endpoints

```
POST /analyze
  - Analyze content from URL
  - Query: { url: string, force?: boolean }
  - Auth: X-API-Key header or sync code
  - Returns: { success, cached, data, processing_time }
  - Status codes: 200 (success), 202 (queued for retry), 400 (error), 409 (already processing), 503 (queued)

GET /caption
  - Quick caption fetch
  - Query: { url: string }
  - Auth: X-API-Key header or sync code

GET /cache/{shortcode}
  - Check if post is cached
  - Auth: X-API-Key header or sync code
```

### Data Retrieval

```
GET /recent
  - Get recent analyses
  - Query: limit (default: 10, max: 100)
  - Auth: X-API-Key header

GET /stats
  - Database statistics
  - Auth: X-API-Key header

GET /categories
  - Get all categories with post counts
  - Auth: X-API-Key header

GET /category/{category}
  - Get posts by category
  - Query: limit (default: 20)
  - Auth: X-API-Key header

GET /search
  - Search by tags
  - Query: tags (comma-separated), limit
  - Auth: X-API-Key header
```

### Queue Management

```
GET /queue-status
  - Current queue and processing status
  - Auth: X-API-Key header

GET /queue/retry
  - Items scheduled for automatic retry
  - Auth: X-API-Key header

POST /queue/retry/flush
  - Immediately promote retry-ready items
  - Auth: X-API-Key header
```

### Collections

```
GET /collections
  - Get all collections
  - Auth: X-API-Key header

POST /collections
  - Create/update collection
  - Body: { id, name, icon, post_ids, created_at, updated_at }
  - Auth: X-API-Key header

PUT /collections/{collection_id}/posts
  - Update collection posts
  - Body: { post_ids: string[] }
  - Auth: X-API-Key header

DELETE /collections/{collection_id}
  - Delete collection
  - Auth: X-API-Key header
```

### Posts Management

```
DELETE /post/{shortcode}
  - Delete a post
  - Kills active analysis if running
  - Auth: X-API-Key header

PUT /post/{shortcode}
  - Update post metadata
  - Body: { category?, title?, summary? }
  - Auth: X-API-Key header
```

### Settings Endpoints

```
GET /settings/ai-providers
  - Get configured AI providers
  - Auth: X-API-Key header

POST /settings/ai-providers
  - Set AI provider API key
  - Body: { provider: string, api_key: string }
  - Auth: X-API-Key header

DELETE /settings/ai-providers/{provider}
  - Delete AI provider key
  - Auth: X-API-Key header

GET /settings/instagram
  - Get Instagram credentials status
  - Auth: X-API-Key header

POST /settings/instagram
  - Set Instagram credentials
  - Body: { username: string, password: string }
  - Auth: X-API-Key header

DELETE /settings/instagram
  - Delete Instagram credentials
  - Auth: X-API-Key header
```

### Import/Export

```
GET /export
  - Export data as JSON or ZIP
  - Query: limit, offset, format (json/zip)
  - Auth: X-API-Key header
  - Returns: JSON or ZIP file

POST /import
  - Import data from JSON
  - Query: mode (merge/replace)
  - Body: { version?, posts[], collections[] }
  - Auth: X-API-Key header

POST /import/file
  - Import data from file (JSON or ZIP)
  - Query: mode (merge/replace)
  - Auth: X-API-Key header
```

### Reset Endpoints

```
POST /reset/database
  - Clear all database data
  - Body: { confirm: "DELETE_ALL" }
  - Auth: X-API-Key header
  - Returns: { success, deleted_count, message }
```

### Health Checks

```
GET /ping
  - Lightweight liveness check (no auth, no DB)
  - Returns: { status: "ok", timestamp }

GET /status
  - Server status (no auth)
  - Returns: { status: "online", version, message }

GET /health
  - Health check with DB connectivity (requires auth)
  - Returns: { status, database, documents, timestamp }

GET /
  - API information (no auth)
  - Returns API metadata and endpoint list
```

## Analysis Pipeline

```
URL Input
    │
    ▼
┌─────────────────┐
│  Link Validator │
│ (link_checker)  │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
Instagram  YouTube/Webpage
    │         │
    ▼         ▼
Download  Direct Analysis
    │         │
    ▼         ▼
┌─────────────────────────┐
│   Parallel Analysis     │
│                         │
│  • Visual (Gemini)      │──► Images/Videos
│  • Audio (Whisper)      │──► Audio files
│  • Music (Shazam)       │──► Audio files
│  • Text (metadata)      │──► info.txt
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Summary Generation    │
│   (Model Router)       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   MongoDB Cache        │
│   (database.py)        │
└─────────────────────────┘
```

## Sync Code System

The backend uses a sync code system for easy mobile app connection:

1. **Sync Code Generation**: 8-character alphanumeric code
2. **Token Storage**: Stored in `sync_code.txt` as `api_token:sync_code`
3. **Authentication**: Accepts both full API token and sync code
4. **Connection Flow**:
   - Server displays sync code on startup
   - Mobile app sends sync code to `/connect` endpoint
   - Server validates and returns API token
   - App stores token for subsequent requests

## Queue System

- Background worker thread processes queue
- Max 1 concurrent analysis
- Retry queue for quota-exhausted items
- Automatic retry after 24 hours (configurable)
- Periodic retry-queue drain every ~2.5 minutes

## Configuration

### Environment Variables
- MongoDB connection via `core/database.py`
- API keys via config

### Key Dependencies
```
fastapi>=0.100.0
uvicorn>=0.23.0
pymongo>=4.0.0
google-generativeai>=0.3.0
openai>=1.0.0
instaloader>=4.9.0
whisper
python-dotenv
pydantic
```

## Authentication

- Token-based authentication via `X-API-Key` header
- Also accepts sync code directly as authentication
- Token generated and stored in `sync_code.txt`
- Token verified in `verify_token()` dependency

## Related Areas

- [INDEX.md](INDEX.md) - Overall architecture
- [FRONTEND.md](FRONTEND.md) - Frontend details
- [DATABASE.md](DATABASE.md) - Data storage
