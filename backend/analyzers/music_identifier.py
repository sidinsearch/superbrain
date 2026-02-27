#!/usr/bin/env python3
"""
Music Identifier – Multi-approach audio recognition
=====================================================
Strategy (in priority order):
  1. Shazam multi-segment  — tries beginning, ~33 %, ~66 % of the audio so
                             songs that start after speech/ambient sound are caught
  2. AudioTag              — large global DB including Indian/regional music;
                             requires AUDIOTAG_API_KEY from config

Output format is identical to the previous single-Shazam version so that
main.py's parser requires no changes.
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

try:
    import requests as _requests
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False

# ─────────────────────────────────────────────────────────────────────────────
#  Config helpers
# ─────────────────────────────────────────────────────────────────────────────

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


def _load_audiotag_key() -> str | None:
    """Return AudioTag API key from config, or None if not set."""
    try:
        keys_file = _CONFIG_DIR / ".api_keys"
        if keys_file.exists():
            for line in keys_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("AUDIOTAG_API_KEY="):
                    val = line.split("=", 1)[1].strip()
                    if val:
                        return val
    except Exception:
        pass
    return None

# ─────────────────────────────────────────────────────────────────────────────
#  Audio helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_duration(audio_path: str) -> float:
    """Return audio duration in seconds via ffprobe. Falls back to 60s."""
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


def _extract_segment(audio_path: str, start_sec: float, duration: float = 20.0) -> str | None:
    """Cut a 20-second slice from *audio_path* starting at *start_sec*.
    Returns path to a temp MP3 file, or None on failure.
    """
    try:
        fd, seg_path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)
        subprocess.run(
            ["ffmpeg", "-y",
             "-ss", str(int(start_sec)), "-t", str(int(duration)),
             "-i", audio_path,
             "-acodec", "libmp3lame", "-q:a", "3", seg_path],
            capture_output=True, timeout=30,
        )
        if os.path.getsize(seg_path) > 1024:
            return seg_path
        os.remove(seg_path)
        return None
    except Exception:
        return None


def _segment_positions(duration: float) -> list[float]:
    """Return start-second offsets to try (at most 3 segments)."""
    if duration <= 25:
        return [0]
    if duration <= 50:
        return [0, duration * 0.40]
    return [0, duration * 0.33, duration * 0.66]


# ─────────────────────────────────────────────────────────────────────────────
#  Strategy 1 — Shazam (multi-segment)
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
    """Try Shazam on original file, then on extracted mid/late segments."""
    if not _HAS_SHAZAM:
        return None

    shazam = Shazam()
    duration = _get_duration(audio_path)
    positions = _segment_positions(duration)
    total = len(positions)

    print(f"   🔍 [Shazam] Trying segment 1/{total} (start @0s)…")
    result = await _shazam_recognize_file(shazam, audio_path)
    if result:
        return result

    for i, start in enumerate(positions[1:], start=2):
        print(f"   🔍 [Shazam] Trying segment {i}/{total} (start @{int(start)}s)…")
        seg = _extract_segment(audio_path, start, 20)
        if seg:
            try:
                result = await _shazam_recognize_file(shazam, seg)
            finally:
                try:
                    os.remove(seg)
                except Exception:
                    pass
            if result:
                return result

    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Strategy 2 — AudioTag (audiotag.info)
# ─────────────────────────────────────────────────────────────────────────────

def _audiotag_identify(audio_path: str) -> dict | None:
    """Submit audio to AudioTag and poll for result. Returns result dict or None."""
    if not _HAS_REQUESTS:
        return None
    api_key = _load_audiotag_key()
    if not api_key:
        print("   ⚠️  [AudioTag] No AUDIOTAG_API_KEY set — skipping.")
        return None
    try:
        # Step 1: submit file, get polling token
        with open(audio_path, "rb") as f:
            resp = _requests.post(
                "https://audiotag.info/api",
                data={"action": "identify", "apikey": api_key},
                files={"file": ("audio.mp3", f, "audio/mpeg")},
                timeout=30,
            )
        data = resp.json()
        if not data.get("success"):
            print(f"   ⚠️  [AudioTag] Identify error: {data.get('error', data)}")
            return None
        token = data.get("token")
        if not token:
            return None

        # Step 2: poll until result is ready (max ~30 s)
        import time as _time
        for attempt in range(10):
            _time.sleep(3)
            poll = _requests.post(
                "https://audiotag.info/api",
                data={"action": "getState", "apikey": api_key, "token": token},
                timeout=15,
            ).json()
            state = poll.get("result", "PROCESSING")
            if state == "FOUND":
                found = poll.get("found", [])
                return found[0] if found else None
            if state == "NOT_FOUND":
                return None
            # still PROCESSING — keep polling

        print("   ⚠️  [AudioTag] Timed out waiting for result")
    except Exception as e:
        print(f"   ⚠️  [AudioTag] Request failed: {e}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Result formatters
# ─────────────────────────────────────────────────────────────────────────────

def _format_shazam(result: dict) -> dict:
    track = result["track"]
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

    album = released = label = genre = ""
    for section in track.get("sections", []):
        if section.get("type") == "SONG":
            for meta in section.get("metadata", []):
                t, v = meta.get("title", "").lower(), meta.get("text", "")
                if t == "album":     album    = v
                elif t == "released": released = v
                elif t == "label":   label    = v
    if "genres" in track:
        genre = track["genres"].get("primary", "")

    spotify = ""
    if "hub" in track:
        for p in track["hub"].get("providers", []):
            if p.get("type") == "SPOTIFY":
                spotify = p["actions"][0].get("uri", "")

    return {"title": track.get("title", ""), "artist": artist or "Unknown",
            "album": album, "released": released, "label": label, "genre": genre,
            "shazam_count": track.get("shazamcount", 0),
            "spotify": spotify, "apple": track.get("url", ""), "source": "Shazam"}


def _format_audiotag(result: dict) -> dict:
    artist = result.get("artist", "Unknown") or "Unknown"
    # AudioTag may return a list of artists
    if isinstance(artist, list):
        artist = ", ".join(str(a) for a in artist if a)
    return {"title": result.get("title", ""), "artist": artist,
            "album": result.get("album", ""),
            "released": str(result.get("year", "") or ""),
            "label": "", "genre": result.get("genre", ""),
            "shazam_count": 0,
            "spotify": "", "apple": "", "source": "AudioTag"}


# ─────────────────────────────────────────────────────────────────────────────
#  Output printer  (same visible format as before so main.py parser still works)
# ─────────────────────────────────────────────────────────────────────────────

def _print_result(info: dict) -> None:
    print()
    print("=" * 70)
    print(f"✅ MUSIC IDENTIFIED  [{info['source']}]")
    print("=" * 70)
    print()
    print(f"🎵 Song: {info['title']}")
    print(f"👤 Artist: {info['artist']}")
    if info["album"]:
        print(f"💿 Album: {info['album']}")
    if info["released"]:
        print(f"📅 Released: {info['released']}")
    if info["label"]:
        print(f"🏷️  Label: {info['label']}")
    if info["genre"]:
        print(f"🎸 Genre: {info['genre']}")
    if info["shazam_count"]:
        c = info["shazam_count"]
        fmt = f"{c/1_000_000:.1f}M" if c >= 1_000_000 else (f"{c/1_000:.1f}K" if c >= 1_000 else str(c))
        print(f"🔥 Shazams: {fmt}")
    print()
    print("🔗 LINKS:")
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
    """Identify music from *audio_path* using Shazam (multi-segment) + AudioTag fallback."""

    print("=" * 70)
    print("🎵 MUSIC IDENTIFIER  (Shazam → AudioTag multi-approach)")
    print("=" * 70)
    print()

    path = Path(audio_path)
    if not path.exists():
        print(f"❌ File not found: {audio_path}")
        return

    valid_exts = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".mp4", ".avi", ".mov"}
    if path.suffix.lower() not in valid_exts:
        print(f"❌ Unsupported file type: {path.suffix}")
        return

    print(f"🎧 Analyzing: {path.name}")
    print()

    # ── Strategy 1: Shazam multi-segment ─────────────────────────────────────
    print("🔍 Strategy 1: Shazam (multi-segment)…")
    shazam_result = await _shazam_multi_segment(str(path))
    if shazam_result:
        _print_result(_format_shazam(shazam_result))
        return
    print("   ⚠️  Shazam: no match across all segments")
    print()

    # ── Strategy 2: AudioTag ─────────────────────────────────────────────────
    print("🔍 Strategy 2: AudioTag…")
    at_result = _audiotag_identify(str(path))
    if at_result:
        _print_result(_format_audiotag(at_result))
        return
    print("   ⚠️  AudioTag: no match")
    print()

    print("❌ No match found across all strategies. The audio might be:")

    print("   • Original / unreleased / user-created music")
    print("   • Too short or poor audio quality")
    print("   • In a niche regional catalogue not yet indexed")


# ─────────────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) > 1:
        audio_path = sys.argv[1].strip("\"'").strip()
    else:
        print("=" * 70)
        print("🎵 MUSIC IDENTIFIER  (Shazam → AudioTag multi-approach)")
        print("=" * 70)
        print()
        audio_path = input("📂 Enter audio/video file path: ").strip()

    if not audio_path:
        print("❌ No path provided!")
        return

    asyncio.run(identify_music(audio_path))


if __name__ == "__main__":
    main()
