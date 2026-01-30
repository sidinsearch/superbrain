   #!/usr/bin/env python3
"""
Text Content Analyzer using Qwen
Analyzes text files (like info.txt) using Ollama's Qwen model
"""

import sys
import ollama
from pathlib import Path

def analyze_text(file_path, model="qwen3:latest"):
    """Analyze text content using Qwen model"""
    
    path = Path(file_path)
    
    if not path.exists():
        return {
            'success': False,
            'error': f"File not found: {file_path}"
        }
    
    if not path.is_file():
        return {
            'success': False,
            'error': f"Not a file: {file_path}"
        }
    
    try:
        # Read file content
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
        
        if not content:
            return {
                'success': False,
                'error': "File is empty"
            }
        
        # Analyze with Qwen
        prompt = f"""You are analyzing an Instagram travel post. Read the following information and provide insights.

POST INFORMATION:
{content}

TASK: Analyze this post and provide:
1. Main topic/theme
2. Content type (travel guide, vlog, educational, etc.)
3. Target audience
4. Key highlights
5. Notable insights

Be specific and concise."""

        print("🔄 Generating analysis with Qwen...")
        
        response = ollama.generate(
            model=model,
            prompt=prompt,
            options={
                'temperature': 0.7,
                'num_predict': 500
            }
        )
        
        analysis = response.get('response', '').strip()
        
        if not analysis:
            # Fallback: try with simpler prompt
            simple_prompt = f"Summarize this Instagram post in 3-5 bullet points:\n\n{content[:500]}"
            response = ollama.generate(model=model, prompt=simple_prompt)
            analysis = response.get('response', 'Unable to generate analysis').strip()
        
        return {
            'success': True,
            'file': path.name,
            'analysis': analysis,
            'content': content
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f"Analysis failed: {str(e)}"
        }

def main():
    """Main entry point"""
    
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        print("=" * 70)
        print("📄 TEXT ANALYZER - Qwen")
        print("=" * 70)
        print()
        file_path = input("Enter text file path: ").strip()
    
    # Clean path
    file_path = file_path.strip('"').strip("'").strip()
    
    if not file_path:
        print("❌ No path provided!")
        return
    
    print()
    print("🤖 Analyzing text content...")
    print()
    
    result = analyze_text(file_path)
    
    if result['success']:
        print("=" * 70)
        print("📊 TEXT ANALYSIS RESULTS")
        print("=" * 70)
        print()
        print(f"📄 File: {result['file']}")
        print()
        print("📝 ORIGINAL CONTENT:")
        print("-" * 70)
        print(result['content'])
        print("-" * 70)
        print()
        print("🔍 ANALYSIS:")
        print("-" * 70)
        print(result['analysis'])
        print("-" * 70)
        print()
    else:
        print(f"❌ Error: {result['error']}")

if __name__ == "__main__":
    main()
