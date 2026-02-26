#!/usr/bin/env python3
"""
Audio Transcriber — Multi-language Support
Primary:  Groq Whisper API  (whisper-large-v3-turbo → whisper-large-v3)
Fallback: Local OpenAI Whisper (medium model, offline)
"""

import os
import sys
from pathlib import Path

# ── API key loader (mirrors model_router.py) ─────────────────────────────────

def _load_groq_key():
    key = os.environ.get("GROQ_API_KEY")
    if key:
        return key
    keys_file = Path(__file__).resolve().parent.parent / "config" / ".api_keys"
    if keys_file.exists():
        for line in keys_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GROQ_API_KEY="):
                v = line.split("=", 1)[1].strip()
                return v or None
    return None


LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "es": "Spanish", "fr": "French",
    "de": "German", "it": "Italian", "pt": "Portuguese", "ru": "Russian",
    "ja": "Japanese", "ko": "Korean", "zh": "Chinese", "ar": "Arabic",
    "tr": "Turkish", "vi": "Vietnamese", "th": "Thai", "id": "Indonesian",
    "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati",
    "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu",
}

VALID_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".mp4"}

# Groq Whisper API max file size (25 MB)
GROQ_MAX_BYTES = 25 * 1024 * 1024


# ── Transcription backends ────────────────────────────────────────────────────

def _transcribe_groq(audio_path, api_key):
    """
    Transcribe using Groq Whisper API.
    Tries whisper-large-v3-turbo first (fast, multilingual),
    then whisper-large-v3 (highest accuracy).
    Returns (text, language_code). Raises on failure.
    """
    from groq import Groq

    client = Groq(api_key=api_key)

    file_size = audio_path.stat().st_size
    if file_size > GROQ_MAX_BYTES:
        raise ValueError(
            f"File too large for Groq API ({file_size / 1024 / 1024:.1f} MB > 25 MB). "
            "Using local fallback."
        )

    models = [
        ("whisper-large-v3-turbo", "fast multilingual"),
        ("whisper-large-v3",       "highest accuracy"),
    ]

    last_err = None
    for model_id, label in models:
        try:
            print(f"  🌐 Groq Whisper [{label}] …")
            with open(audio_path, "rb") as f:
                response = client.audio.transcriptions.create(
                    model=model_id,
                    file=(audio_path.name, f),
                    response_format="verbose_json",
                )
            text = (response.text or "").strip()
            lang = getattr(response, "language", None) or "unknown"
            return text, lang
        except Exception as e:
            print(f"  ⚠️  Groq {model_id} failed: {e}")
            last_err = e

    raise RuntimeError(f"All Groq Whisper models failed. Last error: {last_err}")


def _transcribe_local(audio_path):
    """
    Transcribe using local OpenAI Whisper (medium model).
    Returns (text, language_code).
    """
    import whisper  # type: ignore

    print("  💻 Loading local Whisper model (medium) …")
    model = whisper.load_model("medium")
    print("  ✓  Local model loaded")

    result = model.transcribe(
        str(audio_path),
        fp16=False,
        task="transcribe",
        verbose=False,
    )
    text = result["text"].strip()
    lang = result.get("language", "unknown")
    return text, lang


# ── Main entry point ──────────────────────────────────────────────────────────

def transcribe_audio(audio_path):
    """Transcribe audio file — Groq Whisper primary, local Whisper fallback."""

    print("=" * 70)
    print("🎙️  AUDIO TRANSCRIBER — Multi-Language  (Groq → Local fallback)")
    print("=" * 70)
    print()

    path = Path(audio_path)
    if not path.exists():
        print(f"❌ File not found: {audio_path}")
        return

    if path.suffix.lower() not in VALID_EXTENSIONS:
        print(f"❌ Unsupported file type: {path.suffix}")
        print(f"   Supported: {', '.join(sorted(VALID_EXTENSIONS))}")
        return

    print(f"🎧 File: {path.name}  ({path.stat().st_size / 1024:.1f} KB)")
    print()

    text = ""
    lang_code = "unknown"
    backend_used = ""

    # ── 1. Try Groq Whisper API ───────────────────────────────────────────────
    api_key = _load_groq_key()
    if api_key:
        try:
            text, lang_code = _transcribe_groq(path, api_key)
            backend_used = "Groq Whisper API"
        except Exception as e:
            print(f"  ⚠️  Groq transcription failed: {e}")
            print("  🔁 Falling back to local Whisper …")
            print()
    else:
        print("  ℹ️  GROQ_API_KEY not set — using local Whisper directly")
        print()

    # ── 2. Local Whisper fallback ─────────────────────────────────────────────
    if not text:
        try:
            text, lang_code = _transcribe_local(path)
            backend_used = "Local Whisper (medium)"
        except Exception as e:
            print(f"❌ Local Whisper also failed: {e}")
            import traceback
            traceback.print_exc()
            return

    # ── Print results ─────────────────────────────────────────────────────────
    lang_name = LANGUAGE_NAMES.get(lang_code, lang_code.title())

    print()
    print("=" * 70)
    print("📊 TRANSCRIPTION RESULTS")
    print("=" * 70)
    print()
    print(f"🔧 Backend:           {backend_used}")
    print(f"🌍 Detected Language: {lang_name} ({lang_code})")
    print()
    print("📝 TRANSCRIBED TEXT:")
    print("-" * 70)
    print(text)
    print("-" * 70)
    print()
    print(f"ℹ️  Words: {len(text.split())}")
    print()
    print("=" * 70)
    print("✅ Transcription complete!")
    print("=" * 70)


def main():
    """CLI entry point."""
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        print("=" * 70)
        print("🎙️  AUDIO TRANSCRIBER — Multi-Language")
        print("=" * 70)
        print()
        print("Supports: English, Hindi, Spanish, French, German, Italian,")
        print("          Portuguese, Russian, Japanese, Korean, Chinese, Arabic,")
        print("          and 85+ more languages!")
        print()
        audio_path = input("📂 Enter audio file path: ").strip()

    audio_path = audio_path.strip('"').strip("'").strip()
    if not audio_path:
        print("❌ No path provided!")
        return

    transcribe_audio(audio_path)


if __name__ == "__main__":
    main()
