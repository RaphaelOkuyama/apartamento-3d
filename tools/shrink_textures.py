"""Shrink the site's PBR textures for the web: colour and normal maps to 1024 px, roughness to 512 px
grey, saved as WebP (the .jpg in the site is replaced). Originals are kept once in assets_full/textures (outside the site) so this can be re-run with other sizes."""
import os
import shutil
import sys

from PIL import Image

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "site", "textures")
keep = os.path.normpath(os.path.join(root, "..", "..", "assets_full", "textures"))
os.makedirs(keep, exist_ok=True)
before = after = 0
for name in sorted(os.listdir(root)):
    path = os.path.join(root, name)
    if not name.endswith(".jpg") or not os.path.isfile(path):
        continue
    original = os.path.join(keep, name)
    if not os.path.exists(original):
        shutil.copy2(path, original)
    before += os.path.getsize(original)
    image = Image.open(original)
    rough = name.endswith("_rough.jpg")
    size = 512 if rough else 1024
    image = image.convert("L" if rough else "RGB")
    if max(image.size) > size:
        image = image.resize((size, round(image.size[1] * size / image.size[0])), Image.LANCZOS)
    out = path[:-4] + ".webp"
    image.save(out, "WEBP", quality=80 if rough else 84, method=6)
    os.remove(path)
    after += os.path.getsize(out)
print(f"textures {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
