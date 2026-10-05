"""
Generate brand assets from the user supplied official Repaido logo.
Creates:
- web/public/brand/repaido-logo.png
- web/public/brand/repaido-logo-transparent.png
- web/public/brand/repaido-icon.png
- web/public/brand/repaido-icon-squircle.png
- web/public/favicon.png
- web/public/favicon.ico
- android/app/src/main/res/drawable/repaido_logo.png
- android/app/src/main/res/drawable/repaido_logo_transparent.png
- android/app/src/main/res/drawable/repaido_icon.png
- android/app/src/main/res/mipmap-*/ic_launcher.png
- android/app/src/main/res/mipmap-*/ic_launcher_round.png
"""
import os
from PIL import Image, ImageOps, ImageDraw

SRC_PATH = "/Users/miku0027/.gemini/antigravity-ide/brain/a5b23e8e-dc9e-4e21-9bdd-6cf48afd5a22/.user_uploaded/media_1790050427340.png"
ROOT = "/Users/miku0027/Documents/ChatGPT/Repaido App"

def remove_white_background(img: Image.Image, threshold=245) -> Image.Image:
    """Convert white/near-white background to transparent RGBA with anti-aliasing."""
    img = img.convert("RGBA")
    datas = img.getdata()
    new_data = []
    for item in datas:
        r, g, b, a = item
        # Check brightness
        min_c = min(r, g, b)
        max_c = max(r, g, b)
        
        if min_c >= 252:
            new_data.append((255, 255, 255, 0))
        elif min_c > 220:
            # Transition edge: calculate alpha
            alpha = int(255 * (1.0 - (min_c - 220) / 32.0))
            alpha = max(0, min(255, alpha))
            new_data.append((r, g, b, alpha))
        else:
            new_data.append((r, g, b, 255))
    
    img.putdata(new_data)
    return img

def main():
    orig = Image.open(SRC_PATH).convert("RGB")
    
    # 1. Content bounding box
    gray = ImageOps.invert(orig.convert("L"))
    thresh = gray.point(lambda p: 255 if p > 15 else 0)
    bbox = thresh.getbbox() # (128, 82, 897, 262)
    print("Detected content bbox:", bbox)
    
    # Add a balanced padding of 20px
    pad = 20
    crop_box = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(orig.width, bbox[2] + pad),
        min(orig.height, bbox[3] + pad)
    )
    cropped_white = orig.crop(crop_box)
    
    # Generate transparent cropped logo
    cropped_transparent = remove_white_background(cropped_white)
    
    # Save Web Brand Assets
    web_brand_dir = os.path.join(ROOT, "web/public/brand")
    web_src_assets = os.path.join(ROOT, "web/src/assets")
    os.makedirs(web_brand_dir, exist_ok=True)
    os.makedirs(web_src_assets, exist_ok=True)
    
    # Also save in web/public/reference so legacy references work
    ref_dir = os.path.join(ROOT, "web/public/reference")
    os.makedirs(ref_dir, exist_ok=True)
    
    cropped_white.save(os.path.join(web_brand_dir, "repaido-logo.png"), "PNG", optimize=True)
    cropped_transparent.save(os.path.join(web_brand_dir, "repaido-logo-transparent.png"), "PNG", optimize=True)
    cropped_transparent.save(os.path.join(ref_dir, "logo-source.png"), "PNG", optimize=True)
    cropped_white.save(os.path.join(web_src_assets, "repaido-logo.png"), "PNG", optimize=True)
    cropped_transparent.save(os.path.join(web_src_assets, "repaido-logo-transparent.png"), "PNG", optimize=True)
    
    # 2. Extract House + Wrench Icon (x=128 to x=278, y=82 to y=262)
    house_box = (128, 82, 279, 262)
    house_img = orig.crop(house_box)
    house_transparent = remove_white_background(house_img)
    house_transparent.save(os.path.join(web_src_assets, "repaido-icon.png"), "PNG", optimize=True)
    
    # Create Square Icon 512x512
    icon_size = 512
    square_icon = Image.new("RGBA", (icon_size, icon_size), (255, 255, 255, 0))
    # Resize house to fit 380x380 inside 512x512
    hw, hh = house_transparent.size
    target_h = 380
    target_w = int(hw * (target_h / hh))
    resized_house = house_transparent.resize((target_w, target_h), Image.Resampling.LANCZOS)
    
    paste_x = (icon_size - target_w) // 2
    paste_y = (icon_size - target_h) // 2
    square_icon.paste(resized_house, (paste_x, paste_y), resized_house)
    square_icon.save(os.path.join(web_brand_dir, "repaido-icon.png"), "PNG", optimize=True)
    
    # Create Squircle / Rounded App Icon on clean white/offwhite
    squircle = Image.new("RGBA", (icon_size, icon_size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(squircle)
    draw.rounded_rectangle([16, 16, icon_size-16, icon_size-16], radius=96, fill=(255, 255, 255, 255), outline=(230, 235, 245, 255), width=4)
    squircle.paste(resized_house, (paste_x, paste_y), resized_house)
    squircle.save(os.path.join(web_brand_dir, "repaido-icon-squircle.png"), "PNG", optimize=True)
    squircle.save(os.path.join(web_src_assets, "repaido-icon-squircle.png"), "PNG", optimize=True)
    
    # Web Favicons
    fav_32 = square_icon.resize((32, 32), Image.Resampling.LANCZOS)
    fav_192 = square_icon.resize((192, 192), Image.Resampling.LANCZOS)
    fav_32.save(os.path.join(ROOT, "web/public/favicon.png"), "PNG")
    fav_192.save(os.path.join(ROOT, "web/public/favicon-192.png"), "PNG")
    fav_32.save(os.path.join(ROOT, "web/public/favicon.ico"), "ICO")
    
    # Generate clean SVG embeds so any legacy SVG reference gets the exact brand logo
    import base64
    with open(os.path.join(web_brand_dir, "repaido-logo-transparent.png"), "rb") as f:
        logo_b64 = base64.b64encode(f.read()).decode("utf-8")
    with open(os.path.join(web_brand_dir, "repaido-icon.png"), "rb") as f:
        icon_b64 = base64.b64encode(f.read()).decode("utf-8")
        
    lw, lh = cropped_transparent.size
    svg_logo = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {lw} {lh}" width="{lw}" height="{lh}">
  <image href="data:image/png;base64,{logo_b64}" width="{lw}" height="{lh}"/>
</svg>'''
    for svg_name in ["repaido-logo-primary.svg", "repaido-logo-navy.svg", "repaido-logo-white.svg"]:
        with open(os.path.join(web_brand_dir, svg_name), "w") as f:
            f.write(svg_logo)
            
    svg_icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,{icon_b64}" width="512" height="512"/>
</svg>'''
    for icon_name in ["repaido-mark-blue.svg", "repaido-mark-navy.svg", "repaido-mark-white.svg"]:
        with open(os.path.join(web_brand_dir, icon_name), "w") as f:
            f.write(svg_icon)
    with open(os.path.join(ROOT, "web/public/favicon.svg"), "w") as f:
        f.write(svg_icon)
    
    # 3. Android Drawables
    android_drawable = os.path.join(ROOT, "android/app/src/main/res/drawable")
    os.makedirs(android_drawable, exist_ok=True)
    
    cropped_white.save(os.path.join(android_drawable, "repaido_logo.png"), "PNG")
    cropped_transparent.save(os.path.join(android_drawable, "repaido_logo_transparent.png"), "PNG")
    square_icon.save(os.path.join(android_drawable, "repaido_icon.png"), "PNG")
    
    # 4. Android Mipmap Icons
    mipmap_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    
    for folder, size in mipmap_densities.items():
        dir_path = os.path.join(ROOT, f"android/app/src/main/res/{folder}")
        os.makedirs(dir_path, exist_ok=True)
        # Launcher icon
        scaled = squircle.resize((size, size), Image.Resampling.LANCZOS)
        scaled.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
        
        # Round launcher icon
        round_icon = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        r_draw = ImageDraw.Draw(round_icon)
        r_draw.ellipse([2, 2, size-2, size-2], fill=(255, 255, 255, 255), outline=(230, 235, 245, 255), width=max(1, size//48))
        inner_house = resized_house.resize((int(size * 0.72 * target_w / target_h), int(size * 0.72)), Image.Resampling.LANCZOS)
        rx = (size - inner_house.width) // 2
        ry = (size - inner_house.height) // 2
        round_icon.paste(inner_house, (rx, ry), inner_house)
        round_icon.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
        print(f"Generated {folder} ({size}x{size})")

    print("Brand assets generated successfully!")

if __name__ == "__main__":
    main()
