from PIL import Image, ImageDraw, ImageFont
import os

# Create assets folder if it doesn't exist
os.makedirs('assets', exist_ok=True)

def create_icon(size, filename, bg_color='#667eea', emoji='🧠'):
    """Create an icon with emoji"""
    # Create image with background
    img = Image.new('RGBA', (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Try to add emoji text (will work on systems with emoji font support)
    try:
        # Calculate font size (roughly 55% of image size for proper fit)
        font_size = int(size * 0.55)
        
        # For Windows, try to use Segoe UI Emoji
        try:
            font = ImageFont.truetype("seguiemj.ttf", font_size)
        except:
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except:
                font = ImageFont.load_default()
        
        # Calculate text position to center it properly
        # Get text bbox for accurate positioning
        bbox = draw.textbbox((0, 0), emoji, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Center horizontally and vertically with slight adjustment
        x = (size - text_width) // 2 - bbox[0]
        y = (size - text_height) // 2 - bbox[1]
        
        # Draw emoji
        draw.text((x, y), emoji, font=font, fill='white', embedded_color=True)
    except Exception as e:
        print(f"Could not add emoji: {e}")
        # Fallback: create a brain-like shape
        margin = size // 6
        # Main circle for brain
        draw.ellipse([margin, margin, size-margin, size-margin], fill='white')
    
    # Save
    img.save(f'assets/{filename}', 'PNG')
    print(f'Created assets/{filename}')

# Generate all required icons
print('Generating app icons...')

# Main icon (1024x1024)
create_icon(1024, 'icon.png')

# Adaptive icon (Android, 1024x1024)
create_icon(1024, 'adaptive-icon.png')

# Splash icon (1024x1024)
create_icon(1024, 'splash-icon.png')

# Favicon (48x48)
create_icon(48, 'favicon.png')

print('All icons generated successfully!')
