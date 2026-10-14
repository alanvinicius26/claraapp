"""Export delivery copies; keep the approved PNG artwork intact."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "design-references/clara/15-poses-2026-10-11"
target = root / "src/assets/clara-poses"
target.mkdir(parents=True, exist_ok=True)
for path in sorted(source.glob("clara-*.png")):
    with Image.open(path) as image:
        image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        output = target / (path.stem + ".webp")
        image.save(output, "WEBP", quality=86, method=6)
        print(f"{output.name}: {output.stat().st_size} bytes")
