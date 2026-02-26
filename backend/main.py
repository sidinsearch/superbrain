#!/usr/bin/env python3
"""
SuperBrain - Instagram Content Analyzer
Main orchestrator that coordinates all analysis scripts
With parallel processing for better performance
"""

import sys
import os
from pathlib import Path
import subprocess
import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

# Import local modules
from core.link_checker import validate_link
from core.database import get_db
from analyzers.youtube_analyzer import analyze_youtube
from analyzers.webpage_analyzer import analyze_webpage

# Sentinel returned by run_*_analysis when the item has been queued for retry
RETRY_SENTINEL = "__ENQUEUED_FOR_RETRY__"

# Keywords that indicate a retryable quota / rate-limit failure
_QUOTA_KEYWORDS = (
    "resource_exhausted", "quota", "rate_limit", "rate limit",
    "429", "too many requests", "daily limit", "free tier",
    "insufficient_quota", "ratelimit", "all gemini models exhausted",
)

def _is_quota_error(err: str) -> bool:
    """Return True when an error string looks like a recoverable quota / rate-limit."""
    low = err.lower()
    return any(k in low for k in _QUOTA_KEYWORDS)

def print_header(title):
    """Print section header"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80 + "\n")

def print_section(title):
    """Print subsection"""
    print(f"\n{'─' * 80}")
    print(f"  {title}")
    print('─' * 80 + "\n")

def generate_final_summary(results, instagram_url):
    """Generate comprehensive summary using all analysis results via ModelRouter."""
    from core.model_router import get_router

    # Collect all analysis data
    visual_summary = ""
    audio_summary = ""
    music_info = ""
    text_summary = ""
    
    # Extract visual analysis
    if results['visual']:
        visual_summary = "VISUAL ANALYSIS:\n"
        for item in results['visual']:
            output = item['output']
            clean = _clean_visual(output)
            if clean:
                visual_summary += f"- {clean[:600]}\n"
    
    # Extract audio transcription
    if results['audio_transcription']:
        audio_summary = "AUDIO TRANSCRIPTION:\n"
        for item in results['audio_transcription']:
            output = item['output']
            clean = _clean_audio(output)
            lang = output.split('Detected Language:')[1].split('(')[0].strip() if 'Detected Language:' in output else 'Unknown'
            audio_summary += f"- Language: {lang}\n"
            if clean:
                audio_summary += f"- Content: {clean[:400]}\n"
    
    # Extract music identification
    if results['music_identification']:
        music_info = "MUSIC:\n"
        for item in results['music_identification']:
            output = item['output']
            if '🎵 Song:' in output:
                song = output.split('🎵 Song:')[1].split('\n')[0].strip()
                artist = output.split('👤 Artist:')[1].split('\n')[0].strip() if '👤 Artist:' in output else 'Unknown'
                music_info += f"- {song} by {artist}\n"
            elif 'No match found' in output:
                music_info += "- No music identified (likely voiceover/no background music)\n"
    
    # Extract text analysis
    if results['text']:
        text_summary = "TEXT ANALYSIS:\n"
        for item in results['text']:
            clean = _clean_text(item['output'])
            if clean:
                text_summary += f"{clean[:600]}\n"
    
    # Combine all information
    combined_info = f"""
INSTAGRAM POST: {instagram_url}

{visual_summary}

{audio_summary}

{music_info}

{text_summary}
"""
    
    # Generate structured summary using LLM
    prompt = f"""Based on the following analysis of an Instagram post, create a comprehensive structured summary.

{combined_info}

Generate a report in this EXACT format:

📌 TITLE:
[Create a clear, descriptive title]

📝 SUMMARY:
[Comprehensive 3-5 sentence summary including:
- Main content/theme
- Key information (locations, products, tips, itineraries, lists, tools, links, etc.)
- Important highlights
- Any actionable items or recommendations]

🏷️ TAGS:
[Generate 8-12 relevant hashtags/keywords]

🎵 MUSIC:
[Music/song name if found, or "No background music" or "Voiceover only"]

📂 CATEGORY:
[Choose ONE from: product, places, recipe, software, book, tv shows, workout, film, event]

Be specific, concise, and actionable. Focus on useful information."""

    try:
        print("🤖 Generating comprehensive summary with AI...")
        router = get_router()
        summary = router.generate_text(prompt)

        if not summary:
            summary = "Unable to generate comprehensive summary."

        return summary

    except Exception as e:
        return f"Error generating summary: {e}\n\nRaw data available in individual analysis sections above."

def _parse_field(text: str, emoji: str, label: str) -> str:
    """
    Extract a field value from AI output — handles all common AI formatting variations:
      📌 TITLE: value
      📌 **TITLE:** value
      📌 **TITLE**  \n  value
    Also handles emoji variation selectors (U+FE0F) that may or may not be present.
    Returns the first non-empty content after the label, stopped at the next
    section emoji line or blank-line boundary.
    """
    # Strip variation selector from emoji so pattern works whether or not it's present
    emoji_base = emoji.replace('\ufe0f', '')
    pattern = re.compile(
        rf'{re.escape(emoji_base)}\ufe0f?\s*\*{{0,2}}{re.escape(label)}\*{{0,2}}:?\s*',
        re.IGNORECASE
    )
    m = pattern.search(text)
    # Fallback: model may output U+FFFD instead of the emoji (encoding mangling)
    if not m:
        pattern_fb = re.compile(
            rf'\ufffd\s*\*{{0,2}}{re.escape(label)}\*{{0,2}}:?\s*',
            re.IGNORECASE
        )
        m = pattern_fb.search(text)
    if not m:
        return ""
    after = text[m.end():]
    # Collect until next section (identified by an emoji at line start) or 2 blank lines
    lines = after.split('\n')
    content_lines = []
    for line in lines:
        stripped = line.strip()
        # Stop at next section header — match ANY emoji/symbol at line start,
        # OR a U+FFFD replacement char (model sometimes mangles lower-plane emojis)
        if content_lines and re.match(
            r'^[\U0001F000-\U0001FFFF\U00002600-\U000027BF\U00002B00-\U00002BFF\uFFFD]',
            stripped,
        ):
            break
        # Skip pure markdown bold/italic wrapper lines but keep the text
        content_lines.append(re.sub(r'\*{1,3}([^*]+?)\*{1,3}', r'\1',
                                      re.sub(r'^\*{1,3}|\*{1,3}$', '', stripped)))
    # Remove leading/trailing blank lines and join
    result = ' '.join(l for l in content_lines if l).strip()
    # Strip surrounding markdown bold (**)
    result = re.sub(r'^\*+|\*+$', '', result).strip('"').strip()
    return result


def parse_summary(summary_text):
    """
    Parse AI-generated summary to extract structured data.
    Robust against markdown bold, missing colons, varied whitespace.

    Returns:
        tuple: (title, summary, tags, music, category)
    """
    title = ""
    summary = ""
    tags = []
    music = ""
    category = ""

    try:
        title   = _parse_field(summary_text, "📌", "TITLE")
        summary = _parse_field(summary_text, "📝", "SUMMARY")
        music   = _parse_field(summary_text, "🎵", "MUSIC")

        # Tags: grab block then split on whitespace/commas
        raw_tags = _parse_field(summary_text, "🏷️", "TAGS")
        if not raw_tags:  # try without variation selector
            raw_tags = _parse_field(summary_text, "🏷", "TAGS")
        if not raw_tags:  # model sometimes omits emoji entirely
            _tm = re.search(r'(?:^|\n)\s*\*{0,2}TAGS\*{0,2}:?\s*([^\n]+)', summary_text, re.IGNORECASE)
            if _tm:
                raw_tags = _tm.group(1).strip()
        if raw_tags:
            tags = [t.strip() for t in re.split(r'[\s,]+', raw_tags) if t.strip()]

        # Category: grab first word/phrase that matches a known category
        raw_cat = _parse_field(summary_text, "📂", "CATEGORY").lower()
        # Strip markdown bold leftovers and pick first line
        raw_cat = re.sub(r'\*+', '', raw_cat).strip()
        raw_cat = raw_cat.split('\n')[0].strip()
        category = raw_cat

    except Exception as e:
        print(f"⚠️ Error parsing summary: {e}")

    # Fallback: Auto-detect category if empty or unrecognised
    valid_categories = {'product', 'places', 'recipe', 'software', 'book',
                        'tv shows', 'workout', 'film', 'event', 'other'}
    if not category or category not in valid_categories:
        category = auto_detect_category(summary_text, title, summary, tags)

    return title, summary, tags, music, category

def auto_detect_category(summary_text, title, summary, tags):
    """
    Auto-detect category based on content keywords
    
    Returns:
        str: Detected category
    """
    combined = f"{title} {summary} {' '.join(tags)} {summary_text}".lower()
    
    # Category keywords
    category_keywords = {
        'product': ['camera', 'device', 'gadget', 'tech', 'phone', 'laptop', 'review', 'unbox', 'product', 'dji', 'osmo', 'action cam'],
        'places': ['travel', 'trip', 'visit', 'destination', 'village', 'city', 'mountain', 'beach', 'hotel', 'itinerary', 'sikkim', 'location'],
        'recipe': ['recipe', 'cooking', 'food', 'dish', 'ingredients', 'cook', 'bake', 'meal', 'cuisine'],
        'software': ['app', 'software', 'code', 'programming', 'developer', 'api', 'python', 'javascript'],
        'book': ['book', 'novel', 'author', 'read', 'literature', 'story', 'chapter'],
        'workout': ['workout', 'fitness', 'exercise', 'gym', 'training', 'muscle', 'cardio', 'yoga'],
        'film': ['movie', 'film', 'cinema', 'actor', 'actress', 'director', 'trailer', 'premiere'],
        'tv shows': ['series', 'episode', 'season', 'show', 'tv show', 'streaming', 'netflix'],
        'event': ['event', 'concert', 'festival', 'conference', 'meetup', 'workshop', 'seminar']
    }
    
    # Count keyword matches
    scores = {}
    for category, keywords in category_keywords.items():
        score = sum(1 for keyword in keywords if keyword in combined)
        scores[category] = score
    
    # Get category with highest score
    best_category = max(scores, key=scores.get)
    
    if scores[best_category] > 0:
        return best_category
    
    return "other"

def run_script(script_name, args):
    """Run a Python script and return success status"""
    try:
        # Use sys.executable to ensure same Python interpreter (virtual env)
        cmd = [sys.executable, os.path.join(os.path.dirname(__file__), script_name)] + args
        
        # Force UTF-8 encoding for subprocess
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def run_analysis_task(task_name, script_name, file_path, task_type="light"):
    """
    Run a single analysis task (for parallel execution)
    
    Args:
        task_name: Display name (e.g., "Visual Analysis")
        script_name: Python script to run
        file_path: Path to file to analyze
        task_type: "heavy" or "light" (for scheduling)
    
    Returns:
        dict with task results
    """
    start_time = time.time()
    print(f"  ⚡ Starting {task_name}: {Path(file_path).name}")
    
    success, stdout, stderr = run_script(script_name, [str(file_path)])
    
    elapsed = time.time() - start_time
    
    result = {
        'task_name': task_name,
        'file': Path(file_path).name,
        'success': success,
        'output': stdout if success else '',
        'error': stderr if not success else '',
        'elapsed': elapsed,
        'type': task_type
    }
    
    if success:
        print(f"  ✓ Completed {task_name}: {Path(file_path).name} ({elapsed:.1f}s)")
    else:
        print(f"  ✗ Failed {task_name}: {Path(file_path).name}")
    
    return result

def _extract_section(output: str, marker: str) -> str:
    """Extract the content after a section marker, stopping at the next divider."""
    if marker not in output:
        return output[:2000]
    after = output.split(marker, 1)[1]
    lines = after.split("\n")
    content_lines = []
    started = False
    for line in lines:
        stripped = line.strip('-').strip('=').strip('─').strip()
        if not started:
            # Skip blank lines and pure divider lines
            if stripped:
                started = True
                content_lines.append(line)
        else:
            # Stop at a divider line (5+ repeated chars)
            raw = line.strip()
            if (raw.startswith('─' * 5) or raw.startswith('-' * 5) or
                    raw.startswith('=' * 5) or raw.startswith('*' * 5)):
                break
            content_lines.append(line)
    return "\n".join(content_lines).strip()


def _clean_visual(output: str) -> str:
    return _extract_section(output, "📝 ANALYSIS:")


def _clean_audio(output: str) -> str:
    return _extract_section(output, "📝 TRANSCRIBED TEXT:")


def _clean_text(output: str) -> str:
    return _extract_section(output, "🔍 ANALYSIS:")


def cleanup_temp_folder(folder_path):
    """Delete temp folder after successful database save"""
    try:
        if os.path.exists(folder_path):
            shutil.rmtree(folder_path)
            print(f"🗑️  Cleaned up temp folder: {Path(folder_path).name}")
            return True
    except Exception as e:
        print(f"⚠ Warning: Could not delete temp folder: {e}")
    return False


def _jpg_to_thumbnail(jpg_path) -> str:
    """
    Read a JPEG file and return it as a base64-encoded data URI.
    Downsizes to max 480 px wide using Pillow if available; otherwise
    raw base64 is used (larger but still works as <img src=...>).
    """
    try:
        from PIL import Image
        import io
        img = Image.open(jpg_path)
        img.thumbnail((480, 480), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        data = buf.getvalue()
    except Exception:
        # Pillow not available or failed — use raw bytes
        with open(jpg_path, "rb") as f:
            data = f.read()
    import base64
    encoded = base64.b64encode(data).decode()
    return f"data:image/jpeg;base64,{encoded}"

# ─────────────────────────────────────────────────────────────────────────────
#  Non-Instagram analysis flows (no download/pipeline needed)
# ─────────────────────────────────────────────────────────────────────────────

_EMOJI_MAP = {
    "TITLE":    "📌",
    "CHANNEL":  "📢",
    "DATE":     "📅",
    "SUMMARY":  "📝",
    "TAGS":     "🏷️",
    "MUSIC":    "🎵",
    "CATEGORY": "📂",
}

def _sanitise_yt_raw(raw: str, post_date: str | None) -> str:
    """
    Normalise YouTube Gemini raw output:
      • Replace U+FFFD replacement chars that precede known section labels
        with the correct emoji (model sometimes outputs \ufffd instead of
        📢 or 📝 due to encoding/font issues in the API layer).
      • Re-attach 🏷️ when the model omitted it before TAGS:.
      • Substitute the real upload date for "Unknown" in the DATE field.
    """
    lines = raw.splitlines()
    fixed = []
    for line in lines:
        stripped = line.strip()
        # Replace \ufffd or missing emoji before a known section label
        m = re.match(r'^(\ufffd\s*|)(\*{0,2})([A-Z]+)(\*{0,2}):(.*)$', stripped)
        if m:
            prefix, pre_bold, label, post_bold, rest = m.groups()
            if label in _EMOJI_MAP:
                line = f"{_EMOJI_MAP[label]} {pre_bold}{label}{post_bold}:{rest}"
        # Insert missing 🏷️ before bare 'TAGS:' (no emoji at all)
        elif re.match(r'^TAGS\s*:', stripped, re.IGNORECASE):
            line = re.sub(r'^TAGS\s*:', '🏷️ TAGS:', stripped, flags=re.IGNORECASE)
        fixed.append(line)

    result = "\n".join(fixed)

    # Substitute actual upload date for 'Unknown'
    if post_date:
        result = re.sub(
            r'(📅\s*DATE\s*:)\s*Unknown',
            rf'\1 {post_date}',
            result,
            flags=re.IGNORECASE,
        )

    return result

def run_youtube_analysis(url: str, shortcode: str, db):
    """Single-call YouTube analysis via Gemini native video support."""
    print_section("🎬 YouTube Video Analysis")
    print(f"📹 Analyzing: {url}")
    print("   (Gemini will access the video directly — no download required)")

    result = analyze_youtube(url)

    if result.get('error'):
        err = result['error']
        if _is_quota_error(err):
            db.queue_for_retry(shortcode, url, 'youtube', 'gemini_quota', retry_hours=24)
            print("⏰ All Gemini models quota-exhausted — queued for retry in 24 hours.")
            return RETRY_SENTINEL
        print(f"❌ YouTube analysis failed: {err}")
        return

    raw = result.get('raw_output', '')
    if not raw:
        print("❌ Received empty response from Gemini.")
        return

    # Clean up encoding artefacts and patch in the real upload date
    raw = _sanitise_yt_raw(raw, result.get('post_date'))

    print_section("📋 RAW GEMINI OUTPUT")
    print(raw[:2000])

    title, summary_text, tags, music, category = parse_summary(raw)

    # Use upload date scraped directly from YouTube page (always accurate)
    yt_post_date = result.get('post_date')

    print_section("💾 Saving to Database")
    db.save_analysis(
        shortcode=shortcode,
        url=url,
        username=result.get('channel', ''),
        title=title,
        summary=summary_text,
        tags=tags,
        music=music,
        category=category,
        visual_analysis='',
        audio_transcription='',
        text_analysis=raw,
        content_type='youtube',
        thumbnail=result.get('thumbnail', ''),
        post_date=yt_post_date,
    )
    print(f"✓ YouTube analysis saved ({shortcode})")
    print_header("✅ Done — YouTube Analysis Complete")
    return True


def run_webpage_analysis(url: str, shortcode: str, db):
    """Fetch web page text and run AI text analysis."""
    print_section("🌐 Web Page Analysis")
    print(f"🔗 Analyzing: {url}")

    result = analyze_webpage(url)

    if result.get('error'):
        err = result['error']
        if _is_quota_error(err):
            db.queue_for_retry(shortcode, url, 'webpage', 'ai_quota', retry_hours=24)
            print("⏰ AI models quota-exhausted — queued for retry in 24 hours.")
            return RETRY_SENTINEL
        print(f"❌ Web page analysis failed: {err}")
        return

    raw = result.get('raw_output', '')
    page_title = result.get('page_title', '')
    if not raw:
        db.queue_for_retry(shortcode, url, 'webpage', 'ai_empty_response', retry_hours=1)
        print("⏰ Empty AI response — queued for retry in 1 hour.")
        return RETRY_SENTINEL

    print_section("📋 RAW AI OUTPUT")
    print(raw[:2000])

    title, summary_text, tags, music, category = parse_summary(raw)
    # Use on-page title as fallback if AI did not extract one
    if not title and page_title:
        title = page_title

    print_section("💾 Saving to Database")
    db.save_analysis(
        shortcode=shortcode,
        url=url,
        username=result.get('author', ''),
        title=title,
        summary=summary_text,
        tags=tags,
        music=music,
        category=category,
        visual_analysis='',
        audio_transcription='',
        text_analysis=raw,
        content_type='webpage',
        thumbnail=result.get('thumbnail', ''),
        post_date=result.get('post_date'),
    )
    print(f"✓ Web page analysis saved ({shortcode})")
    print_header("✅ Done — Web Page Analysis Complete")
    return True


# ─────────────────────────────────────────────────────────────────────────────

def main():
    """Main orchestrator"""

    print_header("🧠 SUPERBRAIN - Content Analyzer")
    
    # Step 1: Get URL
    if len(sys.argv) > 1:
        instagram_url = sys.argv[1]
        print(f"📎 Link: {instagram_url}")
    else:
        instagram_url = input("📎 Enter URL (Instagram / YouTube / web page): ").strip()

    if not instagram_url:
        print("❌ No link provided!")
        return

    # Step 2: Validate link & detect type
    print_section("🔍 Step 1: Validating Link")

    validation = validate_link(instagram_url)

    if not validation['valid']:
        print(f"❌ Invalid link!")
        print(f"   Error: {validation['error']}")
        return

    content_type = validation['content_type']
    shortcode    = validation['shortcode']
    # Normalise URL (e.g. YouTube canonical form)
    instagram_url = validation['url']

    print(f"✓ Valid {content_type} link")
    print(f"  ID: {shortcode}")
    
    # Step 2.5: Check cache in database
    print_section("🔍 Step 2: Checking Cache")
    
    db = get_db()
    cached = db.check_cache(shortcode) if db.is_connected() else None
    
    if cached:
        print(f"✓ Found in cache! (Analyzed on {cached.get('analyzed_at', 'unknown')})")
        print(f"  Returning cached result...\n")
        
        # Display cached summary
        print_section("📋 CACHED RESULT")
        print(f"📌 TITLE:\n{cached.get('title', 'N/A')}\n")
        print(f"📝 SUMMARY:\n{cached.get('summary', 'N/A')}\n")
        print(f"🏷️ TAGS:\n{', '.join(cached.get('tags', []))}\n")
        print(f"🎵 MUSIC:\n{cached.get('music', 'N/A')}\n")
        print(f"📂 CATEGORY:\n{cached.get('category', 'N/A')}\n")
        print("=" * 80)
        print("✅ Retrieved from cache (no AI processing needed)")
        print("=" * 80 + "\n")
        return
    else:
        print("⚡ Not in cache - will analyze and save")

    # ── Dispatch non-Instagram types ──────────────────────────────────────────
    if content_type == 'youtube':
        result = run_youtube_analysis(instagram_url, shortcode, db)
        if result == RETRY_SENTINEL:
            sys.exit(2)
        if result is None:
            # Analysis failed — exit non-zero so api.py returns a proper error
            sys.exit(1)
        return
    elif content_type == 'webpage':
        result = run_webpage_analysis(instagram_url, shortcode, db)
        if result == RETRY_SENTINEL:
            sys.exit(2)
        if result is None:
            # Analysis failed — exit non-zero so api.py returns a proper error
            sys.exit(1)
        return
    # Instagram falls through to the existing pipeline below

    # Step 3: Download content
    print_section("📥 Step 3: Downloading Content")
    
    print("Running Instagram downloader...")
    
    try:
        # Pass URL via stdin simulation
        import contextlib
        from io import StringIO
        
        # Import the downloader function
        from instagram.instagram_downloader import download_instagram_content, RetryableDownloadError
        
        download_result = download_instagram_content(instagram_url)
        
        if download_result is None:
            print("❌ Download failed!")
            return
        
        download_folder = download_result
        print(f"\n✓ Content downloaded to: {download_folder}")

    except RetryableDownloadError as e:
        print(f"⏰ Instagram download blocked — {e}")
        db.queue_for_retry(shortcode, instagram_url, 'instagram', 'instagram_rate_limit', retry_hours=24)
        print("⏰ Queued for retry in 24 hours.")
        sys.exit(2)
        
    except Exception as e:
        print(f"❌ Download error: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 4: Find downloaded files
    print_section("📂 Step 3: Locating Files")
    
    folder_path = Path(download_folder)
    
    if not folder_path.exists():
        print(f"❌ Folder not found: {download_folder}")
        return
    
    # Find files
    mp4_files = list(folder_path.glob("*.mp4"))
    mp3_files = list(folder_path.glob("*_audio.mp3"))
    jpg_files = list(folder_path.glob("*.jpg"))
    info_files = list(folder_path.glob("info.txt"))
    
    print(f"📹 Videos: {len(mp4_files)}")
    print(f"🎵 Audio files: {len(mp3_files)}")
    print(f"🖼️  Images: {len(jpg_files)}")
    print(f"📄 Info files: {len(info_files)}")
    
    # Step 5: Run analyses with SMART PARALLEL PROCESSING
    print_section("🚀 Step 4: Running Parallel Analysis")
    print("Strategy: Heavy tasks sequential, light tasks parallel")
    print("Heavy: Visual (video processing), Audio (Whisper)")
    print("Light: Music (Shazam), Text (metadata)")
    
    results = {
        'visual': [],
        'audio_transcription': [],
        'music_identification': [],
        'text': []
    }
    
    all_tasks = []
    analysis_start = time.time()
    
    # === PHASE 1: Visual Analysis (HEAVY) - Run alone ===
    if mp4_files or jpg_files:
        print(f"\n🎬 Phase 1: Visual Analysis (Heavy Task)")
        
        for video in mp4_files:
            result = run_analysis_task("Visual", 'analyzers/visual_analyze.py', str(video), "heavy")
            if result['success']:
                results['visual'].append({
                    'file': result['file'],
                    'type': 'video',
                    'output': result['output']
                })
                print(_clean_visual(result['output'])[:600] + "\n")
        
        for img in jpg_files:
            result = run_analysis_task("Visual", 'analyzers/visual_analyze.py', str(img), "heavy")
            if result['success']:
                results['visual'].append({
                    'file': result['file'],
                    'type': 'image',
                    'output': result['output']
                })
                print(_clean_visual(result['output'])[:600] + "\n")
    
    # === PHASE 2: Audio Transcription (HEAVY) - Run alone ===
    if mp3_files:
        print(f"\n🎙️ Phase 2: Audio Transcription (Heavy Task)")
        
        for audio in mp3_files:
            result = run_analysis_task("Audio", 'analyzers/audio_transcribe.py', str(audio), "heavy")
            if result['success']:
                results['audio_transcription'].append({
                    'file': result['file'],
                    'output': result['output']
                })
                print(_clean_audio(result['output'])[:600] + "\n")
    
    # === PHASE 3: Light tasks in PARALLEL ===
    print(f"\n⚡ Phase 3: Light Tasks (Parallel Execution)")
    
    light_tasks = []
    
    # Add music identification tasks
    for audio in mp3_files:
        light_tasks.append(('music', 'analyzers/music_identifier.py', str(audio)))
    
    # Add text analysis tasks
    for info_file in info_files:
        light_tasks.append(('text', 'analyzers/text_analyzer.py', str(info_file)))
    
    if light_tasks:
        # Run light tasks in parallel (max 3 concurrent)
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {}
            
            for task_type, script, file_path in light_tasks:
                task_name = "Music ID" if task_type == 'music' else "Text"
                future = executor.submit(run_analysis_task, task_name, script, file_path, "light")
                futures[future] = task_type
            
            # Collect results as they complete
            for future in as_completed(futures):
                task_type = futures[future]
                result = future.result()
                
                if result['success']:
                    if task_type == 'music':
                        results['music_identification'].append({
                            'file': result['file'],
                            'output': result['output']
                        })
                    else:  # text
                        results['text'].append({
                            'file': result['file'],
                            'output': result['output']
                        })
                    
                    if task_type == 'music':
                        print(result['output'][:400] + "\n")
                    else:
                        print(_clean_text(result['output'])[:600] + "\n")
    
    analysis_elapsed = time.time() - analysis_start
    print(f"\n⏱️  Total Analysis Time: {analysis_elapsed:.1f}s")
    
    # Final comprehensive summary
    print_header("✅ GENERATING COMPREHENSIVE SUMMARY")
    
    final_summary = generate_final_summary(results, instagram_url)
    
    print_section("📋 FINAL REPORT")
    print(final_summary)
    
    # Extract structured data from summary for database
    title, summary_text, tags, music, category = parse_summary(final_summary)
    
    # Get additional metadata from info.txt if available
    username = ""
    likes = 0
    post_date = None
    
    if info_files:
        try:
            with open(info_files[0], 'r', encoding='utf-8') as f:
                content = f.read()
                username_match = re.search(r'Username: @(\S+)', content)
                likes_match = re.search(r'Likes: (\d+)', content)
                date_match = re.search(r'Date: ([\d\-: ]+)', content)
                
                if username_match:
                    username = username_match.group(1)
                if likes_match:
                    likes = int(likes_match.group(1))
                if date_match:
                    post_date = date_match.group(1)
        except:
            pass
    
    # Save to database
    print_section("💾 Saving to Database")

    # Combine analysis texts — extract clean content (not raw stdout)
    visual_text = "\n\n".join([_clean_visual(r['output']) for r in results['visual']])
    audio_text = "\n\n".join([_clean_audio(r['output']) for r in results['audio_transcription']])
    text_text = "\n\n".join([_clean_text(r['output']) for r in results['text']])

    # — Instagram thumbnail: first downloaded jpg (converted to base64) —
    instagram_thumbnail = ""
    if jpg_files:
        print(f"🖼️  Saving thumbnail from {jpg_files[0].name}...")
        instagram_thumbnail = _jpg_to_thumbnail(jpg_files[0])
    elif mp4_files:
        # Try to extract first frame from the video using cv2
        try:
            import cv2
            import base64
            import tempfile
            cap = cv2.VideoCapture(str(mp4_files[0]))
            ret, frame = cap.read()
            cap.release()
            if ret:
                import cv2 as _cv2
                # Resize to 480 wide keeping aspect
                h, w = frame.shape[:2]
                new_w = 480
                new_h = int(h * new_w / w)
                frame = _cv2.resize(frame, (new_w, new_h))
                ok, buf = _cv2.imencode(".jpg", frame, [_cv2.IMWRITE_JPEG_QUALITY, 75])
                if ok:
                    encoded = base64.b64encode(buf.tobytes()).decode()
                    instagram_thumbnail = f"data:image/jpeg;base64,{encoded}"
                    print("🖼️  Saved first-frame thumbnail from video")
        except Exception as thumb_err:
            print(f"⚠️  Could not extract video thumbnail: {thumb_err}")

    db.save_analysis(
        shortcode=shortcode,
        url=instagram_url,
        username=username,
        title=title,
        summary=summary_text,
        tags=tags,
        music=music,
        category=category,
        visual_analysis=visual_text,
        audio_transcription=audio_text,
        text_analysis=text_text,
        likes=likes,
        post_date=post_date,
        thumbnail=instagram_thumbnail,
    )
    
    print(f"✓ Analysis saved to database")
    
    # Step 8: Cleanup temp folder
    print_section("🧹 Step 5: Cleanup")
    
    if cleanup_temp_folder(download_folder):
        print(f"✓ Temp folder deleted successfully")
    else:
        print(f"⚠ Temp folder not deleted (may need manual cleanup)")
    
    print("\n" + "=" * 80)
    print(f"📊 Analyses Complete: Visual({len(results['visual'])}), Audio({len(results['audio_transcription'])}), Music({len(results['music_identification'])}), Text({len(results['text'])})")
    print(f"⏱️  Total Time: {analysis_elapsed:.1f}s")
    print("=" * 80 + "\n")

if __name__ == "__main__":
    main()
