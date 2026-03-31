# SuperBrain Architecture Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 SuperBrain                                  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Mobile App (React Native/Expo)                     │  │
│  │  ┌────────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │  HomeScreen    │  │ Settings    │  │ Library  │  │PostDetail  │  │  │
│  │  │  (Feed)        │  │ (API Keys)  │  │(Collect) │  │(Viewer)    │  │  │
│  │  └────────────────┘  └─────────────┘  └──────────┘  └────────────┘  │  │
│  │           ▲                      ▲                                    │  │
│  │           └──────────────────────┘                                    │  │
│  │                    ▼                                                  │  │
│  │          ┌──────────────────────┐                                    │  │
│  │          │   ApiService (Axios) │◄─────────x─ API Token (AsyncStore)│  │
│  │          └──────────────────────┘                                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                          │ X-API-Key Header                              │  │
│                          │ (Sync Code or Token)                           │  │
│                          ▼                                               │  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                  FastAPI Backend (Python 3.11)                       │  │
│  │                                                                       │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  REST API Endpoints                                           │  │  │
│  │  │  ├─ POST /analyze      (analyze URL)                          │  │  │
│  │  │  ├─ GET  /cache/{id}   (retrieve cached)                      │  │  │
│  │  │  ├─ GET  /recent       (timeline)                             │  │  │
│  │  │  ├─ GET  /search       (full-text)                            │  │  │
│  │  │  ├─ GET  /collections  (list collections)                     │  │  │
│  │  │  └─ POST /collections  (create collection)                    │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                          │                                         │  │  │
│  │  ┌─────────────────────┬─┴──────────────────────┬──────────────┐  │  │  │
│  │  │                     │                        │              │  │  │  │
│  │  ▼                     ▼                        ▼              ▼  │  │  │
│  │┌──────────────┐ ┌─────────────────────┐ ┌──────────────┐ ┌────────┐ │  │
│  ││ ModelRouter   │ │  Analyzer Pipeline  │ │ Link Checker │ │DateBase │ │  │
│  ││              │ │ (Multi-analyzer     │ │              │ │ Manager │ │  │
│  ││ • Groq       │ │  coordinator)       │ │ • Instagram  │ │         │ │  │
│  ││ • Gemini     │ │ ┌──────────────────┐│ │ • YouTube    │ │ SQLite  │ │  │
│  ││ • OpenRouter │ │ │text_analyzer     ││ │ • Web pages  │ │ Tables: │ │  │
│  ││ • Ollama     │ │ │visual_analyze    ││ │ • URL        │ │ analyses│ │  │
│  ││              │ │ │audio_transcribe  ││ │ • Shortener  │ │ queue   │ │  │
│  ││ EMA Ranking  │ │ │youtube_analyzer  ││ │   Resolution │ │ collect.│ │  │
│  ││ Failover     │ │ │webpage_analyzer  ││ │              │ │         │ │  │
│  ││ Rate-limit   │ │ │music_identifier  ││ │              │ │ WAL:✓   │ │  │
│  ││ Cooldown     │ │ │caption.py        ││ │              │ │ Indices:│ │  │
│  ││              │ │ └──────────────────┘│ │              │ │ 3 active│ │  │
│  │└──────────────┘ └─────────────────────┘ └──────────────┘ └────────┘ │  │
│  │                                                                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│     ▲                       ▲           ▲           ▲           ▲         │  │
│     │                       │           │           │           │         │  │
└─────┼───────────────────────┼───────────┼───────────┼───────────┼─────────┘  │
      │                       │           │           │           │            │
      │                       │           │           │           │            │
      ▼                       ▼           ▼           ▼           ▼            │
  ┌────────────┐        ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐   │
  │   Groq     │        │  Gemini    │ │OpenRouter│ │ Ollama   │ │Shazam  │   │
  │  API       │        │   API      │ │  API     │ │ (local)  │ │ API    │   │
  │            │        │            │ │          │ │          │ │        │   │
  │Text/Vision │        │Text/Vision │ │Text/Vision   Multi    │ │Music   │   │
  │ Models     │        │ Models     │ │          │ │Model     │ │ ID     │   │
  └────────────┘        └────────────┘ └──────────┘ └──────────┘ └────────┘   │
```

---

## Data Flow: Content Analysis

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          User shares URL                                   │
│                      (from Instagram, YouTube, etc.)                        │
└────────────────────────┬───────────────────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────────┐
            │ ShareHandlerScreen             │
            │ (Deep link interceptor)        │
            │ Validates & routes URL         │
            └────────────┬───────────────────┘
                         │
                         ▼
            ┌────────────────────────────────┐
            │ /analyze API Endpoint          │
            │ POST { url, force: boolean }   │
            │ Checks sync code or API token  │
            └────────────┬───────────────────┘
                         │
                         ▼
            ┌────────────────────────────────┐
            │ Link Validator                 │
            │ ├─ Detect type (IG/YT/Web)    │
            │ ├─ Generate shortcode          │
            │ └─ Check if already cached     │
            └────────────┬───────────────────┘
                         │
                ┌────────┴──────────┐
                │                   │
         Cache HIT (200)    Cache MISS
                │                   │
                ▼                   ▼
          Return 200          Enqueue to
          with Post data      processing_queue
                                   │
                                   ▼
                        (Return 503 "Queued")
                                   │
                         ┌─────────┴─────────┐
                         │ Background Job    │
                         │ (Process Post)    │
                         └────────┬──────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
            ┌──────────────┐ ┌─────────────┐ ┌────────────┐
            │ Instagram    │ │ YouTube     │ │ Web page   │
            │ Post         │ │ Video       │ │            │
            └──────┬───────┘ └────┬────────┘ └────┬───────┘
                   │              │               │
        ┌──────────┴──────────────┬───────────────┤
        │                         │               │
        ▼                         ▼               ▼
    ┌────────────────┐    ┌────────────────┐ ┌────────────┐
    │ Analyze        │    │ YouTube        │ │ Webpage    │
    │ ├─ Caption     │    │ Analyzer       │ │ Analyzer   │
    │ ├─ Visual      │    │ (Gemini native)│ │ (BS4/Traf) │
    │ ├─ Audio       │    │                │ │            │
    │ ├─ Music ID    │    │ One API call   │ │ Extract    │
    │ └─ Text        │    │ Full analysis  │ │ & Parse    │
    └────────┬───────┘    └────────┬───────┘ └────────┬───┘
             │                     │                  │
             └─────────────────────┼──────────────────┘
                                   │
                                   ▼
                       ┌───────────────────────────┐
                       │ ModelRouter Selection     │
                       │ (Pick fastest available)  │
                       │                           │
                       │ Try in order:             │
                       │ 1. Groq (fastest)        │
                       │ 2. Gemini                │
                       │ 3. OpenRouter            │
                       │ 4. Ollama (fallback)     │
                       └───────────┬───────────────┘
                                   │
                              ┌────┴────┐
                              │          │
                        Success       Failed
                              │          │
                              ▼          ▼
                         ┌────────┐ ┌─────────────┐
                         │ Call   │ │ Set retry   │
                         │ AI     │ │ (rate-limit │
                         │ Model  │ │ cooldown)   │
                         │        │ │             │
                         │ Get    │ │ Try next    │
                         │ Result │ │ provider    │
                         └────┬───┘ └──────┬──────┘
                              │           │
                              ▼           ▼
                         ┌─────────────────────────┐
                         │ Extract fields:         │
                         │ • title                 │
                         │ • summary               │
                         │ • tags                  │
                         │ • category              │
                         │ • music                 │
                         │ • transcription         │
                         └──────────┬──────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Save to SQLite:      │
                         │ analyses table       │
                         │                      │
                         │ Update queue        │
                         │ status → completed  │
                         └───────────┬─────────┘
                                     │
                                     ▼
                         (Analysis complete)
                         Post available in /cache
                         HomeScreen refreshes
```

---

## Mobile App Navigation Hierarchy

```
RootStack
├── Splash
│   └─ Initial loading screen
│      └─ Routes to: Home (if initialized) or Splash (if not)
│
├── Home (Main Tab)
│   ├─ Shows feed of recent posts
│   ├─ Search posts
│   ├─ Filter by category
│   └─ Can navigate to:
│       ├─ PostDetail (tap post)
│       ├─ Settings (gear icon)
│       └─ ShareHandler (share URL from another app)
│
├── Library (Collections Tab)
│   ├─ Shows all user collections
│   ├─ "Watch Later" (default)
│   ├─ Custom collections
│   └─ Can navigate to:
│       ├─ CollectionDetail (tap collection)
│       ├─ Create new collection
│       └─ Settings
│
├── Settings
│   ├─ API configuration
│   │  ├─ Sync code pairing
│   │  └─ Custom API URL
│   ├─ AI Provider setup
│   │  ├─ Groq API key
│   │  ├─ Gemini API key
│   │  └─ OpenRouter API key
│   ├─ Notification preferences
│   ├─ Data import/export
│   ├─ Instagram login
│   └─ About app
│
├── PostDetail
│   ├─ Display post:
│   │  ├─ Thumbnail
│   │  ├─ Title
│   │  ├─ Summary
│   │  ├─ Tags
│   │  ├─ Category
│   │  ├─ Music
│   │  └─ Transcription (if available)
│   ├─ Actions:
│   │  ├─ Share
│   │  ├─ Add to collection
│   │  ├─ Retry analysis
│   │  └─ Delete
│   └─ Notification action: "Mark as Watched"
│
├── CollectionDetail
│   ├─ Show all posts in collection
│   ├─ Remove posts
│   ├─ Delete collection
│   └─ Export collection
│
├── ShareHandler (Entry point from other apps)
│   ├─ Receive URL (Instagram, YouTube, etc.)
│   ├─ Route to analyzer
│   ├─ Show processing UI
│   └─ Navigate to PostDetail once complete
│
├── FailedAnalysis
│   ├─ Show posts that failed analysis
│   ├─ Display failure reason
│   ├─ Retry mechanism
│   └─ Delete failed posts
│
├── AIProvider
│   ├─ Configure API keys
│   ├─ Test provider connectivity
│   ├─ View available models
│   └─ Set provider priority
│
├── Instagram
│   ├─ Instagram login flow
│   ├─ Credential storage (IG client setup)
│   └─ Logout option
│
└── DataImportExport
    ├─ Export data (JSON)
    ├─ Import data
    ├─ Backup to file
    ├─ Restore from backup
    └─ Scheduled backup config
```

---

## Database Query Patterns

### Most Common
```
┌──────────────────────────────────────────┐
│ 1. Fetch recent posts (HomeScreen)      │
├──────────────────────────────────────────┤
│ SELECT * FROM analyses                   │
│ WHERE is_hidden = 0                      │
│ ORDER BY analyzed_at DESC                │
│ LIMIT 50                                 │
│ [Uses index: idx_analyses_analyzed_at]   │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ 2. Fetch by category (CategoryScreen)   │
├──────────────────────────────────────────┤
│ SELECT * FROM analyses                   │
│ WHERE category = ?                       │
│ AND is_hidden = 0                        │
│ ORDER BY analyzed_at DESC                │
│ [Uses index: idx_analyses_category]      │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ 3. Check cache before analysis           │
├──────────────────────────────────────────┤
│ SELECT * FROM analyses                   │
│ WHERE shortcode = ?                      │
│ [Uses PRIMARY KEY index]                 │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ 4. Get queue status                      │
├──────────────────────────────────────────┤
│ SELECT status, COUNT(*) FROM             │
│ processing_queue                         │
│ GROUP BY status                          │
│ [Uses index: idx_queue_status]           │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ 5. Find posts for retry (retry logic)   │
├──────────────────────────────────────────┤
│ SELECT * FROM processing_queue           │
│ WHERE status = 'failed'                  │
│ AND retry_after < datetime('now')        │
│ ORDER BY retry_after ASC                 │
│ [Uses index: idx_queue_retry]            │
└──────────────────────────────────────────┘
```

---

## Model Router Decision Tree

```
┌─────────────────────────────────────────────────────────┐
│ Content needs AI processing                            │
├─────────────────────────────────────────────────────────┤
│ Is it text OR vision?                                  │
└────────────────┬──────────────────────────┬────────────┘
                 │                          │
             TEXT                       VISION
                 │                          │
                 ▼                          ▼
    ┌─────────────────────┐    ┌─────────────────────┐
    │ TEXT PRIORITY:      │    │ VISION PRIORITY:    │
    ├─────────────────────┤    ├─────────────────────┤
    │ 1. Groq (fastest)   │    │ 1. Gemini (strong)  │
    │    EMA score: ? sec │    │    EMA score: ? sec │
    │                     │    │                     │
    │ 2. Gemini          │    │ 2. Groq Vision      │
    │    EMA score: ? sec │    │    EMA score: ? sec │
    │                     │    │                     │
    │ 3. OpenRouter      │    │ 3. OpenRouter Vision│
    │    (free auto-discovered) │    (free discovered) │
    │    EMA score: ? sec │    │    EMA score: ? sec │
    │                     │    │                     │
    │ 4. Ollama (fallback)│    │ 4. Ollama Vision    │
    │    EMA score: ? sec │    │    (local CPU slow) │
    └──────────┬──────────┘    └──────────┬──────────┘
               │                          │
       ┌───────┴──────────┬───────────────┴───────┐
       │                  │                       │
       ▼                  ▼                       ▼
  Try Provider      Provider Down?        Success?
                    (in cooldown)              │
                    ├─ 5 min: generic      ┌──┴─ YES
                    │ error                 │
                    ├─30 min: rate-limit    │ Store result
                    │ (429 HTTP)            │ Update EMA
                    │                       │ Return
                    └─ Try next provider    │
                                            ▼
                                        Complete
```

---

## API Request/Response Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mobile App                         FastAPI Backend      External APIs   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ POST /analyze                                                           │
│ Headers:                                                                │
│   X-API-Key: <sync-code|api-token>                                     │
│ Body:                                                                   │
│   { url: "https://instagram.com/p/...", force: false }                 │
│ ├─────────────────────────────────────────────────────►                │
│                                                         │                │
│                                       Verify auth       │                │
│                                       Validate URL      │                │
│                                       Check cache       │                │
│                                                         │                │
│                                   ┌─────────────────┐  │                │
│                                   │ Cache hit?      │  │                │
│                                   │ YES → return    │  │                │
│                                   │       200 OK    │  │                │
│                                   │       {Post}    │  │                │
│                                   └────────┬────────┘  │                │
│                                            │           │                │
│                                   NO → Enqueue        │                │
│                                       processing       │                │
│                                                        │                │
│                                   ┌──────────────┐    │                │
│                                   │ Max queue?   │    │                │
│                                   │ YES → 503    │    │                │
│                                   │ {"detail":   │    │                │
│                                   │  "Queued"}   │    │                │
│                                   └────────┬─────┘    │                │
│                                            │          │                │
│       ◄─────────────────────────────────────          │                │
│       Response: 503 Queued                           │                │
│       {"success": false, "cached": false,            │                │
│        "error": "Request queued..."}                 │                │
│                                            │          │                │
│       (Wait loop, poll /queue-status)      │          │                │
│                                            │          │                │
│                       │       Background processing:   │                │
│                       │       ├─ Link validation       │                │
│                       │       ├─ Content download      │                │
│                       │       ├─ Analyzer pipeline     │                │
│                       │       ├─ Model selection ──────────────────►   │
│                       │       │                                   Groq  │
│                       │       │                              or Gemini  │
│                       │       │                           or OpenRouter │
│                       │       │                              or Ollama  │
│                       │       │                                   ◄──── │
│                       │       ├─ Parse response           Result JSON  │
│                       │       ├─ Store in SQLite                │       │
│                       │       └─ Update queue status          ┌─┘       │
│                       │                                       │         │
│       GET /cache/{shortcode}                                 │         │
│       ◄────────────────────────────────────────────────────┐ │         │
│       Response: 200 OK                                    │ │         │
│       {"success": true,                                  │ │         │
│        "cached": true,                                  │ │         │
│        "data": {...post...},                            │ │         │
│        "processing_time": 15.2}                         │ │         │
│       ◄────────────────────────────────────────────────┘─┘         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Docker Host                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │       Docker Container: superbrain-backend         │ │
│  │       (python:3.11-slim)                           │ │
│  ├────────────────────────────────────────────────────┤ │
│  │                                                    │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │ Uvicorn Server                               │ │ │
│  │  │ :5000                                        │ │ │
│  │  │ ├─ FastAPI app                              │ │ │
│  │  │ ├─ REST routes                              │ │ │
│  │  │ └─ CORS middleware                          │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │                      ▲                             │ │
│  │                      │ HTTP                        │ │
│  │                      │                             │ │
│  │  ┌──────────────────┴──────────────────────────┐  │ │
│  │  │ Analyzer Threads (concurrent job processing) │ │ │
│  │  │ ├─ max_concurrent threads                   │  │ │
│  │  │ ├─ Queue management                         │  │ │
│  │  │ └─ Error recovery                           │  │ │
│  │  └──────┬──────────────────────────────────────┘  │ │
│  │         │                                          │ │
│  │  ┌──────┴─────────────────────────────────────┐   │ │
│  │  │ Local Resources                            │   │ │
│  │  │ ├─ Whisper model (optional)               │   │ │
│  │  │ ├─ Ollama connection (optional)           │   │ │
│  │  │ └─ ffmpeg (ffmpeg package)                │   │ │
│  │  └──────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  └────────────────────────────────────────────────────┘ │
│         ▲           ▲           ▲           ▲          │
│         │           │           │           │          │
│    Ports │      Volumes │      │           │          │
│    5000  │   /config    │      │           │          │
│          │   /temp      │      │           │          │
│          │   /db        │      │           │          │
└──────────┼───────────┼──────┼───────────┼──────────┘
           │            │        │           │
           │            │        │           │
           ▼            ▼        ▼           ▼
      Host:5000    ~/.api_keys  ~/tmp  ~/db/superbrain.db
      (localhost)  (persisted)  (temp) (persisted)


           └──────────┬───────────┘
                      │ (Optional: Ngrok tunnel)
                      │
                      ▼
              ngrok TCP tunnel
              (public URL for mobile)
              ngrok.io/xxxxx:5000

```

---

## Key Files Location Reference

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **API Server** | `backend/api.py` | 1000+ | Main FastAPI application |
| **Orchestrator** | `backend/main.py` | 300+ | Multi-analyzer coordinator |
| **Model Router** | `backend/core/model_router.py` | 805 | AI provider selection & routing |
| **Database** | `backend/core/database.py` | 200+ | SQLite schema & CRUD |
| **Link Validator** | `backend/core/link_checker.py` | 200+ | URL detection & parsing |
| **Text Analyzer** | `backend/analyzers/text_analyzer.py` | 80+ | Metadata analysis |
| **Visual Analyzer** | `backend/analyzers/visual_analyze.py` | 150+ | Frame extraction |
| **App Root** | `superbrain-app/App.tsx` | 200+ | Navigation & deep linking |
| **Home Screen** | `superbrain-app/src/screens/HomeScreen.tsx` | 200+ | Main feed UI |
| **Post Detail** | `superbrain-app/src/screens/PostDetailScreen.tsx` | 250+ | Post viewer UI |
| **API Service** | `superbrain-app/src/services/api.ts` | 150+ | HTTP client wrapper |
| **Types** | `superbrain-app/src/types/index.ts` | 80+ | TypeScript interfaces |

---

## Conclusion

This architecture diagram shows:
- **Clean separation** between frontend and backend
- **Intelligent routing** through the ModelRouter
- **Scalable design** with background job processing
- **Local-first approach** with SQLite persistence
- **Multi-provider AI** with automatic failover

The system handles content from multiple sources (Instagram, YouTube, web) through a unified pipeline and serves results efficiently through a REST API.
