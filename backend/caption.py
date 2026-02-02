#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simple Instagram Caption Extractor
Fast, reliable, no rate limiting using direct HTML parsing.
"""

import requests
import re
import sys
import json
import html
import io

# Force UTF-8 encoding for stdout on Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


def is_valid_instagram_url(url):
    """
    Check if the URL is a valid Instagram post/reel URL.
    
    Args:
        url: Instagram URL to validate
        
    Returns:
        Boolean indicating if URL is valid
    """
    patterns = [
        r'instagram\.com/p/[A-Za-z0-9_-]+',      # Regular posts
        r'instagram\.com/reel/[A-Za-z0-9_-]+',   # Reels
        r'instagram\.com/tv/[A-Za-z0-9_-]+',     # IGTV
    ]
    
    return any(re.search(pattern, url) for pattern in patterns)


def clean_caption(caption):
    """
    Clean the caption by removing metadata, hashtags, and decoding HTML entities.
    
    Args:
        caption: Raw caption text
        
    Returns:
        Cleaned caption text
    """
    if not caption:
        return caption
    
    # Decode HTML entities (e.g., &quot; -> ", &#x2764; -> ❤)
    caption = html.unescape(caption)
    
    # Remove Instagram metadata patterns - multiple variations
    # Pattern 1: "123 likes, 45 comments - username on Date: "
    # Pattern 2: "12K likes, 50 comments - username on Date: "
    # Pattern 3: "1,277 likes, 34 comments - username on Date: "
    caption = re.sub(r'^\s*[\d,\.]+[KMB]?\s*(likes?|comments?)[^:]*?:\s*["\']?', '', caption, flags=re.IGNORECASE)
    
    # Remove trailing quotes
    caption = re.sub(r'["\']\.?\s*$', '', caption)
    
    # Remove trailing metadata like "- See photos and videos"
    caption = re.sub(r'\s*-\s*See\s+(photos?|videos?).*$', '', caption, flags=re.IGNORECASE)
    
    # Remove "X likes, Y comments" patterns at the end
    caption = re.sub(r'\s*[\d,\.]+[KMB]?\s*(likes?|comments?).*$', '', caption, flags=re.IGNORECASE)
    
    # Remove hashtags (including the # symbol and the tag text)
    caption = re.sub(r'#\w+', '', caption)
    
    # Clean up extra quotes at the beginning and end
    caption = caption.strip('"\'')
    
    # Clean up extra whitespace and newlines
    caption = re.sub(r'\n\s*\n+', '\n', caption)  # Remove multiple blank lines
    caption = re.sub(r'[ \t]+', ' ', caption)  # Normalize spaces
    caption = caption.strip()
    
    # Remove lines that only contain dots or whitespace
    lines = caption.split('\n')
    lines = [line.strip() for line in lines if line.strip() and line.strip() != '.']
    caption = '\n'.join(lines)
    
    return caption



def get_caption(url):
    """
    Get the caption from an Instagram post or reel by parsing HTML.
    
    Args:
        url: Instagram post or reel URL
        
    Returns:
        Caption text or error message
    """
    # Validate URL
    if not is_valid_instagram_url(url):
        return "❌ Invalid Instagram URL. Please provide a valid post or reel link."
    
    # Clean URL - remove query parameters and trailing slashes
    url = url.split('?')[0].rstrip('/') + '/'
    
    try:
        # Request headers to mimic a browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        }
        
        # Make request
        response = requests.get(url, headers=headers, timeout=15)
        
        if response.status_code != 200:
            return f"❌ Error: Unable to fetch post (Status code: {response.status_code})"
        
        # Get text - let requests handle any decompression
        html = response.text
        
        # Method 1: Try to extract from JSON-LD structured data
        json_ld_pattern = r'<script type="application/ld\+json">(.*?)</script>'
        json_ld_matches = re.findall(json_ld_pattern, html, re.DOTALL)
        
        for json_str in json_ld_matches:
            try:
                data = json.loads(json_str)
                if isinstance(data, dict):
                    # Check for caption in various fields
                    caption = data.get('caption') or data.get('description') or data.get('articleBody')
                    if caption:
                        return clean_caption(caption)
            except:
                continue
        
        # Method 2: Extract from meta tags
        meta_patterns = [
            r'<meta property="og:description" content="([^"]*)"',
            r'<meta name="description" content="([^"]*)"',
            r'<meta property="og:title" content="([^"]*)"',
        ]
        
        for pattern in meta_patterns:
            match = re.search(pattern, html)
            if match:
                caption = match.group(1)
                caption = clean_caption(caption)
                if caption and len(caption) > 10:  # Make sure it's not just metadata
                    return caption
        
        # Method 3: Try to find in embedded JSON data
        shared_data_pattern = r'window\._sharedData\s*=\s*({.*?});'
        match = re.search(shared_data_pattern, html)
        if match:
            try:
                shared_data = json.loads(match.group(1))
                # Navigate through the nested structure
                entry_data = shared_data.get('entry_data', {})
                
                # Try PostPage
                if 'PostPage' in entry_data:
                    media = entry_data['PostPage'][0]['graphql']['shortcode_media']
                    caption_edges = media.get('edge_media_to_caption', {}).get('edges', [])
                    if caption_edges:
                        return clean_caption(caption_edges[0]['node']['text'])
                
            except:
                pass
        
        # Method 4: Try additional_data pattern
        additional_pattern = r'"caption":\s*"([^"]*)"'
        matches = re.findall(additional_pattern, html)
        if matches:
            # Get the longest caption (likely the actual post caption)
            caption = max(matches, key=len)
            if caption:
                # Decode unicode escapes
                caption = caption.encode().decode('unicode_escape')
                return clean_caption(caption)
        
        return "ℹ️ Could not extract caption. The post may have no caption or Instagram's HTML structure has changed."
            
    except requests.exceptions.Timeout:
        return "❌ Request timed out. Please check your internet connection and try again."
    
    except requests.exceptions.ConnectionError:
        return "❌ Connection error. Please check your internet connection."
    
    except requests.exceptions.RequestException as e:
        return f"❌ Request error: {str(e)}"
    
    except Exception as e:
        return f"❌ Unexpected error: {str(e)}"


def main():
    """Main function to run the caption extractor."""
    # Check if URL was provided as command line argument
    if len(sys.argv) > 1:
        url = sys.argv[1]
        # When called from API, just print the caption
        caption = get_caption(url)
        print(caption)
    else:
        # Interactive mode
        print("=" * 60)
        print("📸 Instagram Caption Extractor")
        print("=" * 60)
        print()
        
        # Prompt for URL
        url = input("Enter Instagram post or reel URL: ").strip()
        
        if not url:
            print("❌ No URL provided. Exiting.")
            return
        
        print()
        print("🔍 Fetching caption...")
        print()
        
        # Get and display caption
        caption = get_caption(url)
        
        print("📝 Caption:")
        print("-" * 60)
        print(caption)
        print("-" * 60)


if __name__ == "__main__":
    main()
