# 🚀 SuperBrain Quick Start Guide

Get SuperBrain up and running in minutes!

## 📋 Prerequisites

- **Docker & Docker Compose** (for backend) - [Install](https://docs.docker.com/get-started/)
- **Node.js 18+** (for mobile app) - [Install](https://nodejs.org/)
- **Git** - [Install](https://git-scm.com/)
- **Android SDK** (for building APK) - [Install](https://developer.android.com/studio)

## ⚡ Quick Start (5 minutes)

### Backend

```bash
# 1. Clone and navigate
git clone https://github.com/sidinsearch/superbrain.git
cd superbrain/backend

# 2. Create environment file
cp .env.example .env

# 3. Add your API keys to .env
# Edit with your favorite editor:
# GROQ_API_KEY=your_key_here
# GEMINI_API_KEY=your_key_here
# GOOGLE_API_KEY=your_key_here   # optional compatibility alias

# 4. Start with Docker
docker-compose up -d

# 5. Verify it's running
curl http://localhost:5000/health
# Expected: {"status":"ok"}
```

### Frontend

```bash
# 1. Open new terminal, navigate to app
cd superbrain/superbrain-app

# 2. Install dependencies
npm install

# 3. Start development server
npx expo start

# 4. Launch on Android
# Press 'a' and wait for Expo Go to open on your device
```

## 🔑 Getting API Keys (2 minutes each)

### Groq API

1. Visit [console.groq.com](https://console.groq.com)
2. Sign up (free tier available)
3. Create API key
4. Copy to `.env`: `GROQ_API_KEY=your_key`

### Google Gemini API

1. Visit [makersuite.google.com](https://makersuite.google.com/app/apikey)
2. Sign in with Google account
3. Create API key
4. Copy to `.env`: `GEMINI_API_KEY=your_key`

### OpenRouter (Optional)

1. Visit [openrouter.ai](https://openrouter.ai)
2. Sign up
3. Create API key
4. Copy to `.env`: `OPENROUTER_API_KEY=your_key`

## 📱 Testing the App

1. **Share Content**
   - Open any app (Instagram, YouTube, Chrome, etc.)
   - Share a URL with SuperBrain
   - Watch it get analyzed in seconds

2. **Browse Results**
   - Go to Library tab
   - See AI-generated titles, summaries, tags
   - Search by keyword

3. **Create Collections**
   - Long press any post
   - Add to collection
   - Organize your content

## 🐛 Troubleshooting

### Backend won't start

```bash
# Check Docker is running
docker ps

# View logs
docker-compose logs superbrain-api

# Rebuild (might help)
docker-compose build --no-cache
docker-compose up -d
```

### App can't connect to backend

```bash
# Check backend is running
curl http://localhost:5000/health

# If using phone on different machine:
# 1. Get your computer's IP: ipconfig (Windows) or ifconfig (Mac/Linux)
# 2. Edit app API URL in settings to: http://YOUR_IP:5000
# 3. Make sure port 5000 is accessible
```

### API key errors

```bash
# Verify .env file exists
ls backend/.env

# Check it has all required keys
cat backend/.env | grep API_KEY

# Restart containers after editing
docker-compose restart
```

## 📚 Next Steps

- **[Full Documentation](docs/)** - Detailed guides and API reference
- **[Deployment Guide](DEPLOYMENT.md)** - Production setup
- **[Contributing](CONTRIBUTING.md)** - How to contribute
- **[Security Policy](SECURITY.md)** - Security best practices

## 🎯 Common Tasks

### Change Database Location

Edit `backend/.env`:
```env
DATABASE_PATH=/path/to/superbrain.db
```

### Enable Offline Mode

Edit `backend/.env`:
```env
WHISPER_USE_CLOUD=false
```

### Increase Upload Size

Edit `backend/.env`:
```env
MAX_UPLOAD_SIZE=104857600
```

### View API Documentation

Open in browser: http://localhost:5000/docs

### Export Your Data

1. Go to Settings → Data Import/Export
2. Click "Export Data"
3. Choose format (JSON, CSV)
4. Download backup

## 💡 Tips & Tricks

- **Mobile Testing**: Use [Expo Go](https://expo.dev/client) app instead of building APK
- **API Testing**: Use [Postman](https://www.postman.com/) or [Insomnia](https://insomnia.rest/)
- **Database Viewer**: Use [sqlitebrowser](https://sqlitebrowser.org/)
- **Logs**: Check `docker-compose logs | grep ERROR` for issues

## 🆘 Need Help?

- **📖 Read Docs**: Full documentation in [docs/](docs/) folder
- **🐛 Found Bug?**: [Report on GitHub](https://github.com/sidinsearch/superbrain/issues)
- **💡 Feature Idea?**: [Request Feature](https://github.com/sidinsearch/superbrain/issues)
- **🔒 Security Issue?**: Email security@example.com

## 📊 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Android Mobile App                     │
│         (React Native + Expo)                       │
│  • Share screen content                            │
│  • Browse library                                  │
│  • Manage collections                              │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP/REST
                   ↓
┌─────────────────────────────────────────────────────┐
│              Python Backend                         │
│           (FastAPI + SQLite)                        │
│  • Parse URLs                                      │
│  • Analyze content                                 │
│  • Route to AI models                              │
│  • Store metadata                                  │
└──────────────────┬──────────────────────────────────┘
                   │
       ┌───────────┼───────────┐
       ↓           ↓           ↓
    ┌────────┐ ┌────────┐ ┌────────┐
    │ Groq  │ │ Gemini │ │OpenRoute│
    │  API  │ │  API   │ │   API   │
    └────────┘ └────────┘ └────────┘
```

---

## 🚀 Performance Tips

- Use Groq API for fastest responses (~1 second)
- Enable local Whisper model for transcription without API calls
- Add more workers in docker-compose for higher throughput
- Use SSD storage for database for better performance

---

**Happy analyzing! 🧠✨**

For more details, see the [full README](README.md)
