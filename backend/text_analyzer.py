#!/usr/bin/env python3
"""
Text Content Analyzer
Analyzes text files (like info.txt from Instagram posts) using the ModelRouter.
Routes to the best available free model: Groq → Gemini → OpenRouter → Local Ollama.
"""

import sys
from pathlib import Path

from model_router import get_router


def analyze_text(file_path: str) -> dict:
    """
    Analyze a text file using the best available AI model.

    Returns:
        dict with keys: success (bool), file (str), analysis (str), content (str)
                     or error (str) on failure.
    """
    path = Path(file_path)

    if not path.exists():
        return {"success": False, "error": f"File not found: {file_path}"}
    if not path.is_file():
        return {"success": False, "error": f"Not a file: {file_path}"}

    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
    except Exception as e:
        return {"success": False, "error": f"Could not read file: {e}"}

    if not content:
        return {"success": False, "error": "File is empty"}

    prompt = f"""You are analyzing an Instagram post's metadata. Read the following information and provide insights.

POST INFORMATION:
{content}

TASK: Analyze this post and provide:
1. Main topic / theme
2. Content type (travel guide, vlog, educational, product review, etc.)
3. Key highlights and takeaways
4. Notable details (locations, products, people, links, tips mentioned)
5. Target audience

Be specific and concise. Max 300 words."""

    print("🔄 Generating text analysis...")

    router = get_router()
    try:
        analysis = router.generate_text(prompt)
    except RuntimeError as e:
        return {"success": False, "error": f"All models failed: {e}"}

    if not analysis:
        return {"success": False, "error": "Model returned empty response"}

    return {
        "success": True,
        "file": path.name,
        "analysis": analysis,
        "content": content,
    }


def main():
    """Main entry point."""

    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        print("=" * 70)
        print("📄 TEXT ANALYZER")
        print("=" * 70)
        print()
        file_path = input("Enter text file path: ").strip()

    file_path = file_path.strip('"').strip("'").strip()

    if not file_path:
        print("❌ No path provided!")
        return

    print()
    result = analyze_text(file_path)

    if result["success"]:
        print("=" * 70)
        print("📊 TEXT ANALYSIS RESULTS")
        print("=" * 70)
        print()
        print(f"📄 File: {result['file']}")
        print()
        print("📝 ORIGINAL CONTENT:")
        print("-" * 70)
        print(result["content"])
        print("-" * 70)
        print()
        print("🔍 ANALYSIS:")
        print("-" * 70)
        print(result["analysis"])
        print("-" * 70)
        print()
    else:
        print(f"❌ Error: {result['error']}")


if __name__ == "__main__":
    main()
