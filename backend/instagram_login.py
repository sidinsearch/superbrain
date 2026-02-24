#!/usr/bin/env python3
"""
Instagram Session Setup Script
===============================
Run this ONCE to authenticate with Instagram, solve any security challenge,
and save an encrypted session file.  After that, instagram_downloader.py will
reuse the saved session silently — no login required on every run.

Usage:
    python instagram_login.py

What it does:
    1. Reads credentials from backend/.api_keys
    2. Tries to restore an existing session (if any)
    3. Does a fresh login if needed
    4. Walks you through 2FA / security-challenge interactively
    5. Saves session to backend/.instagram_session.json
"""

import os
import sys
import json
import pathlib
import time

# ─── Paths ────────────────────────────────────────────────────────────────────
BACKEND_DIR   = pathlib.Path(__file__).parent
API_KEYS_FILE = BACKEND_DIR / ".api_keys"
SESSION_FILE  = BACKEND_DIR / ".instagram_session.json"


def _banner(msg: str) -> None:
    print("\n" + "=" * 60)
    print(f"  {msg}")
    print("=" * 60)


def _load_credentials() -> tuple[str, str]:
    """Read credentials from .api_keys or environment."""
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
    """Write / update credentials in .api_keys, preserving other keys."""
    lines: list[str] = []
    existing: dict[str, str] = {}

    if API_KEYS_FILE.exists():
        for line in API_KEYS_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if "=" in stripped and not stripped.startswith("#"):
                k, _, v = stripped.partition("=")
                key = k.strip()
                existing[key] = v.strip()
                if key not in ("INSTAGRAM_USERNAME", "INSTAGRAM_PASSWORD"):
                    lines.append(line)
            else:
                lines.append(line)

    lines.append(f"INSTAGRAM_USERNAME={username}")
    lines.append(f"INSTAGRAM_PASSWORD={password}")

    API_KEYS_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✓ Credentials saved to {API_KEYS_FILE.name}")


def _verify_session(cl) -> bool:
    """Quick check: fetch the logged-in user's own profile."""
    try:
        info = cl.account_info()
        print(f"✓ Session valid — logged in as @{info.username} ({info.full_name})")
        return True
    except Exception as e:
        print(f"✗ Session verification failed: {e}")
        return False


def main() -> None:
    _banner("🔐 SuperBrain — Instagram Session Setup")

    # ── Check instagrapi ──────────────────────────────────────────────────────
    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            BadPassword,
            TwoFactorRequired,
            ChallengeRequired,
            LoginRequired,
        )
    except ImportError:
        print("✗ instagrapi is not installed.")
        print("  Run:  pip install instagrapi")
        sys.exit(1)

    print()

    # ── Credentials ───────────────────────────────────────────────────────────
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

    # ── Try to reuse existing session ─────────────────────────────────────────
    cl = Client()
    cl.delay_range = [1, 3]

    if SESSION_FILE.exists():
        print(f"\n  Found existing session: {SESSION_FILE.name}")
        answer = input("  Try to reuse it? [Y/n]: ").strip().lower()
        if answer != "n":
            try:
                cl.load_settings(SESSION_FILE)
                cl.login(username, password)   # lightweight refresh
                if _verify_session(cl):
                    print("\n✅ Session is already valid — nothing to do!")
                    print(f"   Session file: {SESSION_FILE}")
                    return
                else:
                    print("  Stale session — will do a fresh login.")
                    SESSION_FILE.unlink(missing_ok=True)
                    cl = Client()
                    cl.delay_range = [1, 3]
            except Exception as e:
                print(f"  Session reuse failed ({e}) — performing fresh login.")
                SESSION_FILE.unlink(missing_ok=True)
                cl = Client()
                cl.delay_range = [1, 3]

    # ── Fresh login ───────────────────────────────────────────────────────────
    _banner("🔑 Logging in to Instagram")

    login_ok = False

    try:
        cl.login(username, password)
        login_ok = True

    except BadPassword:
        print("\n✗ Incorrect password. Please check your credentials and retry.")
        answer = input("\n  Update password in .api_keys? [y/N]: ").strip().lower()
        if answer == "y":
            import getpass
            new_pass = getpass.getpass("  New password: ")
            _save_credentials(username, new_pass)
        sys.exit(1)

    except TwoFactorRequired:
        print("\n  📱 Two-factor authentication required.")
        print("     Check your authenticator app or SMS for the 6-digit code.")
        while True:
            code = input("  Enter 2FA code: ").strip().replace(" ", "")
            if len(code) == 6 and code.isdigit():
                break
            print("  ⚠️  Code should be 6 digits — try again.")
        try:
            cl.login(username, password, verification_code=code)
            login_ok = True
        except Exception as e:
            print(f"\n✗ 2FA login failed: {e}")
            sys.exit(1)

    except ChallengeRequired:
        print("\n  🔒 Instagram requires a security challenge.")
        print("     This usually means the login is on a new device/IP.")
        print()

        # instagrapi stores the challenge info in cl.last_json
        try:
            cl.challenge_resolve(cl.last_json)
            time.sleep(2)
        except Exception as e:
            print(f"  Could not auto-resolve challenge: {e}")

        print("  Instagram sent a verification code to your email or phone.")
        print("  Check your inbox / SMS now.\n")

        while True:
            code = input("  Enter the verification code: ").strip().replace(" ", "")
            if code:
                break
            print("  Code cannot be empty.")

        try:
            cl.challenge_resolve(cl.last_json, code)
            login_ok = True
        except Exception as e:
            print(f"\n✗ Challenge resolution failed: {e}")
            print()
            print("  If this keeps failing, try these alternatives:")
            print("  1. Log into Instagram on your phone / browser from this IP")
            print("     (same network as this server), then re-run this script.")
            print("  2. Temporarily disable 'Login Activity' alerts in IG settings.")
            sys.exit(1)

    except Exception as e:
        print(f"\n✗ Login error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    if not login_ok:
        print("\n✗ Login did not succeed.")
        sys.exit(1)

    # ── Save session ──────────────────────────────────────────────────────────
    _banner("💾 Saving Session")

    cl.dump_settings(SESSION_FILE)
    print(f"✓ Session saved to: {SESSION_FILE}")

    # Verify
    print()
    if _verify_session(cl):
        # Save credentials in case they were entered interactively
        _save_credentials(username, password)
        print()
        print("✅ All done!  Instagram session is set up.")
        print()
        print("   From now on, instagram_downloader.py will reuse this session")
        print(f"   automatically without needing to log in each time.")
        print()
        print("   If Instagram ever revokes the session (usually after weeks/months),")
        print(f"   just run:  python {pathlib.Path(__file__).name}")
    else:
        print("⚠️  Session saved but verification check failed.")
        print("   The downloader will try to use the session anyway.")


if __name__ == "__main__":
    main()
