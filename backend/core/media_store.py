#!/usr/bin/env python3
"""Helpers for persisted offline media files."""

import os
import re
import shutil
from pathlib import Path

MEDIA_DIR = Path(os.getenv("MEDIA_PATH", str(Path(__file__).resolve().parent.parent / "media")))


def get_media_dir() -> Path:
    """Return the configured media directory."""
    return MEDIA_DIR


def safe_media_stem(content_type: str, shortcode: str) -> str:
    """Build a stable filesystem-safe media filename stem."""
    safe_type = re.sub(r"[^A-Za-z0-9_-]+", "_", content_type or "media").strip("_")
    safe_code = re.sub(r"[^A-Za-z0-9_-]+", "_", shortcode or "item").strip("_")
    return f"{safe_type or 'media'}_{safe_code or 'item'}"


def persist_media_file(source_path: Path | str | None, content_type: str, shortcode: str) -> tuple[str, int]:
    """
    Persist a downloaded MP4 into backend/media and return (filename, byte_size).
    The database stores only the filename so URLs can be derived by the API layer.
    """
    if not source_path:
        return "", 0

    source = Path(source_path)
    if not source.exists() or source.suffix.lower() != ".mp4":
        return "", 0

    try:
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        destination = MEDIA_DIR / f"{safe_media_stem(content_type, shortcode)}.mp4"
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
        file_size = destination.stat().st_size
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
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        stem = safe_media_stem("youtube", shortcode)
        output_template = str(MEDIA_DIR / f"{stem}.%(ext)s")
        final_path = MEDIA_DIR / f"{stem}.mp4"

        ydl_opts = {
            "format": (
                "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/"
                "b[ext=mp4][height<=1080]/b[ext=mp4]/best[ext=mp4]"
            ),
            "merge_output_format": "mp4",
            "outtmpl": output_template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "overwrites": True,
        }

        print("Downloading YouTube media for offline playback...")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)

        if final_path.exists():
            file_size = final_path.stat().st_size
            print(f"Offline media saved: {final_path.name} ({file_size} bytes)")
            return final_path.name, file_size

        # Some videos may download as a single MP4 with yt-dlp's resolved extension.
        mp4_candidates = sorted(MEDIA_DIR.glob(f"{stem}*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if mp4_candidates:
            return persist_media_file(mp4_candidates[0], "youtube", shortcode)

        print("yt-dlp completed but no MP4 media file was produced.")
        return "", 0
    except Exception as e:
        print(f"YouTube offline media download failed: {e}")
        return "", 0
