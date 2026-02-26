#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║               SuperBrain — First-Time Setup & Launcher           ║
║         Run this once to configure everything, then again        ║
║                    any time to start the server.                 ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
    python start.py          — interactive setup on first run, then start server
    python start.py --reset  — re-run the full setup wizard
"""

import sys
import os
import subprocess
import platform
import shutil
import json
import secrets
import string
import textwrap
import time
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.resolve()
VENV_DIR    = BASE_DIR / ".venv"
API_KEYS    = BASE_DIR / "config" / ".api_keys"
TOKEN_FILE  = BASE_DIR / "token.txt"
SETUP_DONE  = BASE_DIR / ".setup_done"

IS_WINDOWS  = platform.system() == "Windows"
PYTHON      = sys.executable          # path that launched this script
VENV_PYTHON = (VENV_DIR / "Scripts" / "python.exe") if IS_WINDOWS else (VENV_DIR / "bin" / "python")
VENV_PIP    = (VENV_DIR / "Scripts" / "pip.exe")    if IS_WINDOWS else (VENV_DIR / "bin" / "pip")

# ── ANSI colours (stripped on Windows unless ANSICON / Windows Terminal) ──────
def _ansi(code): return f"\033[{code}m"
RESET  = _ansi(0);  BOLD   = _ansi(1)
RED    = _ansi(31); GREEN  = _ansi(32); YELLOW = _ansi(33)
BLUE   = _ansi(34); CYAN   = _ansi(36); WHITE  = _ansi(37)
DIM    = _ansi(2)
MAG    = _ansi(35)

def link(url: str, text: str | None = None) -> str:
    """OSC 8 terminal hyperlink — clickable in most modern terminals."""
    label = text or url
    return f"\033]8;;{url}\033\\{label}\033]8;;\033\\"

def banner():
    art = f"""{CYAN}{BOLD}
  ███████╗██╗   ██╗██████╗ ███████╗██████╗
  ██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗
  ███████╗██║   ██║██████╔╝█████╗  ██████╔╝
  ╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗
  ███████║╚██████╔╝██║     ███████╗██║  ██║
  ╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝

  ██████╗ ██████╗  █████╗ ██╗███╗   ██╗
  ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║
  ██████╔╝██████╔╝███████║██║██╔██╗ ██║
  ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║
  ██████╔╝██║  ██║██║  ██║██║██║ ╚████║
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
{RESET}"""
    credit = (f"  {DIM}made with {RESET}{MAG}❤{RESET}{DIM} by "
              f"{link('https://github.com/sidinsearch', f'{BOLD}sidinsearch{RESET}{DIM}')}"
              f"{RESET}\n")
    print(art + credit)

def h1(msg):  print(f"\n{BOLD}{CYAN}{'━'*64}{RESET}\n{BOLD}  {msg}{RESET}\n{BOLD}{CYAN}{'━'*64}{RESET}")
def h2(msg):  print(f"\n{BOLD}{BLUE}  ▶  {msg}{RESET}")
def ok(msg):  print(f"  {GREEN}✓{RESET}  {msg}")
def warn(msg):print(f"  {YELLOW}⚠{RESET}  {msg}")
def err(msg): print(f"  {RED}✗{RESET}  {msg}")
def info(msg):print(f"  {DIM}{msg}{RESET}")
def nl():     print()

def ask(prompt, default=None, secret=False):
    """Prompt user for input, supporting optional default + secret mode."""
    display_default = f" [{DIM}{'••••' if secret and default else default}{RESET}]" if default else ""
    full_prompt = f"\n  {BOLD}{prompt}{RESET}{display_default}: "
    if secret:
        import getpass
        val = getpass.getpass(full_prompt)
    else:
        val = input(full_prompt).strip()
    return val if val else default

def ask_yn(prompt, default=True):
    suffix = f"[{BOLD}Y{RESET}/n]" if default else f"[y/{BOLD}N{RESET}]"
    val = input(f"\n  {BOLD}{prompt}{RESET} {suffix}: ").strip().lower()
    if not val:
        return default
    return val in ("y", "yes")

def run(cmd, **kwargs):
    """Run a command, raise on failure."""
    return subprocess.run(cmd, check=True, **kwargs)

def run_q(cmd, **kwargs):
    """Run a command silently, capture output."""
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kwargs)

# ══════════════════════════════════════════════════════════════════════════════
# Step 1 — Virtual Environment
# ══════════════════════════════════════════════════════════════════════════════
def setup_venv():
    h1("Step 1 of 6 — Python Virtual Environment")
    if VENV_DIR.exists():
        ok(f"Virtual environment already exists at {VENV_DIR}")
        return
    h2("Creating virtual environment …")
    run([PYTHON, "-m", "venv", str(VENV_DIR)])
    ok(f"Virtual environment created at {VENV_DIR}")

# ══════════════════════════════════════════════════════════════════════════════
# Step 2 — Install Dependencies
# ══════════════════════════════════════════════════════════════════════════════
def install_deps():
    h1("Step 2 of 6 — Installing Python Dependencies")
    req = BASE_DIR / "requirements.txt"
    if not req.exists():
        err("requirements.txt not found — cannot install dependencies.")
        sys.exit(1)

    h2("Upgrading pip …")
    run([str(VENV_PYTHON), "-m", "pip", "install", "--quiet", "--upgrade", "pip"])
    ok("pip up to date")

    h2("Installing packages from requirements.txt (this may take a few minutes) …")
    run([str(VENV_PIP), "install", "--quiet", "-r", str(req)])
    ok("All dependencies installed")

# ══════════════════════════════════════════════════════════════════════════════
# Step 3 — API Keys
# ══════════════════════════════════════════════════════════════════════════════
def setup_api_keys():
    h1("Step 3 of 6 — AI Provider API Keys")

    print(f"""
  SuperBrain uses AI providers to analyse your saved content.
  You need {BOLD}at least one{RESET} key — the router tries them in order and
  falls back automatically.

  Recommended: {GREEN}Gemini{RESET} (most generous free tier — 1 500 req/day)

  Get free keys:
    Gemini      →  {CYAN}https://aistudio.google.com/apikey{RESET}
    Groq        →  {CYAN}https://console.groq.com/keys{RESET}
    OpenRouter  →  {CYAN}https://openrouter.ai/keys{RESET}

  Press {BOLD}Enter{RESET} to skip any key you don't have yet.
""")

    # Load existing values if re-running
    existing = {}
    if API_KEYS.exists():
        for line in API_KEYS.read_text().splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()

    gemini   = ask("Gemini API key",      default=existing.get("GEMINI_API_KEY"),      secret=True) or ""
    groq_k   = ask("Groq API key",        default=existing.get("GROQ_API_KEY"),        secret=True) or ""
    openr    = ask("OpenRouter API key",  default=existing.get("OPENROUTER_API_KEY"),  secret=True) or ""

    if not any([gemini, groq_k, openr]):
        warn("No AI keys entered. SuperBrain will still work but can only use")
        warn("local Ollama models (configured in the next step).")

    # Instagram credentials
    nl()
    print(f"  {BOLD}Instagram Credentials{RESET}")
    print(f"""
  Used for downloading private/public Instagram posts.
  {YELLOW}Use a secondary / burner account — NOT your main account.{RESET}
  The session is cached after first login so you won't be asked again.
  Press {BOLD}Enter{RESET} to skip (YouTube and Websites will still work).
""")
    ig_user = ask("Instagram username", default=existing.get("INSTAGRAM_USERNAME")) or ""
    ig_pass = ask("Instagram password", default=existing.get("INSTAGRAM_PASSWORD"), secret=True) or ""

    # Write .api_keys
    API_KEYS.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# SuperBrain API Keys — DO NOT COMMIT THIS FILE\n",
        f"GEMINI_API_KEY={gemini}\n",
        f"GROQ_API_KEY={groq_k}\n",
        f"OPENROUTER_API_KEY={openr}\n",
        f"INSTAGRAM_USERNAME={ig_user}\n",
        f"INSTAGRAM_PASSWORD={ig_pass}\n",
    ]
    API_KEYS.write_text("".join(lines))
    ok(f"Keys saved to {API_KEYS}")

# ══════════════════════════════════════════════════════════════════════════════
# Step 4 — Ollama / Offline Model
# ══════════════════════════════════════════════════════════════════════════════
OLLAMA_MODEL = "qwen3-vl:4b"   # vision-language model, fits ~6 GB VRAM / ~8 GB RAM

def setup_ollama():
    h1("Step 4 of 7 — Offline AI Model (Ollama)")

    print(f"""
  Ollama runs AI models {BOLD}locally on your machine{RESET} — no internet or API
  key required. SuperBrain uses it as a last-resort fallback if all
  cloud providers fail or run out of quota.

  Recommended model: {BOLD}{OLLAMA_MODEL}{RESET}  (~3 GB download, needs ~8 GB RAM)
    → Vision-language model: understands both text AND images.
  Other options: llama3.2:3b (2 GB / 4 GB RAM), gemma2:2b (1.5 GB / 4 GB RAM)
""")

    if not ask_yn("Set up Ollama offline model?", default=True):
        warn("Skipping Ollama. Cloud providers only — make sure you have API keys.")
        return

    # Check if ollama binary is available
    if not shutil.which("ollama"):
        print(f"""
  {YELLOW}Ollama is not installed.{RESET}

  Install it first:
    Linux / macOS  →  {CYAN}curl -fsSL https://ollama.com/install.sh | sh{RESET}
    Windows        →  Download from {CYAN}https://ollama.com/download{RESET}

  After installing, re-run {BOLD}python start.py{RESET} to continue.
""")
        if not ask_yn("Continue setup anyway (skip model pull for now)?", default=False):
            sys.exit(0)
        warn("Skipping model pull. Run  ollama pull {OLLAMA_MODEL}  manually later.")
        return

    ok("Ollama binary found")

    # Check if model already pulled
    try:
        result = run_q(["ollama", "list"])
        if OLLAMA_MODEL.split(":")[0] in result.stdout:
            ok(f"Model {OLLAMA_MODEL} already available")
            return
    except Exception:
        pass

    custom = ask(f"Model to pull", default=OLLAMA_MODEL)
    model  = custom or OLLAMA_MODEL

    h2(f"Pulling {model} (downloads ~3 GB — grab a coffee ☕) …")
    try:
        run(["ollama", "pull", model])
        ok(f"Model {model} ready")
    except subprocess.CalledProcessError:
        err(f"Failed to pull {model}.")
        warn(f"Run manually later:  ollama pull {model}")

# ══════════════════════════════════════════════════════════════════════════════
# Step 5 — Whisper / Offline Transcription
# ══════════════════════════════════════════════════════════════════════════════
WHISPER_MODELS = {
    "tiny":   (" ~74 MB", "fastest, lower accuracy"),
    "base":   ("~142 MB", "good balance  ⭐ recommended"),
    "small":  ("~461 MB", "higher accuracy"),
    "medium": ("~1.5 GB", "high accuracy, slower"),
    "large":  ("~2.9 GB", "best accuracy, needs 10 GB RAM"),
}

def setup_whisper():
    h1("Step 5 of 7 — Offline Audio Transcription (Whisper)")

    print(f"""
  OpenAI Whisper transcribes audio and video {BOLD}entirely on your machine{RESET}.
  SuperBrain uses it to extract speech from Instagram Reels, YouTube
  videos, and any other saved media — no API key needed.

  Whisper requires {BOLD}ffmpeg{RESET} to be installed on your system.
  It also pre-downloads a speech model the first time it runs.
""")

    # ── ffmpeg check ──────────────────────────────────────────────────────────
    if shutil.which("ffmpeg"):
        ok("ffmpeg is installed")
    else:
        warn("ffmpeg is NOT installed — Whisper cannot run without it.")
        print(f"""
  Install ffmpeg:
    Linux / WSL  →  {CYAN}sudo apt install ffmpeg{RESET}
    macOS        →  {CYAN}brew install ffmpeg{RESET}
    Windows      →  {CYAN}winget install ffmpeg{RESET}
                    or download from {CYAN}https://ffmpeg.org/download.html{RESET}

  After installing ffmpeg, re-run {BOLD}python start.py --reset{RESET} or just
  restart — Whisper will work automatically once ffmpeg is present.
""")
        if not ask_yn("Continue setup anyway?", default=True):
            sys.exit(0)

    # ── Whisper package check ─────────────────────────────────────────────────
    try:
        result = run_q([str(VENV_PYTHON), "-c", "import whisper; print(whisper.__version__)"])
        ok(f"openai-whisper installed (version {result.stdout.strip()})")
    except Exception:
        warn("openai-whisper not found in the virtual environment.")
        warn("Run  python start.py --reset  to reinstall dependencies.")
        return

    # ── Model pre-download ────────────────────────────────────────────────────
    nl()
    print(f"  {BOLD}Whisper model pre-download{RESET}")
    print(f"  Pre-downloading a model now avoids a delay on first use.\n")

    rows = ""
    for name, (size, note) in WHISPER_MODELS.items():
        star = f"  {YELLOW}← default if skipped{RESET}" if name == "base" else ""
        rows += f"    {BOLD}{name:<8}{RESET} {size}  {DIM}{note}{RESET}{star}\n"
    print(rows)

    choice = ask("Model to pre-download", default="base")
    model  = choice.strip().lower() if choice else "base"
    if model not in WHISPER_MODELS:
        warn(f"Unknown model '{model}' — defaulting to 'base'.")
        model = "base"

    h2(f"Pre-downloading Whisper '{model}' model …")
    try:
        run([str(VENV_PYTHON), "-c",
             f"import whisper; whisper.load_model('{model}')"])
        ok(f"Whisper '{model}' model downloaded and cached")
    except subprocess.CalledProcessError:
        err(f"Pre-download failed — Whisper will download '{model}' automatically on first use.")

# ══════════════════════════════════════════════════════════════════════════════
# Step 6 — ngrok / Port Forwarding
# ══════════════════════════════════════════════════════════════════════════════
NGROK_CONFIG = BASE_DIR / "config" / "ngrok_token.txt"

def setup_ngrok():
    h1("Step 6 of 7 — Remote Access (ngrok / Port Forwarding)")

    print(f"""
  The SuperBrain backend runs on {BOLD}port 5000{RESET} on your machine.
  Your phone needs to reach this port over the internet.

  You have two options:

  {BOLD}Option A — ngrok (easiest){RESET}
    ngrok creates a public HTTPS URL that tunnels to your local port 5000.
    Free tier: 1 static domain, unlimited restarts.
    Sign up at {CYAN}https://ngrok.com{RESET} and get your authtoken from
    {CYAN}https://dashboard.ngrok.com/get-started/your-authtoken{RESET}

  {BOLD}Option B — Your own port forwarding (advanced){RESET}
    Forward {BOLD}TCP port 5000{RESET} on your router to your machine's local IP.
    Then use {BOLD}http://<your-public-ip>:5000{RESET} in the mobile app.
    Steps:
      1. Find your machine's local IP  →  ip addr  (Linux) / ipconfig (Windows)
      2. Log into your router admin panel (usually http://192.168.1.1)
      3. Add a port forwarding rule: External 5000 → Internal <your-local-IP>:5000
      4. Use your public IP (check https://ipify.org) in the mobile app.
    {YELLOW}Note: dynamic public IPs change on router restart — consider a DDNS service.{RESET}

  {DIM}You can also run only on your local WiFi — both phone and PC must be on
  the same network. Use your PC's local IP (e.g. 192.168.x.x) in the app.{RESET}
""")

    choice = ask_yn("Set up ngrok authtoken?", default=True)
    if not choice:
        warn("Skipping ngrok. Use either your own port forwarding or local WiFi.")
        info("Remember: set the correct server URL in the mobile app Settings.")
        return

    if not shutil.which("ngrok"):
        print(f"""
  {YELLOW}ngrok is not installed.{RESET}

  Install it:
    Linux   →  {CYAN}curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \\
                | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \\
                && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \\
                | sudo tee /etc/apt/sources.list.d/ngrok.list \\
                && sudo apt update && sudo apt install ngrok{RESET}
    macOS   →  {CYAN}brew install ngrok/ngrok/ngrok{RESET}
    Windows →  Download from {CYAN}https://ngrok.com/download{RESET}

  After installing, re-run {BOLD}python start.py{RESET} to add your token.
""")
        warn("Skipping ngrok token setup.")
        return

    ok("ngrok binary found")
    token = ask("ngrok authtoken (from dashboard.ngrok.com/get-started/your-authtoken)", secret=True)
    if not token:
        warn("No token entered — skipping ngrok configuration.")
        return

    try:
        run(["ngrok", "config", "add-authtoken", token])
        NGROK_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        NGROK_CONFIG.write_text(token)
        ok("ngrok authtoken saved")
        nl()
        info("To start ngrok tunnel on port 5000, run in a separate terminal:")
        info("  ngrok http 5000")
        info("Copy the https://xxxxx.ngrok-free.app URL into the mobile app → Settings.")
    except subprocess.CalledProcessError:
        err("Failed to configure ngrok token.")
        warn("Run manually:  ngrok config add-authtoken <YOUR_TOKEN>")

# ══════════════════════════════════════════════════════════════════════════════
# Step 6 — API Token & Database
# ══════════════════════════════════════════════════════════════════════════════
def setup_token_and_db():
    h1("Step 7 of 7 — API Token & Database")

    # Token
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
        if token:
            ok(f"API token already exists: {BOLD}{token}{RESET}")
            if not ask_yn("Generate a new token?", default=False):
                return
    else:
        token = None

    alphabet = string.ascii_letters + string.digits
    new_token = ''.join(secrets.choice(alphabet) for _ in range(32))
    TOKEN_FILE.write_text(new_token)
    ok(f"API token saved: {BOLD}{GREEN}{new_token}{RESET}")
    nl()
    print(f"  {YELLOW}Copy this token into the mobile app → Settings → API Token.{RESET}")

    # DB is auto-created on first backend start; just let the user know
    nl()
    info("The SQLite database (superbrain.db) will be created automatically")
    info("the first time the backend starts.")

# ══════════════════════════════════════════════════════════════════════════════
# Launch Backend
# ══════════════════════════════════════════════════════════════════════════════
def launch_backend():
    h1("Launching SuperBrain Backend")

    token = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "—"
    try:
        import socket
        local_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        local_ip = "127.0.0.1"

    print(f"""
  {GREEN}{BOLD}Backend is starting up!{RESET}

  Local URL    →  {CYAN}http://127.0.0.1:5000{RESET}
  Network URL  →  {CYAN}http://{local_ip}:5000{RESET}
  API docs     →  {CYAN}http://127.0.0.1:5000/docs{RESET}
  API Token    →  {BOLD}{token}{RESET}

  {DIM}Keep this terminal open. Press Ctrl+C to stop the server.{RESET}

  {YELLOW}Mobile app setup:{RESET}
    1. Build / install the SuperBrain APK on your Android device.
    2. Open the app → tap the ⚙ settings icon.
    3. Set {BOLD}Server URL{RESET} to:
         · Same WiFi  →  http://{local_ip}:5000
         · ngrok      →  https://<your-subdomain>.ngrok-free.app
         · Port fwd   →  http://<your-public-ip>:5000
    4. Set {BOLD}API Token{RESET} to: {BOLD}{token}{RESET}
    5. Tap {BOLD}Save{RESET} — you're good to go!
""")

    os.chdir(BASE_DIR)
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), "-m", "uvicorn", "api:app",
                                 "--host", "0.0.0.0", "--port", "5000", "--reload"])

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════
def main():
    os.chdir(BASE_DIR)
    banner()

    reset_mode = "--reset" in sys.argv

    if SETUP_DONE.exists() and not reset_mode:
        # Already configured — just launch
        print(f"  {GREEN}Setup already complete.{RESET}  Starting backend …")
        print(f"  {DIM}Run  python start.py --reset  to redo the setup wizard.{RESET}")
        launch_backend()
        return

    print(f"""
  Welcome to SuperBrain!  This wizard will guide you through:

    1 · Create Python virtual environment
    2 · Install all required packages
    3 · Configure AI API keys + Instagram credentials
    4 · Set up an offline AI model via Ollama  (qwen3-vl:4b)
    5 · Set up offline audio transcription     (Whisper + ffmpeg)
    6 · Configure remote access (ngrok or port forwarding)
    7 · Generate API token & initialise database

  Press {BOLD}Enter{RESET} to accept defaults shown in [{DIM}brackets{RESET}].
  You can re-run this wizard any time with:  {BOLD}python start.py --reset{RESET}
""")
    input(f"  Press {BOLD}Enter{RESET} to begin … ")

    try:
        setup_venv()
        install_deps()
        setup_api_keys()
        setup_ollama()
        setup_whisper()
        setup_ngrok()
        setup_token_and_db()
    except KeyboardInterrupt:
        nl()
        warn("Setup interrupted. Re-run  python start.py  to continue.")
        sys.exit(1)

    # Mark setup done
    SETUP_DONE.write_text("ok")

    nl()
    print(f"  {GREEN}{BOLD}{'═'*60}{RESET}")
    print(f"  {GREEN}{BOLD}  ✓  Setup complete!{RESET}")
    print(f"  {GREEN}{BOLD}{'═'*60}{RESET}")
    nl()

    if ask_yn("Start the backend now?", default=True):
        launch_backend()
    else:
        info("Run  python start.py  whenever you want to start the backend.")

if __name__ == "__main__":
    main()
