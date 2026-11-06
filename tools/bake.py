"""Bakes the apartment's light in Cycles and writes lightmaps plus their UVs for the page.

blender --background --python tools/bake.py -- <scene.json> <out_dir> <size> <samples> [variants]
Three.js is Y-up in metres; Blender is Z-up, so (x, y, z) becomes (x, -z, y).
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
SCENE, OUT, SIZE, SAMPLES = args[0], args[1], int(args[2]), int(args[3])
TIMES = ["golden", "day", "afternoon", "night"]
VARIANTS = args[4].split(",") if len(args) > 4 else [f"{t}_{f}" for t in TIMES for f in ("full", "empty")]
# Encoded value = (light / RANGE) ^ (1 / 2.2), which the page reads back as an sRGB texture.
RANGE = 6.0
os.makedirs(OUT, exist_ok=True)

data = json.load(open(SCENE, encoding="utf8"))["objects"]
to_blender = lambda x, y, z: (x, -z, y)

ALBEDO = {"monitor": (0, 0, 0)}
# Glass and sheer curtains let light through. Everything else takes the colour the page sent.
SKIP = {"glass", "sheer", "showerGlass"}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for backend in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = backend
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            print("device", backend, [d.name for d in gpus], flush=True)
            break
    except Exception as exc:
        print("backend failed", backend, exc, flush=True)
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = False
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 2
scene.cycles.sample_clamp_indirect = 8


def material_for(obj):
    name = obj["material"]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    color = ALBEDO.get(name, obj["color"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Metallic"].default_value = min(obj["metal"], 0.6)
    emission = obj["emissive"]
    if name == "monitor":
        emission = (0.5, 0.35, 0.85)
    strength = max(emission)
    if strength > 0.001:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.6
    return mat


def build_mesh(objects, name):
    """One big mesh. Polygon order equals triangle order, so corner i maps straight back to the page."""
    verts, faces, face_material, materials = [], [], [], {}
    for obj in objects:
        key = obj["material"]
        if key not in materials:
            materials[key] = (len(materials), material_for(obj))
        slot = materials[key][0]
        lookup = {}
        pos = obj["pos"]
        tri = []
        for i in range(obj["count"]):
            p = (pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
            k = (round(p[0], 3), round(p[1], 3), round(p[2], 3))
            if k not in lookup:
                lookup[k] = len(verts)
                verts.append(to_blender(*p))
            tri.append(lookup[k])
            if len(tri) == 3:
                faces.append(tuple(tri))
                face_material.append(slot)
                tri = []
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.polygons.foreach_set("material_index", face_material)
    for _, mat in sorted(materials.values(), key=lambda m: m[0]):
        mesh.materials.append(mat)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    return ob


usable = [o for o in data if o["material"] not in SKIP and o["count"] > 0]
# Detailed objects (models, upholstery, curtains) take light per vertex: unwrapping them into the atlas
# is what made the earlier bake run for half an hour. Same rule on the page.
is_dense = lambda o: o.get("dense", False)
by_set = lambda objs, sets: [o for sset in sets for o in objs if o["set"] == sset]
atlas_full = by_set([o for o in usable if not is_dense(o)], ("base", "furniture"))
atlas_empty = by_set([o for o in usable if not is_dense(o)], ("base", "bare"))
dense_full = by_set([o for o in usable if is_dense(o)], ("base", "furniture"))
dense_empty = by_set([o for o in usable if is_dense(o)], ("base",))
started = time.time()
full = build_mesh(atlas_full, "full")
empty = build_mesh(atlas_empty, "empty")
full_d = build_mesh(dense_full, "full_dense") if dense_full else None
empty_d = build_mesh(dense_empty, "empty_dense") if dense_empty else None
# Smooth shading, or Cycles lights every triangle of a cushion flat and the page shows facets.
for ob in (full_d, empty_d):
    if ob:
        ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
        ob.data.update()
print("atlas tris", len(full.data.polygons), "dense tris", len(full_d.data.polygons) if full_d else 0, round(time.time() - started, 1), "s", flush=True)

def set_page_uvs(ob, objects):
    uv = np.concatenate([np.asarray(o["uv1"], dtype=np.float32) for o in objects])
    layer = ob.data.uv_layers.new(name="UV")
    layer.data.foreach_set("uv", uv)
    ob.data.update()


set_page_uvs(full, atlas_full)
set_page_uvs(empty, atlas_empty)
print("uv set from page", round(time.time() - started, 1), "s", flush=True)

# Back to the page's order.
dense_index, dense_total = {}, 0
for o in dense_full:
    dense_index[o["id"]] = dense_total
    dense_total += o["count"]
index, counts, cursor = {}, {}, 0
for o in data:
    index[o["id"]] = cursor
    counts[o["id"]] = o["count"]
    cursor += o["count"]
json.dump({"index": index, "counts": counts, "dense": dense_index, "denseTotal": dense_total, "range": RANGE, "size": SIZE}, open(os.path.join(OUT, "uv1.json"), "w"))
print("uv1 written", flush=True)

for ob in (full_d, empty_d):
    if ob:
        attr = ob.data.color_attributes.new("light", "FLOAT_COLOR", "CORNER")
        ob.data.color_attributes.active_color = attr

image = bpy.data.images.new("bake", SIZE, SIZE, alpha=False, float_buffer=True)
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.nodes.active = node

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
background = world.node_tree.nodes["Background"]

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.angle = math.radians(2.5)
sun = bpy.data.objects.new("sun", sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_mode = "QUATERNION"
from mathutils import Vector

# Times of day. The windows are all on the east wall (north is up on the plan), so the sun comes in
# only in the morning: at sunrise it is low and orange and reaches the far walls, mid-morning it
# lays patches on the floor, in the afternoon it is behind the building and only the sky lights in.
# toward: direction to the sun in page coordinates (+x east, +y up, +z south).
SUNS = {
    "golden": dict(toward=(0.97, 0.12, -0.18), energy=8.0, color=(1, 0.56, 0.3), sky=(0.95, 0.66, 0.48), sky_strength=0.95, lamps=0.75),
    "day": dict(toward=(10.7, 7.0, 3.2), energy=10.0, color=(1, 0.9, 0.76), sky=(0.62, 0.76, 1.0), sky_strength=2.1, lamps=0.55),
    "afternoon": dict(toward=(-0.75, 0.62, 0.22), energy=4.8, color=(1, 0.88, 0.72), sky=(0.66, 0.78, 1.0), sky_strength=2.5, lamps=0.55),
    "night": dict(toward=(0, 1, 0), energy=0, color=(1, 1, 1), sky=(0.012, 0.018, 0.04), sky_strength=1, lamps=1),
}


def aim_sun(toward):
    direction = Vector(to_blender(*toward)).normalized()
    sun.rotation_quaternion = direction.to_track_quat("Z", "Y")

# Lights from the reference: recessed spots, LED under cabinets and behind the headboard, rattan pendants.
# (x, y, z, watts, colour, group), in page coordinates. "full": only with furniture.
WARM = (1, 0.74, 0.46)
LAMPS = [
    (1.58, 1.74, 1.53, 5, (1, 0.78, 0.55), "full"), (1.88, 1.88, 1.53, 5, (1, 0.78, 0.55), "full"), (2.2, 1.68, 1.53, 5, (1, 0.78, 0.55), "full"),  # globes
    (0.2, 1.44, 2.0, 6, WARM, "full"), (0.2, 1.54, 3.0, 6, WARM, "full"), (1.15, 1.54, 4.3, 5, WARM, "full"),  # LED under uppers
    (2.0, 2.06, 2.2, 6, WARM, "full"), (3.2, 2.06, 2.2, 6, WARM, "full"), (4.3, 2.06, 2.2, 6, WARM, "full"),   # cornice LED
    (2.9, 2.3, 0.32, 6, WARM, "full"), (4.1, 2.3, 0.32, 6, WARM, "full"),                                    # cove over the sofa
    (1.42, 1.28, -1.9, 6, WARM, "full"), (1.42, 1.28, -0.8, 5, WARM, "full"),                                # headboard LED
    (0.14, 1.0, -0.5, 5, WARM, "full"),                                                                    # bathroom mirror
    (2.45, 1.9, 3.75, 42, (1, 0.14, 0.5), "gamer"), (4.15, 1.9, 3.75, 42, (0.1, 0.75, 1), "gamer"),        # gamer colours
    (3.3, 1.5, 3.2, 12, (1, 0.8, 0.62), "gamer"),                                                          # gamer fill
]
# Recessed spots, also there with an empty apartment.
# The photos' linear ceiling LEDs, as rows of wide downlights along each line.
SPOTS = [(0.95, z, 2.48, 7) for z in (0.6, 1.4, 2.2, 3.0)] + [(x, 1.15, 2.48, 9) for x in (1.6, 2.6, 3.6, 4.3)] + [(1.05, 3.95, 2.48, 6), (0.7, -0.75, 2.28, 9), (0.7, -2.1, 2.28, 8), (2.6, -1.3, 2.48, 13)]
lamp_objects = []


def add_lamp(tag, x, y, z, watts, color):
    light = bpy.data.lights.new(f"{tag}{len(lamp_objects)}", "POINT")
    light.energy = watts
    light.color = color
    light.shadow_soft_size = 0.1
    ob = bpy.data.objects.new(light.name, light)
    ob.location = to_blender(x, y, z)
    bpy.context.collection.objects.link(ob)
    lamp_objects.append((ob, tag))


for x, y, z, watts, color, group in LAMPS:
    add_lamp(group, x, y, z, watts, color)
for x, z, y, watts in SPOTS:
    spot_data = bpy.data.lights.new(f"spot{len(lamp_objects)}", "SPOT")
    spot_data.energy = watts * 1.6
    spot_data.color = WARM
    spot_data.spot_size = math.radians(95)
    spot_data.spot_blend = 0.7
    spot_data.shadow_soft_size = 0.035
    ob = bpy.data.objects.new(spot_data.name, spot_data)
    ob.location = to_blender(x, y, z)
    bpy.context.collection.objects.link(ob)
    lamp_objects.append((ob, "spot"))


def blur(pixels, sigma):
    """Separable gaussian: light is low frequency, this removes the remaining sample noise."""
    radius = max(1, int(sigma * 2.5))
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    out = pixels
    for axis in (0, 1):
        out = np.apply_along_axis(lambda v: np.convolve(v, kernel, mode="same"), axis, out)
    return out


def select_only(ob):
    for other in bpy.data.objects:
        other.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def bake(variant):
    time_of_day, furniture = variant.split("_")
    night = time_of_day == "night"
    sky = SUNS[time_of_day]
    aim_sun(sky["toward"])
    shown = (full, full_d) if furniture == "full" else (empty, empty_d)
    for ob in (full, empty, full_d, empty_d):
        if ob:
            ob.hide_render = ob not in shown
            ob.hide_set(ob not in shown)
    sun_data.energy = sky["energy"]
    sun_data.color = sky["color"]
    background.inputs["Color"].default_value = (*sky["sky"], 1)
    background.inputs["Strength"].default_value = sky["sky_strength"]
    for ob, tag in lamp_objects:
        # Warm artificial light stays on by day, softer: the reference is lit this way.
        scale = 1 if night else sky["lamps"] * {"spot": 1, "full": 1.1, "gamer": 1.27}[tag]
        if tag != "spot" and furniture != "full":
            scale = 0
        ob.hide_render = scale == 0
        ob.data["base"] = ob.data.get("base", ob.data.energy)
        ob.data.energy = ob.data["base"] * scale

    t = time.time()
    select_only(shown[0])
    image.pixels.foreach_set(np.zeros(SIZE * SIZE * 4, dtype=np.float32))
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=10, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES")
    print(variant, "atlas baked", round(time.time() - t, 1), "s", flush=True)
    px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    rgb = px.reshape(SIZE, SIZE, 4)[:, :, :3]
    encoded = np.clip(blur(rgb, 1.2 * SIZE / 2048) / RANGE, 0, 1) ** (1 / 2.2)
    out = bpy.data.images.new(variant, SIZE, SIZE, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[:, :, :3] = encoded
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = os.path.join(OUT, f"{variant}.png")
    out.file_format = "PNG"
    out.save()

    # Per-vertex light for the detailed objects, stored in the page's corner order.
    light = np.zeros((dense_total, 3), dtype=np.uint8)
    dense = shown[1]
    if dense:
        select_only(dense)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
        data = np.empty(len(dense.data.loops) * 4, dtype=np.float32)
        dense.data.color_attributes["light"].data.foreach_get("color", data)
        values = data.reshape(-1, 4)[:, :3]
        light[: len(values)] = np.round(np.clip(values / RANGE, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    light.tofile(os.path.join(OUT, f"vlight_{variant}.bin"))
    print(variant, "done", round(time.time() - t, 1), "s", flush=True)


for variant in VARIANTS:
    bake(variant)
print("ALL DONE", round(time.time() - started, 1), "s", flush=True)
