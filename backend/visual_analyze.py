#!/usr/bin/env python3
"""
Video & Image Visual Analyzer - Fast & Simple
Pure visual analysis using Qwen3-VL (No audio processing)
"""

import sys
from pathlib import Path
from openscenesense_ollama.analyzer import OllamaVideoAnalyzer
from openscenesense_ollama.frame_selectors import DynamicFrameSelector
from openscenesense_ollama.models import AnalysisPrompts

def analyze(file_path):
    """Analyze video or image - visual only"""
    
    print("=" * 70)
    print("🎬 VIDEO & IMAGE ANALYZER")
    print("=" * 70)
    print()
    
    path = Path(file_path)
    if not path.exists():
        print(f"❌ File not found: {file_path}")
        return
    
    if path.is_dir():
        print(f"❌ Provide a file, not a folder")
        return
    
    suffix = path.suffix.lower()
    if suffix not in ['.mp4', '.avi', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.gif']:
        print(f"❌ Unsupported: {suffix}")
        print("   Supported: .mp4, .mov, .avi, .mkv, .jpg, .png, .gif")
        return
    
    print(f"📹 File: {path.name}\n")
    
    # Fast prompts
    prompts = AnalysisPrompts(
        frame_analysis="Quick: main subject, action, text.",
        detailed_summary="{timeline}\n\nBrief summary.",
        brief_summary="Quick summary: {timeline}"
    )
    
    # Ultra-fast analyzer (no audio)
    analyzer = OllamaVideoAnalyzer(
        frame_analysis_model="qwen3-vl:latest",
        summary_model="qwen3-vl:latest",
        min_frames=2,
        max_frames=3,
        frames_per_minute=2.0,
        frame_selector=DynamicFrameSelector(),
        prompts=prompts,
        audio_transcriber=None,
        log_level=50,  # CRITICAL only (no logs)
        request_timeout=180.0,
        request_retries=1
    )
    
    try:
        print("🤖 Analyzing...\n")
        results = analyzer.analyze_video(str(path))
        
        print("=" * 70)
        print("📊 RESULTS")
        print("=" * 70)
        print()
        
        if results.get('brief_summary'):
            print("📝 SUMMARY:")
            print(results['brief_summary'])
            print()
        
        if results.get('summary'):
            print("📋 DETAILS:")
            print(results['summary'])
            print()
        
        if results.get('timeline'):
            print("⏱️  TIMELINE:")
            print(results['timeline'])
            print()
        
        if results.get('metadata'):
            print("ℹ️  INFO:")
            for k, v in results['metadata'].items():
                print(f"  • {k}: {v}")
            print()
        
        print("=" * 70)
        print("✅ Done!")
        print("=" * 70)
        
    except Exception as e:
        print(f"❌ Error: {e}")

def main():
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        print("=" * 70)
        print("🎬 VIDEO & IMAGE ANALYZER")
        print("=" * 70)
        print()
        file_path = input("📂 File path: ").strip()
    
    file_path = file_path.strip('"').strip("'").strip()
    
    if file_path:
        analyze(file_path)
    else:
        print("❌ No path provided!")

if __name__ == "__main__":
    main()
