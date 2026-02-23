#!/usr/bin/env python3
"""
Audio Transcriber - Multi-language Support
Transcribes audio files using OpenAI Whisper (supports 99+ languages)
"""

import sys
from pathlib import Path
import whisper

def transcribe_audio(audio_path):
    """Transcribe audio file in any language"""
    
    print("=" * 70)
    print("🎙️  AUDIO TRANSCRIBER - Multi-Language")
    print("=" * 70)
    print()
    
    path = Path(audio_path)
    if not path.exists():
        print(f"❌ File not found: {audio_path}")
        return
    
    # Check file type
    valid_extensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']
    if path.suffix.lower() not in valid_extensions:
        print(f"❌ Unsupported file type: {path.suffix}")
        print(f"   Supported: {', '.join(valid_extensions)}")
        return
    
    print(f"🎧 File: {path.name}")
    print()
    print("🔄 Loading Whisper model (this may take a moment first time)...")
    
    try:
        # Load Whisper model (medium for better accuracy with multiple languages)
        model = whisper.load_model("medium")
        
        print("✓ Model loaded")
        print()
        print("🎯 Transcribing audio...")
        print()
        
        # Transcribe with automatic language detection
        result = model.transcribe(
            str(path),
            fp16=False,
            task='transcribe',  # Keep original language
            verbose=False
        )
        
        # Extract results
        transcription = result['text'].strip()
        detected_language = result.get('language', 'unknown')
        
        # Language name mapping
        language_names = {
            'en': 'English',
            'hi': 'Hindi',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'ar': 'Arabic',
            'tr': 'Turkish',
            'vi': 'Vietnamese',
            'th': 'Thai',
            'id': 'Indonesian',
            'nl': 'Dutch',
            'pl': 'Polish',
            'uk': 'Ukrainian',
            'bn': 'Bengali',
            'ta': 'Tamil',
            'te': 'Telugu',
            'mr': 'Marathi',
            'gu': 'Gujarati',
            'kn': 'Kannada',
            'ml': 'Malayalam',
            'pa': 'Punjabi',
            'ur': 'Urdu'
        }
        
        lang_name = language_names.get(detected_language, detected_language.title())
        
        # Display results
        print("=" * 70)
        print("📊 TRANSCRIPTION RESULTS")
        print("=" * 70)
        print()
        
        print(f"🌍 Detected Language: {lang_name} ({detected_language})")
        print()
        
        print("📝 TRANSCRIBED TEXT:")
        print("-" * 70)
        print(transcription)
        print("-" * 70)
        print()
        
        # Word count
        word_count = len(transcription.split())
        print(f"ℹ️  Words: {word_count}")
        print()
        
        print("=" * 70)
        print("✅ Transcription complete!")
        print("=" * 70)
        
    except Exception as e:
        print(f"❌ Error during transcription: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Main entry point"""
    
    # Get file path
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        print("=" * 70)
        print("🎙️  AUDIO TRANSCRIBER - Multi-Language")
        print("=" * 70)
        print()
        print("Supports: English, Hindi, Spanish, French, German, Italian,")
        print("          Portuguese, Russian, Japanese, Korean, Chinese, Arabic,")
        print("          and 85+ more languages!")
        print()
        audio_path = input("📂 Enter audio file path: ").strip()
    
    # Clean up path
    audio_path = audio_path.strip('"').strip("'").strip()
    
    if not audio_path:
        print("❌ No path provided!")
        return
    
    # Transcribe
    transcribe_audio(audio_path)

if __name__ == "__main__":
    main()
