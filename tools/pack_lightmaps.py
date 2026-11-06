"""Copies a bake into the site: lightmaps as JPEG, UVs as they are, vertex light gzipped. Usage: pack_lightmaps.py <bake_dir> <site/bake>"""
import gzip
import shutil
import sys
from pathlib import Path

from PIL import Image

source, target = Path(sys.argv[1]), Path(sys.argv[2])
target.mkdir(parents=True, exist_ok=True)
for png in source.glob("*.png"):
    out = target / f"{png.stem}.jpg"
    Image.open(png).convert("RGB").save(out, quality=93, subsampling=0)
    print(out.name, round(out.stat().st_size / 2**20, 2), "MB")
shutil.copy(source / "uv1.json", target / "uv1.json")
for f in source.glob("vlight_*.bin"):
    (target / f"{f.name}.gz").write_bytes(gzip.compress(f.read_bytes(), 9))
    (target / f.name).unlink(missing_ok=True)
