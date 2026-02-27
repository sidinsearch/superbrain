#!/usr/bin/env python3
"""
Music Identifier – Optimized Shazam multi-segment recognition
==============================================================
Strategy:
  • Quick probe  — tries a 12 s fingerprint from several evenly-spaced
                   positions first (fast, low-bandwidth)
  • Deep scan    — if nothing found, retries the same positions with
                   full 20 s segments for trickier tracks
  • Positions    — up to 5 evenly-spread offsets scaled to audio length
                   so songs that start after speech/ambient sound are caught

Output format is identical to the original so that main.py's parser
requires no changes.
"""

import sys
import os
import asyncio
import subprocess
import tempfile
from pathlib import Path

# Ensure backend root is on sys.path when called as a subprocess
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from shazamio import Shazam
    _HAS_SHAZAM = True
except ImportError:
    _HAS_SHAZAM = False


# ─────────────────────────────────────────────────────────────────────────────
#  Audio helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_duration(audio_path: str) -> float:
    """Return audio duration in seconds via ffprobe. Falls back to 60 s."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1",
             audio_path],
            capture_output=True, text=True, timeout=10,
        )
        return float(result.stdout.strip())
    except Exception:
        return 60.0


def _extract_segment(audio_path: str, start_sec: float,
                     duration: float = 20.0) -> str | None:
    """Cut a slice from *audio_path* starting at *start_sec*.
    Returns path to a temp MP3 file (caller must delete it), or None.
    """
    try:
        fd, seg_path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)
        subprocess.run(
            ["ffmpeg", "-y",
             "-ss", str(int(start_sec)),
             "-t",  str(int(duration)),
             "-i",  audio_path,
             "-acodec", "libmp3lame", "-q:a", "3",
             seg_path],
            capture_output=True, timeout=30,
        )
        if os.path.getsize(seg_path) > 1024:
            return seg_path
        os.remove(seg_path)
        return None
    except Exception:
        return None


def _segment_positions(duration: float) -> list[float]:
    """Return evenly-spread start-second offsets to probe.

    Rules:
      <= 20 s  -> [0]                              (short clip, try as-is)
      <= 50 s  -> [0, ~50%]                        (2 positions)
      <= 90 s  -> [0, ~33%, ~66%]                  (3 positions)
      <= 180 s -> [0, ~25%, ~50%, ~75%]            (4 positions)
      > 180 s  -> [0, ~20%, ~40%, ~60%, ~80%]      (5 positions)
    """
    if duration <= 20:
        return [0.0]
    if duration <= 50:
        return [0.0, duration * 0.50]
    if duration <= 90:
        return [0.0, duration * 0.33, duration * 0.66]
    if duration <= 180:
        return [0.0, duration * 0.25, duration * 0.50, duration * 0.75]
    return [0.0, duration * 0.20, duration * 0.40,
            duration * 0.60, duration * 0.80]


# ─────────────────────────────────────────────────────────────────────────────
#  Shazam core
# ─────────────────────────────────────────────────────────────────────────────

async def _shazam_recognize_file(shazam, path: str) -> dict | None:
    try:
        result = await shazam.recognize(path)
        if result and "track" in result:
            return result
    except Exception:
        pass
    return None


async def _shazam_multi_segment(audio_path: str) -> dict | None:
    """Two-pass Shazam scan.

    Pass 1 — Quick probe (12 s segments):  fast fingerprint; catches most hits
    Pass 2 — Deep scan  (20 s segments):   longer window catches harder tracks
    Both passes share the same evenly-distributed position list.
    """
    if not _HAS_SHAZAM:
        return None

    shazam    = Shazam()
    duration  = _get_duration(audio_path)
    positions = _segment_positions(duration)
    total     = len(positions)

    # ── Pass 1: quick 12 s probe ─────────────────────────────────────────────
    print(f"   ⚡ [Pass 1 – quick probe, 12 s  x  {total} position{'s' if total > 1 else ''}]")
    for i, start in enumerate(positions, start=1):
        label = f"@{int(start)}s" if start > 0 else "start"
        print(f"   [Shazam] {i}/{total} {label}...", end=" ", flush=True)

        if start == 0:
            # Try the original file first (no re-encoding overhead)
            result = await _shazam_recognize_file(shazam, audio_path)
        else:
            seg = _extract_segment(audio_path, start, duration=12)
            if not seg:
                print("(extract failed)")
                continue
            try:
                result = await _shazam_recognize_file(shazam, seg)
            finally:
                try:
                    os.remove(seg)
                except Exception:
                    pass

        if result:
            print("match!")
            return result
        print("no match")

    # ── Pass 2: deep 20 s scan ───────────────────────────────────────────────
    if total == 1:
        # Audio is <= 20 s — pass 2 adds nothing new
        return None

    print()
    print(f"   [Shazam] Pass 2 – deep scan, 20 s  x  {total} positions")
    for i, start in enumerate(positions, start=1):
        label = f"@{int(start)}s" if start > 0 else "start"
        print(f"   [Shazam] {i}/{total} {label} (20 s)...", end=" ", flush=True)

        seg = _extract_segment(audio_path, start, duration=20)
        if not seg:
            print("(extract failed)")
            continue
        try:
            result = await _shazam_recognize_file(shazam, seg)
        finally:
            try:
                os.remove(seg)
            except Exception:
                pass

        if result:
            print("match!")
            return result
        print("no match")

    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Result formatter
# ─────────────────────────────────────────────────────────────────────────────

def _format_shazam(result: dict) -> dict:
    track = result["track"]

    # ── Artist ────────────────────────────────────────────────────────────────
    artist = track.get("subtitle", "").strip()
    if not artist and track.get("artists"):
        aliases = [a.get("alias", "").replace("-", " ").title()
                   for a in track["artists"] if a.get("alias")]
        artist = ", ".join(aliases)
    if not artist:
        for section in track.get("sections", []):
            if section.get("type") == "SONG":
                for meta in section.get("metadata", []):
                    if meta.get("title", "").lower() in ("artist", "artists"):
                        artist = meta.get("text", "").strip()
                if not artist:
                    artist = section.get("tabname", "").strip()
    if not artist and "hub" in track:
        hub_text = track["hub"].get("actions", [{}])[0].get("name", "")
        if " - " in hub_text:
            artist = hub_text.split(" - ")[0].strip()

    # ── Metadata ──────────────────────────────────────────────────────────────
    album = released = label = genre = ""
    for section in track.get("sections", []):
        if section.get("type") == "SONG":
            for meta in section.get("metadata", []):
                t, v = meta.get("title", "").lower(), meta.get("text", "")
                if   t == "album":    album    = v
                elif t == "released": released = v
                elif t == "label":    label    = v
    if "genres" in track:
        genre = track["genres"].get("primary", "")

    # ── Links ─────────────────────────────────────────────────────────────────
    spotify = ""
    if "hub" in track:
        for p in track["hub"].get("providers", []):
            if p.get("type") == "SPOTIFY":
                spotify = p["actions"][0].get("uri", "")

    return {
        "title":        track.get("title", ""),
        "artist":       artist or "Unknown",
        "album":        album,
        "released":     released,
        "label":        label,
        "genre":        genre,
        "shazam_count": track.get("shazamcount", 0),
        "spotify":      spotify,
        "apple":        track.get("url", ""),
        "source":       "Shazam",
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Output printer
# ─────────────────────────────────────────────────────────────────────────────

def _print_result(info: dict) -> None:
    print()
    print("=" * 70)
    print(f"\u2705 MUSIC IDENTIFIED  [{info['source']}]")
    print("=" * 70)
    print()
    print(f"\U0001f3b5 Song: {info['title']}")
    print(f"\U0001f464 Artist: {info['artist']}")
    if info["album"]:
        print(f"\U0001f4bf Album: {info['album']}")
    if info["released"]:
        print(f"\U0001f4c5 Released: {info['released']}")
    if info["label"]:
        print(f"\U0001f3f7\ufe0f  Label: {info['label']}")
    if info["genre"]:
        print(f"\U0001f3b8 Genre: {info['genre']}")
    if info["shazam_count"]:
        c   = info["shazam_count"]
        fmt = (f"{c / 1_000_000:.1f}M" if c >= 1_000_000
               else (f"{c / 1_000:.1f}K" if c >= 1_000 else str(c)))
        print(f"\U0001f525 Shazams: {fmt}")
    print()
    print("\U0001f517 LINKS:")
    if info["spotify"]:
        print(f"   Spotify: {info['spotify']}")
    if info["apple"]:
        print(f"   Apple Music: {info['apple']}")
    print()
    print("=" * 70)


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

async def identify_music(audio_path: str) -> None:
    """Identify music from *audio_path* using optimized Shazam multi-segment."""

    print("=" * 70)
    print("MUSIC IDENTIFIER  (Shazam – optimized multi-segment)")
    print("=" * 70)
    print()

    path = Path(audio_path)
    if not path.exists():
        print(f"File not found: {audio_path}")
        return

    valid_exts = {".mp3", ".wav", ".m4a", ".ogg", ".flac",
                  ".aac", ".mp4", ".avi", ".mov"}
    if path.suffix.lower() not in valid_exts:
        print(f"Unsupported file type: {path.suffix}")
        return

    if not _HAS_SHAZAM:
        print("shazamio is not installed. Run:  pip install shazamio")
        return

    print(f"Analyzing: {path.name}")
    print()

    result = await _shazam_multi_segment(str(path))
    if result:
        _print_result(_format_shazam(result))
        return

    print()
    print("No match found. The audio might be:")
    print("   - Original / unreleased / user-created music")
    print("   - Too short or poor audio quality")
    print("   - Background / ambient sound without a clear melody")
    print("   - In a niche regional catalogue not yet in Shazam's DB")


# ─────────────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) > 1:
        audio_path = sys.argv[1].strip("\"'").strip()
    else:
        print("=" * 70)
        print("MUSIC IDENTIFIER  (Shazam – optimized multi-segment)")
        print("=" * 70)
        print()
        audio_path = input("Enter audio/video file path: ").strip()

    if not audio_path:
        print("No path provided!")
        return

    asyncio.run(identify_music(audio_path))


if __name__ == "__main__":
    main()
