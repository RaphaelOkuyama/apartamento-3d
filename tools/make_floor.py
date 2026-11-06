"""Lays pale oak planks from Poly Haven's white_oak_veneer scan: 3 x 3 m, tiling, 18 cm boards.

Usage: make_floor.py <site_dir>
Writes textures/floor_oak_{diff,nor,rough}.jpg and fetches the veneer for cabinet fronts.
"""
import json
import random
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageEnhance

UA = {"User-Agent": "apartamento-local-tour/1.0"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


site = Path(sys.argv[1])
tex = site / "textures"
files = json.loads(get("https://api.polyhaven.com/files/white_oak_veneer"))
scans = {}
for key, suffix in (("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough")):
    data = get(files[key]["2k"]["jpg"]["url"])
    (tex / f"white_oak_veneer_{suffix}.jpg").write_bytes(data)
    scans[suffix] = Image.open(BytesIO(data)).convert("RGB")

SIZE, METRES, BOARD = 2048, 3.0, 0.18
px_per_m = SIZE / METRES
board_px = round(BOARD * px_per_m)
rows = round(SIZE / board_px)
board_px = SIZE // rows
out = {k: Image.new("RGB", (SIZE, SIZE)) for k in scans}
random.seed(14)
scan_w, scan_h = scans["diff"].size


def strip(rotated, x, y, length):
    return rotated.crop((x, y, x + length, y + board_px))


rotated = {k: v.rotate(90, expand=True) for k, v in scans.items()}
for row in range(rows):
    x = -random.randint(0, 600)
    while x < SIZE:
        length = random.randint(int(1.1 * px_per_m), int(2.0 * px_per_m))
        sx, sy = random.randint(0, scan_h - min(length, scan_h - 1) - 1), random.randint(0, scan_w - board_px - 1)
        tone = random.uniform(0.96, 1.2)
        for key in scans:
            piece = strip(rotated[key], sx, sy, min(length, scan_h - sx))
            if piece.width < length:
                piece = piece.resize((length, board_px))
            if key == "diff":
                piece = ImageEnhance.Brightness(piece).enhance(tone * 1.12)
                piece = ImageEnhance.Color(piece).enhance(0.72)
            out[key].paste(piece, (x, row * board_px))
            if x + length > SIZE:
                out[key].paste(piece, (x - SIZE, row * board_px))
        # Bevelled joint at the end of each board
        for joint in range(2):
            for yy in range(row * board_px, (row + 1) * board_px):
                px = (x + length - 1 - joint) % SIZE
                out["diff"].putpixel((px, yy), (86, 72, 58))
                out["nor"].putpixel((px, yy), (150 if joint else 106, 128, 255))
        x += length
    for joint in range(2):
        for xx in range(SIZE):
            yy = (row * board_px + joint) % SIZE
            out["diff"].putpixel((xx, yy), (86, 72, 58))
            out["nor"].putpixel((xx, yy), (128, 150 if joint else 106, 255))

for key, image in out.items():
    image.save(tex / f"floor_oak_{key}.jpg", quality=90)
    print(key, round((tex / f"floor_oak_{key}.jpg").stat().st_size / 2**20, 2), "MB")
