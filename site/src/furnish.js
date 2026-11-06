import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../vendor/BufferGeometryUtils.js';
import { CEILING, DOOR_GAPS, DOOR_HEAD, GESSO, ROOMS, SHAFTS, SILL, WINDOWS, WINDOW_HEAD, X, Z } from './plan.js';
import { mats, monitorScreen } from './materials.js';

// Everything in the apartment that is not in the PDF. Style follows the owner's reference tour:
// warm greige, pale oak, ribbed wood, LED coves, sheer curtains, rattan pendants.
export function furnish(group, models, { box, cylinder, floorPatch, metresUV, gamerRoom }) {
  const soft = { noCollide: false, noEdges: true };
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };

  // Upholstery and bedding: a dense box, corners rounded, top puffed, gently uneven.
  function softBox([x0, x1], [y0, y1], [z0, z1], material, { puff = 0.03, round = 5, wrinkle = 0.004, quilt = 0, seed = 1, noCollide = false, piping = false } = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const seg = (s) => Math.max(4, Math.min(48, Math.round(s / 0.045)));
    let g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const nx = (2 * x) / w, ny = (2 * y) / h, nz = (2 * z) / d;
      const pull = (Math.abs(nx) ** round + Math.abs(ny) ** round + Math.abs(nz) ** round) ** (1 / round);
      x /= pull; y /= pull; z /= pull;
      const dome = (1 - nx * nx) * (1 - nz * nz);
      if (ny > -0.2) y += dome * puff * (ny > 0 ? 1 : 0.4);
      x += nx * (1 - ny * ny) * (1 - nz * nz) * puff * 0.35;
      z += nz * (1 - ny * ny) * (1 - nx * nx) * puff * 0.35;
      const ripple = Math.sin(x * 17 + seed) * Math.cos(z * 13 - seed) + 0.6 * Math.sin((x + z) * 31 + seed * 2);
      y += ripple * wrinkle * (ny > 0 ? 1 : 0);
      if (quilt && ny > 0.1) {
        const a = Math.abs(Math.sin((x * Math.PI) / quilt)), b = Math.abs(Math.sin((z * Math.PI) / quilt));
        y -= (1 - Math.min(a, b) ** 0.45) * 0.03;
      }
      P.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    metresUV(mesh);
    mesh.userData = { noEdges: true, noCollide };
    group.add(mesh);
    if (piping) pipe(x0 + 0.012, x1 - 0.012, y1 - 0.016, z0 + 0.012, z1 - 0.012, material);
    return mesh;
  }

  // Welt cord along an upholstered top edge: a thin tube around a rounded rectangle.
  function pipe(x0, x1, y, z0, z1, material, r = 0.0055) {
    const c = Math.min(0.05, (x1 - x0) / 3, (z1 - z0) / 3), pts = [];
    const corners = [[x1 - c, z0 + c, -Math.PI / 2], [x1 - c, z1 - c, 0], [x0 + c, z1 - c, Math.PI / 2], [x0 + c, z0 + c, Math.PI]];
    for (const [cx, cz, a0] of corners) for (let k = 0; k <= 4; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * c, y, cz + Math.sin(a) * c));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, r, 6, true), material);
    metresUV(tube);
    tube.userData = { noEdges: true, noCollide: true };
    group.add(tube);
    return tube;
  }

  // Ribbed wood panels. axis: which way the panel runs. Slats merge into one mesh.
  function ripado(axis, a0, a1, y0, y1, face, depth, material = mats.ripado) {
    const parts = [];
    for (let a = a0 + 0.012; a < a1 - 0.012; a += 0.036) {
      const slat = new THREE.BoxGeometry(axis === 'x' ? 0.024 : Math.abs(depth), y1 - y0, axis === 'x' ? Math.abs(depth) : 0.024);
      if (axis === 'x') slat.translate(a, (y0 + y1) / 2, face + depth / 2);
      else slat.translate(face + depth / 2, (y0 + y1) / 2, a);
      parts.push(slat);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    metresUV(mesh);
    mesh.userData = { noEdges: true, noCollide: true, flat: true };
    group.add(mesh);
    return mesh;
  }

  // `pick` takes one piece from a model that ships several side by side, centred on its spot.
  function place(name, x, y, z, { rotation = 0, scale = 1, noCollide = true, pick = null } = {}) {
    let object = models[name].clone(true);
    if (pick) {
      const part = object.getObjectByName(pick);
      const box = new THREE.Box3().setFromObject(part), centre = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      part.position.x -= centre.x;
      part.position.z -= centre.z;
      part.position.y -= box.min.y;
      holder.add(part);
      object = holder;
    }
    object.position.set(x, y, z);
    object.rotation.y = rotation;
    object.scale.setScalar(scale);
    object.traverse((m) => {
      if (m.isMesh) {
        m.geometry = m.geometry.clone();
        m.userData = { noEdges: true, noCollide };
      }
    });
    group.add(object);
    return object;
  }

  // Curtain: a sheet folded by a sine wave, hanging from the track.
  function curtain(x, z0, z1, material, y1 = CEILING - 0.03) {
    const width = z1 - z0, folds = Math.max(3, Math.round(width / 0.085));
    const g = new THREE.PlaneGeometry(width, y1 - 0.015, folds * 8, 6);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const t = (P.getX(i) + width / 2) / width;
      const v = (P.getY(i) + (y1 - 0.015) / 2) / (y1 - 0.015);
      const wave = Math.sin(t * folds * Math.PI * 2 + Math.sin(t * 19) * 0.8) * (0.028 + 0.014 * (1 - v));
      P.setXYZ(i, x + wave, P.getY(i) + (y1 + 0.015) / 2, z0 + t * width);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    metresUV(mesh);
    mesh.userData = { noEdges: true, noCollide: true };
    group.add(mesh);
    return mesh;
  }

  function lathe(points, x, y, z, material, options = {}) {
    const g = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), 40);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    metresUV(mesh);
    mesh.userData = { noEdges: true, noCollide: true, ...options };
    group.add(mesh);
    return mesh;
  }

  const plate = (x, y, z, r = 0.115) => lathe([[0, 0], [r * 0.55, 0.002], [r * 0.78, 0.006], [r, 0.022], [r * 0.98, 0.025], [r * 0.74, 0.012], [0, 0.01]], x, y, z, mats.ceramic);
  const cup = (x, y, z) => lathe([[0, 0], [0.028, 0.002], [0.04, 0.03], [0.042, 0.062], [0.038, 0.062], [0.034, 0.03], [0, 0.008]], x, y, z, mats.ceramic);
  const pendant = (x, z) => {
    cylinder(group, x, 1.9, CEILING, z, 0.003, 0.003, mats.blackMetal, { noEdges: true, noCollide: true });
    lathe([[0.03, 0.34], [0.05, 0.33], [0.11, 0.26], [0.17, 0.13], [0.2, 0]], x, 1.58, z, mats.rattan);
    cylinder(group, x, 1.66, 1.74, z, 0.03, 0.03, mats.ledWarm, { noEdges: true, noCollide: true });
  };
  const spot = (x, z, y = CEILING) => {
    cylinder(group, x, y - 0.012, y - 0.002, z, 0.042, 0.042, mats.trim, { noEdges: true, noCollide: true });
    cylinder(group, x, y - 0.015, y - 0.011, z, 0.028, 0.028, mats.ledWarm, { noEdges: true, noCollide: true });
  };

  const [sala, , , , banho, dorm1] = ROOMS;

  // ================= Kitchen and living room: the owner's reference photos =================
  // Flat panels lie on a plane: helpers for cabinet fronts with a raised frame (shaker) and black knobs.
  const knob = (x, y, z, axis) => {
    const k = cylinder(group, x, y - 0.012, y + 0.012, z, 0.012, 0.012, mats.blackMetal, { noEdges: true, noCollide: true });
    k.rotation[axis === 'x' ? 'z' : 'x'] = Math.PI / 2;
  };
  // Front facing +x at plane xf, spanning z0..z1, y0..y1.
  const shakerX = (xf, z0, z1, y0, y1, material, knobAt = 'top') => {
    box(group, [xf - 0.018, xf], [y0 + 0.002, y1 - 0.002], [z0 + 0.002, z1 - 0.002], material, { noCollide: true });
    const f = 0.055;
    box(group, [xf, xf + 0.006], [y0 + 0.002, y0 + f], [z0 + 0.002, z1 - 0.002], material, { noEdges: true, noCollide: true });
    box(group, [xf, xf + 0.006], [y1 - f, y1 - 0.002], [z0 + 0.002, z1 - 0.002], material, { noEdges: true, noCollide: true });
    box(group, [xf, xf + 0.006], [y0 + f, y1 - f], [z0 + 0.002, z0 + f], material, { noEdges: true, noCollide: true });
    box(group, [xf, xf + 0.006], [y0 + f, y1 - f], [z1 - f, z1 - 0.002], material, { noEdges: true, noCollide: true });
    if (knobAt) knob(xf + 0.02, knobAt === 'top' ? y1 - 0.09 : knobAt === 'bottom' ? y0 + 0.09 : (y0 + y1) / 2, z1 - 0.07, 'x');
  };
  // Front facing -z at plane zf, spanning x0..x1.
  const shakerZ = (zf, x0, x1, y0, y1, material, knobAt = 'bottom') => {
    box(group, [x0 + 0.002, x1 - 0.002], [y0 + 0.002, y1 - 0.002], [zf, zf + 0.018], material, { noCollide: true });
    const f = 0.055;
    box(group, [x0 + 0.002, x1 - 0.002], [y0 + 0.002, y0 + f], [zf - 0.006, zf], material, { noEdges: true, noCollide: true });
    box(group, [x0 + 0.002, x1 - 0.002], [y1 - f, y1 - 0.002], [zf - 0.006, zf], material, { noEdges: true, noCollide: true });
    box(group, [x0 + 0.002, x0 + f], [y0 + f, y1 - f], [zf - 0.006, zf], material, { noEdges: true, noCollide: true });
    box(group, [x1 - f, x1 - 0.002], [y0 + f, y1 - f], [zf - 0.006, zf], material, { noEdges: true, noCollide: true });
    if (knobAt) knob(x0 + 0.07, knobAt === 'top' ? y1 - 0.09 : y0 + 0.09, zf - 0.02, 'z');
  };
  // Front facing -x at plane xf, spanning z0..z1, y0..y1 (cabinets on an east-side wall).
  const shakerXneg = (xf, z0, z1, y0, y1, material) => {
    box(group, [xf - 0.018, xf], [y0 + 0.002, y1 - 0.002], [z0 + 0.002, z1 - 0.002], material, { noCollide: true });
    const f = 0.055, x = [xf - 0.024, xf - 0.018];
    box(group, x, [y0 + 0.002, y0 + f], [z0 + 0.002, z1 - 0.002], material, { noEdges: true, noCollide: true });
    box(group, x, [y1 - f, y1 - 0.002], [z0 + 0.002, z1 - 0.002], material, { noEdges: true, noCollide: true });
    box(group, x, [y0 + f, y1 - f], [z0 + 0.002, z0 + f], material, { noEdges: true, noCollide: true });
    box(group, x, [y0 + f, y1 - f], [z1 - f, z1 - 0.002], material, { noEdges: true, noCollide: true });
    knob(xf - 0.04, y0 < 1 ? y1 - 0.09 : y0 + 0.09, z0 + 0.07, 'x');
  };
  // Flat slab with rounded corners in plan, like the photos' table top and console.
  const roundedSlab = (x0, x1, z0, z1, y0, y1, r, material) => {
    const shape = new THREE.Shape();
    const w = x1 - x0, d = z1 - z0;
    shape.moveTo(r, 0); shape.lineTo(w - r, 0); shape.quadraticCurveTo(w, 0, w, r); shape.lineTo(w, d - r);
    shape.quadraticCurveTo(w, d, w - r, d); shape.lineTo(r, d); shape.quadraticCurveTo(0, d, 0, d - r);
    shape.lineTo(0, r); shape.quadraticCurveTo(0, 0, r, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 10 });
    g.rotateX(Math.PI / 2);
    g.translate(x0, y1, z0);
    const mesh = new THREE.Mesh(g, material);
    metresUV(mesh);
    mesh.userData = { noEdges: false, noCollide: false, flat: true };
    group.add(mesh);
    return mesh;
  };
  // Picture on a wall facing +z (north wall) or -z (south wall).
  const picture = (x0, x1, y0, y1, zWall, facing, print) => {
    const s = facing; // +1 faces south (north wall), -1 faces north (south wall)
    const z = (a, b) => (s > 0 ? [zWall + a, zWall + b] : [zWall - b, zWall - a]);
    box(group, [x0, x1], [y0, y1], z(0, 0.03), mats.oak, { noCollide: true });
    box(group, [x0 + 0.03, x1 - 0.03], [y0 + 0.03, y1 - 0.03], z(0.03, 0.033), mats.linenWhite, { noEdges: true, noCollide: true });
    if (print) box(group, [x0 + print[0], x1 - print[1]], [y0 + print[2], y1 - print[3]], z(0.033, 0.035), print[4], { noEdges: true, noCollide: true });
  };

  // ---------- Entrance, as in the photo: shoe cabinet with oak frame and hooks, then the fridge ----------
  // The entry door swings over the floor up to z 0.93, so nothing stands in front of it any more:
  // the shoe cabinet starts right after the door, and the fridge moved along to make room for it.
  // Shoe cabinet against the fridge tower's side, its doors facing the entrance; hooks and a rounded
  // shelf on that side above it, an oak upright by the wall and an oak beam on top.
  const ent = { x1: 0.6, z0: 0.975, z1: 1.33 };
  box(group, [0, ent.x1], [0.08, 0.88], [ent.z0 + 0.02, ent.z1], mats.cabinetCream);
  box(group, [0.02, ent.x1 - 0.04], [0.0, 0.08], [ent.z0 + 0.06, ent.z1], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const [a, b] of [[0.042, 0.32], [0.324, ent.x1 - 0.002]]) box(group, [a, b], [0.02, 0.875], [ent.z0, ent.z0 + 0.02], mats.cabinetCream, { noCollide: true });
  for (const x of [0.29, 0.355]) knob(x, 0.76, ent.z0 - 0.012, 'z');
  roundedSlab(0, ent.x1 + 0.01, ent.z0 - 0.01, ent.z1, 0.88, 0.91, 0.07, mats.oakPale);
  box(group, [0, 0.04], [0, 2.3], [ent.z0 - 0.01, ent.z1], mats.oakPale);
  box(group, [0, ent.x1 + 0.01], [2.16, 2.3], [ent.z0 - 0.01, ent.z0 + 0.1], mats.oakPale, { noCollide: true });
  roundedSlab(0.04, ent.x1 - 0.05, ent.z0 + 0.03, ent.z1, 1.86, 1.89, 0.08, mats.oakPale);
  place('potted_plant_04', 0.38, 1.89, ent.z0 + 0.2, { scale: 1.2 });
  for (const x of [0.22, 0.44]) {
    const hook = cylinder(group, x, 1.52, 1.6, ent.z1 - 0.02, 0.042, 0.042, mats.oak, { noEdges: true, noCollide: true });
    hook.rotation.x = Math.PI / 2;
    hook.position.set(x, 1.56, ent.z1 - 0.02);
  }
  softBox([0.36, 0.56], [1.0, 1.36], [ent.z1 - 0.1, ent.z1 - 0.02], mats.cream, { puff: 0.02, round: 3, seed: 21, noCollide: true });
  box(group, [0.43, 0.45], [1.3, 1.56], [ent.z1 - 0.05, ent.z1 - 0.04], mats.cream, { noEdges: true, noCollide: true });
  plate(0.36, 0.91, ent.z0 + 0.12, 0.07);

  // Fridge tower beside it: black fridge, cream cabinet above.
  const tower = { x0: 0, x1: 0.72, z0: ent.z1 + 0.005, z1: ent.z1 + 0.725 };
  box(group, [tower.x0, tower.x1], [0, 2.3], [tower.z0, tower.z0 + 0.02], mats.cabinetCream);
  box(group, [tower.x0, tower.x1], [0, 2.3], [tower.z1 - 0.02, tower.z1], mats.cabinetCream);
  box(group, [tower.x0, tower.x1 - 0.02], [1.86, 2.3], [tower.z0 + 0.02, tower.z1 - 0.02], mats.cabinetCream, { noCollide: true });
  shakerX(tower.x1 - 0.002, tower.z0 + 0.02, tower.z1 - 0.02, 1.86, 2.3, mats.cabinetCream, 'bottom');
  // Black fridge, bottom freezer, black handles: all black, as asked.
  box(group, [0.03, 0.69], [0.01, 1.84], [tower.z0 + 0.03, tower.z1 - 0.03], mats.fridgeBlack, { radius: 0.014 });
  box(group, [0.689, 0.694], [0.715, 0.725], [tower.z0 + 0.03, tower.z1 - 0.03], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const [y0, y1] of [[0.45, 0.68], [0.8, 1.32]]) box(group, [0.7, 0.716], [y0, y1], [tower.z1 - 0.088, tower.z1 - 0.072], mats.fridgeBlack, { noEdges: true, noCollide: true });

  // ---------- Kitchen run along the west wall ----------
  // Dishwasher, sink cabinet, then the oven under the hob, up to the shaft.
  const k0 = tower.z1 + 0.01, k1 = 3.5, depth = 0.6;
  const sink = { z0: k0 + 0.49, z1: k0 + 0.81, x0: 0.12, x1: 0.44 };
  const hob = { z0: k1 - 0.5, z1: k1 };
  box(group, [0.0, depth - 0.02], [0.1, 0.86], [k0, k1], mats.cabinetCream, { noCollide: false });
  box(group, [0.0, depth - 0.06], [0.0, 0.1], [k0, k1], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [depth - 0.02, depth], [0.06, 0.85], [k0 + 0.005, k0 + 0.45], mats.appliance, { noCollide: true });
  box(group, [depth, depth + 0.004], [0.76, 0.84], [k0 + 0.02, k0 + 0.43], mats.screen, { noEdges: true, noCollide: true });
  shakerX(depth, k0 + 0.45, hob.z0, 0.1, 0.86, mats.cabinetCream, 'top');
  box(group, [depth - 0.02, depth + 0.004], [0.24, 0.8], [hob.z0, hob.z1], mats.fridgeBlack, { noCollide: true });
  box(group, [depth + 0.004, depth + 0.008], [0.3, 0.68], [hob.z0 + 0.04, hob.z1 - 0.04], mats.screen, { noEdges: true, noCollide: true });
  box(group, [depth + 0.01, depth + 0.03], [0.73, 0.745], [hob.z0 + 0.06, hob.z1 - 0.06], mats.metal, { noEdges: true, noCollide: true });
  shakerX(depth, hob.z0, hob.z1, 0.1, 0.24, mats.cabinetCream, null);
  // Terrazzo top with the sink cut out, black sink, black gooseneck tap, hob.
  const top = [0.86, 0.9];
  box(group, [0, depth + 0.02], top, [k0, sink.z0], mats.terrazzo);
  box(group, [0, depth + 0.02], top, [sink.z1, k1], mats.terrazzo);
  box(group, [0, sink.x0], top, [sink.z0, sink.z1], mats.terrazzo, { noEdges: true });
  box(group, [sink.x1, depth + 0.02], top, [sink.z0, sink.z1], mats.terrazzo, { noEdges: true });
  box(group, [sink.x0, sink.x1], [0.7, 0.885], [sink.z0, sink.z1], mats.fridgeBlack, { noEdges: true, noCollide: true });
  const tapZ = (sink.z0 + sink.z1) / 2;
  cylinder(group, 0.06, 0.9, 1.26, tapZ, 0.013, 0.016, mats.blackMetal, { noEdges: true, noCollide: true });
  const spout = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 10, 24, Math.PI), mats.blackMetal);
  spout.position.set(0.145, 1.26, tapZ);
  spout.userData = { noEdges: true, noCollide: true };
  group.add(spout);
  cylinder(group, 0.23, 1.16, 1.26, tapZ, 0.012, 0.012, mats.blackMetal, { noEdges: true, noCollide: true });
  cylinder(group, 0.07, 0.9, 1.05, sink.z0 - 0.06, 0.014, 0.014, mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [0.07, 0.55], [0.9, 0.907], [hob.z0, hob.z1], mats.screen, { noCollide: true });
  for (const [x, dz, r] of [[0.2, 0.12, 0.07], [0.42, 0.12, 0.05], [0.2, 0.37, 0.05], [0.42, 0.37, 0.06]]) cylinder(group, x, 0.907, 0.925, hob.z0 + dz, r, r, mats.blackMetal, { noEdges: true, noCollide: true });
  // Green glazed tiles between counter and cabinets.
  box(group, [0, 0.006], [0.9, 1.5], [k0, k1], mats.zellige, { noEdges: true, noCollide: true });
  // Uppers: oak block with an open microwave niche over the dishwasher, cream shaker doors beyond, LED below.
  const uz = k0 + 0.62;
  box(group, [0, 0.35], [1.5, 1.53], [k0, uz], mats.oakPale, { noCollide: true });
  box(group, [0, 0.35], [1.86, 1.89], [k0, uz], mats.oakPale, { noCollide: true });
  box(group, [0, 0.35], [1.53, 1.86], [k0, k0 + 0.02], mats.oakPale, { noCollide: true });
  box(group, [0, 0.35], [1.53, 1.86], [uz - 0.02, uz], mats.oakPale, { noCollide: true });
  box(group, [0.0, 0.01], [1.53, 1.86], [k0, uz], mats.oakPale, { noEdges: true, noCollide: true });
  box(group, [0.03, 0.33], [1.54, 1.82], [k0 + 0.05, uz - 0.08], mats.fridgeBlack, { radius: 0.008, noCollide: true });
  box(group, [0.33, 0.333], [1.57, 1.79], [k0 + 0.08, uz - 0.24], mats.screen, { noEdges: true, noCollide: true });
  box(group, [0.33, 0.333], [1.58, 1.78], [uz - 0.22, uz - 0.11], mats.ledBlue ?? mats.screen, { noEdges: true, noCollide: true });
  box(group, [0, 0.35], [1.89, 2.3], [k0, uz], mats.oakPale, { noCollide: true });
  box(group, [0.35, 0.353], [1.9, 2.29], [k0 + 0.31 - 0.002, k0 + 0.31 + 0.002], mats.oak, { noEdges: true, noCollide: true });
  box(group, [0, 0.33], [1.6, 2.3], [uz, k1], mats.cabinetCream, { noCollide: true });
  for (const [a, b] of [[uz, (uz + k1) / 2], [(uz + k1) / 2, k1]]) shakerX(0.35, a, b, 1.6, 2.3, mats.cabinetCream, 'bottom');
  box(group, [0, 0.42], [1.52, 1.6], [hob.z0 - 0.02, hob.z1], mats.appliance, { noCollide: true });
  box(group, [0.04, 0.32], [1.494, 1.5], [k0 + 0.03, uz - 0.03], mats.ledWarm, { noEdges: true, noCollide: true });
  box(group, [0.04, 0.32], [1.594, 1.6], [uz + 0.03, hob.z0 - 0.04], mats.ledWarm, { noEdges: true, noCollide: true });

  // ---------- Service area: the counter carries on from the kitchen and turns along the south wall ----------
  // One terrazzo top from the sink and hob, past the shaft, to the washer under it.
  const as = { x0: SHAFTS[1].x1, z0: SHAFTS[1].z0, z1: 4.504 - 0.004, x1: 1.8 };
  const cd = 0.62, top2 = [0.86, 0.9];
  box(group, [0, depth + 0.02], top2, [k1, as.z0], mats.terrazzo, { noEdges: true });
  box(group, [as.x0, depth + 0.02], top2, [as.z0, as.z1], mats.terrazzo);
  box(group, [depth + 0.02, as.x1], top2, [as.z1 - cd, as.z1], mats.terrazzo);
  // Base cabinets under the turn, shaker fronts facing the room.
  box(group, [0, depth - 0.02], [0.1, 0.86], [k1, as.z0], mats.cabinetCream);
  box(group, [as.x0, depth - 0.02], [0.1, 0.86], [as.z0, as.z1 - cd], mats.cabinetCream);
  box(group, [as.x0, depth + 0.02], [0.1, 0.86], [as.z1 - cd + 0.02, as.z1], mats.cabinetCream, { noEdges: true });
  box(group, [as.x0, depth - 0.06], [0.0, 0.1], [k1, as.z1], mats.blackMetal, { noEdges: true, noCollide: true });
  shakerX(depth, as.z0, as.z1 - cd + 0.02, 0.1, 0.48, mats.cabinetCream, 'top');
  shakerX(depth, as.z0, as.z1 - cd + 0.02, 0.48, 0.86, mats.cabinetCream, 'top');
  // Narrow cabinet at the corner, the washer, then a filler cabinet beside the pantry.
  box(group, [depth + 0.02, 0.88], [0.1, 0.86], [as.z1 - cd + 0.02, as.z1], mats.cabinetCream);
  shakerZ(as.z1 - cd + 0.02, depth + 0.02, 0.88, 0.1, 0.86, mats.cabinetCream, 'top');
  box(group, [1.52, as.x1], [0.1, 0.86], [as.z1 - cd + 0.02, as.z1], mats.cabinetCream);
  shakerZ(as.z1 - cd + 0.02, 1.52, as.x1, 0.1, 0.86, mats.cabinetCream, 'top');
  box(group, [1.52, as.x1], [0.0, 0.1], [as.z1 - cd + 0.06, as.z1], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [depth - 0.06, 0.88], [0.0, 0.1], [as.z1 - cd + 0.06, as.z1], mats.blackMetal, { noEdges: true, noCollide: true });

  // Front-loading washer under the top: white body, chrome ring door, drawer and dial.
  const wm = { x0: 0.9, x1: 1.5, z0: as.z1 - 0.58, z1: as.z1 - 0.02, y1: 0.85 };
  box(group, [wm.x0, wm.x1], [0.02, wm.y1], [wm.z0, wm.z1], mats.whiteTop, { radius: 0.02 });
  box(group, [wm.x0 + 0.01, wm.x1 - 0.01], [0.0, 0.03], [wm.z0 + 0.02, wm.z1], mats.plastic, { noEdges: true, noCollide: true });
  box(group, [wm.x0 + 0.02, wm.x1 - 0.02], [0.705, 0.708], [wm.z0 - 0.001, wm.z0 + 0.01], mats.plastic, { noEdges: true, noCollide: true });
  box(group, [wm.x0 + 0.03, wm.x0 + 0.21], [0.73, 0.82], [wm.z0 - 0.004, wm.z0 + 0.02], mats.whiteTop, { radius: 0.006, noCollide: true });
  box(group, [wm.x0 + 0.04, wm.x0 + 0.2], [0.795, 0.805], [wm.z0 - 0.006, wm.z0 - 0.003], mats.plastic, { noEdges: true, noCollide: true });
  box(group, [wm.x0 + 0.26, wm.x0 + 0.42], [0.745, 0.805], [wm.z0 - 0.004, wm.z0], mats.screen, { noEdges: true, noCollide: true });
  const dial = cylinder(group, wm.x1 - 0.1, 0.775 - 0.015, 0.775 + 0.015, wm.z0 - 0.012, 0.03, 0.03, mats.metal, { noEdges: true, noCollide: true });
  dial.rotation.x = Math.PI / 2;
  dial.position.set(wm.x1 - 0.1, 0.775, wm.z0 - 0.012);
  const doorY = 0.38, doorX = (wm.x0 + wm.x1) / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.028, 16, 48), mats.metal);
  ring.position.set(doorX, doorY, wm.z0 - 0.02);
  ring.userData = { noEdges: true, noCollide: true };
  group.add(ring);
  const ringIn = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 12, 48), mats.plastic);
  ringIn.position.set(doorX, doorY, wm.z0 - 0.03);
  ringIn.userData = { noEdges: true, noCollide: true };
  group.add(ringIn);
  const porthole = cylinder(group, doorX, doorY - 0.004, doorY + 0.004, wm.z0 - 0.026, 0.15, 0.15, mats.screen, { noEdges: true, noCollide: true });
  porthole.rotation.x = Math.PI / 2;
  porthole.position.set(doorX, doorY, wm.z0 - 0.026);
  const drumBack = cylinder(group, doorX, doorY - 0.004, doorY + 0.004, wm.z0 + 0.05, 0.15, 0.15, mats.metal, { noEdges: true, noCollide: true });
  drumBack.rotation.x = Math.PI / 2;
  drumBack.position.set(doorX, doorY, wm.z0 + 0.05);
  box(group, [doorX + 0.17, doorX + 0.2], [doorY - 0.05, doorY + 0.05], [wm.z0 - 0.045, wm.z0 - 0.025], mats.metal, { radius: 0.006, noEdges: true, noCollide: true });
  // Laundry baskets and detergent on the top, coffee corner by the shaft.
  box(group, [1.22, 1.42], [0.9, 0.903], [4.25, 4.45], mats.whiteTop, { noCollide: true });
  box(group, [1.25, 1.38], [0.903, 1.22], [4.3, 4.45], mats.appliance, { radius: 0.01, noCollide: true });
  cylinder(group, 1.6, 0.9, 1.12, 4.38, 0.05, 0.05, mats.linenWhite, { noEdges: true, noCollide: true });

  // Uppers along the south wall and zellige behind the top.
  box(group, [as.x0, as.x1], [1.6, 2.3], [as.z1 - 0.35, as.z1], mats.cabinetCream, { noCollide: true });
  for (const [a, b] of [[as.x0, as.x0 + 0.5], [as.x0 + 0.5, as.x0 + 1.0], [as.x0 + 1.0, as.x1]]) shakerZ(as.z1 - 0.35, a, b, 1.6, 2.3, mats.cabinetCream, 'bottom');
  box(group, [as.x0 + 0.05, as.x1 - 0.05], [1.594, 1.6], [as.z1 - 0.32, as.z1 - 0.04], mats.ledWarm, { noEdges: true, noCollide: true });
  box(group, [as.x0, as.x1], [0.9, 1.6], [as.z1 - 0.006, as.z1], mats.zellige, { noEdges: true, noCollide: true });
  box(group, [as.x0, as.x0 + 0.006], [0.9, 1.6], [as.z0, as.z1], mats.zellige, { noEdges: true, noCollide: true });

  // Shallow pantry on the wall facing the hob (the gamer room's wall), 20 cm deep so the kitchen
  // stays open, floor to ceiling, running to the counter at the end. Cream doors below and above,
  // an open lit niche in the middle with the spices.
  const pw = X(623), pd = 0.2, pz0 = Z(697) + 0.04, pz1 = as.z1 - cd - 0.01, pf = pw - pd;
  box(group, [pf + 0.02, pw], [0.1, 0.92], [pz0, pz1], mats.cabinetCream);
  box(group, [pf + 0.02, pw], [1.56, GESSO], [pz0, pz1], mats.cabinetCream);
  for (const z of [pz0, pz1 - 0.018]) box(group, [pf, pw], [0.92, 1.56], [z, z + 0.018], mats.oakPale, { noCollide: true });
  box(group, [pf + 0.06, pw], [0.0, 0.1], [pz0, pz1], mats.blackMetal, { noEdges: true, noCollide: true });
  const pn = 3, ps = (pz1 - pz0) / pn;
  for (let i = 0; i < pn; i++) {
    const a = pz0 + i * ps, b = pz0 + (i + 1) * ps;
    shakerXneg(pf + 0.02, a, b, 0.1, 0.92, mats.cabinetCream);
    shakerXneg(pf + 0.02, a, b, 1.56, GESSO, mats.cabinetCream);
  }
  // The niche: oak lining, two shelves, LED under the top, jars with wooden lids.
  box(group, [pf, pw - 0.002], [0.92, 0.95], [pz0, pz1], mats.oakPale, { noCollide: true });
  box(group, [pf, pw - 0.002], [1.53, 1.56], [pz0, pz1], mats.oakPale, { noCollide: true });
  box(group, [pw - 0.012, pw - 0.002], [0.95, 1.53], [pz0, pz1], mats.oakPale, { noEdges: true, noCollide: true });
  box(group, [pf + 0.02, pw - 0.02], [1.522, 1.528], [pz0 + 0.02, pz1 - 0.02], mats.ledWarm, { noEdges: true, noCollide: true });
  box(group, [pf, pw - 0.012], [1.23, 1.25], [pz0, pz1], mats.oakPale, { noCollide: true });
  const spiceColours = [mats.pillowTan, mats.creamDark, mats.sage, mats.oak, mats.linenWhite, mats.pillowGreen, mats.seatBeige];
  for (const [i, y] of [[0, 0.95], [1, 1.25]]) {
    const count = Math.floor((pz1 - pz0 - 0.06) / 0.08);
    for (let j = 0; j < count; j++) {
      const z = pz0 + 0.06 + j * 0.08, x = pf + 0.09;
      cylinder(group, x, y, y + 0.11, z, 0.03, 0.03, mats.glass, { noEdges: true, noCollide: true });
      cylinder(group, x, y + 0.002, y + 0.08, z, 0.027, 0.027, spiceColours[(j + i * 3) % spiceColours.length], { noEdges: true, noCollide: true });
      cylinder(group, x, y + 0.11, y + 0.135, z, 0.031, 0.031, mats.oak, { noEdges: true, noCollide: true });
    }
  }
  // Oil, salt and a pepper mill on the corner.
  cylinder(group, as.x0 + 0.12, 0.9, 1.15, as.z0 + 0.12, 0.03, 0.03, mats.glass, { noEdges: true, noCollide: true });
  cylinder(group, as.x0 + 0.12, 0.9, 1.08, as.z0 + 0.12, 0.028, 0.028, mats.pillowTan, { noEdges: true, noCollide: true });
  cylinder(group, as.x0 + 0.22, 0.9, 1.08, as.z0 + 0.1, 0.025, 0.03, mats.oak, { noEdges: true, noCollide: true });
  cylinder(group, as.x0 + 0.2, 0.9, 0.97, as.z0 + 0.24, 0.04, 0.04, mats.ceramic, { noEdges: true, noCollide: true });

  // ---------- Dining: round-cornered table, four matching chairs, framed panel with plates ----------
  // The PDF has no wall between kitchen and dining: the gamer room's wall starts at its corner
  // (x 1.80) and the kitchen opens at a clean right angle there. The panel covers only that wall.
  const realWall = X(623);
  box(group, [realWall, 2.47], [0.08, 2.12], [2.37, Z(697)], mats.panelCream, { noCollide: true });
  box(group, [2.47, 2.52], [0, 2.12], [2.3, 2.4], mats.oakPale, { noCollide: true });
  // Plates on the wall, blue rims.
  for (const [x, y, r] of [[1.98, 1.66, 0.11], [2.28, 1.86, 0.12], [2.3, 1.5, 0.09], [1.96, 1.32, 0.09]]) {
    const plateMesh = plate(x, y, 2.37, r);
    plateMesh.rotation.x = -Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, 0.007, 6, 40), mats.plateBlue);
    rim.position.set(x, y, 2.35);
    rim.userData = { noEdges: true, noCollide: true };
    group.add(rim);
  }
  picture(2.18, 2.42, 1.08, 1.32, 2.37, -1, [0.04, 0.04, 0.04, 0.04, mats.printStripe]);

  const table = { x0: 1.42, x1: 2.38, z0: 1.1, z1: 1.84 };
  roundedSlab(table.x0, table.x1, table.z0, table.z1, 0.735, 0.765, 0.24, mats.whiteTop);
  lathe([[0.25, 0], [0.25, 0.015], [0.15, 0.4], [0.11, 0.735], [0, 0.735]], (table.x0 + table.x1) / 2, 0, (table.z0 + table.z1) / 2, mats.oakPale, { noCollide: false });
  place('ceramic_vase_01', 2.18, 0.765, 1.32, { scale: 0.7 });
  place('tea_set_01', 1.82, 0.765, 1.5, { scale: 0.62, rotation: 0.2 });
  // Eucalyptus branches in the vase, as in the reference photo: arching stems, round leaves in pairs.
  {
    const vx = 2.18, vz = 1.32, vy = 0.765 + 0.25;
    const stems = [], leaves = [];
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let s = 0; s < 6; s++) {
      const heading = (s / 6) * Math.PI * 2 + rand() * 0.6, lean = 0.35 + rand() * 0.35, length = 0.42 + rand() * 0.18;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8, out = Math.sin(lean) * length * u * (0.6 + 0.4 * u), up = Math.cos(lean) * length * u - 0.12 * u * u * length;
        pts.push(new THREE.Vector3(vx + Math.cos(heading) * out, vy + up, vz + Math.sin(heading) * out));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      stems.push(new THREE.TubeGeometry(curve, 16, 0.0025, 5));
      for (let k = 2; k < 15; k++) {
        const u = k / 15, at = curve.getPoint(u), tangent = curve.getTangent(u), size = 0.028 * (1.1 - u * 0.5);
        for (const side of [-1, 1]) {
          const leaf = new THREE.CircleGeometry(size, 10);
          leaf.scale(1, 0.82, 1);
          leaf.rotateX(-Math.PI / 2 + (rand() - 0.5) * 0.9);
          leaf.rotateY(heading + side * Math.PI / 2 + (rand() - 0.5) * 0.6);
          leaf.translate(at.x + side * 0.02 * -tangent.z, at.y, at.z + side * 0.02 * tangent.x);
          leaves.push(leaf);
        }
      }
    }
    const stemMesh = new THREE.Mesh(mergeGeometries(stems), mats.oak);
    const leafMat = mats.eucalyptus;
    const leafMesh = new THREE.Mesh(mergeGeometries(leaves.map((g) => g.toNonIndexed())), leafMat);
    for (const m of [stemMesh, leafMesh]) {
      metresUV(m);
      m.userData = { noEdges: true, noCollide: true };
      group.add(m);
    }
  }
  // Two chairs: oak back with cane, black frame, beige seat.
  for (const [x, z, turn] of [[1.68, 0.9, 0], [2.12, 0.9, 0], [1.68, 2.04, Math.PI], [2.12, 2.04, Math.PI]]) {
    const before = group.children.length;
    softBox([x - 0.22, x + 0.22], [0.41, 0.47], [z - 0.21, z + 0.22], mats.seatBeige, { puff: 0.01, round: 6, seed: x * 10, piping: true });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cylinder(group, x + dx * 0.2, 0, 0.41, z + dz * 0.19, 0.008, 0.008, mats.blackMetal, { noEdges: true });
    for (const dx of [-1, 1]) cylinder(group, x + dx * 0.2, 0.41, 0.86, z - 0.21, 0.008, 0.008, mats.blackMetal, { noEdges: true, noCollide: true });
    box(group, [x - 0.21, x + 0.21], [0.56, 0.84], [z - 0.245, z - 0.225], mats.oakPale, { radius: 0.008, noCollide: true });
    box(group, [x - 0.15, x + 0.15], [0.6, 0.8], [z - 0.225, z - 0.221], mats.cane, { noEdges: true, noCollide: true });
    if (turn) {
      // The third chair faces the other way: turn its parts around its own centre.
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, z);
      pivot.rotation.y = turn;
      for (const m of group.children.slice(before)) { m.position.x -= x; m.position.z -= z; pivot.add(m); }
      group.add(pivot);
    }
  }
  // Three globe pendants on a ceiling rail.
  box(group, [1.55, 2.3], [CEILING - 0.02, CEILING - 0.005], [1.45, 1.49], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const [x, y] of [[1.62, 1.76], [1.9, 1.9], [2.2, 1.7]]) {
    cylinder(group, x, y + 0.12, CEILING - 0.02, 1.47, 0.003, 0.003, mats.blackMetal, { noEdges: true, noCollide: true });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 16), mats.globe);
    globe.position.set(x, y, 1.47);
    globe.userData = { noEdges: true, noCollide: true };
    group.add(globe);
  }

  // ---------- South wall: oak cornice with LED, hidden oak door, ribbed TV panel, floating console ----------
  box(group, [realWall, 4.65], [2.12, 2.3], [2.12, 2.4], mats.oakPale, { noCollide: true });
  box(group, [realWall + 0.03, 4.6], [2.112, 2.12], [2.14, 2.17], mats.ledWarm, { noEdges: true, noCollide: true });
  const gd = DOOR_GAPS[3];
  box(group, [gd.x1 + 0.07, 4.65], [0, 2.12], [2.37, 2.4], mats.oakPale, { noEdges: true, noCollide: true });
  box(group, [gd.x0 - 0.07, gd.x1 + 0.07], [DOOR_HEAD + 0.07, 2.12], [2.37, 2.4], mats.oakPale, { noEdges: true, noCollide: true });
  box(group, [3.44, 4.56], [0.98, 2.12], [2.35, 2.37], mats.whiteSlat, { noEdges: true, noCollide: true });
  ripado('x', 3.44, 4.56, 0.98, 2.12, 2.35, -0.022, mats.whiteSlat);
  box(group, [3.52, 4.48], [0.98, 1.54], [2.31, 2.33], mats.blackMetal, { noCollide: true });
  box(group, [3.53, 4.47], [0.99, 1.53], [2.308, 2.31], mats.screen, { noEdges: true, noCollide: true });
  roundedSlab(3.3, 4.6, 2.0, 2.37, 0.3, 0.58, 0.12, mats.cabinetCream);
  ripado('x', 3.75, 4.15, 0.32, 0.56, 2.0, -0.014, mats.whiteSlat);
  roundedSlab(3.28, 4.62, 1.98, 2.37, 0.58, 0.61, 0.13, mats.oakPale);
  place('potted_plant_04', 4.42, 0.61, 2.18, { scale: 1.1 });
  box(group, [4.14, 4.36], [0.61, 0.64], [2.1, 2.28], mats.printStripe, { noCollide: true });
  place('potted_plant_04', 4.45, 2.3, 2.26, { scale: 1.2 });

  // ---------- Sofa wall: modular sofa with chaise to the window, half-painted wall, four frames, LED cove ----------
  const s = { x0: 2.66, x1: 4.58, chaise: 3.86 };
  softBox([s.x0, s.chaise], [0.08, 0.44], [0.07, 0.9], mats.sofaFabric, { puff: 0.018, round: 7, seed: 51, piping: true });
  softBox([s.chaise, s.x1], [0.08, 0.44], [0.07, 1.62], mats.sofaFabric, { puff: 0.018, round: 7, seed: 52, piping: true });
  softBox([s.x0 - 0.04, s.x0 + 0.16], [0.08, 0.62], [0.07, 0.9], mats.sofaFabric, { puff: 0.012, round: 7, seed: 53 });
  softBox([s.x0, s.x1], [0.44, 0.7], [0.05, 0.24], mats.sofaFabric, { puff: 0.012, round: 7, seed: 54, noCollide: true });
  softBox([s.x0 + 0.18, 3.36], [0.44, 0.88], [0.2, 0.42], mats.sofaFabric, { puff: 0.04, round: 4, seed: 55, noCollide: true }).rotation.x = -0.12;
  softBox([3.34, s.chaise - 0.02], [0.44, 0.88], [0.2, 0.42], mats.sofaFabric, { puff: 0.04, round: 4, seed: 56, noCollide: true }).rotation.x = -0.12;
  softBox([3.02, 3.4], [0.46, 0.84], [0.4, 0.52], mats.pillowTan, { puff: 0.035, round: 6, seed: 57, noCollide: true }).rotation.y = 0.12;
  softBox([3.38, 3.76], [0.46, 0.84], [0.4, 0.52], mats.pillowTan, { puff: 0.035, round: 6, seed: 58, noCollide: true }).rotation.y = -0.1;
  softBox([2.8, 3.1], [0.46, 0.76], [0.38, 0.48], mats.pillowGreen, { puff: 0.035, round: 6, seed: 59, noCollide: true }).rotation.y = 0.2;
  // Beige lower wall with a rounded top corner at its west end.
  const paint = new THREE.Shape();
  paint.moveTo(0, 0); paint.lineTo(2.5, 0); paint.lineTo(2.5, 1.22); paint.lineTo(0.42, 1.22);
  paint.quadraticCurveTo(0, 1.22, 0, 0.8); paint.lineTo(0, 0);
  const paintMesh = new THREE.Mesh(new THREE.ShapeGeometry(paint, 12), mats.paintBeige);
  paintMesh.position.set(2.15, 0, 0.004);
  paintMesh.userData = { noEdges: true, noCollide: true, flat: true };
  metresUV(paintMesh);
  group.add(paintMesh);
  picture(3.02, 3.42, 1.32, 1.86, 0.004, 1, [0.08, 0.2, 0.12, 0.12, mats.printBlue]);
  picture(3.47, 3.9, 1.6, 2.1, 0.004, 1, [0.04, 0.04, 0.04, 0.04, mats.printBlue]);
  picture(3.47, 3.9, 1.26, 1.55, 0.004, 1, [0.1, 0.1, 0.07, 0.07, mats.printGreen]);
  picture(3.95, 4.38, 1.34, 2.0, 0.004, 1, [0.08, 0.08, 0.22, 0.22, mats.printGreen]);
  box(group, [2.15, 4.65], [2.36, CEILING], [0, 0.22], mats.ceiling, { noEdges: true, noCollide: true });
  box(group, [2.17, 4.63], [2.355, 2.362], [0.2, 0.22], mats.ledWarm, { noEdges: true, noCollide: true });
  // A calathea in the window corner, between the chaise and the TV console.
  place('calathea_orbifolia_01', 4.42, 0, 1.8, { pick: 'calathea_orbifolia_01_c', scale: 1.15, rotation: 0.6 });
  // Striped oval rug.
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mats.stripeRug);
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(1.05, 0.62, 1);
  rug.position.set(3.45, 0.006, 1.4);
  rug.userData = { noEdges: true, noCollide: true, flat: true };
  rug.updateMatrix();
  metresUV(rug);
  group.add(rug);

  // Window lined in oak, white roller blind half down.
  const ws = WINDOWS[1];
  box(group, [ws.x0 - 0.03, ws.x1 - 0.002], [SILL - 0.02, WINDOW_HEAD], [ws.z0 + 0.001, ws.z0 + 0.03], mats.oakPale, { noCollide: true });
  box(group, [ws.x0 - 0.03, ws.x1 - 0.002], [SILL - 0.02, WINDOW_HEAD], [ws.z1 - 0.03, ws.z1 - 0.001], mats.oakPale, { noCollide: true });
  box(group, [ws.x0 - 0.03, ws.x1 - 0.002], [WINDOW_HEAD - 0.03, WINDOW_HEAD - 0.001], [ws.z0 + 0.03, ws.z1 - 0.03], mats.oakPale, { noCollide: true });
  box(group, [ws.x0 - 0.05, ws.x1 - 0.002], [SILL + 0.004, SILL + 0.026], [ws.z0 + 0.03, ws.z1 - 0.03], mats.oakPale, { noCollide: true });
  box(group, [ws.x0 - 0.07, ws.x0 - 0.035], [WINDOW_HEAD - 0.11, WINDOW_HEAD - 0.032], [ws.z0 + 0.035, ws.z1 - 0.035], mats.blind, { noCollide: true });
  box(group, [ws.x0 - 0.055, ws.x0 - 0.05], [1.88, WINDOW_HEAD - 0.11], [ws.z0 + 0.04, ws.z1 - 0.04], mats.blind, { noEdges: true, noCollide: true });

  // Linear LED lines in the ceiling, as in the photos.
  box(group, [0.94, 0.965], [CEILING - 0.004, CEILING], [0.3, 3.45], mats.ledWarm, { noEdges: true, noCollide: true });
  box(group, [1.05, 4.45], [CEILING - 0.004, CEILING], [1.14, 1.165], mats.ledWarm, { noEdges: true, noCollide: true });

  // ---------- Bathroom ----------
  const shaft = SHAFTS[0];
  floorPatch(group, { x0: shaft.x1, x1: banho.x1, z0: banho.z0, z1: shaft.z1 }, mats.showerFloor, 0.004);
  const vz0 = Z(340), vz1 = Z(405), vzc = (vz0 + vz1) / 2;
  // Ribbed oak vanity, stone top, oval vessel basin.
  box(group, [X(421), X(466)], [0.14, 0.76], [vz0, vz1], mats.oakPale);
  ripado('z', vz0, vz1, 0.16, 0.74, X(466), 0.012);
  box(group, [X(421), X(470)], [0.76, 0.81], [vz0 - 0.01, vz1 + 0.01], mats.stone, { radius: 0.005 });
  // The stone top carries on over the toilet tank, only as deep as the basin, with small ferns on it.
  const ledge = { x1: 0.32, z0: Z(285) - 0.27 };
  box(group, [X(421), ledge.x1], [0.76, 0.81], [ledge.z0, vz0 - 0.01], mats.stone, { noEdges: true });
  const fern = (fx, fz, s) => {
    lathe([[0, 0], [0.045 * s, 0.002], [0.055 * s, 0.07 * s], [0.05 * s, 0.072 * s], [0, 0.06 * s]], fx, 0.81, fz, mats.ceramic);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + s, len = (0.13 + 0.05 * Math.sin(i * 2.3)) * s;
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.035 * s, 6, 1), mats.pillowGreen);
      const P = frond.geometry.attributes.position;
      for (let k = 0; k < P.count; k++) {
        const t = (P.getX(k) + len / 2) / len, w = P.getY(k) * (1 - 0.75 * t);
        // Rises steeply from the pot, then arches over and droops at the tip.
        P.setXYZ(k, t * len * 0.8, len * (1.1 * t - 0.95 * t * t), w);
      }
      frond.geometry.computeVertexNormals();
      frond.material = frond.material.clone();
      frond.material.side = THREE.DoubleSide;
      frond.rotation.y = a;
      frond.position.set(fx, 0.81 + 0.06 * s, fz);
      frond.userData = { noEdges: true, noCollide: true };
      metresUV(frond);
      group.add(frond);
    }
  };
  fern(0.14, Z(285) - 0.14, 1);
  fern(0.12, Z(285) + 0.06, 0.8);
  fern(0.15, Z(285) + 0.25, 0.9);
  const basin = lathe([[0, 0.002], [0.1, 0.004], [0.17, 0.03], [0.19, 0.11], [0.18, 0.112], [0.16, 0.04], [0.09, 0.016], [0, 0.014]], 0.23, 0.81, vzc, mats.ceramic, { noCollide: false });
  basin.scale.set(0.82, 1, 1.25);
  // Tall black tap behind the basin, below the niche: it no longer runs into the wood.
  cylinder(group, 0.045, 0.81, 1.02, vzc, 0.012, 0.014, mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [0.045, 0.19], [1.0, 1.014], [vzc - 0.009, vzc + 0.009], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [0.04, 0.1], [0.94, 0.95], [vzc + 0.03, vzc + 0.04], mats.blackMetal, { noEdges: true, noCollide: true });

  // Shower: black-framed fixed glass with a door, rain head, mixer and hand shower, a niche.
  const sz = shaft.z1 - 0.02, gx0 = shaft.x1 + 0.012, gx1 = banho.x1 - 0.012, split = gx0 + (gx1 - gx0) * 0.48;
  box(group, [gx0, split - 0.01], [0.022, 1.98], [sz - 0.004, sz + 0.004], mats.showerGlass, { noEdges: true });
  box(group, [split + 0.01, gx1 - 0.01], [0.022, 1.98], [sz - 0.004, sz + 0.004], mats.showerGlass, { noEdges: true, noCollide: true });
  for (const x of [gx0, split - 0.01, split + 0.01, gx1]) box(group, [x - 0.012, x + 0.012], [0, 2.0], [sz - 0.012, sz + 0.012], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const y of [0.0, 1.98]) box(group, [gx0 - 0.012, gx1 + 0.012], [y, y + 0.022], [sz - 0.013, sz + 0.013], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [split + 0.04, split + 0.055], [0.9, 1.25], [sz + 0.013, sz + 0.03], mats.blackMetal, { radius: 0.006, noEdges: true, noCollide: true });
  // Plumbing on the east wall inside the shower.
  const wx = banho.x1 - 0.006, sc = (banho.z0 + shaft.z1) / 2;
  cylinder(group, wx - 0.03, 1.0, 2.08, sc, 0.011, 0.011, mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [wx - 0.32, wx - 0.03], [2.07, 2.09], [sc - 0.011, sc + 0.011], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [wx - 0.46, wx - 0.2], [2.052, 2.068], [sc - 0.13, sc + 0.13], mats.blackMetal, { radius: 0.004, noEdges: true, noCollide: true });
  box(group, [wx - 0.012, wx], [0.95, 1.13], [sc - 0.09, sc + 0.09], mats.blackMetal, { radius: 0.006, noEdges: true, noCollide: true });
  box(group, [wx - 0.09, wx - 0.012], [1.03, 1.05], [sc - 0.01, sc + 0.01], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [wx - 0.03, wx - 0.012], [1.25, 1.6], [sc + 0.2, sc + 0.22], mats.blackMetal, { noEdges: true, noCollide: true });
  cylinder(group, wx - 0.05, 1.4, 1.62, sc + 0.21, 0.018, 0.014, mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [wx - 0.1, wx - 0.002], [1.1, 1.42], [sc - 0.42, sc - 0.15], mats.oakPale, { noEdges: true, noCollide: true });
  box(group, [wx - 0.1, wx - 0.004], [1.12, 1.4], [sc - 0.4, sc - 0.17], mats.bathWall, { noEdges: true, noCollide: true });
  for (const [z, h, m] of [[sc - 0.36, 0.2, mats.linenWhite], [sc - 0.3, 0.17, mats.creamDark], [sc - 0.23, 0.14, mats.sage]]) cylinder(group, wx - 0.05, 1.12, 1.12 + h, z, 0.03, 0.03, m, { noEdges: true, noCollide: true });
  box(group, [shaft.x1 + 0.3, shaft.x1 + 0.56], [0.0045, 0.006], [sc - 0.03, sc + 0.03], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [shaft.x1 + 0.05, banho.x1 - 0.05], [0.0045, 0.012], [sz + 0.04, sz + 0.5], mats.linenWhite, { noEdges: true, noCollide: true });

  // One tall oak wall cabinet with mirrored doors, from the shower glass to the end of the wall:
  // over the toilet and over the basin, clear above the tap. The doors are the mirror. LED washes
  // down from under it; decoration on top.
  const toiletZ = Z(285);
  const cab = { x1: 0.17, y0: 1.12, y1: 1.92, z0: shaft.z1 + 0.03, z1: vz1 + 0.05 };
  box(group, [0.006, cab.x1 - 0.02], [cab.y0, cab.y1], [cab.z0, cab.z1], mats.oakPale, { noCollide: true });
  box(group, [0.02, cab.x1 - 0.02], [cab.y0 - 0.006, cab.y0], [cab.z0 + 0.02, cab.z1 - 0.02], mats.ledWarm, { noEdges: true, noCollide: true });
  const doors = 4, step = (cab.z1 - cab.z0) / doors;
  for (let i = 0; i < doors; i++) {
    const a = cab.z0 + i * step + 0.002, b = cab.z0 + (i + 1) * step - 0.002, fx = cab.x1;
    box(group, [fx - 0.02, fx - 0.004], [cab.y0, cab.y1], [a, b], mats.oakPale, { noCollide: true });
    box(group, [fx - 0.004, fx], [cab.y0 + 0.012, cab.y1 - 0.012], [a + 0.012, b - 0.012], mats.mirror, { noEdges: true, noCollide: true });
  }
  // On top: a trailing plant over the toilet end, a candle and a small vase.
  place('potted_plant_04', 0.09, cab.y1, toiletZ - 0.2, { scale: 0.9 });
  cylinder(group, 0.08, cab.y1, cab.y1 + 0.08, toiletZ + 0.12, 0.035, 0.035, mats.cream, { noEdges: true, noCollide: true });
  place('ceramic_vase_04', 0.08, cab.y1, vz1 - 0.06, { scale: 0.32 });
  // Toilet roll holder beside it.
  box(group, [0.006, 0.02], [0.68, 0.72], [toiletZ + 0.3, toiletZ + 0.32], mats.blackMetal, { noEdges: true, noCollide: true });
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 24), mats.linenWhite);
  paper.rotation.x = Math.PI / 2;
  paper.position.set(0.07, 0.64, toiletZ + 0.37);
  paper.userData = { noEdges: true, noCollide: true };
  metresUV(paper);
  group.add(paper);

  // Facing the toilet, on the east wall: a black towel bar with a towel folded over it, and a hook.
  const ex = banho.x1 - 0.006;
  for (const z of [toiletZ - 0.3, toiletZ + 0.3]) box(group, [ex - 0.07, ex], [1.19, 1.21], [z - 0.01, z + 0.01], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [ex - 0.08, ex - 0.06], [1.19, 1.21], [toiletZ - 0.31, toiletZ + 0.31], mats.blackMetal, { radius: 0.008, noEdges: true, noCollide: true });
  box(group, [ex - 0.098, ex - 0.084], [0.74, 1.215], [toiletZ - 0.24, toiletZ + 0.24], mats.linenWhite, { radius: 0.006, noCollide: true });
  box(group, [ex - 0.056, ex - 0.042], [0.88, 1.215], [toiletZ - 0.24, toiletZ + 0.24], mats.linenWhite, { radius: 0.006, noCollide: true });
  box(group, [ex - 0.098, ex - 0.042], [1.205, 1.225], [toiletZ - 0.24, toiletZ + 0.24], mats.linenWhite, { radius: 0.008, noCollide: true });
  box(group, [ex - 0.05, ex], [1.55, 1.57], [toiletZ + 0.5, toiletZ + 0.52], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [ex - 0.07, ex - 0.035], [1.14, 1.56], [toiletZ + 0.45, toiletZ + 0.57], mats.creamDark, { radius: 0.015, noCollide: true });
  spot(0.7, -0.75, GESSO);
  spot(0.7, -2.1, GESSO);

  // ---------- Dormitório 01, as in the reference video ----------
  // Facing the door: a full-height wardrobe on the left that runs straight into the cabinets over
  // the bed, one piece of joinery across the whole wall. Ribbed headboard and LED below the cabinets.
  // Window on the right-hand wall, open white shelving on the left by the door.
  const d = dorm1;
  const wallZ = d.z0;
  const ward = { x0: d.x0, x1: d.x0 + 0.62, z1: wallZ + 0.58 };
  const upperZ = wallZ + 0.36;
  // Wardrobe carcass and two tall doors, then the bridge of cabinets over the bed, same fronts.
  box(group, [ward.x0, ward.x1], [0.0, GESSO], [wallZ, ward.z1 - 0.02], mats.cabinetCream);
  box(group, [ward.x0 + 0.004, ward.x1 - 0.004], [0.0, 0.08], [ward.z1 - 0.06, ward.z1 - 0.02], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const [a, b] of [[ward.x0 + 0.004, (ward.x0 + ward.x1) / 2 - 0.002], [(ward.x0 + ward.x1) / 2 + 0.002, ward.x1 - 0.004]]) {
    box(group, [a, b], [0.09, GESSO - 0.004], [ward.z1 - 0.02, ward.z1], mats.cabinetCream, { noCollide: true });
  }
  for (const x of [(ward.x0 + ward.x1) / 2 - 0.03, (ward.x0 + ward.x1) / 2 + 0.03]) box(group, [x - 0.006, x + 0.006], [0.85, 1.25], [ward.z1, ward.z1 + 0.022], mats.blackMetal, { radius: 0.004, noEdges: true, noCollide: true });
  box(group, [ward.x1, d.x1], [1.74, GESSO], [wallZ, upperZ], mats.cabinetCream, { noCollide: true });
  for (const x of [2.36, 2.98, 3.6]) box(group, [x - 0.002, x + 0.002], [1.75, GESSO - 0.01], [upperZ, upperZ + 0.004], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [ward.x1 + 0.02, d.x1 - 0.02], [1.732, 1.738], [upperZ - 0.06, upperZ - 0.02], mats.ledWarm, { noEdges: true, noCollide: true });
  // Headboard wall between the wardrobe and the window wall.
  box(group, [ward.x1, d.x1], [0, 1.12], [wallZ, wallZ + 0.03], mats.oakPale, { noCollide: true });
  ripado('x', ward.x1, d.x1, 0.0, 1.12, wallZ + 0.03, 0.012);
  box(group, [ward.x1, d.x1], [1.12, 1.74], [wallZ, wallZ + 0.012], mats.panelCream, { noEdges: true, noCollide: true });
  box(group, [ward.x1 + 0.02, d.x1 - 0.02], [1.121, 1.127], [wallZ + 0.03, wallZ + 0.05], mats.ledWarm, { noEdges: true, noCollide: true });

  // Double bed, head against that wall, between the wardrobe and the window.
  const bed = { x0: 2.34, x1: 3.78, z0: wallZ + 0.05, z1: wallZ + 1.98 };
  box(group, [bed.x0, bed.x1], [0.06, 0.38], [bed.z0, bed.z1], mats.whiteTop, { noEdges: true });
  softBox([bed.x0 + 0.01, bed.x1 - 0.01], [0.38, 0.61], [bed.z0 + 0.01, bed.z1 - 0.01], mats.linenWhite, { puff: 0.012, seed: 7, piping: true });
  // Thick quilted duvet over the lower two thirds, falling over the sides and the foot.
  softBox([bed.x0 - 0.06, bed.x1 + 0.06], [0.3, 0.73], [bed.z0 + 0.62, bed.z1 + 0.07], mats.duvet, { puff: 0.06, quilt: 0.34, round: 5, wrinkle: 0.01, seed: 8, noCollide: true });
  softBox([bed.x0 + 0.02, bed.x1 - 0.02], [0.61, 0.71], [bed.z0 + 0.45, bed.z0 + 0.75], mats.duvet, { puff: 0.05, quilt: 0.3, round: 4, seed: 18, noCollide: true });
  // Pillows: two large white, two cushions in front, one patterned.
  softBox([bed.x0 + 0.06, bed.x0 + 0.7], [0.61, 0.93], [bed.z0 + 0.04, bed.z0 + 0.24], mats.linenWhite, { puff: 0.06, round: 5, seed: 9, noCollide: true }).rotation.x = 0.35;
  softBox([bed.x1 - 0.7, bed.x1 - 0.06], [0.61, 0.93], [bed.z0 + 0.04, bed.z0 + 0.24], mats.linenWhite, { puff: 0.06, round: 5, seed: 10, noCollide: true }).rotation.x = 0.35;
  softBox([bed.x0 + 0.2, bed.x0 + 0.68], [0.63, 0.89], [bed.z0 + 0.22, bed.z0 + 0.36], mats.creamDark, { puff: 0.045, round: 5, seed: 11, noCollide: true }).rotation.x = 0.3;
  softBox([bed.x1 - 0.68, bed.x1 - 0.2], [0.63, 0.89], [bed.z0 + 0.22, bed.z0 + 0.36], mats.creamDark, { puff: 0.045, round: 5, seed: 12, noCollide: true }).rotation.x = 0.3;
  softBox([(bed.x0 + bed.x1) / 2 - 0.22, (bed.x0 + bed.x1) / 2 + 0.22], [0.66, 0.85], [bed.z0 + 0.34, bed.z0 + 0.46], mats.linenWhite, { puff: 0.035, round: 6, seed: 13, noCollide: true }).rotation.x = 0.25;
  // Breakfast tray with two cups, plates and a small vase.
  const tx = (bed.x0 + bed.x1) / 2 + 0.12, tz = bed.z0 + 1.05, ty = 0.77;
  box(group, [tx - 0.27, tx + 0.27], [ty + 0.13, ty + 0.15], [tz - 0.17, tz + 0.17], mats.oak, { radius: 0.003, noCollide: true });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(group, [tx + dx * 0.24 - 0.01, tx + dx * 0.24 + 0.01], [ty - 0.05, ty + 0.13], [tz + dz * 0.14 - 0.01, tz + dz * 0.14 + 0.01], mats.oak, { noEdges: true, noCollide: true });
  plate(tx - 0.13, ty + 0.15, tz, 0.095);
  cup(tx - 0.13, ty + 0.165, tz);
  plate(tx + 0.13, ty + 0.15, tz, 0.095);
  cup(tx + 0.13, ty + 0.165, tz);
  place('ceramic_vase_01', tx, ty + 0.15, tz - 0.08, { scale: 0.28 });

  // Floating nightstands on both sides, a lamp-bottle and books.
  for (const [a, b] of [[ward.x1 + 0.03, bed.x0 - 0.04], [bed.x1 + 0.04, bed.x1 + 0.3]]) box(group, [a, b], [0.6, 0.63], [wallZ + 0.03, wallZ + 0.4], mats.oakPale, { noCollide: true });
  cylinder(group, (ward.x1 + bed.x0) / 2, 0.63, 0.82, wallZ + 0.16, 0.05, 0.055, mats.cabinetCream, { noCollide: true, noEdges: true });
  box(group, [bed.x1 + 0.07, bed.x1 + 0.27], [0.63, 0.66], [wallZ + 0.08, wallZ + 0.26], mats.linenWhite, { noCollide: true });
  box(group, [bed.x1 + 0.08, bed.x1 + 0.26], [0.66, 0.68], [wallZ + 0.09, wallZ + 0.25], mats.creamDark, { noCollide: true });

  // Wardrobe along the west wall, from just past the door swing to the corner wardrobe:
  // one continuous run of doors from the door to the cabinets over the bed, no open shelves.
  const wz0 = -0.95, wx1 = d.x0 + 0.56;
  box(group, [d.x0, wx1 - 0.02], [0, GESSO], [ward.z1 - 0.02, wz0], mats.cabinetCream);
  box(group, [wx1 - 0.06, wx1 - 0.02], [0, 0.08], [ward.z1, wz0 - 0.004], mats.blackMetal, { noEdges: true, noCollide: true });
  const wDoors = 3, wStep = (wz0 - ward.z1) / wDoors;
  for (let i = 0; i < wDoors; i++) {
    const a = ward.z1 + i * wStep + 0.002, b = ward.z1 + (i + 1) * wStep - 0.002;
    box(group, [wx1 - 0.02, wx1], [0.09, GESSO - 0.004], [a, b], mats.cabinetCream, { noCollide: true });
    const hz = i % 2 === 0 ? b - 0.04 : a + 0.04;
    box(group, [wx1, wx1 + 0.022], [0.85, 1.25], [hz - 0.006, hz + 0.006], mats.blackMetal, { radius: 0.004, noEdges: true, noCollide: true });
  }
  box(group, [wx1 - 0.02, wx1 + 0.002], [GESSO - 0.004, GESSO], [ward.z1, wz0], mats.cabinetCream, { noEdges: true, noCollide: true });

  // A 65-inch TV on the wall facing the bed, beside the door, on a ribbed oak panel with a floating rack.
  const tvWall = d.z1, tvX = (bed.x0 + bed.x1) / 2, tvW = 1.44, tvH = 0.81, tvY = 1.0;
  box(group, [tvX - 0.86, tvX + 0.86], [0.08, 2.1], [tvWall - 0.025, tvWall], mats.oakPale, { noCollide: true });
  ripado('x', tvX - 0.86, tvX + 0.86, 0.08, 2.1, tvWall - 0.025, -0.012);
  box(group, [tvX - tvW / 2 - 0.006, tvX + tvW / 2 + 0.006], [tvY - 0.006, tvY + tvH + 0.006], [tvWall - 0.075, tvWall - 0.045], mats.blackMetal, { radius: 0.004, noCollide: true });
  box(group, [tvX - tvW / 2, tvX + tvW / 2], [tvY, tvY + tvH], [tvWall - 0.077, tvWall - 0.075], mats.screen, { noEdges: true, noCollide: true });
  box(group, [tvX - tvW / 2 + 0.03, tvX + tvW / 2 - 0.03], [tvY - 0.012, tvY - 0.008], [tvWall - 0.06, tvWall - 0.05], mats.ledWarm, { noEdges: true, noCollide: true });
  roundedSlab(tvX - 0.68, tvX + 0.68, tvWall - 0.34, tvWall - 0.037, 0.36, 0.52, 0.06, mats.cabinetCream);
  roundedSlab(tvX - 0.69, tvX + 0.69, tvWall - 0.35, tvWall - 0.037, 0.52, 0.545, 0.07, mats.oakPale);
  place('ceramic_vase_04', tvX + 0.5, 0.545, tvWall - 0.2, { scale: 0.45 });
  box(group, [tvX - 0.58, tvX - 0.34], [0.545, 0.575], [tvWall - 0.26, tvWall - 0.1], mats.printStripe, { noCollide: true });

  // Rug at the foot of the bed and curtains on the window wall.
  box(group, [bed.x0 - 0.15, bed.x1 + 0.15], [0.003, 0.012], [bed.z1 - 0.05, bed.z1 + 0.5], mats.seagrass, { noEdges: true, noCollide: true });
  const w0 = WINDOWS[0];
  curtain(d.x1 - 0.08, w0.z0 - 0.3, w0.z0 + 0.1, mats.curtain);
  curtain(d.x1 - 0.08, w0.z1 - 0.08, w0.z1 + 0.32, mats.curtain);
  curtain(d.x1 - 0.04, w0.z0 + 0.06, w0.z1 - 0.04, mats.sheer);
  spot((bed.x0 + bed.x1) / 2, -1.25, CEILING);

  // ---------- Quarto gamer ----------
  // The south wall is solid in the PDF; the only window is on the east wall. So the desk keeps that
  // wall, and the wall becomes the feature: walnut slats lit from behind, a floating shelf, a neon.
  const g2 = ROOMS[3];
  const wallS = g2.z1, deskFront = wallS - 0.7, deskTop = 0.75;
  // Deep blue-grey paint on the west wall and the slat wall's backing; the rest stays light.
  box(group, [g2.x0, g2.x0 + 0.006], [0.08, CEILING], [g2.z0, g2.z1], mats.darkPaint, { noEdges: true, noCollide: true });
  box(group, [g2.x0, g2.x1], [0.08, CEILING], [wallS - 0.006, wallS], mats.darkPaint, { noEdges: true, noCollide: true });
  // Slat wall from the desk to the ceiling, with a pink and cyan wash from the top and bottom.
  ripado('x', g2.x0 + 0.1, g2.x1 - 0.1, deskTop + 0.04, 2.3, wallS - 0.006, -0.022, mats.walnut);
  box(group, [g2.x0 + 0.1, g2.x1 - 0.1], [2.3, 2.33], [wallS - 0.06, wallS - 0.006], mats.walnut, { noCollide: true });
  box(group, [g2.x0 + 0.12, (g2.x0 + g2.x1) / 2], [2.296, 2.3], [wallS - 0.05, wallS - 0.03], mats.neonPink, { noEdges: true, noCollide: true });
  box(group, [(g2.x0 + g2.x1) / 2, g2.x1 - 0.12], [2.296, 2.3], [wallS - 0.05, wallS - 0.03], mats.neonCyan, { noEdges: true, noCollide: true });

  // Desk: thick walnut top on black steel frames, LED along its front edge, a long felt mat.
  box(group, [g2.x0 + 0.02, g2.x1 - 0.02], [deskTop - 0.04, deskTop], [deskFront, wallS - 0.03], mats.walnut, { radius: 0.01 });
  for (const x of [g2.x0 + 0.1, (g2.x0 + g2.x1) / 2, g2.x1 - 0.1]) {
    box(group, [x - 0.02, x + 0.02], [0, deskTop - 0.04], [deskFront + 0.06, deskFront + 0.1], mats.blackMetal, { noEdges: true });
    box(group, [x - 0.02, x + 0.02], [0, deskTop - 0.04], [wallS - 0.12, wallS - 0.08], mats.blackMetal, { noEdges: true });
    box(group, [x - 0.02, x + 0.02], [0.0, 0.03], [deskFront + 0.06, wallS - 0.08], mats.blackMetal, { noEdges: true, noCollide: true });
    box(group, [x - 0.02, x + 0.02], [deskTop - 0.08, deskTop - 0.04], [deskFront + 0.06, wallS - 0.08], mats.blackMetal, { noEdges: true, noCollide: true });
  }
  box(group, [g2.x0 + 0.04, g2.x1 - 0.04], [deskTop - 0.05, deskTop - 0.044], [deskFront + 0.005, deskFront + 0.02], mats.neonPink, { noEdges: true, noCollide: true });
  box(group, [g2.x0 + 0.3, g2.x1 - 0.3], [deskTop, deskTop + 0.004], [deskFront + 0.04, deskFront + 0.36], mats.chairPad, { radius: 0.002, noEdges: true, noCollide: true });

  // Floating walnut shelf over the monitors: figures, a plant, a small neon underneath.
  const shelfY = 1.72;
  box(group, [g2.x0 + 0.35, g2.x1 - 0.35], [shelfY, shelfY + 0.03], [wallS - 0.24, wallS - 0.028], mats.walnut, { noCollide: true });
  box(group, [g2.x0 + 0.37, g2.x1 - 0.37], [shelfY - 0.004, shelfY], [wallS - 0.22, wallS - 0.2], mats.ledWarm, { noEdges: true, noCollide: true });
  place('potted_plant_04', g2.x0 + 0.55, shelfY + 0.03, wallS - 0.13, { scale: 1.0 });
  for (const [x, h, m] of [[2.95, 0.16, mats.chairPink], [3.08, 0.12, mats.chairCyan], [3.62, 0.14, mats.canGreen], [3.76, 0.18, mats.canRed]]) {
    cylinder(group, x, shelfY + 0.03, shelfY + 0.045, wallS - 0.13, 0.04, 0.04, mats.blackMetal, { noEdges: true, noCollide: true });
    softBox([x - 0.03, x + 0.03], [shelfY + 0.045, shelfY + 0.045 + h], [wallS - 0.16, wallS - 0.1], m, { puff: 0.006, round: 4, seed: x * 7, noCollide: true });
  }
  for (const [i, x] of [[0, 4.05], [1, 4.1], [2, 4.15]].map(([i, x]) => [i, x])) {
    box(group, [x, x + 0.035], [shelfY + 0.03, shelfY + 0.24 - i * 0.02], [wallS - 0.2, wallS - 0.05], [mats.canBlue, mats.chairPink, mats.linenWhite][i], { noEdges: true, noCollide: true });
  }

  // Neon on the west wall: a controller outline in pink, and two framed prints.
  const nx = g2.x0 + 0.012, nz = (g2.z0 + g2.z1) / 2 + 0.2, ny = 1.62;
  const neon = (z0, z1, y0, y1, m) => box(group, [nx, nx + 0.012], [y0, y1], [z0, z1], m, { noEdges: true, noCollide: true });
  neon(nz - 0.28, nz + 0.28, ny + 0.16, ny + 0.175, mats.neonPink);
  neon(nz - 0.28, nz + 0.28, ny - 0.175, ny - 0.16, mats.neonPink);
  neon(nz - 0.295, nz - 0.28, ny - 0.16, ny + 0.16, mats.neonPink);
  neon(nz + 0.28, nz + 0.295, ny - 0.16, ny + 0.16, mats.neonPink);
  neon(nz - 0.2, nz - 0.08, ny - 0.008, ny + 0.008, mats.neonCyan);
  neon(nz - 0.148, nz - 0.132, ny - 0.06, ny + 0.06, mats.neonCyan);
  for (const [dz, dy] of [[0.12, 0.04], [0.2, -0.04], [0.2, 0.08], [0.12, -0.08]]) {
    const b = cylinder(group, nx + 0.012, ny + dy - 0.022, ny + dy + 0.022, nz + dz, 0.022, 0.022, mats.neonCyan, { noEdges: true, noCollide: true });
    b.rotation.z = Math.PI / 2;
    b.position.set(nx + 0.012, ny + dy, nz + dz);
  }
  for (const [z0, z1, print] of [[g2.z0 + 0.35, g2.z0 + 0.75, mats.printBlue], [g2.z1 - 0.95, g2.z1 - 0.75, mats.printGreen]]) {
    box(group, [nx, nx + 0.03], [1.05, 1.45], [z0, z1], mats.blackMetal, { noCollide: true });
    box(group, [nx + 0.03, nx + 0.033], [1.08, 1.42], [z0 + 0.03, z1 - 0.03], print, { noEdges: true, noCollide: true });
  }

  // Two stations, each with two 24-inch monitors on a dual arm, keyboard with lit edges, mouse, headset.
  const stations = [[2.63, '#2a1a6e', '#d9407a', mats.neonPink, mats.chairPink, '#ff2d95', -0.18], [3.97, '#0c2d6b', '#19b5c9', mats.neonCyan, mats.chairCyan, '#1fd8ff', 0.18]];
  for (const [x, top, bottom, accent, chairMat, glow, turn] of stations) {
    const mz = wallS - 0.2, my0 = 1.0, mw = 0.532, mh = 0.3;
    for (const dx of [-0.272, 0.272]) {
      const mx = x + dx;
      box(group, [mx - mw / 2 - 0.006, mx + mw / 2 + 0.006], [my0 - 0.008, my0 + mh + 0.008], [mz, mz + 0.012], mats.plastic, { radius: 0.004, noCollide: true });
      box(group, [mx - 0.12, mx + 0.12], [my0 + 0.04, my0 + mh - 0.04], [mz + 0.012, mz + 0.04], mats.plastic, { radius: 0.02, noEdges: true, noCollide: true });
      box(group, [mx - mw / 2, mx + mw / 2], [my0, my0 + mh], [mz - 0.002, mz], monitorScreen(mx - mw / 2, my0, mw, mh, top, bottom, glow), { noEdges: true, noCollide: true });
      box(group, [mx - 0.012, mx + 0.012], [my0 + 0.14, my0 + 0.165], [mz + 0.03, wallS - 0.07], mats.blackMetal, { noEdges: true, noCollide: true });
    }
    // Dual arm: clamp at the back edge, one pole, a bar out to both screens.
    cylinder(group, x, deskTop, my0 + 0.17, wallS - 0.07, 0.016, 0.016, mats.blackMetal, { noEdges: true, noCollide: true });
    box(group, [x - 0.28, x + 0.28], [my0 + 0.14, my0 + 0.165], [wallS - 0.085, wallS - 0.06], mats.blackMetal, { noEdges: true, noCollide: true });
    box(group, [x - 0.04, x + 0.04], [deskTop - 0.06, deskTop], [wallS - 0.1, wallS - 0.04], mats.blackMetal, { noEdges: true, noCollide: true });
    // Keyboard and mouse.
    const kz = deskFront + 0.14;
    box(group, [x - 0.2, x + 0.14], [deskTop + 0.004, deskTop + 0.02], [kz, kz + 0.13], mats.plastic, { radius: 0.006, noCollide: true });
    box(group, [x - 0.19, x + 0.13], [deskTop + 0.02, deskTop + 0.03], [kz + 0.012, kz + 0.118], mats.blackMetal, { radius: 0.002, noEdges: true, noCollide: true });
    box(group, [x - 0.202, x + 0.142], [deskTop + 0.004, deskTop + 0.008], [kz - 0.002, kz + 0.132], accent, { noEdges: true, noCollide: true });
    softBox([x + 0.21, x + 0.275], [deskTop + 0.004, deskTop + 0.04], [kz + 0.01, kz + 0.13], mats.plastic, { puff: 0.008, round: 4, seed: x, noCollide: true });
    // Headset on a stand at the outer end of each station.
    const hx = x + (turn < 0 ? -0.58 : 0.58), hz = deskFront + 0.22;
    cylinder(group, hx, deskTop, deskTop + 0.008, hz, 0.06, 0.06, mats.blackMetal, { noEdges: true, noCollide: true });
    cylinder(group, hx, deskTop, deskTop + 0.26, hz, 0.008, 0.008, mats.blackMetal, { noEdges: true, noCollide: true });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 10, 24, Math.PI), mats.plastic);
    band.position.set(hx, deskTop + 0.18, hz);
    band.rotation.y = Math.PI / 2;
    band.userData = { noEdges: true, noCollide: true };
    group.add(band);
    for (const side of [-1, 1]) {
      const cup2 = cylinder(group, hx, deskTop + 0.13, deskTop + 0.17, hz + side * 0.09, 0.045, 0.045, mats.plastic, { noEdges: true, noCollide: true });
      cup2.rotation.x = Math.PI / 2;
      cup2.position.set(hx, deskTop + 0.15, hz + side * 0.09);
    }
    // Racing chair, padded, turned slightly towards the other player.
    const chair = new THREE.Group();
    chair.position.set(x, 0, deskFront - 0.3);
    chair.rotation.y = turn;
    group.add(chair);
    const into = (m) => { chair.add(m); return m; };
    into(softBox([-0.26, 0.26], [0.43, 0.53], [-0.22, 0.26], mats.chairPad, { puff: 0.02, round: 4, seed: x + 1 }));
    into(softBox([-0.2, 0.2], [0.47, 0.545], [-0.16, 0.22], chairMat, { puff: 0.012, round: 5, seed: x + 2, noCollide: true }));
    const back = into(softBox([-0.25, 0.25], [0.52, 1.3], [-0.34, -0.2], mats.chairPad, { puff: 0.015, round: 4, seed: x + 3 }));
    back.rotation.x = -0.1;
    const inset = into(softBox([-0.15, 0.15], [0.6, 1.18], [-0.235, -0.195], chairMat, { puff: 0.01, round: 5, seed: x + 4, noCollide: true }));
    inset.rotation.x = -0.1;
    for (const side of [-1, 1]) {
      const wing = into(softBox([side > 0 ? 0.17 : -0.28, side > 0 ? 0.28 : -0.17], [0.6, 1.08], [-0.32, -0.15], mats.chairPad, { puff: 0.02, round: 4, seed: x + 5 + side, noCollide: true }));
      wing.rotation.x = -0.1;
      into(box(group, [side * 0.3 - 0.018, side * 0.3 + 0.018], [0.45, 0.66], [-0.02, 0.02], mats.plastic, { noEdges: true }));
      into(box(group, [side * 0.3 - 0.04, side * 0.3 + 0.04], [0.66, 0.69], [-0.13, 0.18], mats.plastic, { radius: 0.012 }));
    }
    const pillow = into(softBox([-0.12, 0.12], [1.08, 1.22], [-0.21, -0.12], chairMat, { puff: 0.03, round: 3, seed: x + 8, noCollide: true }));
    pillow.rotation.x = -0.1;
    into(cylinder(group, 0, 0.1, 0.43, 0, 0.028, 0.028, mats.metal, { noEdges: true }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const leg = into(box(group, [-0.15, 0.15], [-0.014, 0.014], [-0.02, 0.02], mats.plastic, { noEdges: true, noCollide: true }));
      leg.position.set(Math.cos(a) * 0.15, 0.09, Math.sin(a) * 0.15);
      leg.rotation.y = -a;
      into(cylinder(group, Math.cos(a) * 0.3, 0, 0.055, Math.sin(a) * 0.3, 0.026, 0.026, mats.plastic, { noEdges: true, noCollide: true }));
    }
  }

  // PC towers under the desk at each end, so both pairs of screens fit on top: glass side to the
  // middle, three lit fans facing the room, a glowing card inside.
  for (const [x0, accent] of [[g2.x0 + 0.16, mats.neonPink], [g2.x1 - 0.38, mats.neonCyan]]) {
    const x1 = x0 + 0.22, z0 = wallS - 0.56, z1 = wallS - 0.14, y0 = 0.02, y1 = 0.49;
    box(group, [x0, x1], [y0, y1], [z0, z1], mats.plastic, { radius: 0.008, noCollide: true });
    box(group, [x0 + 0.015, x1 - 0.015], [y0 + 0.03, y1 - 0.03], [z0 - 0.004, z0], mats.screen, { noEdges: true, noCollide: true });
    for (let i = 0; i < 3; i++) {
      const fy = y0 + 0.09 + i * 0.145;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 8, 32), accent);
      ring.position.set((x0 + x1) / 2, fy, z0 - 0.008);
      ring.userData = { noEdges: true, noCollide: true };
      group.add(ring);
      cylinder(group, (x0 + x1) / 2, fy, fy, z0 - 0.006, 0.02, 0.02, mats.plastic, { noEdges: true, noCollide: true }).geometry = new THREE.CylinderGeometry(0.02, 0.02, 0.004, 16).rotateX(Math.PI / 2);
    }
    const side = x0 < 3 ? x1 : x0;
    const dir = x0 < 3 ? 1 : -1;
    box(group, side === x1 ? [x1 - 0.002, x1 + 0.002] : [x0 - 0.002, x0 + 0.002], [y0 + 0.02, y1 - 0.02], [z0 + 0.02, z1 - 0.02], mats.glass, { noEdges: true, noCollide: true });
    box(group, side === x1 ? [x1 - 0.06, x1 - 0.03] : [x0 + 0.03, x0 + 0.06], [y0 + 0.18, y0 + 0.23], [z0 + 0.05, z1 - 0.12], accent, { noEdges: true, noCollide: true });
    box(group, side === x1 ? [x1 - 0.12, x1 - 0.1] : [x0 + 0.1, x0 + 0.12], [y0 + 0.3, y1 - 0.06], [z0 + 0.12, z1 - 0.12], mats.blackMetal, { noEdges: true, noCollide: true });
    void dir;
  }

  // Frigobar by the window on a walnut snack cabinet with two drawers: black, glass door to the room.
  const fx0 = 3.95, fx1 = 4.45, fz0 = g2.z0 + 0.03, fz1 = g2.z0 + 0.53, base = 0.34, ftop = base + 0.82;
  box(group, [fx0 + 0.01, fx1], [0, base], [fz0, fz1], mats.walnut, { radius: 0.006 });
  box(group, [fx0 + 0.04, fx1 - 0.02], [0, 0.04], [fz0 + 0.02, fz1 - 0.02], mats.blackMetal, { noEdges: true, noCollide: true });
  for (const [y0, y1] of [[0.05, 0.19], [0.195, base - 0.01]]) {
    box(group, [fx0 - 0.006, fx0 + 0.012], [y0, y1], [fz0 + 0.01, fz1 - 0.01], mats.walnut, { radius: 0.003, noCollide: true });
    box(group, [fx0 - 0.012, fx0 - 0.006], [y1 - 0.03, y1 - 0.018], [fz0 + 0.15, fz1 - 0.15], mats.blackMetal, { noEdges: true, noCollide: true });
  }
  box(group, [fx0 + 0.01, fx0 + 0.015], [base - 0.006, base], [fz0 + 0.02, fz1 - 0.02], mats.neonCyan, { noEdges: true, noCollide: true });
  box(group, [fx0, fx1], [base, ftop], [fz0, fz1], mats.fridgeBlack, { radius: 0.012 });
  box(group, [fx0 - 0.005, fx0 + 0.006], [base + 0.07, ftop - 0.08], [fz0 + 0.05, fz1 - 0.05], mats.fridgeLight, { noEdges: true, noCollide: true });
  const cans = [mats.canRed, mats.canBlue, mats.canGreen, mats.canRed, mats.canGreen, mats.canBlue];
  for (const y of [base + 0.1, base + 0.33, base + 0.56]) {
    box(group, [fx0 - 0.05, fx0 - 0.005], [y - 0.006, y], [fz0 + 0.05, fz1 - 0.05], mats.metal, { noEdges: true, noCollide: true });
    for (let i = 0; i < 5; i++) cylinder(group, fx0 - 0.028, y, y + 0.12, fz0 + 0.1 + i * 0.075, 0.022, 0.022, cans[(i + Math.round(y * 10)) % 6], { noEdges: true, noCollide: true });
  }
  box(group, [fx0 - 0.062, fx0 - 0.054], [base + 0.03, ftop - 0.03], [fz0 + 0.03, fz1 - 0.03], mats.glass, { noEdges: true, noCollide: true });
  box(group, [fx0 - 0.075, fx0 - 0.062], [base + 0.2, base + 0.6], [fz1 - 0.07, fz1 - 0.05], mats.blackMetal, { noEdges: true, noCollide: true });
  box(group, [fx0 + 0.08, fx1 - 0.08], [ftop, ftop + 0.018], [fz0 + 0.08, fz1 - 0.08], mats.walnut, { noCollide: true });
  cylinder(group, fx0 + 0.16, ftop + 0.018, ftop + 0.14, fz0 + 0.18, 0.024, 0.024, mats.canRed, { noEdges: true, noCollide: true });
  cylinder(group, fx0 + 0.27, ftop + 0.018, ftop + 0.14, fz0 + 0.3, 0.024, 0.024, mats.canBlue, { noEdges: true, noCollide: true });
  cylinder(group, fx0 + 0.15, ftop + 0.018, ftop + 0.08, fz0 + 0.36, 0.05, 0.04, mats.pot, { noCollide: true });

  // Dark rug under the chairs, LED cove at the ceiling.
  box(group, [g2.x0 + 0.25, g2.x1 - 0.25], [0.003, 0.012], [g2.z0 + 0.62, deskFront + 0.05], mats.chairPad, { radius: 0.004, noEdges: true, noCollide: true });
  box(group, [g2.x0 + 0.3, g2.x1 - 0.3], [0.012, 0.0135], [g2.z0 + 0.66, g2.z0 + 0.68], mats.neonCyan, { noEdges: true, noCollide: true });
  const cy = CEILING - 0.05;
  box(group, [g2.x0 + 0.02, g2.x0 + 0.035], [cy, cy + 0.012], [g2.z0 + 0.02, g2.z1 - 0.02], mats.neonCyan, { noEdges: true, noCollide: true });
  box(group, [3.3, g2.x1 - 0.01], [cy, cy + 0.012], [g2.z0 + 0.02, g2.z0 + 0.035], mats.neonCyan, { noEdges: true, noCollide: true });
  place('gaming_console', 3.3, deskTop, wallS - 0.14, { scale: 0.8 });
  for (const [x, r] of [[2.2, 0.4], [4.42, -0.4]]) place('gamepad', x, deskTop, deskFront + 0.22, { scale: 0.42, rotation: r });
  const w2 = WINDOWS[2];
  // Curtains stop short of the desk, so neither falls over the PC tower at the window end.
  curtain(g2.x1 - 0.08, w2.z0 - 0.22, w2.z0 + 0.14, mats.curtainDark);
  curtain(g2.x1 - 0.08, deskFront - 0.36, deskFront - 0.03, mats.curtainDark);

  void sala;
  void hash;
  void soft;
}
