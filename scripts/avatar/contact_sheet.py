#!/usr/bin/env python3
"""Numbered contact sheet of the avatar options, previewed as round avatars on the dark UI navy.

Usage: python3 scripts/avatar/contact_sheet.py [out_dir] [sheet.png]   (requires Pillow)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

NAVY = (11, 26, 51)
CELL, PAD, LABEL_H = 480, 32, 72


def font(size):
    for f in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "out")
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else out / "contact_sheet.png"
    files = sorted(out.glob("option[0-9].png"))
    if not files:
        sys.exit(f"no option*.png in {out}")
    sheet = Image.new("RGB", (len(files) * (CELL + PAD) + PAD, CELL + LABEL_H + 2 * PAD + CELL // 3), NAVY)
    draw = ImageDraw.Draw(sheet)
    mask = Image.new("L", (CELL // 3, CELL // 3), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, CELL // 3 - 1, CELL // 3 - 1), fill=255)
    for i, f in enumerate(files):
        meta = f.with_suffix(".json")
        label = json.loads(meta.read_text())["label"] if meta.exists() else f.stem
        n = f.stem.removeprefix("option")
        x = PAD + i * (CELL + PAD)
        img = Image.open(f).convert("RGB")
        sheet.paste(img.resize((CELL, CELL), Image.LANCZOS), (x, PAD))
        draw.rounded_rectangle((x + 12, PAD + 12, x + 76, PAD + 76), 14, fill=(255, 255, 255))
        draw.text((x + 44, PAD + 44), n, font=font(44), fill=NAVY, anchor="mm")
        draw.text((x + CELL // 2, PAD + CELL + 30), f"{n}. {label}", font=font(26), fill=(230, 236, 245), anchor="mm")
        # Round preview at a typical voice-panel size.
        small = img.resize((CELL // 3, CELL // 3), Image.LANCZOS)
        sheet.paste(small, (x + CELL // 2 - CELL // 6, PAD + CELL + LABEL_H), mask)
    sheet.save(dest)
    print("wrote", dest)


if __name__ == "__main__":
    main()
