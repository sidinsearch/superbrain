#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║               SuperBrain — Reset / Clean Utility                 ║
║     Selectively wipe configuration, data, and environment.       ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
    python reset.py          — interactive reset wizard
    python reset.py --all    — full wipe without prompting (⚠ destructive)
"""

import sys
import os
import shutil
import platform
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.resolve()
VENV_DIR   = BASE_DIR / ".venv"
API_KEYS   = BASE_DIR / "config" / ".api_keys"
NGROK_CFG  = BASE_DIR / "config" / "ngrok_token.txt"
TOKEN_FILE = BASE_DIR / "token.txt"
SETUP_DONE = BASE_DIR / ".setup_done"
DB_FILE    = BASE_DIR / "superbrain.db"
TEMP_DIR   = BASE_DIR / "temp"
INSTA_SESS = BASE_DIR / "config" / "instagram_session.json"

IS_WINDOWS = platform.system() == "Windows"

# ── ANSI colours ──────────────────────────────────────────────────────────────
def _ansi(code): return f"\033[{code}m"
RESET  = _ansi(0);  BOLD   = _ansi(1)
RED    = _ansi(31); GREEN  = _ansi(32); YELLOW = _ansi(33)
BLUE   = _ansi(34); CYAN   = _ansi(36)
DIM    = _ansi(2);  MAG    = _ansi(35)

def link(url: str, text: str | None = None) -> str:
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

  ██████╗ ███████╗███████╗███████╗████████╗
  ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝
  ██████╔╝█████╗  ███████╗█████╗     ██║
  ██╔══██╗██╔══╝  ╚════██║██╔══╝     ██║
  ██║  ██║███████╗███████║███████╗   ██║
  ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝
{RESET}"""
    credit = (f"  {DIM}made with {RESET}{MAG}❤{RESET}{DIM} by "
              f"{link('https://github.com/sidinsearch', f'{BOLD}sidinsearch{RESET}{DIM}')}"
              f"{RESET}\n")
    print(art + credit)

def h1(msg):   print(f"\n{BOLD}{CYAN}{'━'*64}{RESET}\n{BOLD}  {msg}{RESET}\n{BOLD}{CYAN}{'━'*64}{RESET}")
def ok(msg):   print(f"  {GREEN}✓{RESET}  {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET}  {msg}")
def err(msg):  print(f"  {RED}✗{RESET}  {msg}")
def info(msg): print(f"  {DIM}{msg}{RESET}")
def nl():      print()

def ask_yn(prompt: str, default: bool = True) -> bool:
    hint = f"{BOLD}Y{RESET}/n" if default else f"y/{BOLD}N{RESET}"
    val = input(f"\n  {BOLD}{prompt}{RESET} [{hint}]: ").strip().lower()
    if val == "":
        return default
    return val in ("y", "yes")

# ── Helpers ───────────────────────────────────────────────────────────────────
def _remove_file(path: Path, label: str):
    """Delete a single file (or glob of siblings like .db-shm / .db-wal)."""
    targets = list(path.parent.glob(path.name + "*")) if not path.exists() else [path]
    targets += list(path.parent.glob(path.name + "-shm"))
    targets += list(path.parent.glob(path.name + "-wal"))
    removed = False
    for t in dict.fromkeys(targets):   # deduplicate, preserve order
        if t.exists():
            t.unlink()
            removed = True
    if removed:
        ok(f"{label} deleted")
    else:
        info(f"{label} — nothing to delete")

def _remove_dir(path: Path, label: str):
    if path.exists():
        shutil.rmtree(path)
        ok(f"{label} deleted")
    else:
        info(f"{label} — nothing to delete")

# ── Reset actions ─────────────────────────────────────────────────────────────
def reset_api_keys():
    h1("Reset — API Keys")
    warn("This removes ALL keys: Gemini / Groq / OpenRouter / AudioTag and Instagram credentials.")
    if not ask_yn("Continue?", default=False):
        info("Skipped.")
        return
    _remove_file(API_KEYS, "API keys file (config/.api_keys)")
    ok("Run  python start.py --reset  to re-enter keys.")

def reset_audiotag_key():
    h1("Reset — AudioTag Music Recognition Key")
    info("Clears only the AudioTag key. Music recognition via AudioTag will be skipped until a new key is set.")
    info("Get a free API key at  https://audiotag.info/aap")
    if not ask_yn("Continue?", default=False):
        info("Skipped.")
        return
    if not API_KEYS.exists():
        warn("config/.api_keys not found — nothing to clear.")
        return
    lines = API_KEYS.read_text().splitlines(keepends=True)
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("AUDIOTAG_API_KEY="):
            new_lines.append("AUDIOTAG_API_KEY=\n")
        else:
            new_lines.append(line)
    API_KEYS.write_text("".join(new_lines))
    ok("AudioTag key cleared.")
    ok("Run  python start.py --reset  to set a new key without losing other settings.")

def reset_ngrok():
    h1("Reset — ngrok Token")
    warn("This removes the saved ngrok authtoken.")
    if not ask_yn("Continue?", default=False):
        info("Skipped.")
        return
    _remove_file(NGROK_CFG, "ngrok token (config/ngrok_token.txt)")

def reset_api_token():
    h1("Reset — API Token")
    warn("All mobile devices will lose access until you update the token in their Settings.")
    if not ask_yn("Continue?", default=False):
        info("Skipped.")
        return
    _remove_file(TOKEN_FILE, "API token (token.txt)")
    ok("A new token will be generated next time you run  python start.py.")

def reset_database():
    h1("Reset — Database")
    warn("This permanently deletes ALL saved posts, collections, and analysis data.")
    warn("This action CANNOT be undone.")
    nl()
    confirm = input(f"  Type {BOLD}DELETE{RESET} to confirm: ").strip()
    if confirm != "DELETE":
        info("Skipped.")
        return
    for pat in ["superbrain.db", "superbrain.db-shm", "superbrain.db-wal"]:
        _remove_file(BASE_DIR / pat, pat)
    ok("Database wiped. A fresh one will be created on next server start.")

def reset_temp():
    h1("Reset — Temporary Files")
    info("Removes downloaded media in the  temp/  folder.")
    if not ask_yn("Continue?", default=True):
        info("Skipped.")
        return
    _remove_dir(TEMP_DIR, "temp/ folder")

def reset_instagram_session():
    h1("Reset — Instagram Session")
    info("Forces a fresh login to Instagram on the next request.")
    if not ask_yn("Continue?", default=True):
        info("Skipped.")
        return
    _remove_file(INSTA_SESS, "Instagram session file")

def reset_venv():
    h1("Reset — Virtual Environment")
    warn("This deletes the entire  .venv/  folder.")
    warn("You will need to run  python start.py  again to reinstall all packages.")
    if not ask_yn("Continue?", default=False):
        info("Skipped.")
        return
    _remove_dir(VENV_DIR, ".venv/ (virtual environment)")

def reset_setup_flag():
    """Always called as part of full reset — re-triggers the start.py wizard."""
    _remove_file(SETUP_DONE, "setup flag (.setup_done)")

def full_reset():
    h1("Full Reset — Wipe Everything")
    nl()
    print(f"  This will delete:")
    print(f"    {RED}·{RESET}  API keys  (config/.api_keys)  — includes AudioTag key")
    print(f"    {RED}·{RESET}  ngrok token  (config/ngrok_token.txt)")
    print(f"    {RED}·{RESET}  API token  (token.txt)")
    print(f"    {RED}·{RESET}  Database  (superbrain.db)")
    print(f"    {RED}·{RESET}  Temporary media files  (temp/)")
    print(f"    {RED}·{RESET}  Instagram session")
    print(f"    {RED}·{RESET}  Virtual environment  (.venv/)")
    print(f"    {RED}·{RESET}  Setup completion flag  (.setup_done)")
    nl()
    warn("ALL DATA WILL BE LOST.  This cannot be undone.")
    nl()
    confirm = input(f"  Type {BOLD}RESET ALL{RESET} to confirm: ").strip()
    if confirm != "RESET ALL":
        info("Cancelled — nothing was deleted.")
        return

    for path, label in [
        (API_KEYS,   "API keys"),
        (NGROK_CFG,  "ngrok token"),
        (TOKEN_FILE, "API token"),
    ]:
        _remove_file(path, label)

    for pat in ["superbrain.db", "superbrain.db-shm", "superbrain.db-wal"]:
        _remove_file(BASE_DIR / pat, pat)

    _remove_file(INSTA_SESS, "Instagram session")
    _remove_dir(TEMP_DIR, "temp/")
    _remove_dir(VENV_DIR, ".venv/")
    reset_setup_flag()

    nl()
    ok("Full reset complete.")
    ok("Run  python start.py  to go through the setup wizard again.")

# ── Interactive menu ──────────────────────────────────────────────────────────
MENU_ITEMS = [
    ("1", "API Keys          (config/.api_keys)  — all keys + Instagram"),
    ("2", "AudioTag Key       (music recognition only)"),
    ("3", "ngrok Token        (config/ngrok_token.txt)"),
    ("4", "API Token          (token.txt)"),
    ("5", "Database           (superbrain.db)  ⚠ all posts & collections"),
    ("6", "Temporary Files    (temp/)"),
    ("7", "Instagram Session  (force fresh login)"),
    ("8", "Virtual Environment (.venv/)  ⚠ must reinstall packages"),
    ("9", f"{RED}{BOLD}Full Reset{RESET}          — wipe everything listed above"),
    ("q", "Quit"),
]

ACTIONS = {
    "1": reset_api_keys,
    "2": reset_audiotag_key,
    "3": reset_ngrok,
    "4": reset_api_token,
    "5": reset_database,
    "6": reset_temp,
    "7": reset_instagram_session,
    "8": reset_venv,
    "9": full_reset,
}

def menu():
    h1("SuperBrain Reset Utility")
    nl()
    print(f"  {DIM}Select what you want to reset:{RESET}")
    nl()
    for key, label in MENU_ITEMS:
        if key == "q":
            print(f"    {DIM}{key}{RESET}  {DIM}{label}{RESET}")
        else:
            print(f"    {BOLD}{key}{RESET}  {label}")
    nl()
    choice = input(f"  {BOLD}Choose [1-8 / q]{RESET}: ").strip().lower()
    return choice

def main():
    banner()

    # --all shortcut: skip menu and wipe everything
    if "--all" in sys.argv:
        full_reset()
        return

    while True:
        choice = menu()
        if choice == "q" or choice == "":
            nl()
            info("Nothing changed. Goodbye!")
            nl()
            sys.exit(0)

        action = ACTIONS.get(choice)
        if action:
            action()
            nl()
            again = ask_yn("Reset something else?", default=False)
            if not again:
                nl()
                info("Done. Run  python start.py  to start the server.")
                nl()
                break
        else:
            warn(f"Unknown option '{choice}' — try again.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        nl()
        info("Interrupted. Nothing was changed.")
        nl()
        sys.exit(0)
