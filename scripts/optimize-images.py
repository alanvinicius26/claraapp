"""Create web delivery assets without changing or deleting the original artwork."""
from pathlib import Path
from PIL import Image
import json

root = Path(__file__).resolve().parents[1]
report = []
for name, maximum in [
    ("clara-apontando-v1", 1024), ("clara-personagem-v1", 512),
    ("clara-guia-v1", 640), ("clara-celebrando-v1", 640),
    ("clara-logo-v1", 2172),
]:
    source = root / "src/assets" / (name + ".png")
    target = source.with_suffix(".webp")
    with Image.open(source) as image:
        image.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        image.save(target, "WEBP", quality=86, method=6, lossless="logo" in name)
    report.append({"file": target.name, "before": source.stat().st_size, "after": target.stat().st_size})
with Image.open(root / "public/clara-icon-v1.png") as image:
    image.thumbnail((128,128), Image.Resampling.LANCZOS)
    image.save(root / "public/clara-icon-v2.png", optimize=True)
print(json.dumps(report, indent=2))
