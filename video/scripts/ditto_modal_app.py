"""Ditto-TalkingHead (Ant Group, Apache-2.0) on a Modal GPU — PyTorch path.

Audio-driven whole-head animation built on LivePortrait: it warps the source
image (texture, beard and moustache are preserved) instead of repainting the mouth.

  modal run ditto_app.py --image portrait.png --audio voice.wav --out result.mp4

Outputs are persisted to the `zouave-lipsync` volume (/vol/out) and committed
before returning. One job per container.
"""
import time
from pathlib import Path

import modal

DITTO_COMMIT = "c3e47eee2e626500017a0556b470d6d4182f85e8"
CKPT = "/vol/ditto"
OUT = "/vol/out"

vol = modal.Volume.from_name("zouave-lipsync", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "git", "build-essential", "libgl1", "libglib2.0-0", "libsm6", "libxext6")
    .pip_install("torch==2.4.1", "torchvision==0.19.1", "torchaudio==2.4.1",
                 index_url="https://download.pytorch.org/whl/cu121")
    .pip_install(
        "onnxruntime-gpu==1.19.2", "mediapipe==0.10.14", "numpy==1.26.4", "librosa", "tqdm", "filetype",
        "imageio", "imageio-ffmpeg", "opencv-python-headless", "scikit-image", "cython", "colored",
        "einops", "scipy", "huggingface_hub",
    )
    .run_commands(
        f"git clone https://github.com/antgroup/ditto-talkinghead /root/ditto && cd /root/ditto && git checkout {DITTO_COMMIT}",
    )
    .env({"PYTHONUNBUFFERED": "1"})
)

app = modal.App("zouave-ditto", image=image)


def ensure_weights():
    from huggingface_hub import snapshot_download
    marker = Path(CKPT) / "ditto_pytorch" / "models" / "warp_network.pth"
    if marker.exists():
        return False
    snapshot_download("digital-avatar/ditto-talkinghead", local_dir=CKPT,
                      allow_patterns=["ditto_cfg/v0.4_hubert_cfg_pytorch.pkl", "ditto_pytorch/*"])
    vol.commit()
    return True


@app.function(gpu="A10G", volumes={"/vol": vol}, timeout=60 * 40)
def animate(image_bytes: bytes, audio: bytes, name: str, ext: str = "png") -> dict:
    import subprocess, shutil

    t0 = time.time()
    downloaded = ensure_weights()
    t1 = time.time()
    work = Path("/root/work"); work.mkdir(exist_ok=True)
    src, aud, res = work / f"{name}.{ext}", work / f"{name}.wav", work / f"{name}.mp4"
    src.write_bytes(image_bytes); aud.write_bytes(audio)
    cmd = ["python", "inference.py", "--data_root", f"{CKPT}/ditto_pytorch",
           "--cfg_pkl", f"{CKPT}/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl",
           "--audio_path", str(aud), "--source_path", str(src), "--output_path", str(res)]
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    proc = subprocess.run(cmd, cwd="/root/ditto", capture_output=True, text=True)
    log = proc.stdout[-5000:] + "\n--- stderr ---\n" + proc.stderr[-5000:]
    ok = proc.returncode == 0 and res.exists()
    out_dir = Path(OUT); out_dir.mkdir(parents=True, exist_ok=True)
    if ok:
        shutil.copy(res, out_dir / f"{name}.mp4")
    (out_dir / f"{name}.log").write_text(log)
    vol.commit()
    return {"ok": ok, "returncode": proc.returncode, "gpu": gpu, "weights_downloaded": downloaded,
            "download_s": round(t1 - t0, 1), "infer_s": round(time.time() - t1, 1), "log": log}


@app.local_entrypoint()
def main(image: str, audio: str, out: str, name: str = ""):
    name = name or Path(out).stem
    res = animate.remote(Path(image).read_bytes(), Path(audio).read_bytes(), name, Path(image).suffix.lstrip("."))
    print({k: v for k, v in res.items() if k != "log"})
    print(res["log"])
    if res["ok"]:
        data = b"".join(vol.read_file(f"out/{name}.mp4"))
        Path(out).write_bytes(data)
        print(f"saved {out} ({len(data)} bytes)")


@app.local_entrypoint()
def batch(image: str, audio_dir: str, out_dir: str):
    """Animate every .wav in audio_dir (one container per file, in parallel)."""
    wavs = sorted(p for p in Path(audio_dir).glob("*.wav") if not p.name.endswith(".raw.wav"))
    img = Path(image).read_bytes(); ext = Path(image).suffix.lstrip(".")
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    args = [(img, p.read_bytes(), p.stem, ext) for p in wavs]
    for p, res in zip(wavs, animate.starmap(args)):
        print(p.stem, {k: v for k, v in res.items() if k != "log"})
        if res["ok"]:
            data = b"".join(vol.read_file(f"out/{p.stem}.mp4"))
            (Path(out_dir) / f"{p.stem}.mp4").write_bytes(data)
        else:
            print(res["log"][-3000:])
