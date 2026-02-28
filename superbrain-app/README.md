# SuperBrain

> Your personal second brain — save Instagram posts, YouTube videos & websites,
> have them auto-analysed by AI, and rediscover them later through search,
> filters, and smart notifications.

---

## What's in this repo?

```
SuperBrain/
├── backend/           ← FastAPI Python server  (run this on your PC/laptop)
└── superbrain-app/   ← React Native Android app  (build the APK)
```

---

## Quick Start

### 1 · Backend (PC / Laptop)

Requirements: **Python 3.10+** already installed.

```bash
cd backend
python start.py
```

The interactive wizard will:
- Create a Python virtual environment
- Install all dependencies automatically
- Ask for your AI API keys (Gemini, Groq, OpenRouter)
- Ask for Instagram credentials (optional — needed only for Instagram posts)
- Set up Ollama for offline/local AI models (`qwen3-vl:4b`, optional but recommended)
- Set up Whisper for offline audio transcription (+ ffmpeg check)
- Configure ngrok for remote access (optional)
- Generate your API token
- Start the server on **port 5000**

> Re-run `python start.py` any time to start the server after the first setup.  
> Run `python reset.py` to redo the full setup wizard.

---

### 2 · Mobile App (Android)

#### Option A — Build from source (developers)

```bash
cd superbrain-app
npm install
npx expo run:android        # debug build
```

#### Option B — Use a pre-built APK

Download from the [Releases](../../releases) tab and install directly on your Android device.

#### Option C — CI build

Push to `main` and GitHub Actions will build the APK automatically (see `.github/workflows/build.yml`).

---

### 3 · Connect the App to Your Backend

1. Make sure your phone and PC are on the **same WiFi network**, or use
   ngrok / port-forwarding for remote access.
2. Open the SuperBrain app → tap the ⚙ settings icon.
3. Set **Server URL** to one of:
   - Same WiFi: `http://<your-PC-local-IP>:5000`
   - ngrok:     `https://<your-subdomain>.ngrok-free.app`
   - Port fwd:  `http://<your-public-IP>:5000`
4. Set **API Token** to the token shown by `start.py`.
5. Tap **Save** — you're set!

---

## Getting Free API Keys

| Provider   | Free tier                   | URL |
|------------|-----------------------------|-----|
| Gemini     | 1 500 req/day ⭐ recommended | https://aistudio.google.com/apikey |
| Groq       | 14 400 req/day              | https://console.groq.com/keys |
| OpenRouter | $1 free credit              | https://openrouter.ai/keys |

You need **at least one** key. The backend tries them in order and falls back
automatically. No key is needed if you set up Ollama (local model).

---

## Port Reference

| Service        | Port  | Notes |
|----------------|-------|-------|
| SuperBrain API | 5000  | Forward this for remote access |
| Ollama         | 11434 | Local AI inference — no forwarding needed |

---

## Offline AI with Ollama (Optional)

Install Ollama: https://ollama.com  
The setup wizard will prompt you to pull a model automatically.  
Manual pull: `ollama pull qwen3-vl:4b`

---

## Instagram Note

Use a **secondary / burner Instagram account**, not your main one.
The session is cached after the first login so you won't be prompted again.
