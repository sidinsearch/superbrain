# SuperBrain Codemap

**Last Updated:** 2026-03-31
**Project Type:** Full-stack Mobile Application (React Native + Python Backend)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPERBRAIN ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────────────────────────────┐  │
│  │   React Native   │         │              Python Backend              │  │
│  │      Mobile     │         │              (FastAPI)                   │  │
│  │      App        │         │                                      │  │
│  └────────┬─────────┘         └──────────────────┬───────────────────────┘  │
│           │                                          │                       │
│           │            ┌──────────────────────────────▼───────────────────┐  │
│           │            │              MongoDB Database                    │  │
│           │            │     (Analysis results, cache, queue)            │  │
│           │            └──────────────────────────────────────────────────┘  │
│           │                                          │                       │
│           │            ┌──────────────────────────────▼───────────────────┐  │
│           │            │              AI Services                          │  │
│           │            │   (Gemini, Whisper, Shazam, OpenAI)             │  │
│           └───────────►└──────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Areas

| Area | Description | Location |
|------|-------------|----------|
| **Frontend** | React Native/Expo mobile app | `superbrain-app/` |
| **Backend** | FastAPI REST API server | `backend/` |
| **Database** | MongoDB for caching and queuing | `backend/core/database.py` |
| **Analyzers** | AI content analysis modules | `backend/analyzers/` |
| **API** | REST endpoints and authentication | `backend/api.py` |

## Directory Structure

```
superbrain/
├── superbrain-app/           # React Native (Expo) Mobile App
│   ├── src/
│   │   ├── services/         # API communication
│   │   │   ├── api.ts         # Main API service (662 lines)
│   │   │   ├── collections.ts # Collections management
│   │   │   ├── notificationService.ts
│   │   │   └── postsCache.ts
│   │   ├── theme/            # UI theming
│   │   │   └── colors.ts
│   │   ├── types/            # TypeScript interfaces
│   │   │   └── index.ts
│   │   ├── screens/          # App screens (11 screens)
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── LibraryScreen.tsx
│   │   │   ├── SettingsScreen.tsx
│   │   │   ├── CollectionDetailScreen.tsx
│   │   │   ├── PostDetailScreen.tsx
│   │   │   ├── InstagramScreen.tsx
│   │   │   ├── AIProviderScreen.tsx
│   │   │   ├── DataImportExportScreen.tsx
│   │   │   ├── FailedAnalysisScreen.tsx
│   │   │   ├── ShareHandlerScreen.tsx
│   │   │   └── SplashScreen.tsx
│   │   ├── components/       # Reusable components
│   │   │   └── CustomToast.tsx
│   │   └── index.ts          # App entry point
│   ├── App.tsx               # Root component
│   ├── app.json              # Expo configuration
│   └── package.json
│
├── backend/                  # Python FastAPI Backend
│   ├── api.py                # FastAPI endpoints (1376+ lines)
│   ├── main.py               # Content analysis orchestrator
│   ├── core/
│   │   ├── database.py       # MongoDB operations
│   │   ├── link_checker.py   # URL validation
│   │   ├── model_router.py   # AI model routing
│   │   └── category_manager.py
│   ├── analyzers/            # Content analysis modules
│   │   ├── visual_analyze.py # Video/image analysis (Gemini)
│   │   ├── audio_transcribe.py # Audio transcription (Whisper)
│   │   ├── music_identifier.py  # Music detection (Shazam)
│   │   ├── text_analyzer.py   # Text/metadata analysis
│   │   ├── youtube_analyzer.py
│   │   ├── webpage_analyzer.py
│   │   └── caption.py        # Instagram caption fetching
│   ├── instagram/            # Instagram integration
│   │   ├── instagram_downloader.py
│   │   └── instagram_login.py
│   ├── utils/                # Utility scripts
│   ├── tests/                # Backend tests
│   │   ├── test_api.py
│   │   ├── test_db.py
│   │   └── test_sync_code.py
│   └── requirements.txt
│
└── docs/                     # Documentation
    └── CODEMAPS/
        ├── INDEX.md          # This file
        ├── FRONTEND.md       # Frontend details
        ├── BACKEND.md        # Backend details
        └── DATABASE.md       # Database schema
```

## Data Flow

```
User Input (URL)
      │
      ▼
┌─────────────────┐
│  Frontend App   │ ◄─── Sync Code / API Token Auth
│  (React Native) │
└────────┬────────┘
         │ HTTPS (Axios)
         ▼
┌──────────────────────────────────────────┐
│           FastAPI Backend                │
│                                          │
│  ┌─────────────┐    ┌─────────────────┐ │
│  │  /analyze   │───►│ Content Download │ │
│  │  /connect   │───►│ Sync Code Auth   │ │
│  │  /settings  │───►│ AI Provider Mgmt │ │
│  │  /import    │───►│ Data Import      │ │
│  │  /export    │───►│ Data Export      │ │
│  └─────────────┘    └────────┬──────────┘ │
│           │                  │            │
│           ▼                  ▼            │
│  ┌─────────────────────────────────────┐  │
│  │      Analysis Pipeline              │  │
│  │  • Visual (Gemini Vision)          │  │
│  │  • Audio (Whisper)                 │  │
│  │  • Music (Shazam)                  │  │
│  │  • Text (LLM)                      │  │
│  └─────────────┬───────────────────────┘  │
│                │                           │
│                ▼                           │
│  ┌─────────────────────────────────────┐  │
│  │        MongoDB Cache                 │  │
│  │  • Posts collection                 │  │
│  │  • Queue collection                 │  │
│  │  • Collections collection           │  │
│  └─────────────────────────────────────┘  │
└──────────────────────────────────────────┘
          │
          ▼ JSON Response
┌─────────────────┐
│  Frontend App   │
│  • Display post │
│  • Cache locally│
│  • Manage collections
└─────────────────┘
```

## External Dependencies

### Frontend
- **React Native** 0.81.5 - Mobile framework
- **Expo** 54 - Development platform
- **@react-navigation** 7 - Navigation
- **axios** 1.13 - HTTP client
- **@react-native-async-storage** - Local storage

### Backend
- **FastAPI** - Web framework
- **pymongo** - MongoDB client
- **instaloader** - Instagram content download
- **google-generativeai** - Gemini AI
- **openai** - GPT models
- **whisper** - Audio transcription
- **pydantic** - Data validation

## Recent Updates (2026-03)

- **Sync Code Feature**: Added alphanumeric sync code for easy mobile app connection
- **AI Provider Management**: Configurable AI providers (Gemini, OpenAI, etc.)
- **Instagram Credentials**: Store Instagram login for private content
- **Import/Export**: Full data backup and restore functionality
- **Failed Analysis Screen**: Track and retry failed analyses
- **Share Handler**: Deep link handling for shared content

## Related Documentation

- [Frontend Codemap](FRONTEND.md)
- [Backend Codemap](BACKEND.md)
- [Database Schema](DATABASE.md)
