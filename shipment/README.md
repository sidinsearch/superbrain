# SuperBrain

> Your personal second brain — save Instagram posts, YouTube videos & websites,
> have them auto-analysed by AI, and rediscover them later through search,
> filters, and smart notifications.

---

## What's in this folder?

```
SuperBrain/
├── backend/          ← FastAPI Python server  (run this on your PC/laptop)
└── superbrain-mobile/  ← React Native Android app  (build the APK)
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
- Set up Ollama for offline/local AI models (optional but recommended)
- Configure ngrok for remote access (optional)
- Generate your API token
- Start the server on **port 5000**

> Re-run `python start.py` any time to start the server after the first setup.
> Run `python start.py --reset` to redo the full setup wizard.

---

### 2 · Mobile App (Android)

#### Option A — Build from source (developers)

```bash
cd superbrain-mobile
npm install
npx expo run:android        # debug build
# or
npx expo build:android      # production APK via EAS
```

#### Option B — Use a pre-built APK

Install the APK on your Android device directly.

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

| Provider    | Free tier                  | URL                                      |
|-------------|----------------------------|------------------------------------------|
| Gemini      | 1 500 req/day ⭐ recommended | https://aistudio.google.com/apikey       |
| Groq        | 14 400 req/day             | https://console.groq.com/keys            |
| OpenRouter  | $1 free credit             | https://openrouter.ai/keys               |

You need **at least one** key. The backend tries them in order and falls back
automatically. No key is needed if you set up Ollama (local model).

---

## Port Reference

| Service           | Port  | Notes                                      |
|-------------------|-------|--------------------------------------------|
| SuperBrain API    | 5000  | Forward this for remote access             |
| Ollama            | 11434 | Local AI inference — no forwarding needed  |

---

## Offline AI with Ollama (Optional)

Install Ollama: https://ollama.com  
Then the setup wizard prompts you to pull a model automatically.  
Manual pull: `ollama pull llama3.2:3b`

---

## Instagram Note

Use a **secondary / burner Instagram account**, not your main one.
The session is cached after the first login so you won't be prompted again.
