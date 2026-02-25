#!/usr/bin/env python3
"""
Video & Image Visual Analyzer
Uses the ModelRouter to pick the best available free vision model
(Gemini → Groq Vision → OpenRouter Vision → Local Ollama as last resort)

For videos: extracts key frames using OpenCV (or ffmpeg fallback),
then sends them to the vision model.
"""

import sys
import base64
from pathlib import Path
from typing import List

# Ensure backend root is in sys.path (needed when run as a subprocess)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.model_router import get_router


# ─────────────────────────────────────────────────────────────────────────────
#  Frame extraction helpers
# ─────────────────────────────────────────────────────────────────────────────

def _frames_cv2(video_path: str, max_frames: int = 4) -> List[str]:
    """Extract evenly-spaced frames using OpenCV → base64 JPEG list."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return []
    indices = [int(i * total / max_frames) for i in range(max_frames)]
    out = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            continue
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            out.append(base64.b64encode(buf.tobytes()).decode())
    cap.release()
    return out


def _get_duration_s(video_path: str) -> int:
    import subprocess
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "format=duration", "-of", "csv=p=0", video_path],
        capture_output=True, text=True,
    )
    try:
        return max(1, int(float(r.stdout.strip())))
    except Exception:
        return 60


def _frames_ffmpeg(video_path: str, max_frames: int = 4) -> List[str]:
    """Fallback frame extraction via ffmpeg."""
    import subprocess, tempfile, os
    out = []
    with tempfile.TemporaryDirectory() as tmpdir:
        dur = _get_duration_s(video_path)
        interval = max(1, dur // max_frames)
        pattern = os.path.join(tmpdir, "frame_%02d.jpg")
        subprocess.run(
            ["ffmpeg", "-i", video_path, "-vf", f"fps=1/{interval}",
             "-vframes", str(max_frames), "-q:v", "3", pattern],
            capture_output=True,
        )
        for fname in sorted(os.listdir(tmpdir)):
            with open(os.path.join(tmpdir, fname), "rb") as f:
                out.append(base64.b64encode(f.read()).decode())
    return out


def extract_frames(video_path: str, max_frames: int = 4) -> List[str]:
    """Extract frames from a video, trying OpenCV first then ffmpeg."""
    try:
        import cv2  # noqa: F401
        frames = _frames_cv2(video_path, max_frames)
        if frames:
            print(f"  📸 Extracted {len(frames)} frame(s) via OpenCV")
            return frames
    except ImportError:
        pass
    except Exception as e:
        print(f"  ⚠️  OpenCV failed: {e}")

    try:
        frames = _frames_ffmpeg(video_path, max_frames)
        if frames:
            print(f"  📸 Extracted {len(frames)} frame(s) via ffmpeg")
            return frames
    except Exception as e:
        print(f"  ⚠️  ffmpeg failed: {e}")

    return []


def image_to_b64(image_path: str) -> str:
    """Read an image file and return a base64 JPEG string."""
    try:
        from PIL import Image
        import io
        img = Image.open(image_path).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode()


# ─────────────────────────────────────────────────────────────────────────────
#  Analyze
# ─────────────────────────────────────────────────────────────────────────────

VISION_PROMPT = """Analyze this image/video frame from an Instagram post. Provide:
1. Main subject and what is happening
2. Any visible text, captions, or overlays
3. Setting / location clues
4. Products, brands, or notable items visible
5. Overall content theme

Be concise and factual."""


def analyze(file_path: str) -> None:
    """Analyze a video or image file and print structured results."""

    print("=" * 70)
    print("🎬 VIDEO & IMAGE ANALYZER")
    print("=" * 70)
    print()

    path = Path(file_path)
    if not path.exists():
        print(f"❌ File not found: {file_path}")
        return
    if path.is_dir():
        print("❌ Provide a file, not a folder")
        return

    suffix = path.suffix.lower()
    if suffix not in (".mp4", ".avi", ".mov", ".mkv", ".jpg", ".jpeg", ".png", ".gif"):
        print(f"❌ Unsupported file type: {suffix}")
        return

    print(f"📹 File: {path.name}")
    print()

    # Build image list
    images_b64: List[str] = []

    if suffix in (".mp4", ".avi", ".mov", ".mkv"):
        print("🎥 Extracting video frames...")
        images_b64 = extract_frames(str(path), max_frames=4)
        if not images_b64:
            print("❌ Could not extract any frames from video")
            return
    else:
        print("🖼️  Loading image...")
        try:
            images_b64 = [image_to_b64(str(path))]
        except Exception as e:
            print(f"❌ Could not load image: {e}")
            return

    # Send to vision model via router
    print()
    print("🤖 Analyzing with vision AI...")
    print()

    router = get_router()
    try:
        result = router.analyze_images(VISION_PROMPT, images_b64)
    except RuntimeError as e:
        print(f"❌ Vision analysis failed: {e}")
        return

    print("=" * 70)
    print("📊 VISUAL ANALYSIS RESULTS")
    print("=" * 70)
    print()
    print("📝 ANALYSIS:")
    print("-" * 70)
    print(result)
    print("-" * 70)
    print()
    print("=" * 70)
    print("✅ Done!")
    print("=" * 70)


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
