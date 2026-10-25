"""Download the source street photos listed in web/public/photos/manifest.json and
render each `original.jpg` (1600x896).

360° Panoramax panoramas are reprojected to a rectilinear (pinhole) view using the
`photo.view` parameters: absolute heading `yaw` (degrees from north), `pitch`, `roll`
and horizontal `fov`. `photo.camera_azimuth` is the heading at the left edge (u=0) of the panorama.
Flat photos are centre-cropped to 16:9-ish and resized.

    python3 scripts/photo/fetch_sources.py [--slug SLUG ...] [--manifest PATH] [--photos-root DIR]
"""

import argparse
import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
W, H = 1600, 896
CACHE = Path(__file__).with_name("out") / "sources"


def fetch(url: str) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (url.split("/pictures/")[-1].replace("/", "_") if "/pictures/" in url else Path(url).name)
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "zouave-demo/1.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    return Image.open(io.BytesIO(path.read_bytes())).convert("RGB")


def rot(yaw, pitch, roll):
    y, p, r = map(math.radians, (yaw, pitch, roll))
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), math.sin(p)], [0, -math.sin(p), math.cos(p)]])
    rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    return ry @ rx @ rz


def equirect_to_view(eq: Image.Image, yaw, pitch=0.0, roll=0.0, fov=80.0, w=W, h=H) -> Image.Image:
    src = np.asarray(eq, dtype=np.float32)
    sh, sw = src.shape[:2]
    f = (w / 2) / math.tan(math.radians(fov / 2))
    xs, ys = np.meshgrid(np.arange(w) - w / 2 + 0.5, np.arange(h) - h / 2 + 0.5)
    d = np.stack([xs, -ys, np.full_like(xs, f)], -1)
    d = d @ rot(yaw, pitch, roll).T
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arctan2(d[..., 1], np.hypot(d[..., 0], d[..., 2]))
    # Panoramax equirectangular images start (u=0) at the camera azimuth.
    u = (lon / (2 * math.pi) % 1) * sw - 0.5
    v = (0.5 - lat / math.pi) * sh - 0.5
    u0 = np.floor(u).astype(int)
    v0 = np.clip(np.floor(v).astype(int), 0, sh - 2)
    fu, fv = (u - u0)[..., None], np.clip(v - v0, 0, 1)[..., None]
    u0 %= sw
    u1 = (u0 + 1) % sw
    out = (src[v0, u0] * (1 - fu) * (1 - fv) + src[v0, u1] * fu * (1 - fv)
           + src[v0 + 1, u0] * (1 - fu) * fv + src[v0 + 1, u1] * fu * fv)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def crop_flat(img: Image.Image, view: dict) -> Image.Image:
    iw, ih = img.size
    target = W / H
    cw, ch = (iw, round(iw / target)) if iw / ih < target else (round(ih * target), ih)
    cy = view.get("center_y", 0.5)
    top = int(min(max(cy * ih - ch / 2, 0), ih - ch))
    left = (iw - cw) // 2
    return img.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS)


def save_jpeg(img: Image.Image, path: Path, limit=500_000):
    for q in range(92, 59, -2):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() < limit:
            break
    path.write_bytes(buf.getvalue())
    return q, buf.tell()


def render(loc: dict) -> Image.Image:
    photo = loc["photo"]
    img = fetch(photo["image_url"])
    view = photo.get("view", {})
    if photo.get("projection") == "equirectangular":
        return equirect_to_view(img, view["yaw"] - photo["camera_azimuth"], view.get("pitch", 0),
                                view.get("roll", 0), view.get("fov", 80))
    return crop_flat(img, view)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", action="append")
    ap.add_argument("--manifest", default=str(REPO / "web/public/photos/manifest.json"))
    ap.add_argument("--photos-root", default=str(REPO / "web/public/photos"))
    a = ap.parse_args()
    for loc in json.loads(Path(a.manifest).read_text())["locations"]:
        if a.slug and loc["slug"] not in a.slug:
            continue
        out = Path(a.photos_root) / loc["slug"] / "original.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        q, size = save_jpeg(render(loc), out)
        print(f"{out} q={q} {size // 1024} KB")


if __name__ == "__main__":
    main()
