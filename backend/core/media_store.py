#!/usr/bin/env python3
"""Helpers for persisted offline media files."""

import os
import re
import shutil
import tempfile
from pathlib import Path
from contextlib import contextmanager

from core.media_retention import media_lock

MEDIA_DIR = Path(os.getenv("MEDIA_PATH", str(Path(__file__).resolve().parent.parent / "media")))


def get_media_dir() -> Path:
    """Return the configured media directory."""
    return MEDIA_DIR


def safe_media_stem(content_type: str, shortcode: str) -> str:
    """Build a stable filesystem-safe media filename stem."""
    safe_type = re.sub(r"[^A-Za-z0-9_-]+", "_", content_type or "media").strip("_")
    safe_code = re.sub(r"[^A-Za-z0-9_-]+", "_", shortcode or "item").strip("_")
    return f"{safe_type or 'media'}_{safe_code or 'item'}"


@contextmanager
def media_download_workspace():
    """Private staging area; the lease keeps a live download safe from cleanup."""
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".download-", dir=MEDIA_DIR) as folder:
        workspace = Path(folder)
        with media_lock(workspace / ".active.sqlite3"):
            yield workspace


def persist_media_file(source_path: Path | str | None, content_type: str, shortcode: str) -> tuple[str, int]:
    """
    Persist a downloaded MP4 into backend/media and return (filename, byte_size).
    The database stores only the filename so URLs can be derived by the API layer.
    """
    if not source_path:
        return "", 0

    source = Path(source_path)
    if not source.is_file() or source.suffix.lower() != ".mp4":
        return "", 0

    try:
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        destination = MEDIA_DIR / f"{safe_media_stem(content_type, shortcode)}.mp4"
        if source.resolve() == destination.resolve():
            file_size = destination.stat().st_size
            if file_size <= 0:
                return "", 0
            with media_lock(MEDIA_DIR / ".maintenance.sqlite3"):
                os.utime(destination, None)
                return destination.name, file_size
        with media_download_workspace() as workspace:
            staged = workspace / "video.mp4"
            shutil.copyfile(source, staged)
            file_size = staged.stat().st_size
            if file_size <= 0:
                return "", 0
            # Set retention age at publication, never the original post date.
            with media_lock(MEDIA_DIR / ".maintenance.sqlite3"):
                os.utime(staged, None)
                staged.replace(destination)
        print(f"Offline media saved: {destination.name} ({file_size} bytes)")
        return destination.name, file_size
    except Exception as e:
        print(f"Could not persist offline media: {e}")
        return "", 0


def download_youtube_media(url: str, shortcode: str) -> tuple[str, int]:
    """Download a YouTube video/Short as an MP4 for offline mobile playback."""
    try:
        import yt_dlp
    except ImportError:
        print("yt-dlp is not installed; skipping offline YouTube media download.")
        return "", 0

    try:
        with media_download_workspace() as workspace:
            final_path = workspace / "video.mp4"
            ydl_opts = {
                "format": (
                    "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/"
                    "b[ext=mp4][height<=1080]/b[ext=mp4]/best[ext=mp4]"
                ),
                "merge_output_format": "mp4",
                "outtmpl": str(workspace / "video.%(ext)s"),
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "overwrites": True,
            }

            print("Downloading YouTube media for offline playback...")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(url, download=True)

            # Do not publish an intermediate video-only fragment as the result.
            return persist_media_file(final_path, "youtube", shortcode)
    except Exception as e:
        print(f"YouTube offline media download failed: {e}")
        return "", 0
