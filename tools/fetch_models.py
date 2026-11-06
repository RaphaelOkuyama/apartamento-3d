"""Downloads CC0 models from Poly Haven into one flat folder, site/m/, to stay under Windows' path limit.

Usage: fetch_models.py <site_dir> [model ...]  (with no names, the list below)
"""
import json
import sys
import urllib.request
from pathlib import Path, PurePosixPath

UA = {"User-Agent": "apartamento-local-tour/1.0"}
MODELS = [
    "dining_chair_02", "potted_plant_02", "potted_plant_04", "throw_pillows_01", "wicker_basket_02",
    "ceramic_vase_01", "ceramic_vase_04", "wooden_cutting_board", "wooden_bowl_01", "wine_bottles_01",
    "hanging_picture_frame_01", "standing_picture_frame_01", "gaming_console", "food_apple_01",
]


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


MODELS = sys.argv[2:] or MODELS
root = Path(sys.argv[1]) / "m"
root.mkdir(parents=True, exist_ok=True)
total = 0
for model in MODELS:
    info = json.loads(get(f"https://api.polyhaven.com/info/{model}"))
    entry = json.loads(get(f"https://api.polyhaven.com/files/{model}"))["gltf"]["1k"]["gltf"]
    document = json.loads(get(entry["url"]))
    renames = {path: f"{model}__{PurePosixPath(path).name}" if not PurePosixPath(path).name.startswith(model) else PurePosixPath(path).name for path in entry["include"]}
    for path, include in entry["include"].items():
        blob = get(include["url"])
        (root / renames[path]).write_bytes(blob)
        total += len(blob)
    for group in ("buffers", "images"):
        for item in document.get(group, []):
            if item.get("uri") in renames:
                item["uri"] = renames[item["uri"]]
    (root / f"{model}.gltf").write_text(json.dumps(document), encoding="utf8")
    print(model, "tris", info.get("polycount"), "dim_mm", [round(v) for v in info.get("dimensions", [])], flush=True)
print("total MB", round(total / 2**20, 1))
