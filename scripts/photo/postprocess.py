#!/usr/bin/env python3
import argparse
import io
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PHOTOS_ROOT = (SCRIPT_DIR / "../../web/public/photos").resolve()
OUTPUT_ROOT = SCRIPT_DIR / "out"
MAX_BYTES = 500 * 1024
TARGET_WIDTH = 1600
FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def parse_args():
    parser = argparse.ArgumentParser(description="Convert flood edits to optimized JPEGs.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true", help="Process every location.")
    selection.add_argument("--slug", action="append", help="Location slug; repeat or use commas.")
    parser.add_argument("--height", action="append", help="Height in metres; repeat or use commas.")
    parser.add_argument("--manifest", type=Path, help="Manifest path override.")
    parser.add_argument("--photos-root", type=Path, default=DEFAULT_PHOTOS_ROOT, help="Photo directory override.")
    parser.add_argument("--src", type=Path, help="Use this raw PNG instead of the latest generated PNG.")
    parser.add_argument("--banner", action="store_true", help="Also create labelled simulation JPEGs.")
    parser.add_argument("--originals", action="store_true", help="Re-encode oversized originals.")
    return parser.parse_args()


def split_values(values):
    return [part.strip() for value in values or [] for part in value.split(",") if part.strip()]


def normalize_height(value):
    try:
        height = float(value)
    except ValueError as error:
        raise ValueError(f"Invalid height: {value}") from error
    if not math.isfinite(height) or height <= 0:
        raise ValueError(f"Invalid height: {value}")
    return format(height, "g")


def select_locations(manifest, args):
    locations = manifest.get("locations", [])
    if args.all:
        return locations
    requested = list(dict.fromkeys(split_values(args.slug)))
    by_slug = {location["slug"]: location for location in locations}
    unknown = [slug for slug in requested if slug not in by_slug]
    if unknown:
        raise ValueError(f"Unknown location slug(s): {', '.join(unknown)}")
    return [by_slug[slug] for slug in requested]


def selected_heights(location, override):
    heights = override if override else location.get("heights", [])
    return list(dict.fromkeys(normalize_height(str(height)) for height in heights))


def latest_raw_image(slug, height):
    directory = OUTPUT_ROOT / slug
    prefix = re.escape(f"flood_{height}m")
    pattern = re.compile(rf"^{prefix}(?:_v(\d+))?\.png$")
    matches = []
    if directory.is_dir():
        for path in directory.iterdir():
            match = pattern.match(path.name)
            if match and path.is_file():
                version = int(match.group(1)) if match.group(1) else 1
                matches.append((version, path))
    if not matches:
        raise FileNotFoundError(f"No raw PNG found for {slug} at {height}m in {directory}")
    return max(matches, key=lambda item: item[0])[1]


def resized_rgb(image):
    image = ImageOps.exif_transpose(image)
    if image.width != TARGET_WIDTH:
        target_height = round(image.height * TARGET_WIDTH / image.width)
        image = image.resize((TARGET_WIDTH, target_height), Image.Resampling.LANCZOS)
    return image.convert("RGB")


def restore_regions(image, location, height, photos_root):
    """Paste original pixels back over boxes the model altered above the waterline (e.g. rewritten text)."""
    boxes = (location.get("edit", {}).get("restore", {}) or {}).get(height, [])
    if not boxes:
        return image
    with Image.open(photos_root / location["slug"] / "original.jpg") as opened:
        original = opened.convert("RGB").resize(image.size, Image.Resampling.LANCZOS)
    image = image.convert("RGB")
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    for box in boxes:
        draw.rectangle(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    return Image.composite(original, image, mask)


def encode_jpeg(image):
    for quality in range(92, 59, -1):
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
        data = output.getvalue()
        if len(data) < MAX_BYTES:
            return data, quality
    return data, 60


def load_font(size):
    try:
        return ImageFont.truetype(str(FONT_PATH), size=size)
    except OSError:
        return ImageFont.load_default()


def with_banner(image, location, height):
    image = image.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    margin = 24
    label = "SIMULATION"
    label_font = load_font(44)
    label_box = draw.textbbox((0, 0), label, font=label_font)
    label_width = label_box[2] - label_box[0]
    label_height = label_box[3] - label_box[1]
    band_width = label_width + 44
    band_height = label_height + 30
    draw.rectangle(
        (margin, margin, margin + band_width, margin + band_height),
        fill=(255, 255, 255, 255),
    )
    draw.rectangle(
        (margin + 4, margin + 4, margin + band_width - 4, margin + band_height - 4),
        fill=(190, 30, 45, 255),
    )
    draw.text(
        (margin + 22, margin + (band_height - label_height) / 2 - label_box[1]),
        label,
        font=label_font,
        fill=(255, 255, 255, 255),
    )

    caption = f"Crue type 1910 · eau ≈ {height.replace('.', ',')} m · image retouchée par IA"
    caption_font = load_font(22)
    caption_box = draw.textbbox((0, 0), caption, font=caption_font)
    caption_width = caption_box[2] - caption_box[0]
    caption_height = caption_box[3] - caption_box[1]
    caption_top = margin + band_height + 8
    caption_left = margin
    draw.rectangle(
        (caption_left, caption_top, caption_left + caption_width + 24, caption_top + caption_height + 18),
        fill=(25, 25, 25, 220),
    )
    draw.text(
        (caption_left + 12, caption_top + 8 - caption_box[1]),
        caption,
        font=caption_font,
        fill=(255, 255, 255, 255),
    )

    credit = location.get("credit", "").strip()
    if credit:
        credit_font = load_font(18)
        credit_box = draw.textbbox((0, 0), credit, font=credit_font)
        credit_width = credit_box[2] - credit_box[0]
        credit_height = credit_box[3] - credit_box[1]
        credit_left = max(8, image.width - credit_width - 36)
        credit_top = image.height - credit_height - 34
        draw.rectangle(
            (credit_left, credit_top, image.width - 12, image.height - 12),
            fill=(0, 0, 0, 190),
        )
        draw.text(
            (credit_left + 12, credit_top + 8 - credit_box[1]),
            credit,
            font=credit_font,
            fill=(255, 255, 255, 255),
        )
    return Image.alpha_composite(image, overlay).convert("RGB")


def save_manifest(path, manifest):
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    args = parse_args()
    photos_root = args.photos_root.resolve()
    manifest_path = args.manifest.resolve() if args.manifest else photos_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    locations = select_locations(manifest, args)
    if not locations:
        raise ValueError("No locations selected.")

    height_override = [normalize_height(height) for height in split_values(args.height)]
    flood_jobs = [
        (location, height)
        for location in locations
        for height in selected_heights(location, height_override)
    ]
    if args.src and len(flood_jobs) != 1:
        raise ValueError("--src requires exactly one selected location and height.")
    if not flood_jobs and not args.originals:
        raise ValueError("No heights selected; provide --height or use --originals.")

    changed = False
    for location in locations:
        if not args.originals:
            continue
        original_path = photos_root / location["slug"] / "original.jpg"
        with Image.open(original_path) as opened:
            image = resized_rgb(opened)
        if original_path.stat().st_size > MAX_BYTES:
            encoded, quality = encode_jpeg(image)
            original_path.write_bytes(encoded)
            print(f"Optimized {original_path} at quality={quality} ({len(encoded)} bytes)")
            changed = True

    for location, height in flood_jobs:
        source = args.src.resolve() if args.src else latest_raw_image(location["slug"], height)
        with Image.open(source) as opened:
            image = resized_rgb(restore_regions(opened, location, height, photos_root))
        encoded, quality = encode_jpeg(image)
        destination_dir = photos_root / location["slug"]
        destination_dir.mkdir(parents=True, exist_ok=True)
        flood_name = f"flood_{height}m.jpg"
        destination = destination_dir / flood_name
        destination.write_bytes(encoded)
        public_path = f"/photos/{location['slug']}/{flood_name}"
        files = location.setdefault("files", {})
        flood_files = files.setdefault("flood", {})
        flood_files[height] = public_path
        print(f"Saved {destination} at quality={quality} ({len(encoded)} bytes)")
        if len(encoded) >= MAX_BYTES:
            print(f"Warning: {destination} exceeds 500 KB at quality 60.", file=sys.stderr)

        if args.banner:
            banner_image = with_banner(image, location, height)
            banner_bytes, banner_quality = encode_jpeg(banner_image)
            banner_name = f"flood_{height}m_banner.jpg"
            banner_path = destination_dir / banner_name
            banner_path.write_bytes(banner_bytes)
            banner_files = files.setdefault("flood_banner", {})
            banner_files[height] = f"/photos/{location['slug']}/{banner_name}"
            print(f"Saved {banner_path} at quality={banner_quality} ({len(banner_bytes)} bytes)")
            if len(banner_bytes) >= MAX_BYTES:
                print(f"Warning: {banner_path} exceeds 500 KB at quality 60.", file=sys.stderr)
        changed = True

    if changed:
        save_manifest(manifest_path, manifest)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
