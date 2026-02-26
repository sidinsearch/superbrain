#!/usr/bin/env python3
"""
YouTube Video Analyzer for SuperBrain
=======================================
Uses Gemini's native YouTube URL understanding — no download, no audio
transcription, no frame extraction. One API call → full structured analysis.

The google.genai SDK passes the YouTube URL directly to Gemini which can
watch, listen, and read the video natively at Google's data centre.
"""

import os
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

API_KEYS_FILE = Path(__file__).resolve().parent.parent / "config" / ".api_keys"

# ── Prompt ────────────────────────────────────────────────────────────────────

YOUTUBE_PROMPT = """Watch this YouTube video carefully and write a structured analysis report.

Generate the report in this EXACT format (use these exact emoji headers):

📌 TITLE:
[The actual video title, or a clear descriptive title if you can't read it]

� CHANNEL:
[The YouTube channel name or creator/uploader name]

📅 DATE:
[Upload date in YYYY-MM-DD format if visible or known. Otherwise write "Unknown"]

�📝 SUMMARY:
[Comprehensive 3-5 sentence summary covering: main topic/theme, key points and
information shared, any products/places/tools/tips mentioned, who this content
is for, and the overall value or takeaway]

🏷️ TAGS:
[Generate 8-12 relevant hashtags/keywords separated by spaces, e.g. #dji #drone #aerial]

🎵 MUSIC:
[Name specific background music or songs heard in the video. If there is no
identifiable background music, write "No background music". If it's voiceover
only, write "Voiceover only".]

📂 CATEGORY:
[Choose exactly ONE from: product, places, recipe, software, book, tv shows, workout, film, event, other]

Be specific, accurate, and extractive — pull out real names, numbers, and facts from the video."""


# ── Thumbnail helper ─────────────────────────────────────────────────────

def _extract_video_id(youtube_url: str) -> str:
    """Extract the 11-char video ID from any YouTube URL format."""
    parsed = urlparse(youtube_url)
    qs = parse_qs(parsed.query)
    if "youtu.be" in parsed.netloc:
        return parsed.path.lstrip("/").split("/")[0]
    if "v" in qs:
        return qs["v"][0]
    m = re.match(r"^/(?:shorts|embed|v|live|e)/([A-Za-z0-9_-]{11})", parsed.path)
    return m.group(1) if m else ""


def _parse_yt_field(raw: str, label: str) -> str:
    """Extract a single-line field value from YouTube Gemini output.
    Handles emoji/no-emoji and markdown bold variants.
    """
    pattern = re.compile(
        rf'(?:^|\n)\s*\S*\s*\*{{0,2}}{re.escape(label)}\*{{0,2}}:?\s*([^\n]+)',
        re.IGNORECASE,
    )
    m = pattern.search(raw)
    return m.group(1).strip().strip("*").strip() if m else ""


def get_youtube_channel_name(url: str, ai_raw: str = "") -> str:
    """
    Multi-stage robust YouTube channel name extractor.

    Stages (tried in order, returns first non-empty result):
      1. oEmbed API   — fast, no auth, reliable for public videos
      2. HTML scrape  — parses itemprop/JSON-LD metadata from the watch page
      3. yt-dlp       — subprocess call (if yt-dlp is installed)
      4. AI output    — value parsed from Gemini's CHANNEL field in *ai_raw*
    """
    import requests, subprocess, json as _json, shutil

    # ── Stage 1: oEmbed (fastest, no auth) ───────────────────────────────
    try:
        r = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=8,
        )
        if r.ok:
            name = r.json().get("author_name", "").strip()
            if name:
                return name
    except Exception:
        pass

    # ── Stage 2: HTML meta scrape ─────────────────────────────────────────
    try:
        r = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=10,
        )
        text = r.text
        # JSON-LD: "author":{"@type":"Person","name":"Channel Name"}
        m = re.search(r'"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', text)
        if m:
            return m.group(1).strip()
        # itemprop channel
        m = re.search(r'itemprop="author"[^>]*>\s*<[^>]*itemprop="name"[^>]*content="([^"]+)"', text)
        if m:
            return m.group(1).strip()
        # ytInitialData ownerText
        m = re.search(r'"ownerText"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([^"]+)"', text)
        if m:
            return m.group(1).strip()
    except Exception:
        pass

    # ── Stage 3: yt-dlp subprocess ────────────────────────────────────────
    if shutil.which("yt-dlp"):
        try:
            result = subprocess.run(
                ["yt-dlp", "--print", "channel", "--no-download", "--quiet", url],
                capture_output=True, text=True, timeout=20,
            )
            name = result.stdout.strip()
            if name:
                return name
        except Exception:
            pass

    # ── Stage 4: AI-parsed fallback ───────────────────────────────────────
    if ai_raw:
        name = _parse_yt_field(ai_raw, "CHANNEL")
        if name:
            return name

    return ""


def get_youtube_upload_date(youtube_url: str) -> str | None:
    """
    Scrape the actual upload date from YouTube's page HTML.
    Returns 'YYYY-MM-DD' string or None on failure.
    """
    try:
        import requests
        r = requests.get(
            youtube_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=10,
        )
        for pattern in (
            r'"uploadDate":"(\d{4}-\d{2}-\d{2})',
            r'"publishDate":"(\d{4}-\d{2}-\d{2})',
            r'<meta itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})',
        ):
            m = re.search(pattern, r.text)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


def get_youtube_thumbnail(youtube_url: str) -> str:
    """
    Return the best available thumbnail URL for a YouTube video.
    Tries maxresdefault (1280x720) first, falls back to hqdefault (480x360).
    The returned string is always a direct HTTPS URL — no download needed.
    """
    video_id = _extract_video_id(youtube_url)
    if not video_id:
        return ""

    # Verify maxresdefault exists (some older videos only have hqdefault)
    maxres = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
    hq     = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
    try:
        import requests
        r = requests.head(maxres, timeout=5)
        # YouTube returns a tiny 120x90 stub with 200 when maxres is unavailable
        # Real maxres images are much larger; check content-length as a signal
        cl = int(r.headers.get("content-length", 0))
        return maxres if (r.status_code == 200 and cl > 5000) else hq
    except Exception:
        return hq


# ── Key loader ─────────────────────────────────────────────────────────────────

def _load_gemini_key() -> str:
    creds: dict[str, str] = {}
    if API_KEYS_FILE.exists():
        for line in API_KEYS_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                creds[k.strip()] = v.strip()
    return creds.get("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY", "")


# ── Model fallback chain (supports YouTube video natively) ──────────────────────

# Tried left-to-right; on 429 we parse the retry-after delay and honour it once.
# Only Gemini 2.x+ models support YouTube URL as a native video part via v1beta.
_GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
]


def _parse_retry_after(err_str: str) -> float:
    """Extract retry delay seconds from a Gemini 429 error string."""
    m = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)", err_str)
    if m:
        return float(m.group(1))
    m = re.search(r"retry in (\d+(?:\.\d+)?)s", err_str)
    if m:
        return float(m.group(1))
    return 0.0


# ── Core analysis ──────────────────────────────────────────────────────────────

def analyze_youtube(youtube_url: str) -> dict:
    """
    Analyze a YouTube video using Gemini's native YouTube URL support.
    Tries each model in _GEMINI_MODELS; on 429 waits the retry-after period
    (capped at 65 s) before falling through to the next model.

    Returns:
        dict with keys: raw_output (str), channel (str), thumbnail (str), error (str|None)
    """
    import time

    gemini_key = _load_gemini_key()
    if not gemini_key:
        return {"raw_output": "", "channel": "", "thumbnail": "",
                "error": "GEMINI_API_KEY not found. Add it to backend/.api_keys"}

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return {"raw_output": "", "channel": "", "thumbnail": "",
                "error": "google-genai not installed. Run: pip install google-genai"}

    client = genai.Client(api_key=gemini_key)
    last_error = ""

    for model in _GEMINI_MODELS:
        print(f"  🎬 Trying {model} for YouTube analysis...")
        try:
            response = client.models.generate_content(
                model=model,
                contents=[
                    gtypes.Part.from_uri(
                        file_uri=youtube_url,
                        mime_type="video/youtube",
                    ),
                    YOUTUBE_PROMPT,
                ],
                config=gtypes.GenerateContentConfig(
                    max_output_tokens=1500,
                    temperature=0.7,
                ),
            )
            raw = response.text.strip()
            thumbnail  = get_youtube_thumbnail(youtube_url)
            post_date  = get_youtube_upload_date(youtube_url)
            # Robust multi-stage channel extraction
            channel = get_youtube_channel_name(youtube_url, ai_raw=raw)
            info = f" | channel: {channel}" if channel else ""
            dp   = f" | date: {post_date}" if post_date else ""
            print(f"  ✓ Gemini YouTube analysis complete (model: {model}){info}{dp}")
            return {"raw_output": raw, "channel": channel, "thumbnail": thumbnail,
                    "post_date": post_date, "error": None}

        except Exception as e:
            err = str(e)
            last_error = err
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                wait = min(_parse_retry_after(err), 65.0)
                if wait > 0:
                    print(f"  ⏳ {model} rate-limited — waiting {wait:.0f}s before next model...")
                    time.sleep(wait)
                else:
                    print(f"  ⚠️  {model} quota exhausted — trying next model")
            else:
                # Non-quota error (e.g. 404 model not found) — try next model
                print(f"  ✗ {model} failed: {err[:120]}")

    print(f"  ✗ All Gemini models exhausted for YouTube analysis")
    return {"raw_output": "", "channel": "", "thumbnail": "", "post_date": None, "error": last_error}


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else input("YouTube URL: ").strip()
    if url:
        result = analyze_youtube(url)
        if result["error"]:
            print(f"\n✗ Error: {result['error']}")
        else:
            print("\n" + "=" * 60)
            print(result["raw_output"])
