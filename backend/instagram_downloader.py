"""
Instagram post downloader — dual-engine approach.

Primary  : instagrapi (Instagram Private Mobile API).
           Inspired by instagram-cli (https://github.com/supreme-gg-gg/instagram-cli).
           Authenticates with a saved session file → stable, no cooldowns.
           Requires INSTAGRAM_USERNAME + INSTAGRAM_PASSWORD in backend/.api_keys.

Fallback : instaloader (anonymous web-scraping).
           Used automatically when instagrapi is unavailable or credentials are
           not supplied. More fragile (403s, rate-limits) but needs no account.

Session cache : backend/.instagram_session.json  (instagrapi, gitignored)
"""

import os
import re
import sys
import pathlib

# ── instagrapi: Instagram Private API client (used by instagram-cli) ──────────
try:
    from instagrapi import Client
    from instagrapi.exceptions import (
        LoginRequired,
        RateLimitError,
        MediaNotFound,
        ClientError,
        BadPassword,
        TwoFactorRequired,
        ChallengeRequired,
    )
    INSTAGRAPI_AVAILABLE = True
except ImportError:
    INSTAGRAPI_AVAILABLE = False

# ── instaloader: anonymous fallback ──────────────────────────────────────────
try:
    import instaloader
    import contextlib
    from urllib.request import urlretrieve as _urlretrieve_il
    INSTALOADER_AVAILABLE = True
except ImportError:
    INSTALOADER_AVAILABLE = False

# ── Audio extraction ──────────────────────────────────────────────────────────
try:
    from moviepy.editor import VideoFileClip
    MOVIEPY_AVAILABLE = True
except ImportError:
    MOVIEPY_AVAILABLE = False

# ── Paths ─────────────────────────────────────────────────────────────────────
BACKEND_DIR   = pathlib.Path(__file__).parent
TEMP_DIR      = BACKEND_DIR / "temp"
SESSION_FILE  = BACKEND_DIR / ".instagram_session.json"
API_KEYS_FILE = BACKEND_DIR / ".api_keys"


# ── Credential loader ─────────────────────────────────────────────────────────
def _load_credentials() -> tuple[str, str]:
    """Read INSTAGRAM_USERNAME / INSTAGRAM_PASSWORD from .api_keys or env."""
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


# ── Session management ────────────────────────────────────────────────────────
def _get_client() -> "Client":
    """
    Return an authenticated instagrapi Client.

    Strategy (mirrors instagram-cli session approach):
      1. Load saved session settings (cookies, tokens) from SESSION_FILE.
      2. Call login() — when settings are pre-loaded this is a lightweight token
         refresh, NOT a full login, which avoids checkpoint triggers.
      3. On any session error → delete stale file → do fresh login → save.
    """
    if not INSTAGRAPI_AVAILABLE:
        raise RuntimeError(
            "instagrapi is not installed. Run:  pip install instagrapi"
        )

    username, password = _load_credentials()
    if not username or not password:
        raise RuntimeError(
            "Instagram credentials missing.\n"
            "Add to backend/.api_keys:\n"
            "  INSTAGRAM_USERNAME=your_username\n"
            "  INSTAGRAM_PASSWORD=your_password"
        )

    cl = Client()
    cl.delay_range = [1, 3]   # human-like request pacing (same as instagram-cli)

    # ── Try to reuse cached session ───────────────────────────────────────────
    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)          # lightweight token refresh
            print("✓ Reused saved Instagram session")
            return cl
        except LoginRequired:
            print("  Session expired, performing fresh login...")
            SESSION_FILE.unlink(missing_ok=True)
        except Exception as e:
            print(f"  Session reuse failed ({e}), performing fresh login...")
            SESSION_FILE.unlink(missing_ok=True)

    # ── Fresh login ───────────────────────────────────────────────────────────
    try:
        cl.login(username, password)
    except BadPassword:
        raise RuntimeError("Instagram login failed: incorrect password.")
    except TwoFactorRequired:
        code = input("Enter Instagram 2FA verification code: ").strip()
        cl.login(username, password, verification_code=code)
    except ChallengeRequired:
        raise RuntimeError(
            "Instagram is asking for a security challenge (suspicious login).\n"
            "Log in manually on a browser or phone with this account first, "
            "then retry."
        )
    except Exception as e:
        raise RuntimeError(f"Instagram login error: {e}")

    cl.dump_settings(SESSION_FILE)
    print("✓ Instagram login successful — session saved")
    return cl


# ── Helpers ───────────────────────────────────────────────────────────────────
def sanitize_folder_name(text: str, max_length: int = 50) -> str:
    """Strip non-ASCII and filesystem-unsafe characters; trim to max_length."""
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r'[<>:"/\\|?*\n\r]', "", text)
    text = re.sub(r"\s+", " ", text).strip()[:max_length]
    return text or "instagram_post"


def _unique_folder(base: pathlib.Path, name: str) -> pathlib.Path:
    """Return a non-existing path under base, appending _N suffix if needed."""
    folder = base / name
    counter = 1
    while folder.exists():
        folder = base / f"{name}_{counter}"
        counter += 1
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def extract_audio_from_video(video_path: str, audio_path: str) -> bool:
    """Extract audio track from a video file and save as MP3."""
    if not MOVIEPY_AVAILABLE:
        print("  ⚠ moviepy not installed — skipping audio extraction")
        return False
    try:
        print("  Extracting audio...")
        video = VideoFileClip(video_path)
        if video.audio is not None:
            video.audio.write_audiofile(audio_path, verbose=False, logger=None)
            video.close()
            print(f"  ✓ Audio saved: {os.path.basename(audio_path)}")
            return True
        video.close()
        print("  ⚠ No audio track in video")
        return False
    except Exception as e:
        print(f"  ⚠ Audio extraction failed: {e}")
        return False


# ── Main download function ────────────────────────────────────────────────────
def download_instagram_content(url: str) -> str | None:
    """
    Download an Instagram post (photo / video / carousel) to temp/<folder>/.

    Tries instagrapi (authenticated, rate-limit-resistant) first.
    Falls back to instaloader (anonymous) automatically on any failure.
    Returns the folder path string on success, or None on failure.
    """
    TEMP_DIR.mkdir(exist_ok=True)

    # ── Primary: instagrapi ───────────────────────────────────────────────────
    username, password = _load_credentials()
    if INSTAGRAPI_AVAILABLE and username and password:
        print("[instagrapi] Attempting download via Private API...")
        result = _download_via_instagrapi(url)
        if result is not None:
            return result
        print("[instagrapi] Failed — falling back to instaloader...")
    else:
        if not INSTAGRAPI_AVAILABLE:
            print("[instagrapi] Not installed — using instaloader fallback")
        else:
            print("[instagrapi] No credentials set — using instaloader fallback")

    # ── Fallback: instaloader ─────────────────────────────────────────────────
    if INSTALOADER_AVAILABLE:
        print("[instaloader] Attempting anonymous download...")
        return _download_via_instaloader(url)

    print("✗ Neither instagrapi nor instaloader is available.")
    print("  Install at least one:")
    print("    pip install instagrapi   (recommended — needs IG credentials)")
    print("    pip install instaloader  (anonymous fallback)")
    return None


# ── instagrapi engine ─────────────────────────────────────────────────────────
def _download_via_instagrapi(url: str) -> str | None:
    """Primary download path using instagrapi (Instagram Private API)."""
    # ── Auth ──────────────────────────────────────────────────────────────────
    try:
        cl = _get_client()
    except Exception as e:
        print(f"  ✗ instagrapi login failed: {e}")
        return None

    # ── Extract shortcode ─────────────────────────────────────────────────────
    match = re.search(r"/(?:reels?|p|tv)/([^/?#&]+)", url)
    if not match:
        print("  ✗ Invalid Instagram URL.")
        return None
    shortcode = match.group(1)

    print(f"  Fetching post metadata for shortcode: {shortcode}...")

    # ── Fetch media info with session-expiry retry ────────────────────────────
    media = None
    for attempt in range(2):
        try:
            media_pk = cl.media_pk_from_code(shortcode)
            media    = cl.media_info(media_pk)
            break
        except MediaNotFound:
            print(f"  ✗ Post not found or is private: {shortcode}")
            return None
        except RateLimitError:
            print("  ✗ Rate limit hit.")
            return None
        except LoginRequired:
            if attempt == 0:
                print("  Session expired mid-request, re-authenticating...")
                SESSION_FILE.unlink(missing_ok=True)
                try:
                    cl = _get_client()
                except RuntimeError as e:
                    print(f"  ✗ Re-authentication failed: {e}")
                    return None
            else:
                print("  ✗ Still getting LoginRequired after re-authentication.")
                return None
        except ClientError as e:
            print(f"  ✗ Instagram API error: {e}")
            return None

    if media is None:
        return None

    # ── Setup download folder ─────────────────────────────────────────────────
    caption     = media.caption_text or f"post_{shortcode}"
    folder_name = sanitize_folder_name(caption.split("\n")[0])
    folder      = _unique_folder(TEMP_DIR, folder_name)
    media_type  = media.media_type          # 1 = photo, 2 = video, 8 = carousel

    type_label = {1: "Photo", 2: "Video", 8: "Carousel"}.get(media_type, "Unknown")
    print(f"  User   : @{media.user.username}")
    print(f"  Caption: {caption[:80]}...")
    print(f"  Type   : {type_label}")

    # ── Download by media type ────────────────────────────────────────────────
    try:
        if media_type == 2:
            print("  Downloading video...")
            dl_path    = cl.video_download(media_pk, folder=folder)
            final_path = folder / f"{folder_name}.mp4"
            dl_path.rename(final_path)
            extract_audio_from_video(str(final_path),
                                     str(folder / f"{folder_name}_audio.mp3"))
            if media.thumbnail_url:
                _download_url(str(media.thumbnail_url),
                              folder / f"{folder_name}_thumbnail.jpg")

        elif media_type == 8:
            total = len(media.resources)
            print(f"  Downloading carousel ({total} items)...")
            paths = cl.album_download(media_pk, folder=folder)
            for i, dl_path in enumerate(paths, 1):
                suffix     = dl_path.suffix
                final_path = folder / f"{folder_name}_{i}{suffix}"
                dl_path.rename(final_path)
                if suffix == ".mp4":
                    extract_audio_from_video(
                        str(final_path),
                        str(folder / f"{folder_name}_{i}_audio.mp3")
                    )
                print(f"  → item {i}/{total}")

        else:
            print("  Downloading image...")
            dl_path    = cl.photo_download(media_pk, folder=folder)
            final_path = folder / f"{folder_name}.jpg"
            dl_path.rename(final_path)

    except RateLimitError:
        print("  ✗ Rate limited during download.")
        return None
    except Exception as e:
        print(f"  ✗ Download error: {e}")
        import traceback; traceback.print_exc()
        return None

    _write_info(folder, url, media, media_type, caption, shortcode)
    print(f"\n✓ Download complete (instagrapi): {folder}")
    return str(folder)


# ── instaloader engine (fallback) ─────────────────────────────────────────────
def _download_via_instaloader(url: str) -> str | None:
    """Fallback download path using instaloader (anonymous web-scraping)."""
    match = re.search(r"/(?:reels?|p|tv)/([^/?#&]+)", url)
    if not match:
        print("  ✗ Invalid Instagram URL.")
        return None
    shortcode = match.group(1)

    L = instaloader.Instaloader(
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        max_connection_attempts=3,
    )

    try:
        print(f"  Fetching post for shortcode: {shortcode}...")
        with contextlib.redirect_stderr(open(os.devnull, "w")):
            post = instaloader.Post.from_shortcode(L.context, shortcode)

        caption           = post.caption if post.caption else f"post_{shortcode}"
        caption_first_line = caption.split("\n")[0]
        folder_name       = sanitize_folder_name(caption_first_line)
        folder            = _unique_folder(TEMP_DIR, folder_name)

        print(f"  User   : @{post.owner_username}")
        print(f"  Caption: {caption_first_line[:80]}...")

        file_counter = 1
        if post.is_video:
            video_path = str(folder / f"{folder_name}.mp4")
            print("  Downloading video...")
            _urlretrieve_il(post.video_url, video_path)
            extract_audio_from_video(video_path,
                                     str(folder / f"{folder_name}_audio.mp3"))
            _urlretrieve_il(post.url, str(folder / f"{folder_name}_thumbnail.jpg"))

        elif post.typename == "GraphSidecar":
            print(f"  Downloading carousel ({post.mediacount} items)...")
            for node in post.get_sidecar_nodes():
                if node.is_video:
                    fp = str(folder / f"{folder_name}_{file_counter}.mp4")
                    _urlretrieve_il(node.video_url, fp)
                    extract_audio_from_video(
                        fp,
                        str(folder / f"{folder_name}_{file_counter}_audio.mp3")
                    )
                else:
                    _urlretrieve_il(
                        node.display_url,
                        str(folder / f"{folder_name}_{file_counter}.jpg")
                    )
                print(f"  → item {file_counter}/{post.mediacount}")
                file_counter += 1

        else:
            print("  Downloading image...")
            _urlretrieve_il(post.url, str(folder / f"{folder_name}.jpg"))

        # info.txt (instaloader variant — uses post object fields)
        with open(folder / "info.txt", "w", encoding="utf-8") as f:
            f.write("Instagram Post Information\n")
            f.write("=" * 50 + "\n\n")
            f.write(f"URL: {url}\n")
            f.write(f"Username: @{post.owner_username}\n")
            f.write(f"Date: {post.date_utc}\n")
            f.write(f"Likes: {post.likes}\n")
            f.write(f"Type: {'Video' if post.is_video else 'Image'}\n")
            if post.typename == "GraphSidecar":
                f.write(f"Media Count: {post.mediacount} items\n")
            f.write("\n")
            f.write(f"Caption:\n{'-' * 50}\n")
            f.write(post.caption if post.caption else "No caption")
            f.write(f"\n{'-' * 50}\n\n")
            hashtags = re.findall(r"#\w+", post.caption or "")
            if hashtags:
                f.write("Hashtags:\n")
                f.write(", ".join(hashtags) + "\n")

        print(f"\n✓ Download complete (instaloader): {folder}")
        return str(folder)

    except instaloader.exceptions.LoginRequiredException:
        print("  ✗ instaloader: Login required — Instagram blocked anonymous access.")
    except instaloader.exceptions.ConnectionException as e:
        print(f"  ✗ instaloader: Connection error — {e}")
    except Exception as e:
        print(f"  ✗ instaloader error: {e}")
        import traceback; traceback.print_exc()
    return None


# ── Private helpers ───────────────────────────────────────────────────────────
def _download_url(url: str, dest: pathlib.Path) -> None:
    from urllib.request import urlretrieve
    urlretrieve(url, dest)


def _write_info(
    folder: pathlib.Path,
    url: str,
    media: object,
    media_type: int,
    caption: str,
    shortcode: str,
) -> None:
    """Write metadata to info.txt in the download folder."""
    type_names = {1: "Photo", 2: "Video", 8: "Carousel"}
    with open(folder / "info.txt", "w", encoding="utf-8") as f:
        f.write("Instagram Post Information\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"URL: {url}\n")
        f.write(f"Username: @{media.user.username}\n")
        f.write(f"Date: {media.taken_at}\n")
        f.write(f"Likes: {media.like_count}\n")
        f.write(f"Type: {type_names.get(media_type, 'Unknown')}\n")
        if media_type == 8:
            f.write(f"Media Count: {len(media.resources)} items\n")
        f.write("\n")
        f.write(f"Caption:\n{'-' * 50}\n")
        f.write(caption or "No caption")
        f.write(f"\n{'-' * 50}\n\n")
        hashtags = re.findall(r"#\w+", caption or "")
        if hashtags:
            f.write("Hashtags:\n")
            f.write(", ".join(hashtags) + "\n")


# ── CLI entry-point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) > 1:
        _url = sys.argv[1]
    else:
        _url = input("Enter Instagram Reel / Post / IGTV link: ").strip()

    if _url:
        download_instagram_content(_url)
    else:
        print("No URL provided.")
