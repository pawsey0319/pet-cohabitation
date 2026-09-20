"""Leased rembg worker. It receives only authorized jobs from the cloud gateway.

The worker credential is scoped to lease/result submission, not Supabase service
role. All mutations, account checks and asset paths stay in the cloud gateway.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import json
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
from PIL import Image, ImageChops, ImageOps, ImageStat

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / "model.lock.json").read_text(encoding="utf-8"))
MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)

def verify_model(model_dir: Path) -> Path:
    model = model_dir / LOCK["filename"]
    if not model.is_file() or model.stat().st_size != LOCK["bytes"]:
        raise ValueError("model_missing_or_size_mismatch")
    if hashlib.md5(model.read_bytes(), usedforsecurity=False).hexdigest() != LOCK["md5"]:
        raise ValueError("model_checksum_mismatch")
    if LOCK.get("sha256") and hashlib.sha256(model.read_bytes()).hexdigest() != LOCK["sha256"]:
        raise ValueError("model_checksum_mismatch")
    return model

def compose_alpha(original: Image.Image, mask: Image.Image) -> Image.Image:
    """Keep every original RGB value. Only multiply its existing alpha by mask."""
    rgba = original.convert("RGBA")
    if mask.size != rgba.size:
        raise ValueError("mask_invalid")
    alpha = ImageChops.multiply(rgba.getchannel("A"), mask.convert("L"))
    histogram = alpha.histogram(); count = rgba.width * rgba.height
    if sum(histogram[:16]) < count * .005 or sum(histogram[32:]) < count * .01:
        raise ValueError("mask_invalid")
    rgba.putalpha(alpha)
    return rgba

def subject_context(original: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Give the fixed segmenter a whole-body view without altering output RGB.

    ISNET can treat the head of a tightly framed stylized pet as the entire
    salient object. A second, wider field of view corrects that failure on the
    retained furry-pet regression. The model input is always bounded to 1024px;
    a large uploaded portrait must not allocate a canvas four times its area.
    """
    thumbnail = original.convert("RGB")
    thumbnail.thumbnail((512, 512), Image.Resampling.LANCZOS)
    w, h = thumbnail.size
    edge = max(1, min(w, h) // 32)
    corners = Image.new("RGB", (edge * 4, edge))
    for index, box in enumerate(((0, 0, edge, edge), (w-edge, 0, w, edge),
                                  (0, h-edge, edge, h), (w-edge, h-edge, w, h))):
        corners.paste(thumbnail.crop(box), (index * edge, 0))
    backdrop = tuple(int(value) for value in ImageStat.Stat(corners).median)
    canvas = Image.new("RGB", (1024, 1024), backdrop)
    left, top = (1024-w)//2, (1024-h)//2
    canvas.paste(thumbnail, (left, top))
    return canvas, (left, top, left+w, top+h)

def extract_mask(original: Image.Image, session, remove) -> Image.Image:
    def predict(image):
        value = remove(image, session=session, only_mask=True, post_process_mask=False)
        return value.convert("L") if isinstance(value, Image.Image) else Image.open(io.BytesIO(value)).convert("L")
    detail = predict(original)
    context, source_box = subject_context(original)
    whole_body = predict(context).crop(source_box).resize(original.size, Image.Resampling.LANCZOS)
    # Keep the detailed fur mask and the complete silhouette. No erosion,
    # binary threshold or generative repaint; existing alpha is multiplied only
    # once in compose_alpha. Both predictions use the same locked model.
    return ImageChops.lighter(detail, whole_body)

def process(source: bytes, model_dir: Path) -> bytes:
    if not source or len(source) > MAX_BYTES:
        raise ValueError("source_invalid")
    verify_model(model_dir)
    # rembg v2.0.67 uses U2NET_HOME. Never set checksum-disable env variables.
    os.environ["U2NET_HOME"] = str(model_dir.resolve())
    os.environ.pop("MODEL_CHECKSUM_DISABLED", None)
    from rembg import new_session, remove
    with Image.open(io.BytesIO(source)) as opened:
        if opened.format not in ("JPEG", "PNG", "WEBP") or opened.width * opened.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("source_invalid")
        original = ImageOps.exif_transpose(opened).convert("RGBA")
    session = new_session(LOCK["name"], providers=["CPUExecutionProvider"])
    mask = extract_mask(original, session, remove)
    result = compose_alpha(original, mask)
    output = io.BytesIO(); result.save(output, "PNG")
    data = output.getvalue()
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("mask_invalid")
    return data

def process_child(source: bytes, model_dir: str, result_file: str):
    # No network credential enters the processing subprocess or image decoder.
    os.environ.pop("PET_TRANSPARENT_WORKER_TOKEN", None)
    try:
        Path(result_file).write_bytes(process(source, Path(model_dir)))
    except Exception as reason:
        code = str(reason)
        Path(result_file + ".error").write_text(code if code in ("mask_invalid", "source_invalid") else "worker_processing_failed", encoding="utf-8")

def request_json(endpoint: str, token: str, body: dict) -> dict:
    req = urllib.request.Request(endpoint, json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-pet-worker-token": token}, method="POST")
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)

def download_source(url: str, gateway: str) -> bytes:
    source = urllib.parse.urlparse(url); trusted = urllib.parse.urlparse(gateway)
    if source.scheme != trusted.scheme or source.netloc != trusted.netloc or not source.path.startswith("/storage/v1/object/sign/pet-portraits/"):
        raise ValueError("source_invalid")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError("source_invalid")
    with urllib.request.build_opener(NoRedirect).open(url, timeout=40) as response:
        if int(response.headers.get("Content-Length", "0")) > MAX_BYTES: raise ValueError("source_invalid")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES: raise ValueError("source_invalid")
    return data

def run_once(endpoint: str, token: str, model_dir: Path) -> bool:
    job = request_json(endpoint, token, {"action": "lease"}).get("job")
    if not job: return False
    if job.get("model_name") != LOCK["name"]: raise ValueError("worker_model_mismatch")
    base = {"job_id": job["id"], "lease_token": job["lease_token"]}
    try:
        source = download_source(job["source_url"], endpoint)
        with tempfile.TemporaryDirectory(prefix="pet-transparent-") as temp:
            destination = str(Path(temp) / "result.png")
            child = multiprocessing.get_context("spawn").Process(target=process_child, args=(source, str(model_dir), destination))
            child.start(); child.join(210)
            if child.is_alive(): child.terminate(); child.join(5); raise ValueError("processing_timeout")
            error = Path(destination + ".error")
            if error.exists(): raise ValueError(error.read_text(encoding="utf-8"))
            output = Path(destination).read_bytes()
        body = {"action": "complete", **base, "png_base64": base64.b64encode(output).decode(), "source_sha256": hashlib.sha256(source).hexdigest(), "model_md5": LOCK["md5"]}
        # If the first reply is lost, the same lease/path is submitted again;
        # the gateway returns the committed receipt without creating another job.
        for attempt in range(3):
            try:
                result = request_json(endpoint, token, body)
                if not result.get("committed"): raise ValueError("worker_processing_failed")
                print(json.dumps({"status": "committed"}), flush=True)
                return True
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2: raise
                time.sleep(2)
    except Exception as reason:
        code = str(reason); allowed = {"source_invalid", "processing_timeout", "mask_invalid"}
        code = code if code in allowed else "worker_processing_failed"
        try: request_json(endpoint, token, {"action": "fail", **base, "error_code": code})
        except Exception: pass  # Lease expiry remains recoverable without this report.
        print(json.dumps({"status": "failed", "error_code": code}), flush=True)
    return True

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--once", action="store_true"); parser.add_argument("--model-dir", type=Path, default=Path.home() / ".u2net")
    parser.add_argument("--verify-model", action="store_true"); args = parser.parse_args()
    verify_model(args.model_dir)
    if args.verify_model: print("Model file matches pinned checksums."); return
    endpoint = os.environ["PET_TRANSPARENT_WORKER_URL"].rstrip("/")
    token = os.environ["PET_TRANSPARENT_WORKER_TOKEN"]
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "https" and parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Cloud worker URL must use HTTPS")
    if len(token) < 32: raise ValueError("Worker token must contain at least 32 characters")
    while True:
        try: worked = run_once(endpoint, token, args.model_dir)
        except Exception: print(json.dumps({"status": "unavailable"}), flush=True); worked = False
        if args.once: break
        if not worked: time.sleep(15)

if __name__ == "__main__": main()
