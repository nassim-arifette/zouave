"""Estimate a metric depth map for each street photo so the browser can build a
2.5D relief and flood it with real-time water (`web/src/hero.ts`).

Usage: python3 scripts/photo/depth.py [--slug SLUG] [--model MODEL]

Depth Anything V2 (metric, outdoor) predicts depth in metres but with a loose
global scale, so each map is rescaled so that the road just below the camera is
`CAMERA_HEIGHT` metres under the lens (Panoramax cameras sit at about 2 m).
Output per location: `depth.png`, a 16-bit depth map in centimetres packed as
R = high byte, G = low byte (lossless and decodable with a plain <canvas>), at
half the photo resolution, plus `depth` metadata in the manifest.

Requires: pip install torch transformers pillow numpy (CPU is fine: ~5 s/photo).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
MANIFEST = PUBLIC / "photos" / "manifest.json"
DEFAULT_MODEL = "depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf"
CAMERA_HEIGHT = 2.0
MAX_DEPTH_M = 120.0
OUTPUT_SCALE = 0.5


def predict(model_id: str, image: Image.Image) -> np.ndarray:
    processor = AutoImageProcessor.from_pretrained(model_id)
    model = AutoModelForDepthEstimation.from_pretrained(model_id).eval()
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        outputs = model(**inputs)
        depth = torch.nn.functional.interpolate(
            outputs.predicted_depth.unsqueeze(1), size=(image.height, image.width), mode="bicubic", align_corners=False
        ).squeeze()
    return depth.cpu().numpy().astype(np.float32)


def ground_scale(depth: np.ndarray, fov_deg: float, pitch_deg: float) -> float:
    """Scale factor so the road in the bottom rows sits CAMERA_HEIGHT below the lens."""
    h, w = depth.shape
    tan_x = np.tan(np.radians(fov_deg / 2))
    tan_y = tan_x * h / w
    rows = slice(int(h * 0.97), h)
    cols = slice(int(w * 0.1), int(w * 0.5))
    v = 1 - 2 * (np.arange(h)[rows, None] + 0.5) / h
    d = depth[rows, cols]
    y_cam = v * tan_y * d
    pitch = np.radians(pitch_deg)
    y_world = y_cam * np.cos(pitch) + d * np.sin(pitch)
    return float(CAMERA_HEIGHT / max(-np.median(y_world), 1e-3))


def encode(depth_m: np.ndarray, path: Path) -> None:
    cm = np.clip(np.round(depth_m * 100), 0, 65535).astype(np.uint16)
    rgb = np.zeros((*cm.shape, 3), dtype=np.uint8)
    rgb[..., 0] = cm >> 8
    rgb[..., 1] = cm & 255
    Image.fromarray(rgb, "RGB").save(path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    for location in manifest["locations"]:
        if args.slug and location["slug"] != args.slug:
            continue
        original = PUBLIC / location["files"]["original"].lstrip("/")
        image = Image.open(original).convert("RGB")
        view = location["photo"]["view"]
        depth = predict(args.model, image)
        scale = ground_scale(depth, view.get("fov", 80), view.get("pitch", 0))
        depth = np.clip(depth * scale, 0, MAX_DEPTH_M)
        size = (round(image.width * OUTPUT_SCALE), round(image.height * OUTPUT_SCALE))
        small = np.asarray(Image.fromarray(depth).resize(size, Image.BILINEAR))
        out = original.with_name("depth.png")
        encode(small, out)
        location["files"]["depth"] = f"/{out.relative_to(PUBLIC).as_posix()}"
        location["depth"] = {"model": args.model, "camera_height_m": CAMERA_HEIGHT, "scale": round(scale, 4), "unit": "cm", "encoding": "R*256+G"}
        print(f"{location['slug']}: scale {scale:.3f}, depth {small.min():.1f}-{np.median(small):.1f}-{small.max():.1f} m, {out.stat().st_size // 1024} kB")
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
