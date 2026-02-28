#!/usr/bin/env python3
"""
Web Page Analyzer for SuperBrain
==================================
Multi-strategy fetcher with platform-aware content extraction.

Fetch priority chain:
  1. Reddit   → official .json API (no scraping needed)
  2. Medium   → scribe.rip → freedium.cfd proxy chain
  3. newspaper4k → fast article parser, works on most news/blog sites
  4. trafilatura  → best-in-class boilerplate remover, handles forums
  5. Wayback Machine → archive.org snapshot for blocked/paywalled pages
  6. BeautifulSoup → raw HTML last-resort fallback

Thumbnail priority:
  og:image / twitter:image → article first <img> → platform favicon URL → SVG card
"""

import sys
import re
import base64
import json
import time
from pathlib import Path
from urllib.parse import urlparse, urljoin

# Ensure backend root is in sys.path (needed when run as a subprocess)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
#  Prompt template
# ---------------------------------------------------------------------------

_WEB_PROMPT_TPL = """Analyze the following web page content and generate a structured report.

URL: {url}
Page Title: {page_title}

CONTENT:
{content}

---

Generate the report in this EXACT format (use these exact emoji headers):

📌 TITLE:
[Clear descriptive title for this content]

📝 SUMMARY:
[3-5 sentence summary covering: main topic, key information, important facts,
any products/places/tools mentioned, and the overall purpose of the page]

🏷️ TAGS:
[8-12 relevant hashtags/keywords separated by spaces, e.g. #python #tutorial #beginners]

🎵 MUSIC:
[N/A — web page]

📂 CATEGORY:
[Choose exactly ONE from: product, places, recipe, software, book, tv shows, workout, film, event, other]

Be specific and factual. Extract real names, numbers, and details from the content."""


# ---------------------------------------------------------------------------
#  Browser-like headers (shared across all strategies)
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}


# ---------------------------------------------------------------------------
#  Platform detection helpers
# ---------------------------------------------------------------------------

def _netloc(url: str) -> str:
    return urlparse(url).netloc.lower()


def _is_reddit(url: str) -> bool:
    nl = _netloc(url)
    return "reddit.com" in nl or "redd.it" in nl


# Known custom-domain Medium publications (add more as needed)
_MEDIUM_CUSTOM_DOMAINS = {
    "towardsdatascience.com", "bettermarketing.pub", "uxdesign.cc",
    "itnext.io", "betterprogramming.pub", "entrepreneurshandbook.co",
    "theascent.pub", "personal-growth.org", "onezero.medium.com",
    "writingcooperative.com",
}


def _is_medium(url: str) -> bool:
    """medium.com subdomains + custom-domain Medium publications."""
    nl = _netloc(url)
    if "medium.com" in nl:          # covers safeti.medium.com, medium.com, etc.
        return True
    return nl in _MEDIUM_CUSTOM_DOMAINS


def _is_hacker_news(url: str) -> bool:
    return "news.ycombinator.com" in _netloc(url)


# ---------------------------------------------------------------------------
#  Thumbnail helpers
# ---------------------------------------------------------------------------

def _abs_url(src: str, page_url: str) -> str:
    """Convert relative/protocol-relative URL to absolute."""
    if not src:
        return ""
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        p = urlparse(page_url)
        return f"{p.scheme}://{p.netloc}{src}"
    if not src.startswith("http"):
        return urljoin(page_url, src)
    return src


def _get_favicon_url(url: str) -> str:
    """
    Return a Google-served favicon URL for the domain.
    sz=128 returns up to 128x128 PNG — always resolves (falls back to globe icon).
    """
    p = urlparse(url)
    domain = f"{p.scheme}://{p.netloc}"
    return f"https://www.google.com/s2/favicons?sz=128&domain_url={domain}"


_GREY_SVG_COLORS = [
    "#4F46E5", "#0891B2", "#059669", "#D97706",
    "#DC2626", "#7C3AED", "#DB2777", "#0369A1",
]


def _make_svg_placeholder(domain: str) -> str:
    colour = _GREY_SVG_COLORS[sum(ord(c) for c in domain) % len(_GREY_SVG_COLORS)]
    label  = domain[:30]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">'
        f'<rect width="480" height="270" fill="{colour}"/>'
        f'<text x="240" y="135" font-family="system-ui,Arial,sans-serif" '
        f'font-size="22" font-weight="bold" fill="rgba(255,255,255,0.9)" '
        f'text-anchor="middle" dominant-baseline="middle">{label}</text>'
        f'</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _extract_og_image(soup, page_url: str) -> str:
    """og:image → twitter:image → first large <img> in article/main."""
    for prop in ("og:image", "og:image:secure_url"):
        tag = soup.find("meta", property=prop)
        if tag and tag.get("content"):
            return _abs_url(tag["content"].strip(), page_url)
    for name in ("twitter:image", "twitter:image:src"):
        tag = soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return _abs_url(tag["content"].strip(), page_url)
    # First sizable img inside known content containers
    for sel in ("article", "main", '[role="main"]', ".post-content", ".entry-content", ".content"):
        el = soup.select_one(sel)
        if el:
            for img in el.find_all("img", src=True):
                src = _abs_url(img["src"].strip(), page_url)
                # Skip tracking pixels / tiny images
                w = img.get("width", "")
                h = img.get("height", "")
                if w and int(str(w).rstrip("px") or 0) < 50:
                    continue
                if src.startswith("http"):
                    return src
    return ""


def _resolve_thumbnail(soup, page_url: str) -> str:
    """Return best thumbnail: OG image → platform favicon → SVG."""
    og = _extract_og_image(soup, page_url) if soup else ""
    if og:
        return og
    # Use platform favicon (recognisable icon for Medium, Reddit, GitHub, etc.)
    return _get_favicon_url(page_url)


# ---------------------------------------------------------------------------
#  Strategy 1 – Reddit JSON API
# ---------------------------------------------------------------------------

def _fetch_reddit(url: str, timeout: int) -> tuple[str, str, str] | None:
    """
    Use Reddit's undocumented JSON API to get post + top comments.
    Works on any reddit.com/r/.../comments/... URL.
    """
    import requests

    # Normalise: strip query/fragment, ensure .json suffix
    p = urlparse(url)
    clean = f"{p.scheme}://{p.netloc}{p.path.rstrip('/')}/.json"

    r = requests.get(
        clean,
        headers={**_HEADERS, "Accept": "application/json"},
        timeout=timeout,
        allow_redirects=True,
    )
    r.raise_for_status()
    data = r.json()

    # Reddit returns a list of two listings: [post_listing, comments_listing]
    if not (isinstance(data, list) and len(data) >= 1):
        return None

    post_listing = data[0].get("data", {}).get("children", [])
    if not post_listing:
        return None

    post = post_listing[0].get("data", {})
    title     = post.get("title", "")
    selftext  = post.get("selftext", "")     # markdown body of text posts
    url_field = post.get("url", "")          # link posts point here
    author    = post.get("author", "")
    sub       = post.get("subreddit_name_prefixed", "")
    score     = post.get("score", 0)
    thumbnail_url = post.get("thumbnail", "")   # Reddit thumbnail
    preview   = post.get("preview", {}).get("images", [])

    # Better image: use preview image > thumbnail field
    og_image = ""
    if preview:
        try:
            og_image = preview[0]["source"]["url"].replace("&amp;", "&")
        except (KeyError, IndexError):
            pass
    if not og_image and thumbnail_url and thumbnail_url.startswith("http"):
        og_image = thumbnail_url
    if not og_image:
        og_image = _get_favicon_url(url)

    # Collect top-level comments
    comments: list[str] = []
    if len(data) >= 2:
        for child in data[1].get("data", {}).get("children", [])[:10]:
            body = child.get("data", {}).get("body", "").strip()
            if body and body != "[deleted]" and body != "[removed]":
                comments.append(body)

    parts = [f"TITLE: {title}", f"SUBREDDIT: {sub}", f"AUTHOR: u/{author}", f"SCORE: {score}"]
    if selftext:
        parts.append(f"\nPOST BODY:\n{selftext}")
    if url_field and url_field != url:
        parts.append(f"\nLINKED URL: {url_field}")
    if comments:
        parts.append("\nTOP COMMENTS:\n" + "\n---\n".join(comments))

    import datetime as _dt
    post_date = (
        _dt.datetime.utcfromtimestamp(post.get("created_utc", 0)).strftime("%Y-%m-%d")
        if post.get("created_utc") else None
    )
    text = "\n".join(parts)
    return title, text, og_image, author, post_date


# ---------------------------------------------------------------------------
#  Strategy 2 – Medium via open proxy chain
# ---------------------------------------------------------------------------

# Proxies tried left-to-right; {url} is replaced with the full article URL.
_MEDIUM_PROXIES = [
    "https://scribe.rip/{url}",       # scribe mirrors the article cleanly
    "https://freedium.cfd/{url}",     # alternative (sometimes down)
]


def _parse_proxy_page(html: str, orig_url: str) -> tuple[str, str, str]:
    """Extract title/text/thumbnail from a Medium proxy HTML page."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    thumbnail = _resolve_thumbnail(soup, orig_url)

    title = ""
    for prop in ("og:title", "twitter:title"):
        tag = soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})
        if tag and tag.get("content"):
            title = tag["content"].strip()
            break
    if not title and soup.title:
        title = soup.title.get_text(strip=True)

    # Remove boilerplate
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    content_el = (soup.select_one(".main-content") or
                  soup.select_one("article") or
                  soup.select_one('[role="main"]') or
                  soup.find("body"))
    text = (content_el or soup).get_text(separator="\n", strip=True)
    lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) > 15]

    # Extract author from Medium proxy HTML (meta tags first)
    proxy_author = ""
    for _pa in [{"property": "article:author"}, {"name": "author"}, {"name": "twitter:creator"}]:
        _pt = soup.find("meta", attrs=_pa)
        if _pt and _pt.get("content") and _pt["content"].strip().lower() not in ("medium", ""):
            proxy_author = _pt["content"].strip()
            break
    if not proxy_author:
        for _sel in ['a[rel="author"]', ".author", ".byline"]:
            _el = soup.select_one(_sel)
            if _el:
                proxy_author = _el.get_text(strip=True)
                break

    # Extract publish date (meta first)
    proxy_date = None
    _pdt = soup.find("meta", attrs={"property": "article:published_time"})
    if _pdt and _pdt.get("content"):
        _pm = re.search(r'\d{4}-\d{2}-\d{2}', _pdt["content"])
        if _pm:
            proxy_date = _pm.group(0)

    # Scribe.rip byline fallback: a <p> like "AuthorNameon YYYY-MM-DD" or "Author · YYYY-MM-DD"
    # (scribe.rip sometimes concatenates author+date without spacing)
    if not proxy_author or not proxy_date:
        for _bp in soup.find_all("p"):
            _bt = _bp.get_text(strip=True)
            # Pattern: <name>on <date> or <name> on <date>
            _bm = re.match(r'^(.{2,60}?)\s*on\s+(\d{4}-\d{2}-\d{2})\b', _bt, re.IGNORECASE)
            if not _bm:
                _bm = re.match(r'^(.{2,60}?)\s*[·•|]\s*(\d{4}-\d{2}-\d{2})\b', _bt)
            if _bm:
                if not proxy_author:
                    proxy_author = _bm.group(1).strip().rstrip("·•|").strip()
                if not proxy_date:
                    proxy_date = _bm.group(2)
                break

    return title, "\n".join(lines), thumbnail, proxy_author, proxy_date


def _fetch_medium(url: str, timeout: int) -> tuple[str, str, str] | None:
    """
    Try each Medium proxy in order; return first successful result.
    """
    import requests

    for proxy_tpl in _MEDIUM_PROXIES:
        proxy_url = proxy_tpl.format(url=url)
        try:
            print(f"    [medium] Trying {proxy_url[:55]}...")
            r = requests.get(proxy_url, headers=_HEADERS,
                             timeout=timeout, allow_redirects=True)
            r.raise_for_status()
            title, text, thumbnail, auth, pd = _parse_proxy_page(r.text, url)
            if len(text) > 200:
                return title, text, thumbnail, auth, pd
            print(f"    [medium] {proxy_url[:40]} returned too little text")
        except Exception as e:
            print(f"    [medium] {proxy_url[:40]} failed: {e}")

    return None


# ---------------------------------------------------------------------------
#  Strategy – Wayback Machine (emergency fallback for blocked/paywalled URLs)
# ---------------------------------------------------------------------------

def _fetch_wayback(url: str, timeout: int) -> tuple[str, str, str] | None:
    """
    Look up the most recent Wayback Machine snapshot for a URL and fetch it.
    Used as a last resort when all live fetch strategies are blocked (403/429).
    """
    import requests
    import trafilatura

    check = f"https://archive.org/wayback/available?url={url}"
    try:
        resp = requests.get(check, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        snapshot = data.get("archived_snapshots", {}).get("closest", {})
        if not snapshot.get("available"):
            return None
        wb_url = snapshot["url"]
        print(f"    [wayback] Snapshot found: {wb_url[:70]}")
    except Exception as e:
        print(f"    [wayback] Availability check failed: {e}")
        return None

    try:
        r = requests.get(wb_url, headers=_HEADERS, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        html = r.text
    except Exception as e:
        print(f"    [wayback] Fetch failed: {e}")
        return None

    # Use trafilatura for clean extraction from cached HTML
    try:
        text = trafilatura.extract(html, url=url,
                                   include_comments=True, favor_recall=True) or ""
        meta     = trafilatura.extract_metadata(html, default_url=url)
        title    = (meta.title  if meta else "") or ""
        og_image = (meta.image  if meta else "") or ""
        wb_a     = (meta.author if meta else "") or ""
        wb_d     = (meta.date   if meta else "") or ""
    except Exception:
        text = ""; title = ""; og_image = ""; wb_a = ""; wb_d = ""

    if not og_image:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "lxml")
            og_image = _resolve_thumbnail(soup, url)
        except Exception:
            og_image = _get_favicon_url(url)

    wb_date = None
    if wb_d:
        _wm = re.search(r'\d{4}-\d{2}-\d{2}', str(wb_d))
        if _wm:
            wb_date = _wm.group(0)

    return (title, text, og_image, wb_a, wb_date) if len(text) > 100 else None


# ---------------------------------------------------------------------------
#  Strategy 3 – newspaper4k
# ---------------------------------------------------------------------------

def _fetch_newspaper(url: str, timeout: int) -> tuple[str, str, str] | None:
    """
    newspaper4k (maintained fork of newspaper3k) — excellent for news articles,
    blog posts, and most standard editorial pages.
    """
    try:
        from newspaper import Article, Config
    except ImportError:
        return None

    cfg = Config()
    cfg.browser_user_agent = _HEADERS["User-Agent"]
    cfg.request_timeout    = timeout
    cfg.fetch_images       = False
    cfg.memoize_articles   = False

    article = Article(url, config=cfg)
    article.download()
    article.parse()

    title     = article.title or ""
    text      = article.text  or ""
    top_image = article.top_image or ""

    if not top_image:
        # Try to get it from meta via soup
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(article.html or "", "lxml")
            top_image = _resolve_thumbnail(soup, url)
        except Exception:
            top_image = _get_favicon_url(url)

    # Extract author and publish date from newspaper4k
    np_author = ""
    if hasattr(article, 'authors') and article.authors:
        np_author = article.authors[0]
    np_date = None
    if hasattr(article, 'publish_date') and article.publish_date:
        try:
            _npd = article.publish_date
            if hasattr(_npd, 'strftime'):
                np_date = _npd.strftime("%Y-%m-%d")
            else:
                _npm = re.search(r'\d{4}-\d{2}-\d{2}', str(_npd))
                if _npm:
                    np_date = _npm.group(0)
        except Exception:
            pass

    return (title, text, top_image, np_author, np_date) if len(text) > 200 else None


# ---------------------------------------------------------------------------
#  Strategy 4 – trafilatura
# ---------------------------------------------------------------------------

def _fetch_trafilatura(url: str, timeout: int) -> tuple[str, str, str] | None:
    """
    trafilatura — state-of-the-art main-content extractor.
    Handles forums, comment threads, Hacker News, Stack Overflow, etc.
    """
    try:
        import trafilatura
        from trafilatura.settings import use_config
    except ImportError:
        return None

    # Download with our headers
    import requests
    r = requests.get(url, headers=_HEADERS, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    html = r.text

    # Extract with trafilatura
    extracted = trafilatura.extract(
        html,
        url=url,
        include_comments=True,
        include_tables=True,
        no_fallback=False,
        favor_recall=True,   # better for forums/threads
    )

    if not extracted or len(extracted) < 200:
        return None

    # Get metadata (title + image) via trafilatura's metadata extractor
    meta     = trafilatura.extract_metadata(html, default_url=url)
    title    = (meta.title  if meta else "") or ""
    og_image = (meta.image  if meta else "") or ""
    traf_a   = (meta.author if meta else "") or ""
    traf_d   = (meta.date   if meta else "") or ""
    if not og_image:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "lxml")
            og_image = _resolve_thumbnail(soup, url)
        except Exception:
            og_image = _get_favicon_url(url)

    traf_date = None
    if traf_d:
        _tm = re.search(r'\d{4}-\d{2}-\d{2}', str(traf_d))
        if _tm:
            traf_date = _tm.group(0)

    return title, extracted, og_image, traf_a, traf_date


# ---------------------------------------------------------------------------
#  Strategy 5 – BeautifulSoup (original reliable fallback)
# ---------------------------------------------------------------------------

def _fetch_beautifulsoup(url: str, timeout: int) -> tuple[str, str, str]:
    """Pure BeautifulSoup fallback — always produces *something*."""
    import requests

    r = requests.get(url, headers=_HEADERS, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    html = r.text

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

    thumbnail = _resolve_thumbnail(soup, url)

    title = ""
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        title = og["content"].strip()
    elif soup.title:
        title = soup.title.get_text(strip=True)
    elif soup.find("h1"):
        title = soup.find("h1").get_text(strip=True)

    for tag in soup(["script", "style", "nav", "header", "footer", "aside",
                     "form", "button", "noscript", "iframe", "svg"]):
        tag.decompose()

    text = ""
    for sel in ["article", "main", '[role="main"]', ".post-content",
                ".article-body", ".entry-content", ".content", "#content", ".post", "#main"]:
        el = soup.select_one(sel)
        if el:
            text = el.get_text(separator="\n", strip=True)
            break
    if not text:
        body = soup.find("body")
        text = (body or soup).get_text(separator="\n", strip=True)

    # Extract author and date from meta/JSON-LD
    bs_author = ""
    for _ba in [{"property": "article:author"}, {"name": "author"}, {"name": "dc.creator"}]:
        _bm = soup.find("meta", attrs=_ba)
        if _bm and _bm.get("content"):
            bs_author = _bm["content"].strip()
            break
    bs_date = None
    for _ba in [{"property": "article:published_time"}, {"name": "datePublished"},
                {"itemprop": "datePublished"}]:
        _bm = soup.find("meta", attrs=_ba)
        if _bm and _bm.get("content"):
            _bdm = re.search(r'\d{4}-\d{2}-\d{2}', _bm["content"])
            if _bdm:
                bs_date = _bdm.group(0)
            break
    if not bs_date:
        for _bt in soup.find_all("time", attrs={"datetime": True}):
            if re.match(r'\d{4}-\d{2}-\d{2}', _bt["datetime"]):
                bs_date = _bt["datetime"][:10]
                break

    return title, text, thumbnail, bs_author, bs_date


# ---------------------------------------------------------------------------
#  Public: fetch_page_text
# ---------------------------------------------------------------------------

def fetch_page_text(url: str, timeout: int = 20) -> tuple[str, str, str, str, str | None]:
    """
    Fetch a web page with a multi-strategy pipeline and return
    (title, text, thumbnail, author, post_date).

    Strategy order:
      Reddit JSON API → Medium proxies (scribe.rip/freedium) →
      newspaper4k → trafilatura → Wayback Machine → BeautifulSoup
    """

    def _clean(text: str) -> str:
        lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) > 10]
        words = " ".join(lines).split()
        if len(words) > 5000:
            return " ".join(words[:5000]) + "\n[... content truncated ...]"
        return "\n".join(lines)

    # 1 — Reddit
    if _is_reddit(url):
        print("    [fetch] Reddit JSON API")
        try:
            result = _fetch_reddit(url, timeout)
            if result and result[1].strip():
                t, txt, thumb, auth, pd = result
                return t, _clean(txt), thumb, auth, pd
        except Exception as e:
            print(f"    [fetch] Reddit failed: {e}")

    # 2 — Medium (multi-proxy)
    if _is_medium(url):
        print("    [fetch] Medium proxies (scribe.rip → freedium.cfd)")
        try:
            result = _fetch_medium(url, timeout)
            if result and result[1].strip():
                t, txt, thumb, auth, pd = result
                return t, _clean(txt), thumb, auth, pd
        except Exception as e:
            print(f"    [fetch] All Medium proxies failed: {e}")

    blocked_error: str = ""

    # 3 — newspaper4k (best for standard articles)
    print("    [fetch] newspaper4k")
    try:
        result = _fetch_newspaper(url, timeout)
        if result and result[1].strip():
            t, txt, thumb, auth, pd = result
            return t, _clean(txt), thumb, auth, pd
    except Exception as e:
        print(f"    [fetch] newspaper4k failed: {e}")
        if "403" in str(e) or "401" in str(e) or "Forbidden" in str(e):
            blocked_error = str(e)

    # 4 — trafilatura (best for forums / comment-heavy pages)
    print("    [fetch] trafilatura")
    try:
        result = _fetch_trafilatura(url, timeout)
        if result and result[1].strip():
            t, txt, thumb, auth, pd = result
            return t, _clean(txt), thumb, auth, pd
    except Exception as e:
        print(f"    [fetch] trafilatura failed: {e}")
        if "403" in str(e) or "401" in str(e) or "Forbidden" in str(e):
            blocked_error = str(e)

    # 5 — Wayback Machine (when site blocks scrapers)
    if blocked_error or _is_medium(url):
        print("    [fetch] Wayback Machine (site appears blocked)")
        try:
            result = _fetch_wayback(url, timeout)
            if result and result[1].strip():
                t, txt, thumb, auth, pd = result
                return t, _clean(txt), thumb, auth, pd
        except Exception as e:
            print(f"    [fetch] Wayback Machine failed: {e}")

    # 6 — BeautifulSoup raw fallback
    print("    [fetch] BeautifulSoup fallback")
    t, txt, thumb, auth, pd = _fetch_beautifulsoup(url, timeout)
    return t, _clean(txt), thumb, auth, pd


# ---------------------------------------------------------------------------
#  Core analyzer (public API)
# ---------------------------------------------------------------------------

def analyze_webpage(url: str) -> dict:
    """
    Fetch and analyze a web page via ModelRouter text models.

    Returns:
        dict: raw_output, page_title, thumbnail, error
    """
    print("  🌐 Fetching web page...")

    try:
        page_title, content, thumbnail, page_author, page_date = fetch_page_text(url)
        summary_title = f"'{page_title[:70]}'" if page_title else "(no title)"
        print(f"  ✓ Fetched: {summary_title}")
        if thumbnail.startswith("data:"):
            print("  🖼️  Using SVG placeholder (no image found)")
        elif "google.com/s2/favicons" in thumbnail:
            print(f"  🖼️  Using platform favicon: {_netloc(url)}")
        else:
            print(f"  🖼️  Thumbnail: {thumbnail[:80]}")
    except Exception as e:
        return {"raw_output": "", "page_title": "", "thumbnail": "",
                "author": "", "post_date": None,
                "error": f"Failed to fetch page: {e}"}

    if not content.strip():
        return {"raw_output": "", "page_title": page_title, "thumbnail": thumbnail,
                "author": page_author, "post_date": page_date,
                "error": "No readable text content found on the page"}

    prompt = _WEB_PROMPT_TPL.format(
        url=url,
        page_title=page_title or "Unknown",
        content=content[:8000],
    )

    print("  🤖 Analyzing page content with AI...")

    try:
        from core.model_router import get_router
        raw_output = get_router().generate_text(prompt)
        print("  ✓ Web page analysis complete")
        return {"raw_output": raw_output, "page_title": page_title,
                "thumbnail": thumbnail, "author": page_author,
                "post_date": page_date, "error": None}
    except Exception as e:
        return {"raw_output": "", "page_title": page_title, "thumbnail": thumbnail,
                "author": page_author, "post_date": page_date,
                "error": f"AI analysis failed: {e}"}


# ---------------------------------------------------------------------------
#  CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else input("Web page URL: ").strip()
    if url:
        result = analyze_webpage(url)
        if result["error"]:
            print(f"\n✗ Error: {result['error']}")
        else:
            print("\n" + "=" * 60)
            print(f"[thumbnail] {result['thumbnail'][:100]}")
            print("=" * 60)
            print(result["raw_output"])


