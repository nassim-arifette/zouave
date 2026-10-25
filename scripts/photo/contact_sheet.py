#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PHOTOS_ROOT = (SCRIPT_DIR / "../../web/public/photos").resolve()
DEFAULT_OUTPUT = SCRIPT_DIR / "out/contact_sheet.jpg"
TILE_WIDTH = 640
CELL_WIDTH = 664
LABEL_HEIGHT = 42
FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


def parse_args():
    parser = argparse.ArgumentParser(description="Build a contact sheet from street photos.")
    parser.add_argument("--manifest", type=Path, help="Manifest path override.")
    parser.add_argument("--photos-root", type=Path, default=DEFAULT_PHOTOS_ROOT, help="Photo directory override.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Contact-sheet output path.")
    parser.add_argument("--originals-only", action="store_true", help="Include only original photos.")
    return parser.parse_args()


def height_label(height):
    try:
        return format(float(height), "g").replace(".", ",")
    except ValueError:
        return str(height).replace(".", ",")


def photo_path(value, photos_root):
    if not value:
        raise ValueError("A manifest photo path is empty.")
    if value.startswith("/photos/"):
        relative = value.removeprefix("/photos/")
        resolved_root = photos_root.resolve()
        resolved = (resolved_root / relative).resolve()
        if resolved_root not in resolved.parents:
            raise ValueError(f"Photo path is outside --photos-root: {value}")
        return resolved
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    return photos_root / candidate


def load_tile(filename):
    with Image.open(filename) as image:
        image = image.convert("RGB")
        height = round(image.height * TILE_WIDTH / image.width)
        return image.resize((TILE_WIDTH, height), Image.Resampling.LANCZOS)


def load_font():
    try:
        return ImageFont.truetype(str(FONT_PATH), 22)
    except OSError:
        return ImageFont.load_default()


def main():
    args = parse_args()
    photos_root = args.photos_root.resolve()
    manifest_path = args.manifest.resolve() if args.manifest else photos_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    locations = manifest.get("locations", [])
    if not locations:
        raise ValueError("The manifest contains no locations.")

    flood_heights = set()
    if not args.originals_only:
        for location in locations:
            flood_heights.update((location.get("files", {}).get("flood", {}) or {}).keys())
    height_columns = sorted(flood_heights, key=lambda value: (float(value), str(value)))
    columns = ["original", *height_columns]

    rows = []
    max_image_height = 0
    for location in locations:
        label = location.get("label", location["slug"])
        files = location.get("files", {})
        original_value = files.get("original") or f"/photos/{location['slug']}/original.jpg"
        cells = {
            "original": (
                f"{label} — original",
                load_tile(photo_path(original_value, photos_root)),
            )
        }
        for height in height_columns:
            flood_value = (files.get("flood", {}) or {}).get(height)
            if flood_value:
                cells[height] = (
                    f"{label} — eau ≈ {height_label(height)} m",
                    load_tile(photo_path(flood_value, photos_root)),
                )
        max_image_height = max(
            max_image_height,
            *(image.height for _, image in cells.values()),
        )
        rows.append(cells)

    row_height = LABEL_HEIGHT + max_image_height + 24
    canvas = Image.new("RGB", (CELL_WIDTH * len(columns), row_height * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    font = load_font()
    for row_index, cells in enumerate(rows):
        row_top = row_index * row_height
        for column_index, column in enumerate(columns):
            cell = cells.get(column)
            if not cell:
                continue
            label, image = cell
            left = column_index * CELL_WIDTH + 12
            draw.text((left, row_top + 8), label, font=font, fill=(20, 20, 20))
            canvas.paste(image, (left, row_top + LABEL_HEIGHT))

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="JPEG", quality=90, optimize=True, progressive=True)
    print(output)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
