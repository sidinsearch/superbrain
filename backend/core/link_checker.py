#!/usr/bin/env python3
"""
Universal Link Validator for SuperBrain
========================================
Detects and validates Instagram, YouTube, and general web page URLs.

Returns a unified dict with:
  content_type : 'instagram' | 'youtube' | 'webpage'
  shortcode    : DB primary key
                   Instagram → original shortcode  (e.g. DUQD-t2DC1D)
                   YouTube   → YT_<video_id>       (e.g. YT_dQw4w9WgXcW)
                   Webpage   → WP_<sha256[:16]>    (e.g. WP_a1b2c3d4e5f6a7b8)
  video_id     : YouTube video ID (YouTube only, else None)
  valid        : bool
  error        : str | None
  url          : cleaned URL
"""

import re
import hashlib
from urllib.parse import urlparse, parse_qs


# ─────────────────────────────────────────────────────────────────────────────
#  Instagram
# ─────────────────────────────────────────────────────────────────────────────

def _validate_instagram(url: str, parsed) -> dict:
    """Returns validate_link result for an Instagram URL, or None if not Instagram."""
    if parsed.netloc not in (
        "instagram.com", "www.instagram.com", "instagr.am", "www.instagr.am"
    ):
        return None

    match = re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", parsed.path)
    if not match:
        return {
            "valid": False, "content_type": "instagram",
            "shortcode": None, "video_id": None,
            "error": "Not a valid Instagram post/reel/video URL", "url": url,
        }

    shortcode = match.group(1)
    if not re.match(r"^[A-Za-z0-9_-]+$", shortcode):
        return {
            "valid": False, "content_type": "instagram",
            "shortcode": None, "video_id": None,
            "error": "Invalid Instagram shortcode format", "url": url,
        }

    return {
        "valid": True, "content_type": "instagram",
        "shortcode": shortcode, "video_id": None,
        "error": None, "url": url,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  YouTube
# ─────────────────────────────────────────────────────────────────────────────

_YT_DOMAINS = (
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
)


def _extract_youtube_id(url: str, parsed) -> str | None:
    """Extract video ID from any known YouTube URL format."""
    netloc = parsed.netloc.lower()
    if netloc not in _YT_DOMAINS:
        return None

    path = parsed.path
    qs = parse_qs(parsed.query)

    # youtu.be/<id>
    if "youtu.be" in netloc:
        m = re.match(r"^/([A-Za-z0-9_-]{11})", path)
        return m.group(1) if m else None

    # /watch?v=<id>
    if "/watch" in path and "v" in qs:
        return qs["v"][0]

    # /shorts/<id>  or  /embed/<id>  or  /v/<id>  or  /live/<id>
    m = re.match(r"^/(?:shorts|embed|v|live|e)/([A-Za-z0-9_-]{11})", path)
    if m:
        return m.group(1)

    return None


def _validate_youtube(url: str, parsed) -> dict | None:
    """Returns validate_link result for a YouTube URL, or None if not YouTube."""
    video_id = _extract_youtube_id(url, parsed)
    if video_id is None:
        return None

    clean_url = f"https://www.youtube.com/watch?v={video_id}"
    return {
        "valid": True, "content_type": "youtube",
        "shortcode": f"YT_{video_id}", "video_id": video_id,
        "error": None, "url": clean_url,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Generic web page
# ─────────────────────────────────────────────────────────────────────────────

def _make_page_id(url: str) -> str:
    """Deterministic 16-char ID derived from the URL (sha256 hex prefix)."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _validate_webpage(url: str, parsed) -> dict:
    """Always returns a validate_link result for any http/https URL."""
    if parsed.scheme not in ("http", "https"):
        return {
            "valid": False, "content_type": "webpage",
            "shortcode": None, "video_id": None,
            "error": "URL must use http or https", "url": url,
        }
    if not parsed.netloc:
        return {
            "valid": False, "content_type": "webpage",
            "shortcode": None, "video_id": None,
            "error": "Invalid URL — no domain found", "url": url,
        }

    page_id = _make_page_id(url)
    return {
        "valid": True, "content_type": "webpage",
        "shortcode": f"WP_{page_id}", "video_id": None,
        "error": None, "url": url,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

def validate_link(url: str) -> dict:
    """
    Validate any URL and detect its content type.

    Returns:
        {
            'valid'        : bool,
            'content_type' : 'instagram' | 'youtube' | 'webpage',
            'shortcode'    : str | None,   # DB primary key
            'video_id'     : str | None,   # YouTube video ID only
            'error'        : str | None,
            'url'          : str,
        }
    """
    if not url or not isinstance(url, str):
        return {
            "valid": False, "content_type": "webpage",
            "shortcode": None, "video_id": None,
            "error": "Empty or invalid URL", "url": url or "",
        }

    url = url.strip()

    try:
        parsed = urlparse(url)
    except Exception as e:
        return {
            "valid": False, "content_type": "webpage",
            "shortcode": None, "video_id": None,
            "error": f"Invalid URL format: {e}", "url": url,
        }

    result = _validate_instagram(url, parsed)
    if result is not None:
        return result

    result = _validate_youtube(url, parsed)
    if result is not None:
        return result

    return _validate_webpage(url, parsed)


# Backward-compat shim for code that still calls is_valid_instagram_link()
def is_valid_instagram_link(url: str):
    """Legacy function. Prefer validate_link()."""
    r = validate_link(url)
    if r["content_type"] != "instagram":
        return False, None, "Not an Instagram URL"
    return r["valid"], r["shortcode"], r["error"]


# ─────────────────────────────────────────────────────────────────────────────
#  CLI test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    test_urls = [
        "https://www.instagram.com/reel/DUQD-t2DC1D/",
        "https://www.instagram.com/p/DRWKk5JiL0h/",
        "https://www.youtube.com/watch?v=dQw4w9WgXcW",
        "https://youtu.be/dQw4w9WgXcW",
        "https://www.youtube.com/shorts/ab12cd34ef5",
        "https://techcrunch.com/2024/01/01/some-article/",
        "https://www.instagram.com/username/",   # invalid IG (no post path)
        "not-a-url",
    ]
    print("=" * 70)
    for u in test_urls:
        r = validate_link(u)
        icon = "✓" if r["valid"] else "✗"
        print(f"{icon} [{r['content_type']:<9}] shortcode={str(r['shortcode']):<28} | {u}")
