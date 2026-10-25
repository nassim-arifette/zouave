#!/usr/bin/env python3
"""Turns picked avatar options into web assets under web/public/zouave/<variant>/.

For each variant: aligns the OpenAI "speaking" edit onto the original (ECC affine), pastes back only a
feathered mouth patch so both frames are pixel-aligned, cuts out the background (rembg isnet-general-use)
or keeps a round crop, then writes avatar.png (512), avatar@2x.png (1024), avatar-speaking.png (+@2x),
WebP copies of each, and favicons.

Usage: python3 scripts/avatar/finalize.py   (requires pillow, numpy, opencv-python-headless, rembg)
"""
import base64
import io
import json
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import new_session, remove

HERE = Path(__file__).parent
OUT = HERE / "out"
WEB = HERE.parent.parent / "web" / "public" / "zouave"
NAVY = (11, 26, 51, 255)

# option id -> (folder name, background mode, favicon face box in 1024 px)
VARIANTS = {
    1: ("stone", "cutout", (300, 20, 780, 500)),
    2: ("living-stone", "cutout", (300, 10, 780, 490)),
    4: ("bronze-flood", "round", (310, 30, 770, 490)),
}
DEFAULT = 2


def mouth_boxes():
    src = (HERE / "prompts.mjs").read_text()
    block = src[src.index("MOUTH_BOXES"):]
    return {int(k): tuple(map(int, v.split(","))) for k, v in re.findall(r"(\d+): \[([\d, ]+)\]", block)}


def align(src, ref, box):
    """Warp src onto ref with an affine ECC fit that ignores the edited mouth area."""
    g = lambda im: cv2.cvtColor(np.asarray(im.convert("RGB")), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    mask = np.full((1024, 1024), 255, np.uint8)
    x0, y0, x1, y1 = box
    mask[y0 - 40:y1 + 40, x0 - 40:x1 + 40] = 0
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    _, warp = cv2.findTransformECC(g(ref), g(src), warp, cv2.MOTION_AFFINE, crit, mask, 5)
    out = cv2.warpAffine(np.asarray(src.convert("RGB")), warp, (1024, 1024),
                         flags=cv2.INTER_LANCZOS4 + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out), warp


def mouth_patch(base, speaking, box):
    x0, y0, x1, y1 = box
    m = Image.new("L", base.size, 0)
    ImageDraw.Draw(m).ellipse((x0 - 6, y0 - 6, x1 + 6, y1 + 6), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(14))
    return Image.composite(speaking, base, m)


def round_crop(im):
    m = Image.new("L", (4096, 4096), 0)
    ImageDraw.Draw(m).ellipse((8, 8, 4087, 4087), fill=255)
    out = im.convert("RGBA")
    out.putalpha(m.resize(im.size, Image.LANCZOS))
    return out


def save_sizes(im, folder, stem):
    small = im.resize((512, 512), Image.LANCZOS)
    im.save(folder / f"{stem}@2x.png", optimize=True)
    small.save(folder / f"{stem}.png", optimize=True)
    # Lightweight copies for the web app (a few dozen KB instead of ~2 MB).
    im.save(folder / f"{stem}@2x.webp", quality=86, method=6)
    small.save(folder / f"{stem}.webp", quality=86, method=6)


def favicons(base, face_box, folder):
    face = base.convert("RGB").crop(face_box).resize((1024, 1024), Image.LANCZOS)
    disc = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    disc.paste(Image.new("RGBA", (1024, 1024), NAVY), (0, 0), round_crop(face).getchannel("A"))
    disc.alpha_composite(round_crop(face))
    icon = lambda s: disc.resize((s, s), Image.LANCZOS)
    icon(32).save(folder / "favicon-32.png", optimize=True)
    icon(192).save(folder / "icon-192.png", optimize=True)
    icon(512).save(folder / "icon-512.png", optimize=True)
    # Apple touch icons must be opaque.
    apple = Image.new("RGBA", (180, 180), NAVY)
    apple.alpha_composite(icon(180))
    apple.convert("RGB").save(folder / "apple-touch-icon.png", optimize=True)
    disc.save(folder / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    buf = io.BytesIO()
    icon(96).save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    (folder / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">'
        f'<image width="96" height="96" href="data:image/png;base64,{b64}"/></svg>\n')


def main():
    boxes = mouth_boxes()
    session = new_session("isnet-general-use")
    manifest = {"default": VARIANTS[DEFAULT][0], "variants": {}}
    for oid, (name, mode, face_box) in VARIANTS.items():
        folder = WEB / name
        folder.mkdir(parents=True, exist_ok=True)
        base = Image.open(OUT / f"option{oid}.png").convert("RGB")
        raw = Image.open(OUT / f"option{oid}_speaking_raw.png").convert("RGB")
        aligned, warp = align(raw, base, boxes[oid])
        speaking = mouth_patch(base, aligned, boxes[oid])
        if mode == "cutout":
            alpha = remove(base, session=session, only_mask=True)
            frames = [base.convert("RGBA"), speaking.convert("RGBA")]
            for f in frames:
                f.putalpha(alpha)
        else:
            frames = [round_crop(base), round_crop(speaking)]
        save_sizes(frames[0], folder, "avatar")
        save_sizes(frames[1], folder, "avatar-speaking")
        favicons(base, face_box, folder)
        manifest["variants"][name] = {"option": oid, "background": mode}
        print(f"{name}: affine {np.round(warp, 3).tolist()}")
    # Top-level files mirror the default variant so the app can use /zouave/avatar.png directly.
    default = WEB / VARIANTS[DEFAULT][0]
    for f in default.iterdir():
        (WEB / f.name).write_bytes(f.read_bytes())
    (WEB / "variants.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
