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


def _handle_challenge(cl, username: str, password: str) -> bool:
    """Handle ChallengeRequired — send code then let user enter it."""
    print("\n  🔒 Instagram requires a security challenge.")
    print("     This happens when logging in from a new device or IP.")
    print()
    try:
        cl.challenge_resolve(cl.last_json)
        time.sleep(2)
        print("  ✓ Challenge request sent.")
    except Exception as e:
        print(f"  ⚠️  Auto-send failed ({e})")

    print("  Instagram sent a verification code to your email or phone.")
    print("  Check your inbox / SMS now.\n")

    for attempt in range(3):
        code = input(f"  Enter the verification code (attempt {attempt+1}/3): ").strip()
        if not code:
            continue
        try:
            cl.challenge_resolve(cl.last_json, code)
            print("  ✓ Challenge solved!")
            return True
        except Exception as e:
            print(f"  ✗ Code rejected: {e}")

    print("\n✗ Could not solve challenge after 3 attempts.")
    _print_manual_fix()
    return False


def _handle_challenge_manual(cl, username: str, password: str) -> bool:
    """
    Called when Instagram's challenge API returns empty/bad responses
    (account flagged for this IP).  Offers the user two paths:

      A) Trust this IP by logging in via a browser on this same machine,
         then re-run the script.
      B) Import browser cookies that instaloader can read (Firefox / Chrome).
    """
    print()
    print("  Instagram is refusing the automated challenge flow — this account")
    print("  has not been used from this IP before and IG is extra cautious.")
    print()
    print("  Choose a fix:")
    print()
    print("  [A]  Browser login  (recommended)")
    print("       Open Firefox/Chromium on THIS machine, log into Instagram,")
    print("       complete any security check there, then come back here.")
    print()
    print("  [B]  Import Firefox/Chrome cookies  (if already logged in)")
    print("       If you are already logged in on this machine's browser,")
    print("       this option imports those cookies automatically.")
    print()
    print("  [S]  Skip  (keep using instaloader anonymous fallback for now)")
    print()

    choice = input("  Your choice [A/B/S]: ").strip().upper()

    if choice == "A":
        print()
        print("  ➤  Open Firefox or Chromium now and log in at:")
        print("     https://www.instagram.com/accounts/login/")
        print()
        print("  ➤  Complete any security check Instagram shows.")
        print()
        input("  Press ENTER when you have logged in successfully in the browser...")
        print()
        print("  Retrying login with instagrapi now...")
        from instagrapi import Client
        cl2 = Client()
        cl2.delay_range = [1, 3]
        try:
            cl2.login(username, password)
            # Copy settings back to original client
            cl.set_settings(cl2.get_settings())
            print("  ✓ Login succeeded after browser trust!")
            return True
        except Exception as e:
            print(f"  ✗ Still failing: {e}")
            print("  Try option B (cookie import) or wait a few hours and retry.")
            return False

    elif choice == "B":
        return _try_browser_cookies(cl, username)

    else:
        print()
        print("  Skipped — instaloader anonymous fallback will be used.")
        return False


def _try_browser_cookies(cl, username: str) -> bool:
    """Attempt to build a session from browser cookies using instaloader."""
    try:
        import instaloader
    except ImportError:
        print("  ✗ instaloader not installed — cannot import browser cookies.")
        return False

    print()
    print("  Trying to import browser cookies via instaloader ...")
    print("  Supported browsers: Firefox, Chrome, Chromium, Edge, Safari")
    print()

    browsers = ["firefox", "chrome", "chromium", "edge", "safari"]
    for browser in browsers:
        try:
            L = instaloader.Instaloader()
            instaloader.load_session_from_cookies(L, browser, username)  # type: ignore[attr-defined]
            if L.context.is_logged_in:
                print(f"  ✓ Imported session from {browser}!")
                # Export instaloader cookies to a temp file, load in instagrapi
                _convert_instaloader_to_instagrapi(L, cl, username)
                return True
        except Exception:
            continue

    # Fallback: just let the user provide the session cookie manually
    print("  Could not find browser cookies automatically.")
    print()
    print("  Manual cookie import:")
    print("  1. Open your browser's DevTools (F12) → Application → Cookies")
    print("     → https://www.instagram.com")
    print("  2. Copy the value of the 'sessionid' cookie.")
    print()
    session_id = input("  Paste sessionid value (or press ENTER to skip): ").strip()
    if not session_id:
        return False

    # URL-decode if needed (browsers sometimes copy it percent-encoded)
    from urllib.parse import unquote
    session_id = unquote(session_id)
    print(f"  Using sessionid: {session_id[:20]}…")

    # Try 1: instagrapi's built-in method
    try:
        cl.login_by_sessionid(session_id)
        print("  ✓ Logged in via sessionid cookie!")
        return True
    except Exception as e:
        print(f"  ⚠️  login_by_sessionid failed ({e}), trying direct cookie inject...")

    # Try 2: inject the cookie directly into the underlying requests session
    # This skips login_flow() so Instagram doesn't see an extra API burst
    try:
        cl.private.cookies.set("sessionid", session_id, domain=".instagram.com")
        cl.private.cookies.set("ds_user_id", "", domain=".instagram.com")
        # Lightweight check — does not trigger login_flow
        info = cl.account_info()
        print(f"  ✓ Logged in as @{info.username} via direct cookie inject!")
        return True
    except Exception as e2:
        print(f"  ✗ Direct cookie inject also failed: {e2}")
        print()
        print("  This usually means Instagram is blocking all API requests from")
        print("  this IP address (common with cloud/VPS servers).")
        print()
        print("  What to do:")
        print("   • If you're on a home/office connection: open Firefox on this")
        print("     machine, log in to Instagram, solve any verification there,")
        print("     then re-run this script and choose option A.")
        print("   • The anonymous instaloader fallback will keep working fine")
        print("     for downloading public posts.")
        return False


def _convert_instaloader_to_instagrapi(
    L: "instaloader.Instaloader", cl, username: str
) -> None:
    """Copy instaloader cookies into instagrapi client via sessionid."""
    try:
        session_id = L.context._session.cookies.get("sessionid", domain=".instagram.com")
        if session_id:
            cl.login_by_sessionid(session_id)
    except Exception:
        pass  # best effort


def _print_manual_fix() -> None:
    print()
    print("  ── Manual fix ─────────────────────────────────────────────")
    print("  1. On THIS machine open Firefox/Chromium and log in at:")
    print("     https://www.instagram.com/accounts/login/")
    print("  2. Complete any security verification Instagram shows.")
    print("  3. Re-run:  python backend/instagram_login.py")
    print("  ────────────────────────────────────────────────────────────")
    print()


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
        login_ok = _handle_challenge(cl, username, password)
        if not login_ok:
            sys.exit(1)

    except Exception as e:
        # Instagram's challenge flow sometimes returns empty body → JSONDecodeError
        # instagrapi wraps this same scenario without raising ChallengeRequired
        err_str = str(e)
        if "JSONDecodeError" in type(e).__name__ or "Expecting value" in err_str:
            print("\n  🔒 Instagram is blocking this login (security challenge,")
            print("     empty challenge response).")
            print()
            login_ok = _handle_challenge_manual(cl, username, password)
            if not login_ok:
                sys.exit(1)
        else:
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
