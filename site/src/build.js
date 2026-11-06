import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { BOUNDS, CEILING, DOOR_GAPS, DOOR_HEAD, GESSO, GESSO_AREAS, ROOMS, SHAFTS, SILL, WALLS, WINDOWS, WINDOW_HEAD, X, Z } from './plan.js';
import { inkLines, mats, monitorScreen } from './materials.js';
import { furnish } from './furnish.js';

// Projects each vertex onto its dominant axis, in world metres, so textures keep real scale
// and run continuously across neighbouring pieces of wall.
function metresUV(mesh) {
  const { position: p, normal: n } = mesh.geometry.attributes;
  const uv = new Float32Array(p.count * 2), o = mesh.position;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i) + o.x, y = p.getY(i) + o.y, z = p.getZ(i) + o.z;
    if (ay >= ax && ay >= az) uv.set([x, z], i * 2);
    else if (ax >= az) uv.set([z, y], i * 2);
    else uv.set([x, y], i * 2);
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Boxes are placed by their real extents in metres: x0..x1, y0..y1, z0..z1.
function box(group, [x0, x1], [y0, y1], [z0, z1], material, { radius = 0, noCollide = false, noEdges = false } = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const geometry = radius
    ? new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2))
    : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  metresUV(mesh);
  mesh.castShadow = material !== mats.glass;
  mesh.receiveShadow = true;
  mesh.userData = { noCollide, noEdges, flat: !radius };
  group.add(mesh);
  return mesh;
}

function cylinder(group, x, y0, y1, z, r0, r1, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, y1 - y0, 28), material);
  mesh.position.set(x, (y0 + y1) / 2, z);
  metresUV(mesh);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData = options;
  group.add(mesh);
  return mesh;
}

function floorPatch(group, r, material, y = 0.002) {
  const g = new THREE.BufferGeometry();
  const { x0, x1, z0, z1 } = r;
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([x0, z0, x0, z1, x1, z1, x1, z0], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.userData = { noCollide: true, noEdges: true, flat: true };
  group.add(mesh);
  return mesh;
}

function shell(group) {
  for (const w of [...WALLS]) {
    box(group, [w.x0, w.x1], [0, CEILING], [w.z0, w.z1], mats.wall);
    box(group, [w.x0 - 0.008, w.x1 + 0.008], [0, 0.08], [w.z0 - 0.008, w.z1 + 0.008], mats.trim, { noEdges: true });
  }
  for (const s of SHAFTS) box(group, [s.x0, s.x1], [0, CEILING], [s.z0, s.z1], mats.shaft);
  for (const d of DOOR_GAPS) {
    box(group, [d.x0, d.x1], [DOOR_HEAD, CEILING], [d.z0, d.z1], mats.wall);
    const alongX = d.x1 - d.x0 > d.z1 - d.z0, w = 0.07, out = 0.012, opts = { noCollide: true };
    if (alongX) {
      for (const [a, b] of [[d.x0 - w, d.x0 + 0.012], [d.x1 - 0.012, d.x1 + w]]) box(group, [a, b], [0, DOOR_HEAD + w], [d.z0 - out, d.z1 + out], mats.trim, opts);
      box(group, [d.x0 - w, d.x1 + w], [DOOR_HEAD - 0.012, DOOR_HEAD + w], [d.z0 - out, d.z1 + out], mats.trim, opts);
    } else {
      for (const [a, b] of [[d.z0 - w, d.z0 + 0.012], [d.z1 - 0.012, d.z1 + w]]) box(group, [d.x0 - out, d.x1 + out], [0, DOOR_HEAD + w], [a, b], mats.trim, opts);
      box(group, [d.x0 - out, d.x1 + out], [DOOR_HEAD - 0.012, DOOR_HEAD + w], [d.z0 - w, d.z1 + w], mats.trim, opts);
    }
  }
  // Switches and sockets, so walls read at real scale.
  const plate = (x, y, z, alongX) => box(group, alongX ? [x - 0.04, x + 0.04] : [x - 0.005, x + 0.005], [y - 0.06, y + 0.06], alongX ? [z - 0.005, z + 0.005] : [z - 0.04, z + 0.04], mats.ceramic, { noCollide: true, noEdges: true });
  for (const [x, y, z, a] of [[2.35, 1.1, 0.005, 1], [0.005, 1.1, 1.03, 0], [4.3, 0.3, 2.395, 1], [2.3, 1.1, -0.148, 1], [3.45, 1.1, 2.495, 1], [1.26, 0.3, -0.6, 0], [4.195, 0.3, -1.05, 0], [1.946, 0.3, 3.3, 0], [4.645, 0.3, 4.2, 0]]) plate(x, y, z, a);
  for (const w of WINDOWS) {
    box(group, [w.x0, w.x1], [0, SILL], [w.z0, w.z1], mats.wall);
    box(group, [w.x0, w.x1], [WINDOW_HEAD, CEILING], [w.z0, w.z1], mats.wall);
    const mid = (w.x0 + w.x1) / 2, c = (w.z0 + w.z1) / 2, t = 0.022;
    box(group, [mid - t, mid + t], [SILL, SILL + 0.04], [w.z0, w.z1], mats.frame, { noCollide: true });
    box(group, [mid - t, mid + t], [WINDOW_HEAD - 0.04, WINDOW_HEAD], [w.z0, w.z1], mats.frame, { noCollide: true });
    for (const z of [w.z0 + 0.02, c, w.z1 - 0.02]) box(group, [mid - t, mid + t], [SILL, WINDOW_HEAD], [z - 0.02, z + 0.02], mats.frame, { noCollide: true });
    box(group, [mid - 0.005, mid + 0.005], [SILL + 0.04, WINDOW_HEAD - 0.04], [w.z0 + 0.02, w.z1 - 0.02], mats.glass, { noEdges: true });
    box(group, [w.x0 - 0.03, w.x1 + 0.01], [SILL - 0.025, SILL + 0.004], [w.z0 - 0.02, w.z1 + 0.02], mats.ceramic, { noCollide: true, noEdges: true });
  }
  // Floors, and a sub-floor so door thresholds are not holes.
  floorPatch(group, { x0: BOUNDS.x0, x1: BOUNDS.x1, z0: BOUNDS.z0, z1: BOUNDS.z1 }, mats.trim, 0.0005);
  for (const room of ROOMS) floorPatch(group, room, mats[room.floor]);
  // Door thresholds.
  for (const d of DOOR_GAPS) floorPatch(group, d, mats.wood, 0.0015);

  // Bathroom walls are tiled up to the plaster ceiling.
  const t = 0.006;
  const bath = ROOMS.find((r) => r.id === 'banho');
  box(group, [bath.x1 - t, bath.x1], [0, GESSO], [bath.z0, bath.z1], mats.bathWall, { noEdges: true, noCollide: true });
  box(group, [SHAFTS[0].x1, bath.x1], [0, GESSO], [bath.z0, bath.z0 + t], mats.bathWall, { noEdges: true, noCollide: true });
  box(group, [bath.x0, bath.x0 + t], [0, GESSO], [SHAFTS[0].z1, bath.z1], mats.bathWall, { noEdges: true, noCollide: true });
  box(group, [SHAFTS[0].x1, SHAFTS[0].x1 + t], [0, GESSO], [bath.z0, SHAFTS[0].z1], mats.bathWall, { noEdges: true, noCollide: true });
  box(group, [bath.x0, SHAFTS[0].x1], [0, GESSO], [SHAFTS[0].z1, SHAFTS[0].z1 + t], mats.bathWall, { noEdges: true, noCollide: true });

  // Entry door threshold mat stays outside the room graph, in the shell.
  const hallway = new THREE.Group();
  group.add(hallway);
  return hallway;
}

function ceilings(group) {
  const material = mats.ceiling;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0), material);
  plane.rotation.x = Math.PI / 2;
  plane.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, CEILING, (BOUNDS.z0 + BOUNDS.z1) / 2);
  plane.castShadow = true;
  plane.userData = { noCollide: true, noEdges: true, flat: true };
  group.add(plane);
  for (const g of GESSO_AREAS) box(group, [g.x0, g.x1], [GESSO, CEILING], [g.z0, g.z1], mats.ceiling, { noCollide: true, noEdges: true });
}

// Hinges come from the arcs drawn in the PDF.
function doors(group) {
  const leaf = (x, z, along, width) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, z);
    const mesh = box(pivot, [-0.018, 0.018], [0, DOOR_HEAD - 0.01], along > 0 ? [0, width] : [-width, 0], mats.door);
    const handleZ = along * (width - 0.07);
    box(pivot, [-0.06, 0.06], [0.98, 1.0], [handleZ - 0.012, handleZ + 0.012], mats.metal, { noCollide: true, noEdges: true });
    mesh.userData.door = true;
    group.add(pivot);
    return pivot;
  };
  const [entry, banho, dorm1, dorm2] = DOOR_GAPS;
  const entryLeaf = leaf((entry.x0 + entry.x1) / 2, entry.z0 + 0.02, 1, entry.z1 - entry.z0 - 0.04);
  leaf(banho.x1 - 0.03, banho.z0, -1, banho.x1 - banho.x0 - 0.06);
  leaf(dorm1.x0 + 0.03, dorm1.z0, -1, dorm1.x1 - dorm1.x0 - 0.06);
  // The gamer room's door is flush oak, part of the panelled wall in the photos.
  leaf(dorm2.x0 + 0.03, dorm2.z1, 1, dorm2.x1 - dorm2.x0 - 0.06).children[0].material = mats.oakPale;
  return entryLeaf;
}

// What the PDF shows as delivered. The toilet stays in both views. The kitchen top, basin and
// laundry tank sit exactly where the furniture puts its own, so they show only with the furniture
// hidden: two surfaces in one place is what made parts of the kitchen and bathroom flicker.
function fixtures(group, bare) {
  // Toilet: tank on the wall, oval bowl, oval seat and lid.
  const toiletZ = Z(285);
  box(group, [X(422), X(446)], [0.38, 0.74], [toiletZ - 0.19, toiletZ + 0.19], mats.ceramic, { radius: 0.03 });
  const flush = cylinder(group, X(446) + 0.003, 0.64, 0.67, toiletZ, 0.026, 0.026, mats.metal, { noCollide: true, noEdges: true });
  flush.rotation.z = Math.PI / 2;
  flush.position.set(X(446) + 0.003, 0.65, toiletZ);
  const bowl = cylinder(group, X(466), 0.04, 0.4, toiletZ, 0.2, 0.15, mats.ceramic);
  bowl.scale.set(1.2, 1, 0.9);
  const seat = cylinder(group, X(466), 0.4, 0.42, toiletZ, 0.195, 0.195, mats.ceramic, { noCollide: true, noEdges: true });
  seat.scale.set(1.22, 1, 0.92);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.ceramic);
  lid.scale.set(1.24, 0.12, 0.94);
  lid.position.set(X(466), 0.42, toiletZ);
  lid.userData = { noCollide: true, noEdges: true };
  group.add(lid);
  // Kitchen top and sink, basin, laundry tank: flat boxes only, so they bake into the atlas.
  box(bare, [X(422), X(481)], [0.86, 0.9], [Z(620), Z(754)], mats.stone);
  box(bare, [X(434), X(469)], [0.9, 0.905], [Z(665), Z(710)], mats.metal, { noEdges: true });
  box(bare, [X(422), X(466)], [0.76, 0.84], [Z(346), Z(400)], mats.ceramic);
  box(bare, [X(475), X(537)], [0.55, 0.88], [Z(885), Z(930)], mats.ceramic);
  box(bare, [X(483), X(529)], [0.88, 0.885], [Z(892), Z(924)], mats.stone, { noEdges: true });
  box(bare, [X(480), X(532)], [0, 0.55], [Z(888), Z(930)], mats.ceramic);
}

function gamingChair(group, x, z, accent) {
  // The player faces the desk on the south wall, so the backrest is on the north side.
  box(group, [x - 0.26, x + 0.26], [0.42, 0.51], [z - 0.24, z + 0.26], mats.chairPad, { radius: 0.05 });
  box(group, [x - 0.25, x + 0.25], [0.51, 1.3], [z - 0.32, z - 0.2], mats.chairPad, { radius: 0.05 });
  box(group, [x - 0.27, x - 0.2], [0.53, 1.1], [z - 0.3, z - 0.16], accent, { radius: 0.02, noCollide: true });
  box(group, [x + 0.2, x + 0.27], [0.53, 1.1], [z - 0.3, z - 0.16], accent, { radius: 0.02, noCollide: true });
  box(group, [x - 0.13, x + 0.13], [1.1, 1.24], [z - 0.21, z - 0.15], accent, { radius: 0.03, noCollide: true });
  for (const side of [-1, 1]) {
    const ax = x + side * 0.3;
    box(group, [ax - 0.02, ax + 0.02], [0.46, 0.66], [z - 0.02, z + 0.02], mats.plastic, { noEdges: true });
    box(group, [ax - 0.04, ax + 0.04], [0.66, 0.69], [z - 0.14, z + 0.2], mats.plastic, { radius: 0.012 });
  }
  cylinder(group, x, 0.09, 0.42, z, 0.03, 0.03, mats.metal, { noEdges: true });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, tx = x + Math.cos(a) * 0.3, tz = z + Math.sin(a) * 0.3;
    const leg = box(group, [-0.16, 0.16], [-0.012, 0.012], [-0.018, 0.018], mats.plastic, { noEdges: true, noCollide: true });
    leg.position.set((x + tx) / 2, 0.09, (z + tz) / 2);
    leg.rotation.y = -a;
    cylinder(group, tx, 0, 0.06, tz, 0.028, 0.028, mats.plastic, { noEdges: true, noCollide: true });
  }
}

function station(group, x, top, bottom, accent, chairAccent, deskFront, wall) {
  const y0 = 0.9, w = 0.62, h = 0.36, z = wall - 0.26;
  box(group, [x - w / 2 - 0.012, x + w / 2 + 0.012], [y0 - 0.012, y0 + h + 0.012], [z, z + 0.03], mats.plastic, { noCollide: true });
  box(group, [x - w / 2, x + w / 2], [y0, y0 + h], [z - 0.003, z], monitorScreen(x - w / 2, y0, w, h, top, bottom, accent === mats.neonPink ? '#ff2d95' : '#1fd8ff'), { noEdges: true, noCollide: true });
  box(group, [x - 0.025, x + 0.025], [0.76, y0], [z + 0.03, z + 0.06], mats.plastic, { noEdges: true, noCollide: true });
  box(group, [x - 0.13, x + 0.13], [0.76, 0.772], [z - 0.04, z + 0.12], mats.plastic, { noEdges: true, noCollide: true });
  // Mouse pad, keyboard, mouse, headset
  box(group, [x - 0.4, x + 0.4], [0.76, 0.764], [deskFront + 0.03, deskFront + 0.33], mats.chairPad, { noEdges: true, noCollide: true });
  box(group, [x - 0.22, x + 0.14], [0.764, 0.79], [deskFront + 0.08, deskFront + 0.22], mats.plastic, { radius: 0.006, noCollide: true });
  box(group, [x - 0.215, x + 0.135], [0.79, 0.793], [deskFront + 0.085, deskFront + 0.215], accent, { noEdges: true, noCollide: true });
  box(group, [x + 0.22, x + 0.285], [0.764, 0.8], [deskFront + 0.1, deskFront + 0.21], mats.plastic, { radius: 0.016, noCollide: true });
  cylinder(group, x + 0.25, 0.76, 0.98, wall - 0.14, 0.012, 0.03, mats.plastic, { noEdges: true, noCollide: true });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 20, Math.PI), mats.plastic);
  band.position.set(x + 0.25, 0.98, wall - 0.14);
  band.castShadow = true;
  band.userData = { noEdges: true, noCollide: true };
  group.add(band);
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, deskFront - 0.28);
  pivot.rotation.y = accent === mats.neonPink ? -0.55 : 0.55;
  group.add(pivot);
  gamingChair(pivot, 0, 0, chairAccent);
}

function tower(group, x0, wall, accent) {
  const z0 = wall - 0.5, z1 = wall - 0.06, x1 = x0 + 0.21;
  box(group, [x0, x1], [0.76, 1.22], [z0, z1], mats.plastic, { radius: 0.006, noCollide: true });
  // Glass side and fans facing the player
  box(group, [x0 + 0.02, x1 - 0.02], [0.79, 1.19], [z0 - 0.003, z0], accent, { noEdges: true, noCollide: true });
  box(group, [x0 + 0.045, x1 - 0.045], [0.82, 1.16], [z0 - 0.006, z0 - 0.003], mats.screen, { noEdges: true, noCollide: true });
  for (const y of [0.9, 1.08]) {
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.007, 8, 28), accent);
    fan.position.set((x0 + x1) / 2, y, z0 - 0.009);
    fan.userData = { noEdges: true, noCollide: true };
    group.add(fan);
  }
}

function frigobar(group, wallNorth) {
  // Glass door faces west, towards the room. Clear of the door swing and of the window sill.
  const x0 = 3.95, x1 = 4.45, z0 = wallNorth + 0.02, z1 = wallNorth + 0.52, top = 0.86;
  box(group, [x0, x1], [0.03, top], [z0, z1], mats.plastic, { radius: 0.012 });
  box(group, [x0 - 0.005, x0 + 0.006], [0.1, top - 0.08], [z0 + 0.05, z1 - 0.05], mats.fridgeLight, { noEdges: true, noCollide: true });
  const cans = [mats.canRed, mats.canBlue, mats.canGreen, mats.canRed, mats.canGreen, mats.canBlue];
  for (const y of [0.13, 0.36, 0.59]) {
    box(group, [x0 - 0.05, x0 - 0.005], [y - 0.006, y], [z0 + 0.05, z1 - 0.05], mats.metal, { noEdges: true, noCollide: true });
    for (let i = 0; i < 5; i++) {
      const z = z0 + 0.1 + i * 0.075;
      cylinder(group, x0 - 0.028, y, y + 0.12, z, 0.022, 0.022, cans[(i + Math.round(y * 10)) % 6], { noEdges: true, noCollide: true });
    }
  }
  box(group, [x0 - 0.06, x0 - 0.052], [0.05, top - 0.03], [z0 + 0.03, z1 - 0.03], mats.glass, { noEdges: true, noCollide: true });
  box(group, [x0 - 0.075, x0 - 0.06], [0.28, 0.66], [z1 - 0.06, z1 - 0.04], mats.metal, { noEdges: true, noCollide: true });
  // Drinks and a snack tray ready on top
  box(group, [x0 + 0.08, x1 - 0.08], [top, top + 0.018], [z0 + 0.08, z1 - 0.08], mats.walnut, { noCollide: true });
  cylinder(group, x0 + 0.16, top + 0.018, top + 0.14, z0 + 0.18, 0.024, 0.024, mats.canRed, { noEdges: true, noCollide: true });
  cylinder(group, x0 + 0.27, top + 0.018, top + 0.14, z0 + 0.3, 0.024, 0.024, mats.canBlue, { noEdges: true, noCollide: true });
  cylinder(group, x0 + 0.13, top + 0.018, top + 0.08, z0 + 0.35, 0.05, 0.04, mats.pot, { noCollide: true });
}

function gamerRoom(group) {
  const d2 = ROOMS[3];
  const t = 0.006;
  // Dark paint only behind the desk and on the west wall, to keep the room from closing in.
  box(group, [d2.x0, d2.x1], [0.08, CEILING], [d2.z1 - t, d2.z1], mats.darkPaint, { noEdges: true, noCollide: true });
  box(group, [d2.x0, d2.x0 + t], [0.08, CEILING], [d2.z0, d2.z1], mats.darkPaint, { noEdges: true, noCollide: true });

  // One long desk along the south wall, shared by two stations.
  const deskFront = d2.z1 - 0.68;
  box(group, [d2.x0 + 0.02, d2.x1 - 0.02], [0.72, 0.76], [deskFront, d2.z1 - 0.01], mats.walnut, { radius: 0.008 });
  for (const x of [d2.x0 + 0.06, 3.3, d2.x1 - 0.06]) {
    box(group, [x - 0.025, x + 0.025], [0, 0.72], [deskFront + 0.03, d2.z1 - 0.04], mats.plastic, { noEdges: true });
  }
  box(group, [d2.x0 + 0.02, d2.x1 - 0.02], [0.712, 0.72], [deskFront - 0.002, deskFront + 0.006], mats.neonPink, { noEdges: true, noCollide: true });
  station(group, 2.72, '#2a1a6e', '#d9407a', mats.neonPink, mats.chairPink, deskFront, d2.z1);
  station(group, 3.87, '#0c2d6b', '#19b5c9', mats.neonCyan, mats.chairCyan, deskFront, d2.z1);
  tower(group, d2.x0 + 0.04, d2.z1, mats.neonPink);
  tower(group, d2.x1 - 0.25, d2.z1, mats.neonCyan);

  // Acoustic panels above the monitors.
  for (const [x, y] of [[2.3, 1.6], [2.52, 1.75], [2.74, 1.6], [2.96, 1.75], [3.64, 1.75], [3.86, 1.6], [4.08, 1.75], [4.3, 1.6]]) {
    box(group, [x - 0.1, x + 0.1], [y - 0.1, y + 0.1], [d2.z1 - 0.035, d2.z1 - t], y > 1.7 ? mats.plastic : mats.chairPad, { noCollide: true });
  }
  // Game shelf on the west wall.
  for (const y of [1.25, 1.65]) box(group, [d2.x0 + t, d2.x0 + 0.22], [y, y + 0.025], [d2.z0 + 0.25, d2.z0 + 1.15], mats.walnut, { noCollide: true });
  [[0.32, mats.canRed], [0.44, mats.cabinet], [0.56, mats.canBlue], [0.68, mats.art], [0.8, mats.canGreen]].forEach(([dz, m], i) => {
    box(group, [d2.x0 + 0.03, d2.x0 + 0.2], [1.275, 1.275 + 0.2 + (i % 2) * 0.03], [d2.z0 + dz, d2.z0 + dz + 0.04], m, { noEdges: true, noCollide: true });
  });
  const figure = cylinder(group, d2.x0 + 0.11, 1.675, 1.83, d2.z0 + 0.65, 0.04, 0.055, mats.neonCyan, { noEdges: true, noCollide: true });
  figure.material = mats.canBlue;

  // LED cove around the ceiling and the two coloured lights it throws.
  const y = CEILING - 0.05;
  box(group, [d2.x0 + 0.01, d2.x1 - 0.01], [y, y + 0.012], [d2.z1 - 0.035, d2.z1 - 0.02], mats.neonPink, { noEdges: true, noCollide: true });
  box(group, [d2.x0 + 0.02, d2.x0 + 0.035], [y, y + 0.012], [d2.z0 + 0.02, d2.z1 - 0.02], mats.neonCyan, { noEdges: true, noCollide: true });
  box(group, [3.3, d2.x1 - 0.01], [y, y + 0.012], [d2.z0 + 0.02, d2.z0 + 0.035], mats.neonCyan, { noEdges: true, noCollide: true });
  frigobar(group, d2.z0);
}

function addEdges(group, target) {
  group.updateMatrixWorld(true);
  const positions = [];
  const v = new THREE.Vector3();
  group.traverse((mesh) => {
    if (!mesh.isMesh || mesh.userData.noEdges) return;
    const edges = new THREE.EdgesGeometry(mesh.geometry, 32);
    const p = edges.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    edges.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, inkLines());
  lines.frustumCulled = false;
  target.add(lines);
  return lines;
}

export function buildApartment(scene, models) {
  const shellGroup = new THREE.Group(), fixtureGroup = new THREE.Group(), bareGroup = new THREE.Group(), furnitureGroup = new THREE.Group(), ceilingGroup = new THREE.Group();
  shell(shellGroup);
  const entryLeaf = doors(shellGroup);
  fixtures(fixtureGroup, bareGroup);
  furnish(furnitureGroup, models, { box, cylinder, floorPatch, metresUV, gamerRoom });
  ceilings(ceilingGroup);
  scene.add(shellGroup, fixtureGroup, bareGroup, furnitureGroup, ceilingGroup);
  const baked = [];
  const register = (group, set) => group.traverse((m) => {
    if (!m.isMesh) return;
    if (m.geometry.index) m.geometry = m.geometry.toNonIndexed();
    m.name = `m${baked.length}`;
    m.userData.set = set;
    // Flat pieces go in the lightmap atlas; curved and detailed ones take light per vertex.
    // Stick-like pieces (profiles, bars, frames) become slivers in the atlas and pick up their
    // neighbours' light at the edges; they read better with light per vertex.
    m.geometry.computeBoundingBox();
    const size = m.geometry.boundingBox.getSize(new THREE.Vector3()).toArray().sort((a, b) => a - b);
    m.userData.dense = !m.userData.flat || m.geometry.attributes.position.count > 3600 || size[1] < 0.05;
    baked.push(m);
  });
  register(shellGroup, 'base');
  register(fixtureGroup, 'base');
  register(bareGroup, 'bare');
  register(ceilingGroup, 'base');
  register(furnitureGroup, 'furniture');
  addEdges(shellGroup, scene);
  addEdges(fixtureGroup, scene);
  const bareLines = addEdges(bareGroup, scene);
  bareGroup.visible = bareLines.visible = false;
  const furnitureLines = addEdges(furnitureGroup, scene);

  return { shellGroup, fixtureGroup, bareGroup, bareLines, furnitureGroup, furnitureLines, ceilingGroup, entryLeaf, baked };
}

export function buildOutside(scene) {
  const group = new THREE.Group();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uNight: { value: 0 }, uLinear: { value: 1 } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // The view from a high floor: three bands of tower silhouettes painted into the sky,
      // lighter and bluer with distance, with lit windows at night.
      fragmentShader: `uniform float uNight; uniform float uLinear; varying vec3 d;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
        float t = clamp(d.y * 1.6 + 0.12, 0.0, 1.0);
        vec3 sky = mix(vec3(0.87,0.87,0.83), vec3(0.32,0.54,0.82), pow(t, 0.75));
        vec3 skyN = mix(vec3(0.075,0.075,0.13), vec3(0.012,0.018,0.05), pow(t, 0.6));
        vec3 c = mix(sky, skyN, uNight);
        float a = atan(d.z, d.x);
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float width = 0.035 - fi * 0.008;            // angular width of one tower
          float cell = floor(a / width + fi * 13.0);
          float r = h1(cell + fi * 31.0);
          float gap = step(0.18 + fi * 0.08, r);        // some lots stay empty
          float top = (0.006 + fi * 0.012) + h1(cell * 1.7 + fi) * (0.018 + fi * 0.028);
          if (gap > 0.5 && d.y < top) {
            float haze = 0.68 - fi * 0.26;               // far band fades into the sky
            vec3 day = mix(vec3(0.46, 0.5, 0.56) + 0.12 * r, sky, haze);
            vec3 night = mix(vec3(0.03, 0.035, 0.05), skyN, haze * 0.8);
            vec2 w = vec2((a / width + fi * 13.0) * 9.0, d.y * (420.0 - fi * 90.0));
            float window = step(0.3, fract(w.x)) * step(0.35, fract(w.y));
            float lit = step(0.72, h2(floor(w) + cell)) * window;
            night += lit * vec3(1.0, 0.78, 0.45) * (0.5 + 0.5 * h2(floor(w) * 1.3)) * (1.0 - haze * 0.6);
            day = mix(day, day * 0.86, window * (1.0 - haze));
            c = mix(day, night, uNight);
          }
        }
        // Linear when it goes through the post-processing chain, display values otherwise.
        gl_FragColor = vec4(uLinear > 0.5 ? pow(c, vec3(2.2)) * 1.5 : c, 1.0); }`,
    }),
  );
  group.add(sky);
  // The city is painted in the sky shader above; the ground only fills the view straight down.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial({ color: 0x5f6159, toneMapped: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -45;
  group.add(ground);
  scene.add(group);
  group.userData.setMode = (night, linear) => {
    sky.material.uniforms.uNight.value = night ? 1 : 0;
    sky.material.uniforms.uLinear.value = linear ? 1 : 0;
    ground.material.color.set(night ? 0x0b0c10 : 0x5f6159);
  };
  return group;
}
