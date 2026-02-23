#!/usr/bin/env python3
"""
Music Identifier - Find song details from audio files
Uses Shazam API to identify music, artist, album, and more
"""

import sys
import os
import asyncio
from pathlib import Path
from shazamio import Shazam

async def identify_music(audio_path):
    """Identify music from audio file using Shazam"""
    
    print("=" * 70)
    print("🎵 MUSIC IDENTIFIER - Powered by Shazam")
    print("=" * 70)
    print()
    
    # Check if file exists
    path = Path(audio_path)
    if not path.exists():
        print(f"❌ File not found: {audio_path}")
        return
    
    # Check file type
    valid_extensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.mp4', '.avi', '.mov']
    if path.suffix.lower() not in valid_extensions:
        print(f"❌ Unsupported file type: {path.suffix}")
        print(f"   Supported: {', '.join(valid_extensions)}")
        return
    
    print(f"🎧 Analyzing: {path.name}")
    print()
    print("🔍 Searching Shazam database...")
    print()
    
    try:
        # Initialize Shazam
        shazam = Shazam()
        
        # Recognize the song
        result = await shazam.recognize(str(path))
        
        if not result or 'track' not in result:
            print("❌ No match found. The audio might be:")
            print("   • Too short or poor quality")
            print("   • Background music/instrumental")
            print("   • Not in Shazam's database")
            return
        
        track = result['track']
        
        # Display results
        print("=" * 70)
        print("✅ MUSIC IDENTIFIED")
        print("=" * 70)
        print()
        
        # Song Title
        if 'title' in track:
            print(f"🎵 Song: {track['title']}")
        
        # Artist
        if 'subtitle' in track:
            print(f"👤 Artist: {track['subtitle']}")
        
        # Album
        if 'sections' in track:
            for section in track['sections']:
                if section.get('type') == 'SONG':
                    metadata = section.get('metadata', [])
                    for item in metadata:
                        if item.get('title') == 'Album':
                            print(f"💿 Album: {item.get('text', 'Unknown')}")
                        elif item.get('title') == 'Released':
                            print(f"📅 Released: {item.get('text', 'Unknown')}")
                        elif item.get('title') == 'Label':
                            print(f"🏷️  Label: {item.get('text', 'Unknown')}")
        
        # Genres
        if 'genres' in track and 'primary' in track['genres']:
            print(f"🎸 Genre: {track['genres']['primary']}")
        
        # Shazam Count
        if 'shazamcount' in track:
            count = track['shazamcount']
            if count >= 1000000:
                print(f"🔥 Shazams: {count/1000000:.1f}M")
            elif count >= 1000:
                print(f"🔥 Shazams: {count/1000:.1f}K")
            else:
                print(f"🔥 Shazams: {count}")
        
        print()
        
        # Links
        print("🔗 LINKS:")
        
        # Spotify
        if 'hub' in track and 'providers' in track['hub']:
            for provider in track['hub']['providers']:
                if provider.get('type') == 'SPOTIFY':
                    print(f"   Spotify: {provider['actions'][0]['uri']}")
        
        # Apple Music
        if 'url' in track:
            print(f"   Apple Music: {track['url']}")
        
        # YouTube
        if 'sections' in track:
            for section in track['sections']:
                if section.get('type') == 'VIDEO':
                    for action in section.get('actions', []):
                        if 'uri' in action and 'youtube' in action['uri']:
                            print(f"   YouTube: {action['uri']}")
                            break
        
        print()
        
        # Lyrics preview
        if 'sections' in track:
            for section in track['sections']:
                if section.get('type') == 'LYRICS':
                    print("📝 LYRICS PREVIEW:")
                    lyrics = section.get('text', [])
                    preview = '\n'.join(lyrics[:4]) if isinstance(lyrics, list) else str(lyrics)[:200]
                    print(preview)
                    if len(lyrics) > 4:
                        print("   ...")
                    break
        
        print()
        print("=" * 70)
        
    except Exception as e:
        print(f"❌ Error during recognition: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Main entry point"""
    
    # Get file path
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        print("=" * 70)
        print("🎵 MUSIC IDENTIFIER - Powered by Shazam")
        print("=" * 70)
        print()
        audio_path = input("📂 Enter audio/video file path: ").strip()
    
    # Clean up path
    audio_path = audio_path.strip('"').strip("'").strip()
    
    if not audio_path:
        print("❌ No path provided!")
        return
    
    # Run async identification
    asyncio.run(identify_music(audio_path))

if __name__ == "__main__":
    main()
