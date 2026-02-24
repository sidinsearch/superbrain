"""
Instagram post downloader — instaloader engine.

Uses an authenticated instaloader session if one exists
(created by instagram_login.py), falls back to anonymous otherwise.

Session file : backend/.instaloader_session  (gitignored)
"""

import os
import re
import sys
import pathlib
import contextlib
from urllib.request import urlretrieve as _urlretrieve_il

# ── instaloader ───────────────────────────────────────────────────────────────
try:
    import instaloader
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
BACKEND_DIR     = pathlib.Path(__file__).parent
TEMP_DIR        = BACKEND_DIR / "temp"
IL_SESSION_FILE = BACKEND_DIR / ".instaloader_session"
API_KEYS_FILE   = BACKEND_DIR / ".api_keys"


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

    Uses authenticated instaloader session if available, anonymous otherwise.
    Returns the folder path string on success, or None on failure.
    """
    TEMP_DIR.mkdir(exist_ok=True)

    if INSTALOADER_AVAILABLE:
        return _download_via_instaloader(url)

    print("✗ instaloader is not installed. Run: pip install instaloader")
    return None



# ── instaloader engine ───────────────────────────────────────────────────────
def _download_via_instaloader(url: str) -> str | None:
    """Download using instaloader — authenticated session if available, else anonymous."""
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

    # Load saved instaloader session if one exists (set up by instagram_login.py)
    username, _ = _load_credentials()
    if IL_SESSION_FILE.exists() and username:
        try:
            L.load_session_from_file(username, str(IL_SESSION_FILE))
            print(f"  ✓ Using authenticated instaloader session (@{username})")
        except Exception as e:
            print(f"  ⚠ Could not load instaloader session ({e}) — using anonymous")

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
