"""Read-only raster validation for the isolated Android prebuild."""
import hashlib
import json
from pathlib import Path
from PIL import Image

workspace = Path.cwd()
target = Path(json.loads((workspace / "test-results/android-native-validation-latest.json").read_text(encoding="utf-8-sig"))["target"])
if not target.resolve().is_relative_to((workspace / "test-results").resolve()):
    raise ValueError("Expected isolated output directory")
assets = list((target / "assets/brand").glob("*.png"))
assets += [path for path in (target / "android/app/src/main/res").rglob("*") if path.suffix in (".png", ".webp")]
rows = []
for path in assets:
    with Image.open(path) as image:
        image.load()
        assert image.width > 0 and image.height > 0
        rgba = image.convert("RGBA")
        rows.append({"file": path.relative_to(target).as_posix(), "format": image.format, "size": [image.width, image.height], "mode": image.mode, "alpha": list(rgba.getchannel("A").getextrema()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
assert len(rows) >= 20, "Expected brand assets and generated density variants"
(target / "asset-inspection.json").write_text(json.dumps({"passed": True, "assets": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS: {len(rows)} brand and generated Android raster assets decode correctly.")
