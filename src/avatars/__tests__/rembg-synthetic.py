"""Local locked-rembg acceptance for an explicitly authorized synthetic image.

No network, queue leasing, service credentials or image generation is used.
RGB/alpha checks support manual edge review; they do not certify pet anatomy.
"""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import time

from PIL import Image, ImageChops, ImageDraw, ImageOps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    worker_path = Path(__file__).resolve().parents[1] / "transparent-worker" / "worker.py"
    spec = importlib.util.spec_from_file_location("avatar_transparent_worker", worker_path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    source = args.source.read_bytes()
    started = time.monotonic()
    result = worker.process(source, args.model_dir)
    elapsed = time.monotonic() - started
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "transparent.png").write_bytes(result)
    original = ImageOps.exif_transpose(Image.open(io.BytesIO(source))).convert("RGBA")
    rgba = Image.open(io.BytesIO(result)).convert("RGBA")
    assert original.size == rgba.size, "rembg must retain source dimensions"
    assert ImageChops.difference(original.convert("RGB"), rgba.convert("RGB")).getbbox() is None, "rembg must retain every original RGB pixel"
    histogram = rgba.getchannel("A").histogram()
    count = rgba.width * rgba.height
    assert histogram[0] > count * .005 and sum(histogram[32:]) > count * .01
    assert sum(histogram[1:255]) > 0, "sample must retain graded alpha edges"
    report = {
        "scope": "Actual locked local worker.process/rembg inference only; synthetic source from the single live-avatar request. No cloud lease/commit was invoked for this sample.",
        "source": str(args.source),
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "output_sha256": hashlib.sha256(result).hexdigest(),
        "model": worker.LOCK["name"],
        "verified_model_sha256": worker.LOCK["sha256"],
        "size": list(rgba.size),
        "seconds": round(elapsed, 3),
        "original_rgb_unchanged": True,
        "alpha_zero_fraction": histogram[0] / count,
        "alpha_partial_fraction": sum(histogram[1:255]) / count,
        "alpha_opaque_fraction": histogram[255] / count,
        "automatic_checks_passed": True,
        "manual_quality_acceptance": "pending review; this sample does not cover translucent material or unusual extra limbs",
    }
    for name, color in [("white", "#ffffff"), ("dark", "#17202d")]:
        background = Image.new("RGBA", rgba.size, color)
        background.alpha_composite(rgba)
        background.convert("RGB").save(args.output / f"on-{name}.png")
    # Review sheet: full subject followed by actual-size ear/ribbon/feet crops.
    sheet = Image.new("RGB", (1536, 1536), "#edf0f4")
    draw = ImageDraw.Draw(sheet)
    panels = [
        (original.convert("RGB"), "Original synthetic avatar"),
        (Image.open(args.output / "on-white.png"), "rembg / white"),
        (Image.open(args.output / "on-dark.png"), "rembg / dark"),
    ]
    for index, (panel, label) in enumerate(panels):
        sheet.paste(panel.resize((512, 512)), (index * 512, 24))
        draw.text((index * 512 + 10, 5), label, fill="#151a20")
    dark = Image.open(args.output / "on-dark.png")
    white = Image.open(args.output / "on-white.png")
    for index, (box, label) in enumerate([((256, 150, 768, 550), "ears / hair"), ((240, 420, 752, 820), "ribbon / arms"), ((250, 550, 762, 950), "feet / lower silhouette")]):
        sheet.paste(dark.crop(box), (index * 512, 570))
        sheet.paste(white.crop(box), (index * 512, 1030))
        draw.text((index * 512 + 10, 548), f"Dark {label}", fill="#151a20")
        draw.text((index * 512 + 10, 1008), f"White {label}", fill="#151a20")
    sheet.save(args.output / "review-sheet.png")
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": "automatic_checks_passed_manual_review_required", "seconds": report["seconds"], "alpha_partial_fraction": report["alpha_partial_fraction"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
