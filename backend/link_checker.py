#!/usr/bin/env python3
"""
Instagram Link Validator
Validates Instagram post/reel/video URLs
"""

import re
from urllib.parse import urlparse

def is_valid_instagram_link(url):
    """
    Check if URL is a valid Instagram post/reel/video link
    
    Returns:
        tuple: (is_valid: bool, shortcode: str or None, error_message: str or None)
    """
    
    if not url or not isinstance(url, str):
        return False, None, "Empty or invalid URL"
    
    # Clean URL
    url = url.strip()
    
    # Parse URL
    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, None, f"Invalid URL format: {e}"
    
    # Check domain
    if parsed.netloc not in ['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am']:
        return False, None, "Not an Instagram URL"
    
    # Extract shortcode from path
    # Valid patterns: /p/ABC123/, /reel/ABC123/, /reels/ABC123/, /tv/ABC123/
    match = re.search(r'/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)', parsed.path)
    
    if not match:
        return False, None, "Not a valid Instagram post/reel/video URL"
    
    shortcode = match.group(1)
    
    # Validate shortcode format (Instagram shortcodes are alphanumeric with _ and -)
    if not re.match(r'^[A-Za-z0-9_-]+$', shortcode):
        return False, None, "Invalid Instagram shortcode format"
    
    return True, shortcode, None

def validate_link(url):
    """
    Validate Instagram link and return result
    
    Returns:
        dict: {
            'valid': bool,
            'shortcode': str or None,
            'error': str or None,
            'url': str
        }
    """
    
    is_valid, shortcode, error = is_valid_instagram_link(url)
    
    return {
        'valid': is_valid,
        'shortcode': shortcode,
        'error': error,
        'url': url
    }

# Test function
if __name__ == "__main__":
    test_urls = [
        "https://www.instagram.com/p/DRPQS8vj6Cz/",
        "https://instagram.com/reel/ABC123/",
        "https://www.instagram.com/reels/XYZ789/",
        "https://instagr.am/p/TEST123/",
        "https://www.instagram.com/username/",  # Invalid
        "https://youtube.com/watch?v=123",      # Invalid
        "",                                      # Invalid
    ]
    
    print("=" * 70)
    print("INSTAGRAM LINK VALIDATOR - TEST")
    print("=" * 70)
    print()
    
    for url in test_urls:
        result = validate_link(url)
        status = "✓ VALID" if result['valid'] else "✗ INVALID"
        print(f"{status}: {url if url else '(empty)'}")
        if result['valid']:
            print(f"  Shortcode: {result['shortcode']}")
        else:
            print(f"  Error: {result['error']}")
        print()
