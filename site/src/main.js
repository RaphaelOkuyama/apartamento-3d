import * as THREE from 'three';
import { RGBELoader } from '../vendor/RGBELoader.js';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';
import { BOUNDS, CEILING, EYE, ROOMS, X, Z } from './plan.js';
import { drawing, loadingManager, mats, shared, texturesReady } from './materials.js';
import { buildApartment, buildOutside } from './build.js';
import { loadModels } from './models.js';
import { assignLightmapUV } from './lightmapuv.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  $('loader').textContent = 'Este passeio precisa de WebGL, que não está disponível neste navegador.';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1f2022);
// Indoor HDRI from Poly Haven (CC0), for soft reflections and fill light.
new RGBELoader(loadingManager).load('textures/photo_studio_loft_hall_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
});
// Diffuse light comes from the bake; the HDRI only adds reflections.
scene.environmentIntensity = 0.22;

const models = await loadModels((share) => { $('loadBar').style.transform = `scaleX(${share * 0.6})`; });
const apartment = buildApartment(scene, models);
const outside = buildOutside(scene);

// ---------- baked light ----------
// The four lightmaps come from tools/bake.py. Encoded as sRGB, scaled to a known range.
const lightmaps = {};
const lightmapLoader = new THREE.TextureLoader();
const lightmapsReady = Promise.all(['day_full', 'day_empty', 'night_full', 'night_empty'].map(async (key) => {
  const texture = await lightmapLoader.loadAsync(`bake/${key}.jpg`);
  texture.channel = 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  lightmaps[key] = texture;
}));
const VARIANTS = ['day_full', 'day_empty', 'night_full', 'night_empty'];
// Atlas coordinates for flat surfaces, computed here and sent to Blender with the model.
const cornerGroups = new WeakMap();
function smoothCorners(position, source) {
  let groups = cornerGroups.get(position);
  if (!groups) {
    const ids = new Map();
    groups = new Int32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.round(position.getX(i) * 2000)},${Math.round(position.getY(i) * 2000)},${Math.round(position.getZ(i) * 2000)}`;
      if (!ids.has(key)) ids.set(key, ids.size);
      groups[i] = ids.get(key);
    }
    cornerGroups.set(position, groups);
  }
  const n = groups.reduce((m, g) => Math.max(m, g), 0) + 1;
  const sum = new Float32Array(n * 3), hits = new Uint16Array(n);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    sum[g * 3] += source[i * 3]; sum[g * 3 + 1] += source[i * 3 + 1]; sum[g * 3 + 2] += source[i * 3 + 2];
    hits[g]++;
  }
  const out = new Uint8Array(source.length);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    out[i * 3] = sum[g * 3] / hits[g]; out[i * 3 + 1] = sum[g * 3 + 1] / hits[g]; out[i * 3 + 2] = sum[g * 3 + 2] / hits[g];
  }
  return out;
}
const atlas = assignLightmapUV(apartment.baked.filter((m) => !m.userData.dense));
const bakeReady = Promise.all([
  fetch('bake/uv1.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  // Vertex light ships gzipped (about a third of the size); the browser unpacks it.
  Promise.all(VARIANTS.map((key) => fetch(`bake/vlight_${key}.bin.gz`)
    .then((r) => (r.ok ? new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : null))
    .catch(() => null))),
  lightmapsReady.catch(() => null),
]).then(([info, vertexLight]) => {
  const stale = !info || !info.counts || !info.dense
    || apartment.baked.some((m) => info.counts[m.name] !== m.geometry.attributes.position.count)
    || vertexLight.some((b) => !b || b.byteLength !== info.denseTotal * 3);
  if (stale) {
    console.warn('Baked light is from an older model; using plain lights until the next bake.');
    return null;
  }
  // Detailed objects read their light from a vertex attribute instead of the atlas.
  const vertexMaterials = new Map();
  for (const mesh of apartment.baked) {
    const start = info.dense[mesh.name];
    if (start === undefined) continue;
    const count = mesh.geometry.attributes.position.count;
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).toArray().sort((a, b) => a - b);
    const sliver = size[1] < 0.05 || (size[0] < 0.03 && size[2] < 0.7);
    mesh.userData.bakeLight = Object.fromEntries(VARIANTS.map((key, i) => {
      let data = new Uint8Array(vertexLight[i], start * 3, count * 3);
      // A bar or profile has corners buried in the wall it touches, which bake to stray extremes
      // and shine as dots: give the whole piece its median light instead.
      if (sliver) {
        const median = [0, 1, 2].map((c) => {
          const v = []; for (let k = c; k < data.length; k += 3) v.push(data[k]);
          v.sort((a, b) => a - b);
          return v[v.length >> 1];
        });
        data = new Uint8Array(count * 3).map((_, k) => median[k % 3]);
      } else {
        // Corners are baked per face; averaging the corners that share a point smooths the
        // triangle facets the upholstery showed.
        data = smoothCorners(mesh.geometry.attributes.position, data);
      }
      return [key, new THREE.BufferAttribute(data, 3, true)];
    }));
    if (!vertexMaterials.has(mesh.material)) {
      const material = mesh.material.clone();
      material.defines = { ...(material.defines || {}), USE_BAKE_VERTEX: '' };
      material.userData.source = mesh.material;
      vertexMaterials.set(mesh.material, drawing(material));
    }
    mesh.material = vertexMaterials.get(mesh.material);
    mesh.geometry.setAttribute('bakeLight', mesh.userData.bakeLight.day_full);
  }
  return info;
});
const LIT = Object.entries(mats).filter(([name]) => name !== 'glass' && name !== 'sheer').map(([, material]) => material);
let night = false, furnished = true, lightRange = 6, bakedLight = false;
function applyLight() {
  if (!bakedLight) return;
  const key = `${night ? 'night' : 'day'}_${furnished ? 'full' : 'empty'}`;
  const map = lightmaps[key];
  shared.uBakeScale.value = lightRange * Math.PI;
  for (const mesh of apartment.baked) if (mesh.userData.bakeLight) mesh.geometry.setAttribute('bakeLight', mesh.userData.bakeLight[key]);
  for (const material of LIT) {
    if (!material.lightMap) material.needsUpdate = true;
    material.lightMap = map;
    material.lightMapIntensity = lightRange * Math.PI;
  }
  scene.environmentIntensity = night ? 0.06 : 0.22;
  if (probes) captureProbes();
}
let probes = null;

// ---------- post-processing ----------
// Off on touch devices, where the budget is better spent on frame rate.
const POST = !matchMedia('(pointer: coarse)').matches && innerWidth >= 768;
let composer = null;
const GRADE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - 0.32 * smoothstep(0.28, 0.85, length(q));
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.06);
      gl_FragColor = c;
    }`,
};
if (POST) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, null));
  // A single invalid pixel would be smeared over the whole frame by the bloom: drop it first.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: GRADE.vertexShader,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
        gl_FragColor = vec4(min(c.rgb, vec3(24.0)), c.a);
      }`,
  }));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.55, 1.35));
  composer.addPass(new ShaderPass(GRADE));
  composer.addPass(new OutputPass());
}
// Same paper and ink on screen in both pipelines: the chain tone-maps what the direct path shows as is.
const PAPER_DIRECT = shared.uPaper.value.clone(), INK_DIRECT = shared.uInk.value.clone();
const PAPER_LINEAR = new THREE.Vector3(1.05, 0.97, 0.78), INK_LINEAR = new THREE.Vector3(0.012, 0.013, 0.015);

// ---------- the sheet ----------
const INK = '#17181a', PAPER = '#f1ede2';
const CX = (BOUNDS.x0 + BOUNDS.x1) / 2, CZ = (BOUNDS.z0 + BOUNDS.z1) / 2;
const SERIF = 'Georgia, "Times New Roman", serif', MONO = 'Consolas, "Courier New", monospace';

function drawnPlane(widthM, heightM, pxPerM, paint, y, material = {}) {
  const c = document.createElement('canvas');
  c.width = widthM * pxPerM;
  c.height = heightM * pxPerM;
  const ctx = c.getContext('2d');
  ctx.scale(pxPerM, pxPerM);
  ctx.translate(widthM / 2 - CX, heightM / 2 - CZ);
  paint(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, heightM),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...material }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(CX, y, CZ);
  scene.add(mesh);
  return mesh;
}

const sheet = drawnPlane(44, 28, 110, (ctx) => {
  ctx.fillStyle = PAPER;
  ctx.fillRect(CX - 22, CZ - 14, 44, 28);
  ctx.strokeStyle = 'rgba(23,24,26,.05)';
  ctx.lineWidth = 0.008;
  for (let x = Math.floor(CX - 22); x < CX + 22; x++) { ctx.beginPath(); ctx.moveTo(x, CZ - 14); ctx.lineTo(x, CZ + 14); ctx.stroke(); }
  for (let z = Math.floor(CZ - 14); z < CZ + 14; z++) { ctx.beginPath(); ctx.moveTo(CX - 22, z); ctx.lineTo(CX + 22, z); ctx.stroke(); }
}, -0.012);

const LABELS = [
  ['DORMITÓRIO 01', 726, 279], ['BANHO', 499, 330], ['SALA', 789, 562],
  ['COZINHA', 538, 687], ['A.S.', 538, 880], ['DORMITÓRIO 02', 789, 820],
];
const DIMS = [
  ['2.95', 726, 156], ['2.40', 880, 278, 1], ['2.39', 541, 278, 1], ['1.14', 499, 402], ['4.65', 554, 439],
  ['2.40', 931, 562, 1], ['3.54', 431, 582, 1], ['1.80', 538, 815], ['1.49', 538, 838], ['0.90', 613, 879, 1],
  ['2.00', 931, 818, 1], ['2.70', 789, 921],
];
const planInk = drawnPlane(20, 20, 150, (ctx) => {
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `0.135px ${SERIF}`;
  for (const [t, x, y] of LABELS) ctx.fillText(t, X(x), Z(y));
  ctx.font = `0.105px ${MONO}`;
  for (const [t, x, y, vertical] of DIMS) {
    ctx.save();
    ctx.translate(X(x), Z(y));
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  }
  // Door swings, from the arcs in the PDF.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.008;
  ctx.setLineDash([0.05, 0.035]);
  const arc = (x, z, r, a, b) => { ctx.beginPath(); ctx.arc(x, z, r, a, b); ctx.stroke(); };
  arc(X(413), Z(436), 0.88, 0, Math.PI / 2);
  arc(X(536), Z(412), 0.66, Math.PI, Math.PI * 1.5);
  arc(X(575), Z(412), 0.74, Math.PI * 1.5, Math.PI * 2);
  arc(X(703), Z(707), 0.74, 0, Math.PI / 2);
  ctx.setLineDash([]);
  // Title block
  const tx = BOUNDS.x1 + 1.1, tz = BOUNDS.z0 + 0.1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `0.44px ${SERIF}`;
  if (innerWidth >= innerHeight) {
    ctx.fillText('Apartamento 02', tx, tz + 0.5);
    ctx.font = `0.125px ${MONO}`;
    ctx.fillText('PLANTA BAIXA · CORTE A 1,20 M', tx, tz + 0.82);
    ctx.fillText('ÁREA INTERNA APROX. 30 M²', tx, tz + 1.04);
  }
  ctx.font = `0.125px ${MONO}`;
  // Scale bar
  const sz = BOUNDS.z1 - 0.1;
  ctx.fillRect(tx, sz, 1, 0.035);
  ctx.fillText('1 M', tx + 1.1, sz + 0.04);
  ctx.lineWidth = 0.012;
  ctx.beginPath(); ctx.moveTo(tx, sz - 1.35); ctx.lineTo(tx, sz - 0.65); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx - 0.09, sz - 1.17); ctx.lineTo(tx, sz - 1.35); ctx.lineTo(tx + 0.09, sz - 1.17); ctx.stroke();
  ctx.fillText('N', tx + 0.16, sz - 1.22);
}, 0.012, { transparent: true, depthWrite: false, depthTest: false });
planInk.renderOrder = 20;

// ---------- the walk ----------
// t is how much scroll a leg takes. A GSAP timeline moves the camera key by key.
const look = (x, y, z) => new THREE.Vector3(x, y, z);
const pos = (x, y, z) => new THREE.Vector3(x, y, z);
const K = [
  // fov: vertical degrees for the aerial keys; h: horizontal degrees inside, so a wide screen
  // never stretches the rooms (74 vertical on 16:9 was about 105 horizontal, a fisheye).
  { t: 0, p: pos(CX, 70, CZ + 0.08), l: look(CX, 0, CZ), fov: 8 },
  { t: 1.7, p: pos(8.5, 15, 13), l: look(CX, 0.7, CZ), fov: 22 },
  { t: 1.4, p: pos(-2.4, EYE, 0.5), l: look(1.2, 1.35, 0.5), h: 70 },
  { t: 1.2, p: pos(0.5, EYE, 0.5), l: look(4.6, 1.1, 1.4), h: 82, room: 0 },
  { t: 0.7, p: pos(1.45, EYE, 0.24), l: look(0.35, 1.25, 2.5), h: 78 },
  { t: 0.8, p: pos(1.14, 1.4, 1.8), l: look(0.3, 1.12, 3.6), h: 84, room: 1 },
  { t: 0.7, p: pos(0.95, EYE, 2.55), l: look(1.55, 1.05, 4.35), h: 86, room: 2 },
  { t: 0.8, p: pos(1.12, EYE, 0.6), l: look(4.5, 1.15, 1.3), h: 82 },
  { t: 0.7, p: pos(2.46, EYE, 0.55), l: look(1.6, 0.95, 2.1), h: 82 },
  { t: 0.7, p: pos(2.46, EYE, 1.42), l: look(3.6, 0.95, 0.1), h: 84 },
  { t: 0.7, p: pos(2.6, EYE, 1.48), l: look(3.95, 1.1, 2.4), h: 80 },
  { t: 0.9, p: pos(2.92, 1.68, 2.62), l: look(3.25, 0.9, 4.45), h: 86, room: 3 },
  { t: 0.7, p: pos(2.95, EYE, 2.85), l: look(4.3, 0.55, 2.78), h: 74, room: 3 },
  { t: 0.7, p: pos(2.85, EYE, 1.45), l: look(1.0, 1.3, 0.6), h: 80 },
  { t: 0.6, p: pos(2.46, EYE, 0.55), l: look(0.6, 1.3, 0.3), h: 80 },
  { t: 0.7, p: pos(0.95, EYE, 0.5), l: look(0.68, 1.2, -1.4), h: 80 },
  { t: 0.7, p: pos(0.72, EYE, -0.08), l: look(0.45, 0.9, -1.7), h: 90, room: 4 },
  { t: 0.5, p: pos(0.7, EYE, 0.45), l: look(1.75, 1.3, 0.2), h: 80 },
  { t: 0.5, p: pos(1.75, EYE, 0.45), l: look(1.75, 1.3, -1.4), h: 80 },
  { t: 0.7, p: pos(1.75, EYE, -0.3), l: look(2.6, 0.85, -2.5), h: 86, room: 5 },
  { t: 0.7, p: pos(3.95, EYE, -0.42), l: look(2.5, 0.8, -2.3), h: 88 },
  { t: 0.8, p: pos(4.0, EYE, -1.55), l: look(3.0, 1.2, -0.14), h: 80 },
  { t: 0.7, p: pos(3.95, 3.4, -0.42), l: look(2.4, 0.5, 0.2), fov: 62 },
  { t: 1.2, p: pos(9.4, 12.5, 11.2), l: look(CX - 0.9, 0.3, CZ - 0.2), fov: 30 },
];
// Inside, shoot like an architectural photo: camera at 1.35 m, held almost level, lens no wider
// than 78 degrees. Looking down from eye height made the walls lean and seem to grow, and the
// near furniture loom. The gamer room stays a little higher to see over the chair backs.
const INSIDE_EYE = 1.35, MAX_H = 78;
K.forEach((k, i) => {
  if (k.h === undefined || i === 2) return;
  if (i === 12) { k.p.y = 1.2; k.h = Math.min(k.h, MAX_H); return; }
  if (i === 6) { k.p.y = 1.4; k.l.y = 0.55; k.h = Math.min(k.h, MAX_H); return; }
  k.p.y = i === 11 ? 1.5 : INSIDE_EYE;
  const run = Math.hypot(k.l.x - k.p.x, k.l.z - k.p.z);
  k.l.y = k.p.y - Math.min(0.09 * run, Math.max(0, k.p.y - k.l.y));
  k.h = Math.min(k.h, MAX_H);
});
const CAPTION_KEYS =K.map((k, i) => (k.room === undefined ? null : [i, k.room])).filter(Boolean);
const pathP = new THREE.CatmullRomCurve3(K.map((k) => k.p), false, 'centripetal');
const pathL = new THREE.CatmullRomCurve3(K.map((k) => k.l), false, 'centripetal');
// Inside, the camera turns by heading and tilt rather than chasing a target point: when two keys
// look in very different directions, the in-between target used to cross behind the camera and
// flip it down and around. Headings are unwrapped so each turn takes the short way.
let lastYaw = 0;
const pathA = new THREE.CatmullRomCurve3(K.map((k, i) => {
  const d = k.l.clone().sub(k.p);
  let yaw = Math.atan2(d.x, d.z);
  if (i) {
    while (yaw - lastYaw > Math.PI) yaw -= 2 * Math.PI;
    while (yaw - lastYaw < -Math.PI) yaw += 2 * Math.PI;
  }
  // A big turn gets more scroll, so no leg swings faster than about 100 degrees per unit.
  if (i >= 3) k.t = Math.max(k.t, (Math.abs(yaw - lastYaw) * 180) / Math.PI / 100);
  lastYaw = yaw;
  return new THREE.Vector3(yaw, Math.atan2(d.y, Math.hypot(d.x, d.z)), d.length());
}), false, 'catmullrom', 0.5);
const ANGLES_FROM = 2;
function lookTarget(u, n, from) {
  if (u < ANGLES_FROM) return pathL.getPoint(u / n);
  const a = pathA.getPoint(u / n);
  const pitch = Math.max(-1.45, Math.min(1.2, a.y));
  return new THREE.Vector3(Math.sin(a.x) * Math.cos(pitch), Math.sin(pitch), Math.cos(a.x) * Math.cos(pitch)).multiplyScalar(Math.max(0.5, a.z)).add(from);
}
const OUT_KEY = K.length - 2;
const cam = { u: 0 };

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const band = (u, a, b) => clamp01((u - a) / (b - a));

const camera = new THREE.PerspectiveCamera(8, 1, 0.08, 900);
// Vertical fov from a key: horizontal keys convert through the aspect, capped for tall phones.
const keyFov = (key, aspect) => {
  if (key.fov !== undefined) return key.fov;
  const v = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(key.h) / 2) / aspect) * 180) / Math.PI;
  return Math.min(v, 78);
};

// Room reveal: starts as the camera reaches each doorway, then sweeps from that door.
const REVEAL_FROM = [2.25, 3.9, 5.5, 10.3, 15.2, 18.3];
ROOMS.forEach((room, i) => {
  shared.uRect.value[i].set(room.x0 - 0.08, room.z0 - 0.08, room.x1 + 0.08, room.z1 + 0.08);
  shared.uSweep.value[i].set(room.door[0], room.door[1], 0);
});

function renderAt(u) {
  const n = K.length - 1;
  const i = Math.min(Math.floor(u), n - 1), f = u - i;
  pathP.getPoint(u / n, camera.position);
  const target = lookTarget(u, n, camera.position);
  // Fit the sheet on any screen at the top of the page.
  const aspect = innerWidth / innerHeight;
  const fit = Math.max(1, 0.82 / Math.max(aspect, 0.01));
  const planFactor = 1 - band(u, 0, 0.6);
  camera.position.y *= 1 + (fit - 1) * planFactor;
  camera.fov = keyFov(K[i], aspect) + (keyFov(K[i + 1], aspect) - keyFov(K[i], aspect)) * f;
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  shared.uCut.value = 1.2 + (CEILING + 0.002 - 1.2) * smooth(band(u, 0.18, 1.35));
  planInk.material.opacity = 1 - band(u, 0.12, 0.6);
  planInk.visible = planInk.material.opacity > 0.001;

  // Opens while the camera stands outside, closes behind it: open, it would block the bathroom door, as the plan shows.
  apartment.entryLeaf.rotation.y = (Math.PI / 2) * smooth(band(u, 1.6, 2.5)) * (1 - smooth(band(u, 3.2, 4.1)));

  ROOMS.forEach((room, r) => {
    const reach = 7 * smooth(band(u, REVEAL_FROM[r], REVEAL_FROM[r] + 1.0));
    shared.uSweep.value[r].z = reach;
  });

  const camY = camera.position.y, inside = camera.position.x > -0.1 && camY < 3;
  sheet.visible = !inside;
  apartment.ceilingGroup.visible = camY < CEILING - 0.02;

  // The sheet is drawn directly; rooms go through the chain once the camera is down.
  const chain = composer && u >= 1.55;
  outside.visible = chain ? camY < 6 : false;
  if (!composer && camY < 6) outside.visible = true;
  outside.userData.setMode(night, Boolean(chain));
  shared.uPaper.value.copy(chain ? PAPER_LINEAR : PAPER_DIRECT);
  shared.uInk.value.copy(chain ? INK_LINEAR : INK_DIRECT);
  if (chain) {
    composer.passes[0].camera = camera;
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// ---------- page ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
  }
  camera.aspect = innerWidth / innerHeight;
}
addEventListener('resize', resize);
resize();

const hero = $('hero'), caption = $('caption'), finale = $('finale');
let captionRoom = -1;
function updateUI(u) {
  hero.classList.toggle('off', u > 0.15);
  let room = -1;
  for (const [key, r] of CAPTION_KEYS) if (Math.abs(u - key) < 0.42) room = r;
  if (room !== captionRoom) {
    captionRoom = room;
    caption.classList.toggle('on', room >= 0);
    if (room >= 0) {
      $('capName').textContent = ROOMS[room].name;
      $('capSize').textContent = ROOMS[room].size;
    }
  }
  finale.classList.toggle('on', u > OUT_KEY + 0.55);
  let current = STOPS[0][0];
  for (const [key] of STOPS) if (u > key - 0.5) current = key;
  for (const button of nav.children) button.classList.toggle('on', +button.dataset.key === current);
  $('progress').style.transform = `scaleX(${walk.progress()})`;
}

const toggle = $('furnish'), clock = $('clock');
function setFurnished(value) {
  furnished = value;
  apartment.furnitureGroup.visible = value;
  apartment.furnitureLines.visible = value;
  apartment.bareGroup.visible = apartment.bareLines.visible = !value;
  toggle.textContent = value ? 'Ver sem móveis' : 'Ver mobiliado';
  toggle.setAttribute('aria-pressed', String(!value));
  applyLight();
}
toggle.onclick = () => setFurnished(!furnished);
function setNight(value) {
  night = value;
  clock.textContent = value ? 'Ver de dia' : 'Ver à noite';
  clock.setAttribute('aria-pressed', String(value));
  applyLight();
}
clock.onclick = () => setNight(!night);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
if (!reduced) ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.4, smoothTouch: 0.1 });

const walk = gsap.timeline({
  scrollTrigger: { trigger: '#track', start: 'top top', end: 'bottom bottom', scrub: true },
});
walk.addLabel('k0');
K.slice(1).forEach((key, i) => walk.to(cam, { u: i + 1, duration: key.t, ease: 'sine.inOut' }).addLabel(`k${i + 1}`));

// Room index: jumps along the scroll, so the camera still travels through the house.
const smoother = ScrollSmoother.get();
const STOPS = [[0, 'Planta'], [3, 'Sala'], [5, 'Cozinha'], [8, 'Jantar'], [11, 'Gamer'], [16, 'Banho'], [20, 'Dormitório 01'], [23, 'Vista']];
const nav = $('rooms');
nav.append(...STOPS.map(([key, name]) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.onclick = () => {
    const top = key === 0 ? 0 : walk.scrollTrigger.labelToScroll(`k${key}`);
    if (smoother) smoother.scrollTo(top, true);
    else scrollTo({ top });
  };
  button.dataset.key = key;
  return button;
}));

const [info] = await Promise.all([bakeReady, texturesReady]);
if (info) {
  lightRange = info.range;
  bakedLight = true;
  applyLight();
} else {
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x9c8a74, 1.3));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.5);
  sun.position.set(13, 7.5, 4.2);
  scene.add(sun);
}
// ---------- room reflections ----------
// Each room photographs itself in 360 once the baked light is on. Shiny surfaces in that room
// (mirror, glass, metal, the black fridge, stone and tiles) reflect that capture, projected onto
// the room's walls, instead of a studio panorama. Retaken on every day/night or furniture switch.
const pmrem = new THREE.PMREMGenerator(renderer);
const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const cubeCamera = new THREE.CubeCamera(0.05, 60, cubeTarget);
function setupProbes() {
  const list = ROOMS.map((room) => ({
    min: new THREE.Vector3(room.x0, 0, room.z0),
    max: new THREE.Vector3(room.x1, CEILING, room.z1),
    pos: new THREE.Vector3((room.x0 + room.x1) / 2, 1.3, (room.z0 + room.z1) / 2),
    materials: [],
  }));
  const clones = new Map(), box = new THREE.Box3(), centre = new THREE.Vector3();
  for (const mesh of apartment.baked) {
    const material = mesh.material, base = material.userData.source ?? material;
    // Roughness maps here sit around 0.5, so the effective value is about half the parameter.
    const rough = base.roughness * (base.roughnessMap ? 0.5 : 1);
    if (!(base.metalness >= 0.5 || rough <= 0.36 || base === mats.mirror)) continue;
    box.setFromObject(mesh).getCenter(centre);
    const r = ROOMS.findIndex((room) => centre.x > room.x0 - 0.25 && centre.x < room.x1 + 0.25 && centre.z > room.z0 - 0.25 && centre.z < room.z1 + 0.25);
    if (r < 0) continue;
    const key = `${material.uuid}:${r}`;
    if (!clones.has(key)) {
      const probe = list[r];
      const clone = material.clone();
      if (material.defines) clone.defines = { ...material.defines };
      clone.userData = { ...material.userData, source: base, probe: {
        uProbeOn: { value: 1 }, uProbeMin: { value: probe.min }, uProbeMax: { value: probe.max }, uProbePos: { value: probe.pos },
      } };
      drawing(clone, { poche: material.userData.poche });
      clone.envMapIntensity = base.metalness >= 0.5 ? 0.85 : 0.55;
      if (LIT.includes(material)) LIT.push(clone);
      probe.materials.push(clone);
      clones.set(key, clone);
    }
    mesh.material = clones.get(key);
  }
  probes = list;
}
function captureProbes() {
  const cut = shared.uCut.value, reach = shared.uSweep.value.map((v) => v.z);
  const shown = [sheet.visible, planInk.visible, apartment.ceilingGroup.visible, outside.visible];
  shared.uCut.value = CEILING + 0.01;
  for (const v of shared.uSweep.value) v.z = 99;
  sheet.visible = planInk.visible = false;
  apartment.ceilingGroup.visible = outside.visible = true;
  outside.userData.setMode(night, true);
  // LED strips are far brighter than anything else; in a reflection they turn into sparkling dots
  // on thin metal. Tone them down for the capture only.
  const glowing = [];
  scene.traverse((o) => {
    const m = o.isMesh && o.material;
    if (m && m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.01 && !glowing.includes(m)) glowing.push(m);
  });
  const glow = glowing.map((m) => m.emissiveIntensity);
  glowing.forEach((m) => { m.emissiveIntensity *= 0.12; });
  for (const probe of probes) {
    cubeCamera.position.copy(probe.pos);
    cubeCamera.update(renderer, scene);
    const old = probe.target;
    probe.target = pmrem.fromCubemap(cubeTarget.texture);
    for (const material of probe.materials) {
      if (!material.envMap) material.needsUpdate = true;
      material.envMap = probe.target.texture;
    }
    old?.dispose();
  }
  glowing.forEach((m, i) => { m.emissiveIntensity = glow[i]; });
  shared.uCut.value = cut;
  shared.uSweep.value.forEach((v, i) => { v.z = reach[i]; });
  [sheet.visible, planInk.visible, apartment.ceilingGroup.visible, outside.visible] = shown;
}
if (info) {
  setupProbes();
  captureProbes();
}

// Compile both pipelines now, so the first switch does not hitch during the walk.
if (composer) renderAt(2.2);
renderAt(0);
$('loader').hidden = true;

let frozen = false;
gsap.ticker.add(() => {
  if (frozen) return;
  renderAt(cam.u);
  updateUI(cam.u);
});

// ---------- used by the automated route check ----------
window.tour = {
  count: K.length,
  seekKey(u) {
    frozen = true;
    walk.scrollTrigger.disable(false);
    walk.pause();
    cam.u = u;
    renderAt(u);
    updateUI(u);
    renderAt(u);
  },
  setFurnished,
  setNight,
  debug: () => ({ renderer, scene, camera, composer, apartment }),
  // Writes the whole model for Blender: world-space triangles, material, and which set it belongs to.
  async exportScene(url) {
    apartment.entryLeaf.rotation.y = 0;
    scene.updateMatrixWorld(true);
    const names = new Map(Object.entries(mats).map(([k, v]) => [v, k]));
    const v = new THREE.Vector3(), normal = new THREE.Matrix3();
    const objects = apartment.baked.map((m) => {
      normal.getNormalMatrix(m.matrixWorld);
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, pos = [], nor = [];
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        pos.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
        v.fromBufferAttribute(N, i).applyMatrix3(normal).normalize();
        nor.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3));
      }
      const c = m.material.color.clone(), e = m.material.emissive, ei = m.material.emissiveIntensity ?? 1;
      const image = m.material.map?.image;
      if (image) {
        const probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        const ctx = probe.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        c.multiply(new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));
      }
      return {
        id: m.name, set: m.userData.set, count: P.count,
        uv1: m.userData.dense ? null : Array.from(m.geometry.attributes.uv1.array, (x) => +x.toFixed(6)),
        material: names.get(m.material.userData.source ?? m.material) ?? 'monitor', dense: m.userData.dense, metal: m.material.metalness ?? 0,
        color: [c.r, c.g, c.b], emissive: e ? [e.r * ei, e.g * ei, e.b * ei] : [0, 0, 0],
        pos, nor,
      };
    });
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ objects }) });
    return { status: res.status, objects: objects.length, triangles: objects.reduce((a, o) => a + o.count / 3, 0) };
  },
  // Walks the camera path and reports anything solid within `radius` metres.
  collisions(radius = 0.12) {
    apartment.entryLeaf.rotation.y = 0;
    const solids = [];
    for (const g of [apartment.shellGroup, apartment.fixtureGroup, apartment.furnitureGroup]) {
      g.updateMatrixWorld(true);
      g.traverse((m) => {
        if (!m.isMesh || m.userData.noCollide) return;
        solids.push({ box: new THREE.Box3().setFromObject(m), entry: m.parent === apartment.entryLeaf });
      });
    }
    const hits = new Map(), q = new THREE.Vector3(), sphere = new THREE.Sphere(q, radius);
    for (let u = 2.2; u <= OUT_KEY; u += 0.01) {
      pathP.getPoint(u / (K.length - 1), q);
      for (const s of solids) {
        if (s.entry && u < 3.2) continue;
        if (s.box.intersectsSphere(sphere)) {
          const b = s.box;
          const id = [b.min.x, b.max.x, b.min.z, b.max.z].map((v) => v.toFixed(2)).join(',');
          if (!hits.has(id)) hits.set(id, { u: +u.toFixed(2), at: [q.x, q.z].map((v) => +v.toFixed(2)), box: id, y: [b.min.y.toFixed(2), b.max.y.toFixed(2)].join('-') });
        }
      }
    }
    return { checked: solids.length, hits: [...hits.values()] };
  },
  snapshot: () => { renderAt(cam.u); return canvas.toDataURL('image/jpeg', 0.82); },
};
