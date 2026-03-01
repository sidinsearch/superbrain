<div align="center">

# 🧠 SuperBrain

### Save anything. Understand everything. Forget nothing.

A self-hosted AI-powered second brain for Android — save Instagram posts, YouTube videos, and web pages directly from the share sheet, have them automatically analysed by AI, and rediscover them with intelligent search, collections, and smart notifications.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![Expo SDK 54](https://img.shields.io/badge/Expo-SDK_54-000020?logo=expo&logoColor=white)](https://expo.dev)

[![Download APK](https://img.shields.io/badge/Download%20APK-2ea44f?style=for-the-badge&logo=android&logoColor=white)](https://github.com/sidinsearch/superbrain/releases)
[![Report Bug](https://img.shields.io/badge/Report%20Bug-d73a4a?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sidinsearch/superbrain/issues/new?labels=bug)
[![Request Feature](https://img.shields.io/badge/Request%20Feature-7057ff?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sidinsearch/superbrain/issues/new?labels=enhancement)

</div>

---

## 📱 App Screenshots

<div align="center">
<table>
  <tr>
    <td><img src="superbrain-app/assets/mockups/1.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/2.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/3.png" width="220"/></td>
  </tr>
  <tr>
    <td><img src="superbrain-app/assets/mockups/4.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/5.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/6.png" width="220"/></td>
  </tr>
  <tr>
    <td><img src="superbrain-app/assets/mockups/7.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/8.png" width="220"/></td>
    <td><img src="superbrain-app/assets/mockups/9.png" width="220"/></td>
  </tr>
</table>
</div>

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Features](#features)
- [Architecture](#architecture)
- [AI Model Router](#ai-model-router)
- [Getting Started](#getting-started)
- [Instagram Credentials](#instagram-credentials)
- [Installing the Android App](#installing-the-android-app)
- [Hosting Options](#hosting-options)
- [Notifications](#notifications)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

---

## The Problem

We all save content constantly — Instagram posts, YouTube videos, Reddit threads, articles, recipes — but every platform buries it in its own silo:

- **Instagram Saved** is a graveyard. No search, no categories, no reminders. You save hundreds of posts and never look at them again.
- **YouTube Watch Later** piles up endlessly with no way to know what each video was about without rewatching it.
- **Browser bookmarks** are a mess — unsorted folders full of dead links and forgotten context.
- **Screenshots** fill your gallery with no searchable text.

You spend time saving things you'll never find again. You forget **what** you saved, **why** you saved it, and **where** you saved it.

## The Solution

**SuperBrain** is a self-hosted Android app + Python backend that acts as your **personal AI-powered content archive**. Share any URL from any app — the backend analyses it with AI in seconds and gives you:

- A clean **title** and **summary** so you instantly know what it's about
- Auto-assigned **category** and **tags** for filtering at a glance
- **Background music identification** from Instagram reels (via Shazam)
- **Audio transcription** from videos (Groq Whisper API + local Whisper)
- Smart **Watch Later reminders** that actually bring you back to your content

Everything is stored in a local SQLite database **you own** — no cloud subscriptions, no data harvesting, no vendor lock-in.

---

## Features

### ✨ Content Analysis

| Feature | Description |
|---|---|
| **Universal share target** | Works with any app that shares URLs — Instagram, YouTube, Chrome, Reddit, etc. |
| **Multi-provider AI** | Automatic fallback across Groq, Gemini, OpenRouter, and Ollama |
| **Smart model router** | EMA-ranked, auto-healing, self-optimising — always picks the fastest available model |
| **Music identification** | Shazam-powered background music detection from Instagram reels |
| **Audio transcription** | Groq Whisper API (cloud) with local OpenAI Whisper as offline fallback |
| **Native YouTube analysis** | Gemini watches the video directly — no download needed |
| **Web scraping** | Multi-strategy extraction (newspaper4k, trafilatura, Wayback Machine) |

### 📂 Organisation & Discovery

| Feature | Description |
|---|---|
| **Custom collections** | Watch Later, Recipes, Work, or any category you create |
| **Full-text search** | Search across titles, summaries, tags, and transcriptions |
| **Smart filtering** | Filter by category, tags, or collection |
| **Watch Later reminders** | Daily notifications with unique time slots per post (8 AM – 9:30 PM) |
| **Urgent alerts** | Morning notifications for deadline-sensitive content (exams, hackathons) |
| **Offline-first** | Queues saves locally and syncs automatically when reconnected |
| **Retry recovery** | Failed analyses can be retried directly from the Library |

---

## Architecture

```
superbrain/
├── backend/
│   ├── start.py                  # Interactive setup wizard & server launcher
│   ├── reset.py                  # Reset / clean utility (selective wipe)
│   ├── api.py                    # FastAPI REST API (18 endpoints) + queue worker
│   ├── main.py                   # Analysis orchestrator (parallel processing)
│   ├── core/
│   │   ├── model_router.py       # Multi-provider AI router with EMA ranking
│   │   ├── database.py           # SQLite (WAL mode) — posts, queue, collections
│   │   ├── link_checker.py       # URL validator (Instagram / YouTube / web)
│   │   └── category_manager.py   # Category normalisation & deduplication
│   ├── analyzers/
│   │   ├── visual_analyze.py     # Vision analysis (frame extraction + AI)
│   │   ├── audio_transcribe.py   # Groq Whisper → local Whisper fallback
│   │   ├── music_identifier.py   # Shazamio multi-segment recognition
│   │   ├── text_analyzer.py      # Caption / metadata AI analysis
│   │   ├── caption.py            # Instagram caption extractor
│   │   ├── youtube_analyzer.py   # Gemini native YouTube understanding
│   │   └── webpage_analyzer.py   # Multi-strategy web scraper + AI summary
│   ├── instagram/
│   │   ├── instagram_downloader.py  # Instaloader engine (auth/anonymous)
│   │   └── instagram_login.py      # One-time session setup with 2FA
│   ├── utils/
│   │   ├── db_stats.py           # Database statistics
│   │   └── manage_token.py       # API token management
│   ├── config/
│   │   ├── .api_keys.example     # Template for API keys
│   │   ├── openrouter_free_models.json
│   │   └── model_rankings.json   # Persisted provider performance data
│   ├── tests/
│   └── requirements.txt
│
└── superbrain-app/               # React Native (Expo SDK 54)
    ├── App.tsx                   # Navigation + notification handlers
    ├── src/
    │   ├── screens/
    │   │   ├── HomeScreen.tsx          # Feed with search, filters, categories
    │   │   ├── LibraryScreen.tsx       # Collections + failed analyses
    │   │   ├── PostDetailScreen.tsx    # Full post view (edit, re-analyse, delete)
    │   │   ├── CollectionDetailScreen.tsx
    │   │   ├── SettingsScreen.tsx      # Server URL + token configuration
    │   │   ├── ShareHandlerScreen.tsx  # Receives shared URLs from other apps
    │   │   ├── FailedAnalysisScreen.tsx
    │   │   └── SplashScreen.tsx
    │   ├── services/
    │   │   ├── api.ts                  # Axios client + offline queue & retry
    │   │   ├── postsCache.ts           # AsyncStorage cache + pending mutations
    │   │   ├── collections.ts          # Collection CRUD + offline sync
    │   │   └── notificationService.ts  # Watch Later scheduling + channels
    │   ├── components/
    │   │   └── CustomToast.tsx
    │   ├── types/index.ts
    │   └── theme/colors.ts
    └── android/                  # Native Android project (Gradle)
```

---

## AI Model Router

Free AI APIs have rate limits, downtime, and variable speed. SuperBrain solves this with a **multi-provider model router** that automatically selects the fastest available model and falls back transparently on failure — you never have to think about which provider is working.

### Priority Chain

| Task | Fallback Order |
|---|---|
| **Text analysis** | Groq → Gemini → OpenRouter (hardcoded best) → Dynamic free OpenRouter → Ollama |
| **Vision** | Gemini → Groq Vision → OpenRouter Vision → Ollama Vision |
| **Transcription** | Groq Whisper API → Local OpenAI Whisper |
| **YouTube** | Gemini (native URL understanding) |

### How It Works

- **Performance ranking** — tracks response times with an exponential moving average; faster models get promoted automatically
- **Cooldown on failure** — generic errors trigger a 5‑minute cooldown; rate limits (HTTP 429) trigger a 30‑minute cooldown
- **Dynamic discovery** — refreshes the OpenRouter free model list every 6 hours, scores models by context length, capabilities, recency, and provider trust
- **Persistent rankings** — saved to `config/model_rankings.json` so performance data survives server restarts

### Supported Providers

| Provider | Key in `config/.api_keys` | Notes |
|---|---|---|
| **Groq** | `GROQ_API_KEY` | Fastest inference — free tier at [console.groq.com](https://console.groq.com) |
| **Google Gemini** | `GEMINI_API_KEY` | Most generous free tier at [aistudio.google.com](https://aistudio.google.com) |
| **OpenRouter** | `OPENROUTER_API_KEY` | Free model router at [openrouter.ai](https://openrouter.ai) |
| **Ollama** | *(no key needed)* | Local inference — `start.py` guides setup · recommended model: `qwen3-vl:4b` |

> **Tip:** You don't need all providers — the router falls back automatically. Start with at least **Gemini** (most generous free tier). Ollama serves as the fully offline last resort.

---

## Getting Started

### Prerequisites

| Requirement | Install | Required? |
|---|---|---|
| Python 3.10+ | [python.org](https://python.org) | ✅ Yes |
| ffmpeg | `sudo apt install ffmpeg` / `brew install ffmpeg` | ✅ Yes |
| Node.js 20+ | [nodejs.org](https://nodejs.org) | Only for building the app |
| ngrok | [ngrok.com](https://ngrok.com) | Only if backend runs on your PC |

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/sidinsearch/superbrain.git
cd superbrain/backend

# 2. Run the interactive setup wizard
#    Creates venv · installs deps · configures API keys · starts server
python start.py

# 3. Expose the server to the internet (if running on your local machine)
ngrok http 5000

# 4. Install the APK on your Android phone
#    Open Settings in the app → enter the ngrok URL + token from backend/token.txt
```

**See it in action:**


https://github.com/user-attachments/assets/9769681b-5494-4093-b1bf-2c60c20e1673


`start.py` is the **single entry point** for the backend. On first run it walks you through:

1. Virtual environment creation
2. Dependency installation (`requirements.txt`)
3. API key configuration (Groq / Gemini / OpenRouter)
4. Instagram credentials (optional — [see below](#instagram-credentials))
5. Ollama offline model setup (optional)
6. Whisper transcription model selection
7. API token generation

On subsequent runs it simply starts the server. Use `python start.py --reset` to re-run the wizard.

### Manual Setup

<details>
<summary>Click to expand</summary>

```bash
cd superbrain/backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Copy the example keys file and fill in your keys
cp config/.api_keys.example config/.api_keys

# Start the server
python api.py
```

The server starts on `http://localhost:5000`. A unique API token is auto-generated and saved to `backend/token.txt`.

</details>

### Expose with ngrok

```bash
ngrok http 5000
```

Copy the `https://xxxx.ngrok-free.app` URL and enter it in the app's **Settings** screen along with the token from `backend/token.txt`.

> **Tip:** Run `ngrok config add-authtoken YOUR_TOKEN` for a stable URL that persists across restarts.

---

## Instagram Credentials

SuperBrain uses [Instaloader](https://instaloader.github.io/) to download Instagram posts. It can operate in two modes:

### Without credentials (anonymous mode)

SuperBrain works **without any Instagram account** — but with limitations:

| Limitation | Details |
|---|---|
| **Public posts only** | Only posts from public profiles that Instagram serves to unauthenticated users |
| **Rate limiting** | Instagram aggressively rate-limits anonymous requests — you may need to wait several minutes between saves |
| **Login-required blocks** | Some posts trigger a `LoginRequiredException` even if the profile is public — these get auto-queued for retry later |

YouTube videos and web pages are **not affected** — they work fully without Instagram credentials.

### With credentials (recommended)

Adding Instagram credentials removes all the above restrictions:

- ✅ **Reliable downloads** — authenticated sessions are not rate-limited for normal usage
- ✅ **Access to all public posts** — no more login-required blocks
- ✅ **Posts from followed private accounts** — if the authenticated account follows a private profile, those posts can be saved too
- ✅ **Session caching** — you log in once and the session is reused automatically until Instagram invalidates it

### How to set up

**Option 1 — During setup wizard** (recommended)

`start.py` prompts for Instagram credentials during first-run setup. Enter your username and password when asked — they're saved to `config/.api_keys` and a session file is created automatically.

**Option 2 — Manual login**

```bash
cd superbrain/backend
python instagram/instagram_login.py
```

This interactive script handles the full login flow including **two-factor authentication (2FA)**. It saves:
- Credentials → `config/.api_keys` (gitignored)
- Session → `.instaloader_session` (gitignored)

### ⚠️ Security advice

> **Use a secondary / burner Instagram account — not your main personal account.**
>
> While credentials are stored locally and never transmitted anywhere other than Instagram's servers, using a disposable account protects your primary account from any risk of rate-limit flags or session issues.

Credentials are stored in `config/.api_keys` which is **gitignored** — they will never be committed to version control. The cached session file (`.instaloader_session`) is also gitignored.

---

## Installing the Android App

### Option 1 — Download from Releases *(easiest)*

The latest APK is always available on the **[Releases](https://github.com/sidinsearch/superbrain/releases)** page.

1. Download `superbrain.apk` from the latest release
2. On your Android device, enable **Install from unknown sources**
3. Open the APK to install

### Option 2 — EAS Cloud Build

```bash
npm install -g eas-cli
eas login
cd superbrain-app
eas build --platform android --profile preview --non-interactive
```

EAS returns a download URL + QR code when done. No Android Studio required.

### Option 3 — GitHub Actions

The repo includes a [build workflow](.github/workflows/build.yml) that builds the APK on every push to `main`. Download the artifact from the **Actions** tab.

### Option 4 — Local Gradle Build

```bash
cd superbrain-app
npm install
cd android
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

---

## Hosting Options

The backend is lightweight and runs anywhere with Python 3.10+:

| Platform | Cost | Notes |
|---|---|---|
| **Your PC / laptop** | Free | Use ngrok to expose · disable sleep / hibernate |
| **Raspberry Pi** | ~$50 one-time | Low power, always-on home server |
| **AWS EC2** | Free tier | `t2.micro` handles it fine |
| **DigitalOcean** | $4/mo | Basic droplet |
| **Hetzner** | €3.29/mo | Fast EU-based VPS |
| **Google Cloud Run** | Pay-per-use | Serverless, scales to zero |

For cloud hosting, open port `5000` in your firewall and point the app directly at your server's public IP — no ngrok needed.

---

## Notifications

SuperBrain uses Android notification channels to keep you engaged with your saved content without being noisy.

### Watch Later

Adding a post to the **Watch Later** collection triggers:

| Notification | When | Details |
|---|---|---|
| **Instant confirmation** | Immediately | High-priority heads-up banner |
| **Daily reminder** | Once per day, unique time slot per post | Spread between 8:00 AM – 9:30 PM |
| **Urgent morning alert** | 9:00 AM | Only for deadline-sensitive content (exams, hackathons, applications) |

Each reminder includes a **Mark as Watched** action button — tap it to remove from Watch Later and cancel all future reminders for that post.

### Other Collections

Saving to any non-Watch Later collection fires an instant **"Saved to SuperBrain"** notification confirming the save.

---

## API Reference

All endpoints require the `X-API-Key` header with the token from `backend/token.txt`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyze` | Submit a URL for analysis (queued if busy) |
| `GET` | `/cache/{shortcode}` | Retrieve cached analysis by shortcode |
| `GET` | `/recent` | List recent analyses |
| `GET` | `/search` | Full-text search across posts |
| `GET` | `/category/{category}` | Filter posts by category |
| `GET` | `/stats` | Database statistics |
| `GET` | `/caption` | Extract Instagram caption from URL |
| `GET` | `/collections` | List all collections |
| `POST` | `/collections` | Create a new collection |
| `PUT` | `/collections/{id}/posts` | Update posts in a collection |
| `DELETE` | `/collections/{id}` | Delete a collection |
| `PUT` | `/post/{shortcode}` | Update post fields (category, title, summary) |
| `DELETE` | `/post/{shortcode}` | Delete a post (cancels active analysis if running) |
| `GET` | `/queue-status` | Current processing and queue state |
| `GET` | `/queue/retry` | Items scheduled for automatic retry |
| `POST` | `/queue/retry/flush` | Force-promote retry items to active queue |
| `GET` | `/ping` | Connectivity check |
| `GET` | `/health` | Health check with system info |

> Interactive API docs are available at `http://localhost:5000/docs` (Swagger UI) and `/redoc`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Mobile** | React Native 0.81 · Expo SDK 54 · TypeScript |
| **Backend** | Python 3 · FastAPI · Uvicorn |
| **Database** | SQLite with WAL mode |
| **AI Routing** | Custom multi-provider router (Groq · Gemini · OpenRouter · Ollama) |
| **Vision** | OpenCV frame extraction → AI vision models |
| **Transcription** | Groq Whisper API → OpenAI Whisper (local fallback) |
| **Music ID** | Shazamio (multi-segment recognition) |
| **Instagram** | Instaloader + Instagrapi |
| **Web Scraping** | newspaper4k · trafilatura · Wayback Machine · BeautifulSoup |
| **Notifications** | Expo Notifications · Android notification channels |
| **CI/CD** | GitHub Actions (Gradle APK build) · EAS Build |

---

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch — `git checkout -b feature/my-feature`
3. **Commit** your changes — `git commit -m "feat: add my feature"`
4. **Push** to the branch — `git push origin feature/my-feature`
5. **Open** a Pull Request

For major changes, please [open an issue](https://github.com/sidinsearch/superbrain/issues) first to discuss what you'd like to implement.

---

## License

This project is licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0).

| Use Case | Allowed? |
|---|---|
| Personal & non-commercial use | ✅ Free, no restrictions |
| Forking & modifications | ✅ Must release under AGPL-3.0 with source code |
| Running as a network service (SaaS) | ✅ Must publish your modified source code |
| Commercial / proprietary use | ❌ Requires a separate commercial license |


---

<p align="center">
  Made with ❤️ by <a href="https://github.com/sidinsearch">sidinsearch</a>
  &nbsp;·&nbsp;
  Copyright &copy; 2026 <a href="https://github.com/sidinsearch">sidinsearch</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">AGPL-3.0 License</a>
</p>
