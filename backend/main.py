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
from link_checker import validate_link
from database import get_db

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
    """Generate comprehensive summary using all analysis results"""
    import ollama
    
    # Collect all analysis data
    visual_summary = ""
    audio_summary = ""
    music_info = ""
    text_summary = ""
    
    # Extract visual analysis
    if results['visual']:
        visual_summary = "VISUAL ANALYSIS:\n"
        for item in results['visual']:
            # Extract key parts from output
            output = item['output']
            if 'SUMMARY:' in output:
                summary_part = output.split('SUMMARY:')[1].split('📋')[0].strip()
                visual_summary += f"- {summary_part[:500]}...\n"
    
    # Extract audio transcription
    if results['audio_transcription']:
        audio_summary = "AUDIO TRANSCRIPTION:\n"
        for item in results['audio_transcription']:
            output = item['output']
            if 'TRANSCRIBED TEXT:' in output:
                lines = output.split('TRANSCRIBED TEXT:')[1].split('─')[0].strip()
                audio_summary += f"- Language: {output.split('Detected Language:')[1].split('(')[0].strip() if 'Detected Language:' in output else 'Unknown'}\n"
                audio_summary += f"- Content: {lines[:300]}...\n"
    
    # Extract music identification
    if results['music_identification']:
        music_info = "MUSIC:\n"
        for item in results['music_identification']:
            output = item['output']
            if '🎵 Song:' in output:
                song = output.split('🎵 Song:')[1].split('\n')[0].strip()
                artist = output.split('🎤 Artist:')[1].split('\n')[0].strip() if '🎤 Artist:' in output else 'Unknown'
                music_info += f"- {song} by {artist}\n"
            elif 'No match found' in output:
                music_info += "- No music identified (likely voiceover/no background music)\n"
    
    # Extract text analysis
    if results['text']:
        text_summary = "TEXT ANALYSIS:\n"
        for item in results['text']:
            output = item['output']
            if 'ANALYSIS:' in output:
                analysis_part = output.split('ANALYSIS:')[1].split('─')[0].strip()
                text_summary += f"{analysis_part[:500]}...\n"
    
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
        response = ollama.generate(
            model='qwen3:latest',
            prompt=prompt,
            options={
                'temperature': 0.7,
                'num_predict': 600
            }
        )
        
        summary = response.get('response', '').strip()
        
        if not summary:
            summary = "Unable to generate comprehensive summary."
        
        return summary
        
    except Exception as e:
        return f"Error generating summary: {e}\n\nRaw data available in individual analysis sections above."

def parse_summary(summary_text):
    """
    Parse AI-generated summary to extract structured data
    
    Returns:
        tuple: (title, summary, tags, music, category)
    """
    title = ""
    summary = ""
    tags = []
    music = ""
    category = ""
    
    try:
        # Extract title
        if "📌 TITLE:" in summary_text:
            title_section = summary_text.split("📌 TITLE:")[1].split("\n\n")[0].strip()
            title = title_section.replace("\n", " ").strip()
        
        # Extract summary
        if "📝 SUMMARY:" in summary_text:
            summary_section = summary_text.split("📝 SUMMARY:")[1].split("\n\n")[0].strip()
            summary = summary_section.replace("\n", " ").strip()
        
        # Extract tags
        if "🏷️ TAGS:" in summary_text:
            tags_section = summary_text.split("🏷️ TAGS:")[1].split("\n\n")[0].strip()
            # Split by common separators
            tags = [tag.strip() for tag in re.split(r'[,\s]+', tags_section) if tag.strip()]
        
        # Extract music
        if "🎵 MUSIC:" in summary_text:
            music_section = summary_text.split("🎵 MUSIC:")[1].split("\n\n")[0].strip()
            music = music_section.replace("\n", " ").strip()
        
        # Extract category
        if "📂 CATEGORY:" in summary_text:
            category_section = summary_text.split("📂 CATEGORY:")[1].strip()
            # Get first non-empty line
            for line in category_section.split('\n'):
                line = line.strip().lower()
                if line and not line.startswith('='):
                    category = line
                    break
    
    except Exception as e:
        print(f"⚠️ Error parsing summary: {e}")
    
    # Fallback: Auto-detect category if empty
    if not category:
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

def main():
    """Main orchestrator"""
    
    print_header("🧠 SUPERBRAIN - Instagram Content Analyzer")
    
    # Step 1: Get Instagram link
    if len(sys.argv) > 1:
        instagram_url = sys.argv[1]
        print(f"📎 Link: {instagram_url}")
    else:
        instagram_url = input("📎 Enter Instagram link: ").strip()
    
    if not instagram_url:
        print("❌ No link provided!")
        return
    
    # Step 2: Validate link
    print_section("🔍 Step 1: Validating Link")
    
    validation = validate_link(instagram_url)
    
    if not validation['valid']:
        print(f"❌ Invalid Instagram link!")
        print(f"   Error: {validation['error']}")
        return
    
    print(f"✓ Valid Instagram link")
    print(f"  Shortcode: {validation['shortcode']}")
    
    shortcode = validation['shortcode']
    
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
    
    # Step 3: Download content
    print_section("📥 Step 3: Downloading Content")
    
    # Run instagram_downloader.py
    print("Running Instagram downloader...")
    downloader_path = os.path.join(os.path.dirname(__file__), 'instagram_downloader.py')
    
    try:
        # Pass URL via stdin simulation
        import contextlib
        from io import StringIO
        
        # Import the downloader function
        sys.path.insert(0, os.path.dirname(__file__))
        from instagram_downloader import download_instagram_content
        
        download_result = download_instagram_content(instagram_url)
        
        if download_result is None:
            print("❌ Download failed!")
            return
        
        download_folder = download_result
        print(f"\n✓ Content downloaded to: {download_folder}")
        
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
            result = run_analysis_task("Visual", 'visual_analyze.py', str(video), "heavy")
            if result['success']:
                results['visual'].append({
                    'file': result['file'],
                    'type': 'video',
                    'output': result['output']
                })
                print(result['output'][:500] + "...\n")
        
        for img in jpg_files:
            result = run_analysis_task("Visual", 'visual_analyze.py', str(img), "heavy")
            if result['success']:
                results['visual'].append({
                    'file': result['file'],
                    'type': 'image',
                    'output': result['output']
                })
                print(result['output'][:500] + "...\n")
    
    # === PHASE 2: Audio Transcription (HEAVY) - Run alone ===
    if mp3_files:
        print(f"\n🎙️ Phase 2: Audio Transcription (Heavy Task)")
        
        for audio in mp3_files:
            result = run_analysis_task("Audio", 'audio_transcribe.py', str(audio), "heavy")
            if result['success']:
                results['audio_transcription'].append({
                    'file': result['file'],
                    'output': result['output']
                })
                print(result['output'][:500] + "...\n")
    
    # === PHASE 3: Light tasks in PARALLEL ===
    print(f"\n⚡ Phase 3: Light Tasks (Parallel Execution)")
    
    light_tasks = []
    
    # Add music identification tasks
    for audio in mp3_files:
        light_tasks.append(('music', 'music_identifier.py', str(audio)))
    
    # Add text analysis tasks
    for info_file in info_files:
        light_tasks.append(('text', 'text_analyzer.py', str(info_file)))
    
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
                    
                    print(result['output'][:300] + "...\n")
    
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
    
    # Combine analysis texts
    visual_text = "\n".join([r['output'][:500] for r in results['visual']])
    audio_text = "\n".join([r['output'][:500] for r in results['audio_transcription']])
    text_text = "\n".join([r['output'][:500] for r in results['text']])
    
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
        post_date=post_date
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
