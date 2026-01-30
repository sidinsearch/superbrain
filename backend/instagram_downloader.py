import instaloader
import sys
import re
import os
import shutil
from urllib.request import urlretrieve
from moviepy.editor import VideoFileClip
import contextlib

def sanitize_folder_name(text, max_length=50):
    """Sanitize text for use as folder name"""
    # Remove emojis and special Unicode characters
    text = text.encode('ascii', 'ignore').decode('ascii')
    # Remove or replace invalid characters
    text = re.sub(r'[<>:"/\\|?*\n\r]', '', text)
    # Replace multiple spaces with single space
    text = re.sub(r'\s+', ' ', text)
    # Trim and limit length
    text = text.strip()[:max_length]
    return text if text else "instagram_post"

def extract_audio_from_video(video_path, audio_path):
    """Extract audio from video file and save separately"""
    try:
        print(f"  Extracting audio...")
        video = VideoFileClip(video_path)
        if video.audio is not None:
            video.audio.write_audiofile(audio_path, verbose=False, logger=None)
            video.close()
            print(f"  ✓ Audio saved: {os.path.basename(audio_path)}")
            return True
        else:
            video.close()
            print(f"  ⚠ No audio in video")
            return False
    except Exception as e:
        print(f"  ⚠ Audio extraction failed: {e}")
        return False

def download_instagram_content(url):
    # Set download directory to temp folder in backend
    temp_dir = os.path.join(os.path.dirname(__file__), 'temp')
    
    # Ensure the temp directory exists
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)

    # Initialize Instaloader
    L = instaloader.Instaloader(
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        max_connection_attempts=3
    )
    
    # Extract shortcode from URL
    match = re.search(r'/(?:reels?|p|tv)/([^/?#&]+)', url)
    if not match:
        print("Invalid Instagram link. Please provide a valid Reel, Post, or IGTV link.")
        return

    shortcode = match.group(1)
    
    try:
        print(f"Fetching content for shortcode: {shortcode}...")
        
        # Suppress 403 retry warnings (they're harmless, library auto-retries)
        with contextlib.redirect_stderr(open(os.devnull, 'w')):
            post = instaloader.Post.from_shortcode(L.context, shortcode)
        
        # Get caption and create folder name
        caption = post.caption if post.caption else f"post_{shortcode}"
        caption_first_line = caption.split('\n')[0] if caption else f"post_{shortcode}"
        folder_name = sanitize_folder_name(caption_first_line)
        
        # Create unique folder
        final_folder = os.path.join(temp_dir, folder_name)
        counter = 1
        original_folder_name = folder_name
        while os.path.exists(final_folder):
            folder_name = f"{original_folder_name}_{counter}"
            final_folder = os.path.join(temp_dir, folder_name)
            counter += 1
        
        os.makedirs(final_folder, exist_ok=True)
        
        print(f"Downloading content from @{post.owner_username}...")
        print(f"Caption: {caption_first_line[:60]}...")
        
        # Download all media files
        file_counter = 1
        
        if post.is_video:
            # Download video
            video_path = os.path.join(final_folder, f"{folder_name}.mp4")
            print(f"Downloading video...")
            urlretrieve(post.video_url, video_path)
            
            # Extract audio from video
            audio_path = os.path.join(final_folder, f"{folder_name}_audio.mp3")
            extract_audio_from_video(video_path, audio_path)
            
            # Download video thumbnail
            thumb_path = os.path.join(final_folder, f"{folder_name}_thumbnail.jpg")
            urlretrieve(post.url, thumb_path)
        else:
            # Download images (works for single and carousel posts)
            if post.typename == 'GraphSidecar':
                # Multiple images/videos in carousel
                print(f"Downloading {post.mediacount} items from carousel post...")
                for node in post.get_sidecar_nodes():
                    if node.is_video:
                        file_path = os.path.join(final_folder, f"{folder_name}_{file_counter}.mp4")
                        urlretrieve(node.video_url, file_path)
                        
                        # Extract audio from carousel video
                        audio_path = os.path.join(final_folder, f"{folder_name}_{file_counter}_audio.mp3")
                        extract_audio_from_video(file_path, audio_path)
                    else:
                        file_path = os.path.join(final_folder, f"{folder_name}_{file_counter}.jpg")
                        urlretrieve(node.display_url, file_path)
                    print(f"  Downloaded item {file_counter}/{post.mediacount}")
                    file_counter += 1
            else:
                # Single image
                print(f"Downloading image...")
                image_path = os.path.join(final_folder, f"{folder_name}.jpg")
                urlretrieve(post.url, image_path)
        
        # Create info text file
        info_file = os.path.join(final_folder, 'info.txt')
        with open(info_file, 'w', encoding='utf-8') as f:
            f.write(f"Instagram Post Information\n")
            f.write(f"=" * 50 + "\n\n")
            f.write(f"URL: {url}\n")
            f.write(f"Username: @{post.owner_username}\n")
            f.write(f"Date: {post.date_utc}\n")
            f.write(f"Likes: {post.likes}\n")
            f.write(f"Type: {'Video' if post.is_video else 'Image'}\n")
            if post.typename == 'GraphSidecar':
                f.write(f"Media Count: {post.mediacount} items\n")
            f.write(f"\n")
            f.write(f"Caption:\n{'-' * 50}\n")
            f.write(post.caption if post.caption else "No caption")
            f.write(f"\n{'-' * 50}\n\n")
            
            # Extract hashtags
            if post.caption:
                hashtags = re.findall(r'#\w+', post.caption)
                if hashtags:
                    f.write(f"Hashtags:\n")
                    f.write(', '.join(hashtags))
        
        print(f"\nDownload completed successfully!")
        print(f"Files saved to: {final_folder}")
        
        return final_folder  # Return folder path for main.py
        
    except instaloader.exceptions.LoginRequiredException:
        print("\nError: Login Required. Instagram is blocking anonymous access for this content.")
    except instaloader.exceptions.ConnectionException as e:
        print(f"\nConnection Error: {e}. Instagram might be rate-limiting you.")
    except Exception as e:
        print(f"\nAn error occurred: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        url = input("Enter the Instagram Reel/Post/Video link: ").strip()
    
    if url:
        download_instagram_content(url)
    else:
        print("No URL provided.")
