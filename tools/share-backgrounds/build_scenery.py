"""
Builds the Share Studio "Scenery" backgrounds from scenery-sources.json.

  python -P build_scenery.py <cache-dir>

1. Downloads each source photo from the Unsplash CDN (height-bounded to 2600 px,
   q95) into <cache-dir>, unless it is already there. Nothing is downloaded at
   app runtime: the outputs are bundled with the app.
2. Scales it to cover 1080 x 1920 (the Story card, the tallest format) with
   Lanczos, crops around focalX (default centre), and saves an optimized
   baseline JPEG (quality 82) to mobile/assets/share-backgrounds/scenery/.
   Post (4:5) and Square (1:1) cards show a centred crop of the same image.
3. Finds the weakest cream overlay that keeps the card text readable on that
   photo: over the text area of every format (inside the card padding, after a
   small blur that stands in for a letter stroke), the 1st-percentile pixel
   must give the Arabic/translation ink >= 7:1 (WCAG AAA) and the reference /
   branding ink >= 4.5:1. The value is rounded up to 0.01 and never below
   OVERLAY_FLOOR, so every card keeps the same soft, cream look.
   ShareAyahCard draws exactly this overlay (shareCardScenery.ts holds the
   numbers; tests/shareCardScenery.test.ts checks they match the manifest).
4. Writes docs/share-backgrounds/scenery-manifest.json and a numbered contact
   sheet, docs/share-backgrounds/scenery-contact-sheet.jpg.

Requires Python 3 with Pillow and numpy.
"""
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSETS = os.path.join(ROOT, "mobile", "assets", "share-backgrounds", "scenery")
DOCS = os.path.join(ROOT, "docs", "share-backgrounds")

WIDTH, HEIGHT = 1080, 1920
JPEG_QUALITY = 82
OVERLAY_FLOOR = 0.45
# Keep in sync with SCENERY_CARD_THEME / SHARE_CARD_SCENERY_OVERLAY_COLOR (mobile/src/constants/shareCardScenery.ts).
OVERLAY_COLOR = "#F7F2EA"
INK = "#1F2A24"
SECONDARY_INK = "#2D3826"
# (card height, paddingX, paddingTop, paddingBottom) — SHARE_CARD_FORMAT_SPECS in shareCardLayout.ts.
FORMATS = {"story": (1920, 100, 250, 250), "post": (1350, 96, 124, 104), "square": (1080, 88, 96, 84)}


def rgb(hex_color):
    return np.array([int(hex_color[i:i + 2], 16) for i in (1, 3, 5)], float)


def luminance(values):
    c = values / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def download(photo, cache):
    path = os.path.join(cache, f"{photo['unsplashId']}.jpg")
    if not os.path.exists(path):
        url = f"https://images.unsplash.com/{photo['image']}?h=2600&q=95&fm=jpg"
        with urllib.request.urlopen(url, timeout=60) as response, open(path, "wb") as out:
            out.write(response.read())
    meta_url = f"https://images.unsplash.com/{photo['image']}?fm=json"
    with urllib.request.urlopen(meta_url, timeout=60) as response:
        meta = json.load(response)
    width, height = meta["PixelWidth"], meta["PixelHeight"]
    if meta.get("Orientation", 1) in (5, 6, 7, 8):
        width, height = height, width
    return path, (width, height)


def render(source, focal_x):
    image = Image.open(source).convert("RGB")
    scale = max(WIDTH / image.width, HEIGHT / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    x = min(max(round(image.width * focal_x - WIDTH / 2), 0), image.width - WIDTH)
    y = (image.height - HEIGHT) // 2
    return image.crop((x, y, x + WIDTH, y + HEIGHT))


def required_overlay(image):
    # A 1/3-scale copy after a small blur: the blur averages over about one letter stroke.
    k = 3
    pixels = np.asarray(image.filter(ImageFilter.BoxBlur(4)).resize((WIDTH // k, HEIGHT // k), Image.BOX), float)
    regions = []
    for height, pad_x, top, bottom in FORMATS.values():
        offset = (HEIGHT - height) // 2
        regions.append(pixels[(offset + top) // k:(offset + height - bottom) // k, pad_x // k:(WIDTH - pad_x) // k].reshape(-1, 3))
    region = np.concatenate(regions)
    cream = rgb(OVERLAY_COLOR)
    ink, secondary = float(luminance(rgb(INK))), float(luminance(rgb(SECONDARY_INK)))

    def readable(alpha):
        darkest = float(np.percentile(luminance(alpha * cream + (1 - alpha) * region), 1))
        return contrast(darkest, ink) >= 7 and contrast(darkest, secondary) >= 4.5

    lo, hi = 0.0, 1.0
    for _ in range(16):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if readable(mid) else (mid, hi)
    return max(OVERLAY_FLOOR, np.ceil(hi * 100) / 100)


def contact_sheet(entries, path):
    tile_w, tile_h, label_h, gap, cols = 216, 384, 44, 22, 6
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tile_w + gap) + gap, rows * (tile_h + label_h + gap) + gap + 40), "#F7F2EA")
    draw = ImageDraw.Draw(sheet)
    try:
        title_font = ImageFont.truetype("arialbd.ttf", 22)
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        title_font = font = ImageFont.load_default()
    draw.text((gap, 12), f"Quran Heals — Share Studio Scenery backgrounds: {len(entries)} photographs (Story crop, 1080 x 1920)", fill="#1F2A24", font=title_font)
    for index, entry in enumerate(entries):
        col, row = index % cols, index // cols
        x, y = gap + col * (tile_w + gap), 52 + row * (tile_h + label_h + gap)
        tile = Image.open(os.path.join(ASSETS, entry["file"])).resize((tile_w, tile_h), Image.LANCZOS)
        sheet.paste(tile, (x, y))
        draw.text((x, y + tile_h + 4), entry["file"], fill="#1F2A24", font=font)
        draw.text((x, y + tile_h + 22), f"{entry['photographer']} · {entry['overlayOpacity']:.2f}", fill="#5F6960", font=font)
    sheet.save(path, quality=88)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)
    sources = json.load(open(os.path.join(HERE, "scenery-sources.json"), encoding="utf-8"))
    entries = []
    for index, photo in enumerate(sources["photos"], start=1):
        source, original = download(photo, cache)
        image = render(source, photo.get("focalX", 0.5))
        file_name = f"{index:02d}-{photo['id']}.jpg"
        out = os.path.join(ASSETS, file_name)
        image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=False)
        entries.append({
            "id": photo["id"],
            "file": file_name,
            "theme": photo["theme"],
            "description": photo["description"],
            "sourceUrl": f"https://unsplash.com/photos/{photo['unsplashId']}",
            "photographer": photo["photographer"],
            "photographerUrl": f"https://unsplash.com/@{photo['username']}",
            "license": sources["license"]["name"],
            "originalSize": list(original),
            "optimizedSize": [WIDTH, HEIGHT],
            "bytes": os.path.getsize(out),
            "overlayOpacity": float(required_overlay(image)),
        })
        print(f"{file_name:36s} {entries[-1]['bytes'] / 1024:7.1f} KB  overlay {entries[-1]['overlayOpacity']:.2f}")
    manifest = {
        "license": sources["license"],
        "format": {"width": WIDTH, "height": HEIGHT, "type": "baseline JPEG", "quality": JPEG_QUALITY},
        "overlay": {"color": OVERLAY_COLOR, "floor": OVERLAY_FLOOR, "ink": INK, "secondaryInk": SECONDARY_INK,
                    "rule": "1st-percentile pixel of every format's text area: ink >= 7:1, secondary ink >= 4.5:1"},
        "totalBytes": sum(entry["bytes"] for entry in entries),
        "photos": entries,
    }
    with open(os.path.join(DOCS, "scenery-manifest.json"), "w", encoding="utf-8") as out:
        json.dump(manifest, out, ensure_ascii=False, indent=2)
        out.write("\n")
    contact_sheet(entries, os.path.join(DOCS, "scenery-contact-sheet.jpg"))
    print(f"total {manifest['totalBytes'] / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
