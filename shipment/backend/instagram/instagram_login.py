#!/usr/bin/env python3
"""
Instagram Session Setup Script
===============================
Run this ONCE to authenticate with Instagram and save an instaloader session.
After that, instagram_downloader.py will reuse the saved session automatically.

Usage:
    python instagram_login.py
"""

import os
import sys
import pathlib

# Ensure backend root is in sys.path (needed when run directly)
import sys as _sys_
_sys_.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
del _sys_

# ─── Paths ────────────────────────────────────────────────────────────────────
BACKEND_DIR     = pathlib.Path(__file__).parent.parent
API_KEYS_FILE   = BACKEND_DIR / ".api_keys"
IL_SESSION_FILE = BACKEND_DIR / ".instaloader_session"


def _banner(msg: str) -> None:
    print("\n" + "=" * 60)
    print(f"  {msg}")
    print("=" * 60)


def _load_credentials() -> tuple[str, str]:
    creds: dict[str, str] = {}
    if API_KEYS_FILE.exists():
        for line in API_KEYS_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                creds[k.strip()] = v.strip()
    username = creds.get("INSTAGRAM_USERNAME") or os.getenv("INSTAGRAM_USERNAME", "")
    password = creds.get("INSTAGRAM_PASSWORD") or os.getenv("INSTAGRAM_PASSWORD", "")
    return username, password


def _save_credentials(username: str, password: str) -> None:
    lines: list[str] = []
    if API_KEYS_FILE.exists():
        for line in API_KEYS_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if "=" in stripped and not stripped.startswith("#"):
                k = stripped.split("=", 1)[0].strip()
                if k not in ("INSTAGRAM_USERNAME", "INSTAGRAM_PASSWORD"):
                    lines.append(line)
            else:
                lines.append(line)
    lines.append(f"INSTAGRAM_USERNAME={username}")
    lines.append(f"INSTAGRAM_PASSWORD={password}")
    API_KEYS_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✓ Credentials saved to {API_KEYS_FILE.name}")


# ══════════════════════════════════════════════════════════════════════════════
#  PART 1 — instaloader session (web API, works on any IP)
# ══════════════════════════════════════════════════════════════════════════════

def setup_instaloader_session(username: str, password: str) -> bool:
    """
    Log in with instaloader (Instagram Web API), save session to a file.
    Handles 2FA interactively.
    Returns True on success.
    """
    _banner("📥 Setting up instaloader session (web API)")

    try:
        import instaloader
    except ImportError:
        print("✗ instaloader not installed.  Run:  pip install instaloader")
        return False

    L = instaloader.Instaloader(
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
    )

    # Try reusing existing session
    if IL_SESSION_FILE.exists():
        try:
            L.load_session_from_file(username, str(IL_SESSION_FILE))
            if L.context.is_logged_in:
                print(f"✓ Reused saved instaloader session for @{username}")
                return True
        except Exception:
            print("  Existing instaloader session invalid — re-logging in.")
            IL_SESSION_FILE.unlink(missing_ok=True)

    # Fresh login
    print(f"  Logging in as @{username} ...")
    try:
        L.login(username, password)
    except instaloader.exceptions.TwoFactorAuthRequiredException:
        print("\n  📱 Two-factor authentication required.")
        print("     Check your authenticator app or SMS for the 6-digit code.\n")
        while True:
            code = input("  Enter 2FA code: ").strip().replace(" ", "")
            if len(code) == 6 and code.isdigit():
                break
            print("  Code should be 6 digits.")
        try:
            L.two_factor_login(code)
        except Exception as e:
            print(f"  ✗ 2FA failed: {e}")
            return False
    except instaloader.exceptions.BadCredentialsException:
        print("  ✗ Incorrect username or password.")
        return False
    except Exception as e:
        print(f"  ✗ Login error: {e}")
        return False

    if not L.context.is_logged_in:
        print("  ✗ Login did not succeed.")
        return False

    # Save session
    L.save_session_to_file(str(IL_SESSION_FILE))
    print(f"✓ instaloader session saved → {IL_SESSION_FILE.name}")
    return True




# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    _banner("SuperBrain — Instagram Session Setup")
    print()

    try:
        import instaloader  # noqa: F401
    except ImportError:
        print("✗ instaloader is not installed.  Run:  pip install instaloader")
        sys.exit(1)

    username, password = _load_credentials()

    if username and password:
        print(f"  Found credentials for: @{username}")
        answer = input("  Use these? [Y/n]: ").strip().lower()
        if answer == "n":
            username = ""
            password = ""

    if not username:
        username = input("\n  Instagram username: ").strip().lstrip("@")
    if not password:
        import getpass
        password = getpass.getpass("  Instagram password: ")

    if not username or not password:
        print("✗ Username and password are required.")
        sys.exit(1)

    il_ok = setup_instaloader_session(username, password)

    # Save credentials if entered interactively
    existing_user, _ = _load_credentials()
    if not existing_user:
        _save_credentials(username, password)

    _banner("Summary")
    il_status = "\u2713 saved" if il_ok else "\u2717 not saved"
    print(f"  instaloader session : {il_status}")
    print()
    if il_ok:
        print("  SuperBrain will now use the authenticated instaloader session")
        print("  for all Instagram downloads.")
        print()
        print("  Re-run this script if Instagram ever asks you to log in again.")
    else:
        print("  ⚠  No session saved. Anonymous instaloader will be used.")


if __name__ == "__main__":
    main()
