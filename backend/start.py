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
import importlib
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
MAGENTA = _ansi(35)
MAG    = MAGENTA

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
    credit = (f"    {DIM}made with {RESET}{MAG}❤{RESET}{DIM}  by "
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

def ask(prompt, default=None, secret=False, paste=False):
    """
    Prompt for input.
      secret=True  — uses getpass (hidden, no echo) — good for passwords typed char-by-char.
      paste=True   — uses plain input (visible) so Ctrl+V / right-click paste works;
                     existing value is shown as ●●●● to indicate something is already set.
    """
    if paste and default:
        display_default = f" [{DIM}●●●● (already set — paste to replace){RESET}]"
    elif default:
        display_default = f" [{DIM}{default}{RESET}]"
    else:
        display_default = ""

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


def ensure_runtime_dependencies():
    """Install must-have runtime packages if missing in the active venv."""
    required = [
        ("multipart", "python-multipart"),
    ]
    missing: list[str] = []

    for module_name, package_name in required:
        try:
            importlib.import_module(module_name)
        except Exception:
            missing.append(package_name)

    if not missing:
        return

    warn(f"Missing runtime package(s): {', '.join(missing)}")
    info("Installing missing runtime package(s) automatically …")
    try:
        run([str(VENV_PYTHON), "-m", "pip", "install", *missing])
        ok("Runtime dependencies installed")
    except Exception as e:
        err(f"Failed to install runtime dependencies: {e}")
        info(f"Run manually: {VENV_PYTHON} -m pip install {' '.join(missing)}")
        sys.exit(1)

# ── Helpers for live output displays ───────────────────────────────────────────────
BAR_WIDTH = 36

def _ascii_bar(completed: int, total: int, width: int = BAR_WIDTH) -> str:
    """Return a coloured ASCII progress bar string."""
    if total <= 0:
        return ""
    pct  = min(completed / total, 1.0)
    fill = int(width * pct)
    bar  = f"{GREEN}{'█' * fill}{DIM}{'░' * (width - fill)}{RESET}"
    mb_d = completed / 1_048_576
    mb_t = total    / 1_048_576
    return f"[{bar}] {mb_d:6.1f} / {mb_t:.1f} MB  {pct*100:5.1f}%"

def _overwrite(line: str):
    """Overwrite the current terminal line in-place."""
    sys.stdout.write(f"\r  {line}")
    sys.stdout.flush()

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
    h1("Step 2 of 7 — Installing Python Dependencies")
    req = BASE_DIR / "requirements.txt"
    if not req.exists():
        err("requirements.txt not found — cannot install dependencies.")
        sys.exit(1)

    h2("Upgrading pip …")
    run([str(VENV_PYTHON), "-m", "pip", "install", "--quiet", "--upgrade", "pip"])
    ok("pip up to date")

    h2("Installing packages from requirements.txt …")
    nl()

    # ── stream pip output and display each package live ────────────────────────
    cmd = [str(VENV_PIP), "install", "--progress-bar", "off", "-r", str(req)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1)

    collecting: list[str] = []
    n_cached   = 0
    n_download = 0
    n_install  = 0
    current_pkg = ""

    for raw in proc.stdout:  # type: ignore[union-attr]
        line = raw.rstrip()
        if not line:
            continue

        if line.startswith("Collecting "):
            pkg = line.split()[1]
            current_pkg = pkg
            collecting.append(pkg)
            idx = len(collecting)
            print(f"  {CYAN}↓{RESET}  [{idx:>3}] {BOLD}{pkg}{RESET}")

        elif "Downloading" in line and ".whl" in line or ".tar.gz" in line:
            # e.g. "  Downloading fastapi-0.111.0-py3..whl (92 kB)"
            parts = line.strip().split()
            if len(parts) >= 2:
                filename = parts[1]
                size_str = " ".join(parts[2:]).strip("()")
                print(f"       {DIM}↓ {filename}  {size_str}{RESET}")
            n_download += 1

        elif line.strip().startswith("Requirement already satisfied"):
            n_cached += 1

        elif line.startswith("Installing collected packages:"):
            pkgs = line.split(":", 1)[1].strip()
            n_install = len(pkgs.split(","))
            nl()
            print(f"  {BLUE}{BOLD}  ▶  Linking {n_install} package(s) into virtual environment …{RESET}")

        elif line.startswith("Successfully installed"):
            tail = line.replace("Successfully installed", "").strip()
            count = len(tail.split())
            nl()
            ok(f"{count} package(s) installed successfully")
            if n_cached:
                info(f"{n_cached} package(s) already satisfied (cached)")

        elif line.upper().startswith("WARNING") or line.upper().startswith("DEPRECATION"):
            pass   # suppress pip noise

        else:
            # Any other line (build output, etc.) show dimmed
            if line.strip():
                print(f"       {DIM}{line.strip()}{RESET}")

    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)

# ══════════════════════════════════════════════════════════════════════════════
# ── API key validators ────────────────────────────────────────────────────────
# Return values:
#   (True,  detail)  — key is definitely valid
#   (False, detail)  — key is definitely INVALID  (401 / explicit auth error)
#   (None,  detail)  — could not verify (network, 403 scope, timeout, etc.)

def _validate_gemini(key: str):
    """Hit the Gemini models list endpoint — any valid key returns 200."""
    try:
        import urllib.request as _r, json as _j
        req = _r.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={key}",
            headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
        with _r.urlopen(req, timeout=8) as resp:
            data = _j.loads(resp.read())
            count = len(data.get("models", []))
            return True, f"{count} models accessible"
    except Exception as e:
        msg = str(e)
        if "400" in msg:
            return False, "invalid key (400 Bad Request)"
        if "401" in msg:
            return False, "invalid key (401 Unauthorized)"
        # 403, timeouts, etc. — cannot determine validity
        return None, f"could not verify ({msg[:70]})"

def _validate_groq(key: str):
    """
    Test with a minimal chat completion (max_tokens=1).
    Must include User-Agent to pass Cloudflare (error 1010 without it).
    """
    try:
        import urllib.request as _r, urllib.error as _e, json as _j
        body = _j.dumps({
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
        }).encode()
        req = _r.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=body,
            headers={"Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "Accept": "application/json",
                     "User-Agent": "Mozilla/5.0"},
            method="POST",
        )
        with _r.urlopen(req, timeout=10) as resp:
            return True, "key valid"
    except _e.HTTPError as e:
        if e.code in (401, 400):
            return False, f"invalid key ({e.code} {e.reason})"
        # 403, 429, 503, etc. — key may be fine
        return None, f"could not verify ({e.code} {e.reason})"
    except Exception as e:
        return None, f"could not verify ({str(e)[:70]})"

def _validate_openrouter(key: str):
    try:
        import urllib.request as _r, urllib.error as _e, json as _j
        req = _r.Request("https://openrouter.ai/api/v1/auth/key",
                         headers={"Authorization": f"Bearer {key}",
                                  "Accept": "application/json",
                                  "User-Agent": "Mozilla/5.0"})
        with _r.urlopen(req, timeout=8) as resp:
            data = _j.loads(resp.read())
            label = data.get("data", {}).get("label", "")
            return True, label or "key valid"
    except _e.HTTPError as e:
        if e.code in (401, 400):
            return False, f"invalid key ({e.code})"
        return None, f"could not verify ({e.code} {e.reason})"
    except Exception as e:
        return None, f"could not verify ({str(e)[:70]})"

def _check_and_report(name: str, key: str, validator) -> str:
    """Validate `key`, print result inline, return the key unchanged."""
    if not key:
        return key
    print(f"  {DIM}Checking {name} key …{RESET}", end="", flush=True)
    result, detail = validator(key)
    if result is True:
        print(f"\r  {GREEN}✓{RESET}  {name}: {detail}                            ")
    elif result is False:
        print(f"\r  {RED}✗{RESET}  {name}: {detail}                            ")
        warn(f"That key looks invalid — double-check at the provider dashboard.")
    else:
        # None — ambiguous, don't cry wolf
        print(f"\r  {YELLOW}~{RESET}  {name}: {detail}                            ")
        info("Could not reach the API right now — key saved, will be tested on first use.")
    return key

# Step 3 — API Keys
# ══════════════════════════════════════════════════════════════════════════════
def setup_api_keys():
    h1("Step 3 of 7 — AI Provider Keys")

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
  {DIM}Keys and passwords are visible as you paste — don't run setup in a screen share.{RESET}
""")

    # Load existing values if re-running
    existing = {}
    if API_KEYS.exists():
        for line in API_KEYS.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()

    gemini   = ask("Gemini API key",      default=existing.get("GEMINI_API_KEY"),      paste=True) or ""
    gemini   = _check_and_report("Gemini",      gemini, _validate_gemini)
    groq_k   = ask("Groq API key",        default=existing.get("GROQ_API_KEY"),        paste=True) or ""
    groq_k   = _check_and_report("Groq",        groq_k, _validate_groq)
    openr    = ask("OpenRouter API key",  default=existing.get("OPENROUTER_API_KEY"),  paste=True) or ""
    openr    = _check_and_report("OpenRouter",  openr,  _validate_openrouter)

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

  {DIM}Without credentials:{RESET}
    SuperBrain can still save and analyse {BOLD}YouTube videos{RESET} and {BOLD}Websites{RESET}
    without any Instagram account. However, Instagram posts will be limited:
    • Only {BOLD}public posts{RESET} that are accessible without login may work.
    • You {BOLD}cannot process multiple Instagram posts back-to-back{RESET} —
      Instagram enforces a rate-limit cool-down between unauthenticated
      requests. You may need to wait several minutes between saves.
    Adding credentials removes these restrictions entirely.

  Press {BOLD}Enter{RESET} to skip.
""")
    ig_user = ask("Instagram username", default=existing.get("INSTAGRAM_USERNAME")) or ""
    ig_pass = ask("Instagram password", default=existing.get("INSTAGRAM_PASSWORD"), paste=True) or ""

    # Write .api_keys
    API_KEYS.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# SuperBrain API Keys — DO NOT COMMIT THIS FILE\n",
        f"GEMINI_API_KEY={gemini}\n",
        f"GROQ_API_KEY={groq_k}\n",
        f"OPENROUTER_API_KEY={openr}\n",
        "\n",
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

    h2(f"Pulling {model} — this downloads ~3 GB, grab a coffee ☕")
    nl()
    try:
        _ollama_pull_with_progress(model)
    except subprocess.CalledProcessError:
        err(f"Failed to pull {model}.")
        warn(f"Run manually later:  ollama pull {model}")

def _ollama_pull_with_progress(model: str):
    """Run `ollama pull` and render a live per-layer progress bar."""
    import json as _json

    cmd = ["ollama", "pull", model]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1)

    # digest → (total_bytes, completed_bytes, short_label)
    layers: dict[str, tuple[int, int, str]] = {}
    last_status = ""
    active_digest = ""
    render_line   = False   # True while a progress bar is being overwritten

    for raw in proc.stdout:  # type: ignore[union-attr]
        raw = raw.strip()
        if not raw:
            continue

        # Ollama outputs plain-text lines (not JSON) when not a TTY — accept both
        try:
            data = _json.loads(raw)
        except _json.JSONDecodeError:
            # plain text line from older Ollama or piped output
            if render_line:
                sys.stdout.write("\n"); render_line = False
            if raw != last_status:
                last_status = raw
                print(f"  {CYAN}→{RESET}  {raw}")
            continue

        status   = data.get("status",    "")
        digest   = data.get("digest",    "")
        total    = int(data.get("total",    0))
        completed= int(data.get("completed",0))

        if digest and total > 0:
            short = (digest.split(":")[-1])[:12]  # e.g. "a1b2c3d4e5f6"
            layers[digest] = (total, completed, short)
            active_digest  = digest
            bar = _ascii_bar(completed, total)
            _overwrite(f"{DIM}{short}{RESET}  {bar}")
            render_line = True

        elif status and status != last_status:
            if render_line:
                sys.stdout.write("\n"); render_line = False
            last_status = status
            # Show a checkmark when a layer finishes
            done_statuses = ("verifying sha256 digest", "writing manifest",
                             "removing any unused layers", "success")
            if any(s in status.lower() for s in done_statuses):
                print(f"  {GREEN}✓{RESET}  {status}")
            else:
                print(f"  {CYAN}→{RESET}  {status}")

    if render_line:
        sys.stdout.write("\n"); render_line = False

    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)

    ok(f"Model {model} ready")

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

    # ── Whisper package check / install ──────────────────────────────────────
    try:
        result = run_q([str(VENV_PYTHON), "-c", "import whisper; print(whisper.__version__)"])
        ok(f"openai-whisper installed (version {result.stdout.strip()})")
    except Exception:
        warn("openai-whisper not found — installing now …")
        nl()
        try:
            cmd = [str(VENV_PIP), "install", "--progress-bar", "off", "openai-whisper"]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1)
            for raw in proc.stdout:  # type: ignore[union-attr]
                line = raw.rstrip()
                if not line:
                    continue
                if line.startswith("Collecting "):
                    print(f"  {CYAN}↓{RESET}  {BOLD}{line.split()[1]}{RESET}")
                elif "Downloading" in line and (".whl" in line or ".tar.gz" in line):
                    parts = line.strip().split()
                    if len(parts) >= 2:
                        print(f"       {DIM}↓ {parts[1]}  {' '.join(parts[2:]).strip('()')}{RESET}")
                elif line.startswith("Successfully installed"):
                    print(f"  {GREEN}✓  {line}{RESET}")
                elif "error" in line.lower() or "ERROR" in line:
                    print(f"  {RED}{line}{RESET}")
            proc.wait()
            if proc.returncode == 0:
                result = run_q([str(VENV_PYTHON), "-c", "import whisper; print(whisper.__version__)"])
                ok(f"openai-whisper installed (version {result.stdout.strip()})")
            else:
                err("openai-whisper install failed — offline transcription will not work.")
                if not ask_yn("Continue setup anyway?", default=True):
                    sys.exit(0)
                return
        except Exception as e:
            err(f"openai-whisper install failed: {e}")
            if not ask_yn("Continue setup anyway?", default=True):
                sys.exit(0)
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

    # ── Save model choice to config ─────────────────────────────────────────
    whisper_cfg = BASE_DIR / "config" / "whisper_model.txt"
    (BASE_DIR / "config").mkdir(exist_ok=True)
    whisper_cfg.write_text(model)
    ok(f"Whisper model set to '{model}' (saved to config/whisper_model.txt)")

    h2(f"Pre-downloading Whisper '{model}' model …")
    print(f"  {DIM}(Whisper's own progress bar will appear below){RESET}\n")
    try:
        # Don't capture: let tqdm's download progress bars stream to the terminal
        run([str(VENV_PYTHON), "-c",
             f"import whisper; print('Loading model …'); whisper.load_model('{model}'); print('Done.')"])
        nl()
        ok(f"Whisper '{model}' model downloaded and cached")
    except subprocess.CalledProcessError:
        err(f"Pre-download failed — Whisper will download '{model}' automatically on first use.")

# ══════════════════════════════════════════════════════════════════════════════
# Step 6 — Remote Access / Port Forwarding
# ══════════════════════════════════════════════════════════════════════════════
LOCALTUNNEL_ENABLED = BASE_DIR / "config" / "localtunnel_enabled.txt"
LOCALTUNNEL_LOG = BASE_DIR / "config" / "localtunnel.log"

def setup_remote_access():
    h1("Step 6 of 7 — Remote Access (localtunnel / Port Forwarding)")

    print(f"""
  The SuperBrain backend runs on {BOLD}port 5000{RESET} on your machine.
  Your phone needs to reach this port over the internet.

  You have two options:

    {BOLD}Option A — localtunnel (easiest + free){RESET}
        localtunnel creates a public HTTPS URL that tunnels to your local port 5000.
        No account required.
        Official site: {CYAN}https://theboroer.github.io/localtunnel-www/{RESET}

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

    choice = ask_yn("Enable localtunnel on startup?", default=True)
    if not choice:
        LOCALTUNNEL_ENABLED.unlink(missing_ok=True)
        warn("Skipping localtunnel. Use either your own port forwarding or local WiFi.")
        info("Remember: set the correct server URL in the mobile app Settings.")
        return

    if not shutil.which("npx"):
        print(f"""
    {YELLOW}npx is not installed / not on PATH.{RESET}

    Install it:
        Linux   →  {CYAN}Install Node.js (includes npm + npx){RESET}
        macOS   →  {CYAN}brew install node{RESET}
        Windows →  Install Node.js LTS from {CYAN}https://nodejs.org/{RESET}

    After installing, re-run {BOLD}python start.py{RESET}.
""")
        warn("Skipping localtunnel setup.")
        return

    ok("npx binary found")
    LOCALTUNNEL_ENABLED.parent.mkdir(parents=True, exist_ok=True)
    LOCALTUNNEL_ENABLED.write_text("enabled")
    ok("localtunnel auto-start enabled")
    nl()
    info("localtunnel will be started automatically every time you run start.py.")

# ══════════════════════════════════════════════════════════════════════════════
# Step 6 — Access Token & Database
# ══════════════════════════════════════════════════════════════════════════════
def setup_token_and_db():
    h1("Step 7 of 7 — Access Token & Database")

    # Token
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
        if token and len(token) == 8 and token.isalnum():
            ok(f"Access Token already exists: {BOLD}{token}{RESET}")
            if not ask_yn("Generate a new Access Token?", default=False):
                return
        elif token:
            warn("Existing token uses old format. A new 8-character Access Token will be generated.")
    else:
        token = None

    alphabet = string.ascii_uppercase + string.digits
    new_token = ''.join(secrets.choice(alphabet) for _ in range(8))
    TOKEN_FILE.write_text(new_token)
    ok(f"Access Token saved: {BOLD}{GREEN}{new_token}{RESET}")
    nl()
    print(f"  {YELLOW}Copy this token into the mobile app → Settings → Access Token.{RESET}")

    # DB is auto-created on first backend start; just let the user know
    nl()
    info("The SQLite database (superbrain.db) will be created automatically")
    info("the first time the backend starts.")

# ══════════════════════════════════════════════════════════════════════════════
# Launch Backend
# ══════════════════════════════════════════════════════════════════════════════
def _extract_localtunnel_url(text: str) -> str | None:
    """Extract first localtunnel public URL from text."""
    import re
    m = re.search(r"https://[\w.-]+\.loca\.lt\b", text)
    return m.group(0) if m else None


def _find_localtunnel_url_from_log() -> str | None:
    """Read local tunnel log and return detected public URL if available."""
    try:
        if not LOCALTUNNEL_LOG.exists():
            return None
        text = LOCALTUNNEL_LOG.read_text(encoding="utf-8", errors="ignore")
        return _extract_localtunnel_url(text)
    except Exception:
        return None


def _stop_localtunnel_processes():
    """Stop existing localtunnel processes so only one tunnel remains active."""
    try:
        if IS_WINDOWS:
            script = (
                "Get-CimInstance Win32_Process "
                "| Where-Object { $_.CommandLine -match 'localtunnel|\\.loca\\.lt' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
            )
            subprocess.run(["powershell", "-NoProfile", "-Command", script], check=False)
        else:
            subprocess.run(["pkill", "-f", "localtunnel"], check=False)
    except Exception:
        pass


def _start_localtunnel(port: int, timeout: int = 25) -> str | None:
    """Start localtunnel in the background and wait for the public URL."""
    import time as _time

    npx_exec = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx_exec:
        return None

    # Clean stale localtunnel processes.
    _stop_localtunnel_processes()
    _time.sleep(0.8)

    info("Starting localtunnel in background …")
    try:
        LOCALTUNNEL_LOG.parent.mkdir(parents=True, exist_ok=True)
        LOCALTUNNEL_LOG.write_text("")

        log_handle = open(LOCALTUNNEL_LOG, "a", encoding="utf-8", buffering=1)
        kwargs = {
            "start_new_session": True,
            "stdout": log_handle,
            "stderr": subprocess.STDOUT,
            "text": True,
        }
        if IS_WINDOWS and npx_exec.lower().endswith(".cmd"):
            cmd = ["cmd", "/c", npx_exec, "-y", "localtunnel", "--port", str(port)]
        else:
            cmd = [npx_exec, "-y", "localtunnel", "--port", str(port)]
        subprocess.Popen(cmd, **kwargs)
    except Exception as e:
        warn(f"Could not start localtunnel: {e}")
        return None

    # Poll log output until URL is emitted.
    deadline = _time.time() + timeout
    while _time.time() < deadline:
        _time.sleep(1)
        url = _find_localtunnel_url_from_log()
        if url:
            ok(f"localtunnel active  →  {GREEN}{BOLD}{url}{RESET}")
            return url

    warn("localtunnel started but URL is not available yet.")
    info(f"Check tunnel logs in: {LOCALTUNNEL_LOG}")
    return None


def _get_windows_pids_on_port(port: int) -> list[int]:
    """Return listener PIDs on Windows using Get-NetTCPConnection when available."""
    pids: set[int] = set()
    try:
        ps_cmd = (
            f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue "
            "| Select-Object -ExpandProperty OwningProcess -Unique"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            check=False,
            capture_output=True,
            text=True,
        )
        for row in (result.stdout or "").splitlines():
            row = row.strip()
            if row.isdigit():
                pids.add(int(row))
    except Exception:
        pass
    return sorted(pids)

def _check_port(port: int) -> int | None:
    """Return the PID occupying `port`, or None if free."""
    import socket as _socket
    with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        if s.connect_ex(("127.0.0.1", port)) != 0:
            return None   # port is free

    # Port is busy — try to find the PID
    try:
        if IS_WINDOWS:
            out = run_q(["netstat", "-ano"]).stdout
            for line in out.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
                    local_addr = parts[1]
                    if local_addr.endswith(f":{port}"):
                        return int(parts[-1])
        else:
            out = run_q(["lsof", "-ti", f"TCP:{port}", "-sTCP:LISTEN"]).stdout.strip()
            if out:
                return int(out.splitlines()[0])
    except Exception:
        pass
    return -1   # busy but PID unknown


def _find_pids_on_port(port: int) -> list[int]:
    """Return all PIDs listening on a given port."""
    pids: set[int] = set()
    try:
        if IS_WINDOWS:
            for pid in _get_windows_pids_on_port(port):
                pids.add(pid)

            out = run_q(["netstat", "-ano"]).stdout
            for line in out.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
                    local_addr = parts[1]
                    if local_addr.endswith(f":{port}"):
                        try:
                            pids.add(int(parts[-1]))
                        except ValueError:
                            pass
        else:
            out = run_q(["lsof", "-ti", f"TCP:{port}", "-sTCP:LISTEN"]).stdout.strip()
            if out:
                for row in out.splitlines():
                    try:
                        pids.add(int(row.strip()))
                    except ValueError:
                        pass
    except Exception:
        pass
    return sorted(pids)


def _kill_pid_windows(pid: int) -> bool:
    """Best-effort kill for a Windows PID. Returns True if command succeeded."""
    try:
        result = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return True

        # Fallback for cases where taskkill can't resolve a rapidly-exiting process.
        ps = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        return ps.returncode == 0
    except Exception:
        return False


def _clear_port_listeners(port: int, attempts: int = 6) -> bool:
    """Try multiple passes to free a busy port by killing all listeners."""
    for _ in range(attempts):
        if _check_port(port) is None:
            return True

        pids = _find_pids_on_port(port)
        if not pids:
            time.sleep(0.8)
            continue

        for ep in pids:
            try:
                if IS_WINDOWS:
                    _kill_pid_windows(ep)
                else:
                    os.kill(ep, 9)
            except Exception:
                pass
        time.sleep(0.8)

    return _check_port(port) is None


def _detect_local_ip() -> str:
    """Best-effort LAN IP detection for same-network mobile access."""
    import socket

    # Most reliable route-based detection.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    # Hostname fallback.
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    return "127.0.0.1"

def _display_connect_qr(url: str, token: str):
    """Display a proper QR code in the terminal using segno + Unicode half-block chars.

    The QR encodes a JSON string:  {"url": "...", "token": "..."}
    which the mobile app's QR scanner can read to auto-configure connection.
    """
    try:
        import segno
    except ImportError:
        # segno not installed — try installing it on the fly
        try:
            info("Installing segno for QR code display …")
            run_q([str(VENV_PIP), "install", "--quiet", "segno"])
            import segno
        except Exception:
            warn("Could not generate QR code (segno not available).")
            info("Install it:  pip install segno")
            return

    payload = json.dumps({"url": url, "token": token}, separators=(',', ':'))
    qr = segno.make(payload, error='L')

    # Convert to a matrix of booleans (True = dark module)
    matrix = [list(row) for row in qr.matrix]
    rows = len(matrix)
    cols = len(matrix[0]) if rows else 0

    # Add quiet zone (2 modules on each side)
    quiet = 2
    padded_cols = cols + quiet * 2
    padded_rows = rows + quiet * 2
    padded = []
    empty_row = [0] * padded_cols
    for _ in range(quiet):
        padded.append(list(empty_row))
    for row in matrix:
        padded.append([0] * quiet + row + [0] * quiet)
    for _ in range(quiet):
        padded.append(list(empty_row))

    # Render using Unicode half-block characters for double vertical resolution
    # Each output line encodes TWO rows of QR modules:
    #   top=dark, bottom=dark → "█"  (full block)
    #   top=dark, bottom=light → "▀" (upper half)
    #   top=light, bottom=dark → "▄" (lower half)
    #   top=light, bottom=light → " " (space)
    BG_WHITE  = "\033[47m"   # white background
    FG_BLACK  = "\033[30m"   # black foreground
    ANSI_RST  = "\033[0m"

    nl()
    print(f"  {BOLD}{CYAN}┌{'─' * (padded_cols + 4)}┐{RESET}")
    print(f"  {BOLD}{CYAN}│{RESET}  {BOLD}Scan with SuperBrain app{RESET}  {BOLD}{CYAN}│{RESET}")
    print(f"  {BOLD}{CYAN}├{'─' * (padded_cols + 4)}┤{RESET}")

    for y in range(0, padded_rows, 2):
        line_chars = []
        for x in range(padded_cols):
            top = padded[y][x] if y < padded_rows else 0
            bottom = padded[y + 1][x] if y + 1 < padded_rows else 0

            if top and bottom:
                line_chars.append("█")
            elif top and not bottom:
                line_chars.append("▀")
            elif not top and bottom:
                line_chars.append("▄")
            else:
                line_chars.append(" ")

        line = "".join(line_chars)
        print(f"  {BOLD}{CYAN}│{RESET}  {line}  {BOLD}{CYAN}│{RESET}")

    print(f"  {BOLD}{CYAN}└{'─' * (padded_cols + 4)}┘{RESET}")
    nl()


def launch_backend():
    h1("Launching SuperBrain Backend")

    # Ensure upload endpoints won't crash FastAPI at import time.
    ensure_runtime_dependencies()

    # ── Port conflict check ───────────────────────────────────────────────────
    PORT = 5000
    pid = _check_port(PORT)
    if pid is not None:
        if pid > 0:
            warn(f"Port {PORT} is already in use by PID {BOLD}{pid}{RESET}.")
        else:
            warn(f"Port {PORT} is already in use (PID unknown).")

        nl()
        print(f"  This is usually a previous SuperBrain server that wasn't stopped.")
        print(f"  Options:")
        print(f"    {BOLD}1{RESET}  Kill the existing process and start fresh  {DIM}(recommended){RESET}")
        print(f"    {BOLD}2{RESET}  Exit — I'll stop it manually then re-run start.py")
        nl()
        choice = input(f"  {BOLD}Choose [1/2]{RESET}: ").strip()

        if choice != "1":
            nl()
            if pid and pid > 0:
                info(f"Stop it with:  kill {pid}")
            else:
                info(f"Find what's on port {PORT}:  lsof -i :{PORT}   (Linux/macOS)")
                info(f"                              netstat -ano | findstr :{PORT}   (Windows)")
            info("Then re-run:  python start.py")
            sys.exit(0)

        # Kill it
        try:
            import signal as _sig
            if pid and pid > 0:
                if IS_WINDOWS:
                    killed = _kill_pid_windows(pid)
                    if not killed:
                        warn(f"PID {pid} is no longer active. Trying current listeners on port {PORT} …")
                else:
                    os.kill(pid, _sig.SIGTERM)
                time.sleep(1)
                # If still alive, SIGKILL
                if not IS_WINDOWS:
                    try:
                        os.kill(pid, 0)   # check if process exists
                        os.kill(pid, _sig.SIGKILL)
                        time.sleep(0.5)
                    except ProcessLookupError:
                        pass

                # Verify port is free; if not, keep clearing listeners until stable.
                _clear_port_listeners(PORT)

                if _check_port(PORT) is None:
                    ok(f"Process {pid} stopped")
                else:
                    err(f"Port {PORT} is still in use after kill attempt.")
                    if IS_WINDOWS:
                        info(f"Run manually:  netstat -ano | findstr :{PORT}")
                        info("Then:         taskkill /PID <pid> /T /F")
                        info("Or inspect:    powershell Get-NetTCPConnection -LocalPort 5000 -State Listen")
                    else:
                        info(f"Run:  lsof -ti TCP:{PORT} -sTCP:LISTEN | xargs kill -9")
                    sys.exit(1)
            else:
                # Unknown PID — try to kill all listeners we can find
                extra_pids = _find_pids_on_port(PORT)
                if not extra_pids:
                    err("Cannot determine PID automatically.")
                    if IS_WINDOWS:
                        info(f"Run manually:  netstat -ano | findstr :{PORT}")
                        info("Then:         taskkill /PID <pid> /F")
                    else:
                        info(f"Run:  lsof -ti TCP:{PORT} -sTCP:LISTEN | xargs kill -9")
                    info("Then re-run:  python start.py")
                    sys.exit(1)

                _clear_port_listeners(PORT)
                if _check_port(PORT) is None:
                    ok(f"Cleared port {PORT} by terminating PID(s): {', '.join(str(x) for x in extra_pids)}")
                else:
                    err(f"Port {PORT} is still busy.")
                    if IS_WINDOWS:
                        info(f"Run manually:  netstat -ano | findstr :{PORT}")
                        info("Then:         taskkill /PID <pid> /T /F")
                    else:
                        info(f"Run:  lsof -ti TCP:{PORT} -sTCP:LISTEN | xargs kill -9")
                    sys.exit(1)
        except Exception as e:
            err(f"Failed to kill process: {e}")
            if IS_WINDOWS:
                if pid and pid > 0:
                    info(f"Try manually:  taskkill /PID {pid} /F")
                info(f"Or list listeners:  netstat -ano | findstr :{PORT}")
            else:
                info(f"Try manually:  kill -9 {pid}")
            sys.exit(1)

    token = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "—"
    local_ip = _detect_local_ip()

    localtunnel_enabled = bool(shutil.which("npx") or shutil.which("npx.cmd"))

    localtunnel_url: str | None = None
    if localtunnel_enabled:
        localtunnel_url = _start_localtunnel(PORT)
    else:
        localtunnel_url = _find_localtunnel_url_from_log()

    if localtunnel_url:
        tunnel_line = f"    Public URL   →  {GREEN}{BOLD}{localtunnel_url}{RESET}  {DIM}(localtunnel){RESET}"
        tunnel_hint = f"         · public     →  {GREEN}{localtunnel_url}{RESET}"
    elif localtunnel_enabled:
        tunnel_line = f"    Public URL   →  {YELLOW}(starting — URL pending, check localtunnel.log){RESET}"
        tunnel_hint = f"         · public     →  run:  {DIM}npx localtunnel --port {PORT}{RESET}"
    else:
        tunnel_line = ""
        tunnel_hint = f"         · public     →  install Node.js first, then run: {DIM}npx localtunnel --port {PORT}{RESET}"

    # ── Generate and display QR code ──────────────────────────────────────────
    qr_url = f"http://{local_ip}:{PORT}"
    _display_connect_qr(qr_url, token)

    print(f"""
  {GREEN}{BOLD}Backend is starting up!{RESET}

    Local URL      →  {CYAN}http://127.0.0.1:{PORT}{RESET}
    Network URL    →  {CYAN}http://{local_ip}:{PORT}{RESET}
{(tunnel_line + chr(10)) if tunnel_line else ''}    API docs       →  {CYAN}http://127.0.0.1:{PORT}/docs{RESET}
    Access Token   →  {BOLD}{MAGENTA}{token}{RESET}

  {DIM}Keep this terminal open. Press Ctrl+C to stop the server.{RESET}

  {YELLOW}Mobile app setup:{RESET}
    {BOLD}Option A — Scan QR code (easiest):{RESET}
      1. Open the app  →  Settings  →  tap the {BOLD}QR icon{RESET} 📷
      2. Scan the QR code shown above
      3. Done — auto-connected!

    {BOLD}Option B — Manual setup:{RESET}
      1. Build / install the SuperBrain APK on your Android device.
      2. Open the app  →  tap the ⚙ settings icon.
      3. Set {BOLD}Server URL{RESET} to:
           · Same WiFi  →  http://{local_ip}:{PORT}
{tunnel_hint}
           · Port fwd   →  http://<your-public-ip>:{PORT}
      4. Set {BOLD}Access Token{RESET} to: {BOLD}{MAGENTA}{token}{RESET}
      5. Tap {BOLD}Save{RESET}  →  Connected!

  {YELLOW}Data Management:{RESET}
    • {BOLD}Export:{RESET}   In app Settings  →  Data Import/Export  →  choose format (JSON/ZIP)
    • {BOLD}Import:{RESET}   Upload backup file in app  →  Data Import/Export  →  select file
    • {BOLD}Reset:{RESET}    Run  {BOLD}python reset.py{RESET}  for safe data cleanup options

  {DIM}Security Note: Keep token.txt private. Anyone with this token can use your API.{RESET}
  {DIM}The app securely stores your Access Token locally — it's never transmitted anywhere but your server.{RESET}
""")

    os.chdir(BASE_DIR)
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), "-m", "uvicorn", "api:app",
                                 "--host", "0.0.0.0", "--port", str(PORT), "--reload"])

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
    3 · Configure AI provider keys + Instagram credentials
    4 · Set up an offline AI model via Ollama  (qwen3-vl:4b)
    5 · Set up offline audio transcription     (Whisper + ffmpeg)
    6 · Configure remote access (localtunnel or port forwarding)
    7 · Generate Access Token & initialise database

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
        setup_remote_access()
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
