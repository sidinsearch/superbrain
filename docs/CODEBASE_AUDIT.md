# SuperBrain Codebase Architecture Audit

**Generated**: March 31, 2026  
**Project**: SuperBrain - Self-hosted AI-powered content archive for Android  
**Scope**: Complete full-stack analysis of backend, frontend, database, and deployment

---

## Executive Summary

**SuperBrain** is a production-ready dual-stack application:

- **Backend**: Python/FastAPI with intelligent multi-provider AI routing (Groq, Gemini, OpenRouter, Ollama)
- **Frontend**: React Native/Expo mobile app for Android with TypeScript
- **Database**: SQLite with WAL mode for concurrent access
- **Deployment**: Docker containerized with optional Ngrok tunnel

**Status**: Core features production-ready; some supplementary features incomplete.

---

## Technology Stack

### Backend (Python 3.11)
| Component | Version | Purpose |
|-----------|---------|---------|
| FastAPI | ≥0.111.0 | REST API framework |
| Uvicorn | ≥0.29.0 | ASGI server |
| Pydantic | ≥2.0.0 | Data validation |
| OpenAI Whisper | ≥20231117 | Audio transcription |
| Google GenAI | ≥0.8.0 | Gemini API client |
| Groq | ≥0.9.0 | Groq API client |
| OpenCV | ≥4.9.0.80 | Video frame extraction |
| BeautifulSoup4 | ≥4.12.0 | Web scraping |
| Shazamio | ≥0.4.0 | Music identification |
| Instagrapi | ≥2.0.0 | Instagram download |

### Frontend (Expo SDK 54)
| Component | Version | Purpose |
|-----------|---------|---------|
| React Native | 0.81.5 | Mobile framework |
| React | 19.1.0 | UI library |
| TypeScript | ~5.9.2 | Type safety |
| React Navigation | ^7.1.28 | Screen navigation |
| Axios | ^1.13.4 | HTTP client |
| AsyncStorage | ^2.2.0 | Local storage |
| Expo Notifications | ^0.32.16 | Push notifications |
| Biome | ^1.9.0 | Linting/formatting |

### Infrastructure
- **Container**: Docker (Python 3.11-slim base)
- **Orchestration**: Docker Compose
- **Tunneling**: Ngrok (optional remote access)
- **Build Tool**: Gradle (Android)

---

## Project Structure

### Backend Architecture
```
backend/
├── api.py                          # FastAPI application (1000+ lines)
├── main.py                         # Orchestrator (multi-analyzer coordinator)
├── start.py                        # Interactive setup wizard
├── requirements.txt                # Python dependencies
├── Dockerfile                      # Container definition
├── docker-compose.yml              # Service configuration
├── superbrain.db                   # SQLite database

├── core/
│   ├── database.py                 # SQLite manager with migrations
│   ├── model_router.py             # AI provider routing (805 lines)
│   ├── category_manager.py         # Category operations
│   ├── link_checker.py             # URL validation (Instagram/YouTube/Web)

├── analyzers/                      # Content analysis pipeline
│   ├── text_analyzer.py            # Metadata → AI analysis
│   ├── visual_analyze.py           # Video frames → vision model analysis
│   ├── audio_transcribe.py         # Audio → Whisper transcription
│   ├── youtube_analyzer.py         # YouTube → Gemini native analysis
│   ├── webpage_analyzer.py         # Web page extraction
│   ├── music_identifier.py         # Shazam music detection
│   └── caption.py                  # Instagram caption extraction

├── instagram/                      # Instagram integration
│   ├── instagram_login.py
│   └── instagram_downloader.py

├── config/                         # Configuration & cache
│   ├── .api_keys                   # Encrypted API keys (gitignored)
│   ├── model_rankings.json         # Performance history (EMA scores)
│   ├── openrouter_free_models.json # Dynamic model cache (6h refresh)
│   ├── ngrok_token.txt
│   └── whisper_model.txt

├── tests/
│   ├── test_api.py
│   ├── test_db.py
│   └── test_sync_code.py

└── utils/
    ├── db_stats.py
    └── manage_token.py
```

### Frontend Architecture (React Native/Expo)
```
superbrain-app/
├── App.tsx                         # Root navigation setup
├── index.ts                        # Entry point
├── package.json
├── tsconfig.json
├── eas.json                        # EAS Build configuration
├── biome.json                      # Lint/format config

├── src/
│   ├── screens/                    # 11 main screens
│   │   ├── HomeScreen.tsx          # Main feed
│   │   ├── LibraryScreen.tsx       # Collections & saved posts
│   │   ├── PostDetailScreen.tsx    # Single post viewer
│   │   ├── SettingsScreen.tsx      # Configuration
│   │   ├── AIProviderScreen.tsx    # Model provider setup
│   │   ├── InstagramScreen.tsx     # IG authentication
│   │   ├── CollectionDetailScreen.tsx
│   │   ├── DataImportExportScreen.tsx
│   │   ├── FailedAnalysisScreen.tsx
│   │   ├── ShareHandlerScreen.tsx  # Deep link handler
│   │   └── SplashScreen.tsx        # Splash/onboarding

│   ├── services/
│   │   ├── api.ts                  # HTTP client wrapper
│   │   ├── collections.ts          # Collection management
│   │   ├── notificationService.ts  # Notification handling
│   │   └── postsCache.ts           # Local caching

│   ├── types/
│   │   └── index.ts                # TypeScript interfaces

│   ├── components/
│   │   └── CustomToast.tsx

│   ├── constants/
│   │   └── icons.ts

│   └── theme/
│       └── colors.ts

├── android/                        # Android native build
│   ├── app/src/
│   ├── build.gradle
│   └── gradle.properties

└── assets/
    ├── mockups/                    # 9 app screenshots
    └── notification_icons/
```

---

## Database Schema

### SQLite Tables & Indexes

#### `analyses` (Primary Content Table)
```sql
CREATE TABLE analyses (
    shortcode TEXT PRIMARY KEY,      -- ID: Instagram code | YT_videoid | WP_hash
    url TEXT,
    username TEXT,
    content_type TEXT DEFAULT 'instagram',  -- 'instagram', 'youtube', or 'webpage'
    analyzed_at TEXT,               -- ISO 8601 timestamp
    updated_at TEXT,
    post_date TEXT,
    likes INTEGER DEFAULT 0,
    thumbnail TEXT DEFAULT '',      -- Image URL/base64
    title TEXT,                     -- AI-generated title
    summary TEXT,                   -- AI-generated summary (3-5 sentences)
    tags TEXT,                      -- Space-separated or JSON array
    music TEXT,                     -- Identified artist/song
    category TEXT,                  -- Auto-assigned: product, places, recipe, etc.
    visual_analysis TEXT,           -- JSON from vision model
    audio_transcription TEXT,       -- JSON from Whisper
    text_analysis TEXT,             -- JSON from text analyzer
    is_hidden INTEGER DEFAULT 0     -- Soft-delete flag
);

CREATE INDEX idx_analyses_category ON analyses (category);
CREATE INDEX idx_analyses_analyzed_at ON analyses (analyzed_at DESC);
CREATE INDEX idx_analyses_content_type ON analyses (content_type);
```

#### `processing_queue` (Background Jobs)
```sql
CREATE TABLE processing_queue (
    shortcode TEXT PRIMARY KEY,
    url TEXT,
    status TEXT DEFAULT 'queued',   -- 'queued' | 'processing' | 'completed' | 'failed'
    position INTEGER,               -- Queue position
    added_at TEXT,
    started_at TEXT,
    updated_at TEXT,
    retry_after TEXT,               -- Timestamp for rate-limit cooldown
    attempts INTEGER DEFAULT 0,     -- Retry count
    reason TEXT,                    -- Failure reason
    content_type TEXT
);

CREATE INDEX idx_queue_status ON processing_queue (status);
CREATE INDEX idx_queue_position ON processing_queue (position);
CREATE INDEX idx_queue_retry ON processing_queue (status, retry_after);
```

#### `collections` (User Collections)
```sql
CREATE TABLE collections (
    id TEXT PRIMARY KEY,            -- User-defined or 'default_watch_later'
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📁',         -- Emoji icon
    post_ids TEXT DEFAULT '[]',     -- JSON array of shortcodes
    created_at TEXT,
    updated_at TEXT
);
```

**Database Features**:
- **WAL Mode**: Write-Ahead Logging for concurrent reads
- **Foreign Keys**: Enabled globally
- **Migrations**: Non-destructive, run on startup
- **Indices**: Optimized for category/date/content_type queries

---

## API Endpoints

### Health & Status
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/` | GET | No | Welcome page |
| `/ping` | GET | No | Health check |
| `/health` | GET | No | Detailed status |
| `/status` | GET | Yes | Server + queue info |

### Content Analysis
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/analyze` | POST | Yes | Analyze URL (Instagram/YouTube/Web) |
| `/caption` | GET | Yes | Extract Instagram caption + metadata |

### Retrieval
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/cache/{shortcode}` | GET | Yes | Get cached analysis |
| `/recent` | GET | Yes | Recent posts (limit param) |
| `/search` | GET | Yes | Full-text search (q, category, limit) |
| `/categories` | GET | Yes | Category distribution |
| `/category/{cat}` | GET | Yes | Posts in category |

### Collections
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/collections` | GET | Yes | List all collections |
| `/collections` | POST | Yes | Create collection |
| `/collections/{id}/posts` | PUT | Yes | Add/update posts |
| `/collections/{id}` | DELETE | Yes | Delete collection |

### Queue & System
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/queue-status` | GET | Yes | Processing queue state |
| `/stats` | GET | Yes | Database statistics |
| `/connect` | POST | No | Pair sync code |
| `/reset/sync-code` | POST | Yes | Generate new sync code |

**Authentication**: 
- Header: `X-API-Key`
- Accepts: Full API token OR 8-char sync code

---

## Core Features

### 1. Multi-Provider AI Router
**Location**: `backend/core/model_router.py` (~805 lines)

**Purpose**: Intelligent failover routing with performance optimization

**Provider Priority**:
- **Text**: Groq → Gemini → OpenRouter (free) → Local Ollama
- **Vision**: Gemini → Groq Vision → OpenRouter Vision → Ollama

**Smart Features**:
- **EMA Ranking**: Exponential moving average of response times
- **Auto-Healing**: Models recover after 5 min (errors) or 30 min (rate-limits)
- **Dynamic Discovery**: OpenRouter free models refreshed every 6 hours
- **Failover**: Automatic cascading to next provider on failure
- **Persistence**: Rankings survive server restart via `model_rankings.json`

**Configuration**:
- `model_rankings.json` → EMA scores for each model
- `openrouter_free_models.json` → Free model cache
- `.api_keys` → Encrypted API credentials

### 2. Content Analysis Pipeline
**Location**: `backend/main.py` (orchestrator)

**Supported Content**:
1. **Instagram Posts/Reels** → Visual analysis, audio, music ID
2. **YouTube Videos** → Native Gemini analysis (no download)
3. **Web Pages** → Title, summary, extraction

**Analysis Output**:
- **Title** & **Summary** (3-5 sentences)
- **Category** (auto-assigned via AI)
- **Tags** (8-12 hashtags)
- **Music** (Shazam identification)
- **Transcription** (Groq Whisper API or local)
- **Visual Analysis** (4 key frames)
- **Text Analysis** (metadata insights)

**Analyzer Modules**:
| Module | Input | Output |
|--------|-------|--------|
| `text_analyzer.py` | Metadata file | AI analysis |
| `visual_analyze.py` | Video/image URL | Frame analysis |
| `audio_transcribe.py` | Audio URL | Transcribed text |
| `youtube_analyzer.py` | YouTube URL | Gemini analysis |
| `webpage_analyzer.py` | Web URL | Extracted content |
| `music_identifier.py` | Audio file | Artist/song info |
| `caption.py` | Instagram URL | Caption + metadata |

### 3. Universal Link Validator
**Location**: `backend/core/link_checker.py`

**Detection**: Instagram, YouTube, generic web pages

**Unified Shortcode Generation**:
- **Instagram**: Original shortcode (e.g., `DUQD-t2DC1D`)
- **YouTube**: `YT_<11-char-video-id>`
- **Webpage**: `WP_<sha256-hash[:16]>`

**Features**:
- Short URL resolution (bit.ly, tinyurl, etc.)
- User-Agent handling for API compatibility

### 4. Authentication & Sync
**Mechanism**: Sync Code + API Token
- **Sync Code**: 8-character alphanumeric (visible in console at startup)
- **API Token**: 32-character generated internally
- **Storage**: Both stored in `sync_code.txt`
- **Usage**: Header `X-API-Key` accepts either

**Rotation**: `/reset/sync-code` generates new pair

---

## Frontend Navigation

### Navigation Stack (React Navigation)
```
RootStack (Native Stack Navigator)
├── Splash (initial splash screen)
├── Home (main feed)
├── Library (collections)
├── Settings (configuration)
├── PostDetail (single post)
├── CollectionDetail (collection posts)
├── FailedAnalysis (retry queue)
├── AIProvider (model config)
├── Instagram (IG login)
├── DataImportExport (backup/restore)
└── ShareHandler (deep link handler)
```

### Key Screens

**HomeScreen**
- Feed of recent analyzed posts
- Search & category filter
- Pull-to-refresh
- Add/share buttons

**LibraryScreen**
- Collections browser
- "Watch Later" default collection
- Custom user collections
- Collection creation

**PostDetailScreen**
- Full post with metadata (title, summary, tags)
- Thumbnail image
- Music information
- Transcription display
- Share/export actions
- Retry analysis button

**SettingsScreen**
- API token configuration
- Model provider selection
- Notification preferences
- Data import/export
- About/version info

**AIProviderScreen**
- Groq, Gemini, OpenRouter API key input
- Provider connectivity test
- Model availability check

**Deep Linking** (ShareHandlerScreen)
- Intercepts URLs from share menu
- Routes to analysis
- Supports Instagram, YouTube, web

---

## Build & Deployment

### Docker Setup
**Base Image**: `python:3.11-slim`

**System Dependencies**:
- `ffmpeg` → Video processing
- `libmagic1` → File type detection
- `libgl1-mesa-glx`, `libglib2.0-0` → OpenCV support

**Port**: 5000 (HTTP)

**Volumes**:
- `config/` → API keys, model rankings
- `temp/` → Temporary files
- `superbrain.db` → SQLite database

**Health Check**: `/ping` every 30 seconds

**Restart Policy**: `unless-stopped`

### Setup Wizard (`backend/start.py`)
Interactive configuration flow:
1. Virtual environment setup
2. Python dependency installation
3. API key validation (Groq, Gemini, OpenRouter)
4. Ollama local model setup (optional)
5. Whisper model download (optional)
6. Ngrok tunnel configuration (optional)
7. Database initialization

**Features**:
- Color-coded terminal output (ANSI)
- Progress bars for long operations
- API key validation before saving
- Automatic Ngrok URL detection

### Build Systems

**Backend**
- Package Manager: pip
- Python: 3.11+
- Entry: `uvicorn api:app`

**Frontend**
- Build: Expo CLI
- Package Manager: npm
- Android: Gradle
- Distribution: APK (internal/preview/production)

---

## Data Types & Models

### TypeScript Interfaces (`src/types/index.ts`)

```typescript
interface Post {
  shortcode: string;
  url: string;
  username: string;
  title: string;
  summary: string;
  tags: string[];
  music: string;
  category: string;
  content_type?: 'instagram' | 'youtube' | 'webpage';
  thumbnail_url?: string;
  likes?: number;
  post_date?: string;
  analyzed_at?: string;
  processing?: boolean;
}

interface Collection {
  id: string;
  name: string;
  icon: string;
  postIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface QueueStatus {
  currently_processing: string[];
  processing_count: number;
  queue: Array<{shortcode: string; position: number}>;
  queue_count: number;
  retry_queue: RetryQueueItem[];
  retry_count: number;
}

interface RetryQueueItem {
  shortcode: string;
  url: string;
  content_type: string;
  reason: string;
  retry_after: string;
  attempts: number;
}
```

---

## Testing

### Test Coverage
**Current Status**: Minimal (smoke tests only)

| File | Purpose | Status |
|------|---------|--------|
| `test_api.py` | API endpoint tests | Basic |
| `test_db.py` | Database CRUD | Basic |
| `test_sync_code.py` | Auth token generation | Basic |

**Gaps**:
- No integration tests
- No E2E tests for mobile
- No visual regression tests
- No performance benchmarks

---

## Configuration Files

### Backend
| File | Purpose |
|------|---------|
| `.api_keys` | API credentials (gitignored) |
| `model_rankings.json` | Model performance history |
| `openrouter_free_models.json` | Free model cache |
| `ngrok_token.txt` | Ngrok authentication |
| `whisper_model.txt` | Local Whisper model name |

### Frontend
| File | Purpose |
|------|---------|
| `package.json` | Dependencies & scripts |
| `tsconfig.json` | TypeScript configuration |
| `eas.json` | EAS Build profiles |
| `biome.json` | Linting & formatting rules |
| `.env` (via EXPO_PUBLIC_*) | Environment variables |

---

## Missing or Incomplete Components

### Critical (Blocking Production)
None identified — core features functional.

### High Priority
| Feature | Status | Impact |
|---------|--------|--------|
| CI/CD Pipeline | ❌ Not implemented | Manual deployments required |
| API Documentation | ❌ Missing | Swagger/OpenAPI not available |
| Backup/Export | ⚠️ Incomplete | UI exists; implementation partial |
| Logging | ⚠️ Basic | No centralized aggregation |

### Medium Priority
| Feature | Status | Impact |
|---------|--------|--------|
| Advanced Search | ⚠️ Basic | No full-text indexing |
| Test Coverage | ⚠️ ~10% | Test suite needed |
| User Preferences | ⚠️ Limited | No theme/custom settings |
| Rate Limiting | ⚠️ Partial | No per-user limits |
| Monitoring | ❌ Missing | No dashboards or alerts |
| Offline Support | ❌ Missing | No offline mode |

### Nice-to-Have
| Feature | Status |
|---------|--------|
| Analytics Dashboard | ❌ Not implemented |
| Multi-user Accounts | ❌ Not implemented |
| Web Interface | ❌ Not planned |
| Theme Support | ❌ Not implemented |

---

## Performance Characteristics

### Speed Estimates
| Operation | Typical Time |
|-----------|--------------|
| Model Selection | <50 ms |
| Database Query | <100 ms |
| API Response (cached) | 200-500 ms |
| Content Analysis | 5-30 seconds |
| Total Request (new) | 30-60 seconds |

### Database Characteristics
- **Record Size**: ~5 KB per post (with full text)
- **Indices**: 3 active (category, date, content_type)
- **Concurrent Connections**: SQLite with WAL supports reasonable concurrency
- **Typical DB Size**: 10K posts = ~50 MB

### Model Performance
- **Groq**: Fastest (text), ~1-3 sec
- **Gemini**: Medium (vision), ~2-5 sec
- **OpenRouter**: Variable (free models), ~3-10 sec
- **Ollama**: Slowest (local CPU), ~5-30 sec

---

## Security Assessment

### Implemented ✅
- API key isolation (not in git)
- CORS configured
- Sync code authentication
- Pydantic input validation
- SQLite foreign keys enabled

### Missing ⚠️
- Per-user rate limiting
- HTTPS enforcement (deployment-dependent)
- Request/response logging
- Audit trail
- Secrets rotation policy

### Recommended Improvements
1. Implement per-client rate limiting (e.g., 100 requests/hour)
2. Add request signing (HMAC)
3. Implement comprehensive audit logging
4. Add API key expiration
5. Use TLS for all communications

---

## Deployment Checklist

### Pre-deployment
- [ ] All API keys configured in `.api_keys`
- [ ] Database migrations verified
- [ ] Docker image builds successfully
- [ ] Health check endpoint responsive
- [ ] Log aggregation configured
- [ ] Backup strategy defined

### Post-deployment
- [ ] Health check dashboard monitored
- [ ] Error alerts configured
- [ ] Performance baseline established
- [ ] Backup runs tested
- [ ] Documentation updated

---

## Recommendations

### Short-term (1-2 weeks)
1. **Add Swagger/OpenAPI** → Auto-generate API docs
2. **Implement pytest suite** → Start with 30% coverage
3. **Add structured logging** → JSON logs for aggregation
4. **Document API authentication** → How sync code/tokens work

### Medium-term (1-2 months)
1. **Refactor ModelRouter** → Split into provider classes
2. **Add user preferences** → Settings persistence
3. **Implement per-user rate limiting** → Prevent abuse
4. **Add scheduled backups** → Automatic DB dumps

### Long-term (3+ months)
1. **Full-text search** → Lucene/Elasticsearch integration
2. **Admin dashboard** → Usage analytics, health monitoring
3. **Multi-user support** → User accounts with shared collections
4. **Web interface** → React SPA frontend
5. **Offline support** → Service workers, IndexedDB

---

## Architecture Strengths

✅ **Modular analyzers** — Easy to extend with new content types  
✅ **Smart model routing** — Automatic failover with learning  
✅ **Zero vendor lock-in** — Self-hosted, portability  
✅ **Responsive UI** — Fast navigation, smooth transitions  
✅ **Database normalization** — Clean schema with indices  
✅ **Type safety** — TypeScript frontend, Pydantic validation  

## Architecture Gaps

❌ **Single-threaded model router** — Could be async/parallel  
❌ **No caching layer** → Redis would speed queries  
❌ **Monolithic FastAPI app** → Could split into blueprints  
❌ **No message queue** → Job distribution would scale better  
❌ **Limited error recovery** → Some failures not retryable  

---

## Conclusion

**SuperBrain** is a well-designed, functional personal knowledge-base application with strong fundamentals:
- Clean separation between backend and frontend
- Intelligent multi-provider AI integration
- Robust database schema with proper indexing
- Intuitive mobile UI with proper navigation

**Production-ready for personal/small-team use**. Scaling to 100+ concurrent users would require:
- Async model routing (currently blocking)
- Message queue (Celery/RQ) for background jobs
- Redis caching layer
- Database replication/clustering
- Comprehensive monitoring & alerting

The codebase is well-positioned for these improvements without major architectural changes.

---

**Audit Completed**: March 31, 2026  
**Total Codebase**: ~6,000 lines (backend + frontend)  
**Primary Maintainer**: Analysis tool  
**Last Review**: Session initialization
