import * as THREE from 'three';

// State shared by every drawing-aware material.
export const shared = {
  uCut: { value: 1.2 },
  uBakeScale: { value: 6 * Math.PI },
  uRect: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uSweep: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
  uPaper: { value: new THREE.Vector3(0.945, 0.93, 0.885) },
  uInk: { value: new THREE.Vector3(0.09, 0.095, 0.105) },
};

const REVEAL = /* glsl */ `
  uniform vec4 uRect[6];
  uniform vec3 uSweep[6];
  float revealAt(vec3 p) {
    float r = 0.0;
    for (int i = 0; i < 6; i++) {
      vec4 q = uRect[i];
      // Before a room's sweep starts nothing of it shows: the jitter could pull distances below
      // zero and leak a lit patch at each door into the opening plan.
      if (uSweep[i].z > 0.001 && p.x > q.x && p.x < q.z && p.z > q.y && p.z < q.w) {
        vec3 block = floor(p * 3.2);
        float jitter = fract(sin(dot(block, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float d = distance(p.xz, uSweep[i].xy) + (jitter - 0.5) * 1.1;
        r = max(r, 1.0 - smoothstep(uSweep[i].z - 0.12, uSweep[i].z, d));
      }
    }
    return r;
  }`;

// Vertices above the cut are flattened onto it, so the model reads as a plan at 1.2 m
// and the walls grow as the cut rises. Unrevealed surfaces render as paper.
// Reflections: a material may carry a room probe (a 360 capture of its room). Its reflection ray is
// projected onto that room's box, so a mirror shows the room it hangs in, at the right place.
const NO_PROBE = { uProbeOn: { value: 0 }, uProbeMin: { value: new THREE.Vector3() }, uProbeMax: { value: new THREE.Vector3() }, uProbePos: { value: new THREE.Vector3() } };
const PROBE_CHUNK = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
  'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );',
  `reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
      if (uProbeOn > 0.5) {
        // Surfaces on (or just past) a wall would divide zero by zero: keep the point inside the
        // box and the ray off exact zeros.
        vec3 pBox = clamp(vWP, uProbeMin + 0.01, uProbeMax - 0.01);
        vec3 rv = reflectVec + vec3(equal(reflectVec, vec3(0.0))) * 1e-4;
        vec3 far = max((uProbeMax - pBox) / rv, (uProbeMin - pBox) / rv);
        float dist = max(min(min(far.x, far.y), far.z), 0.0);
        vec3 dir = pBox + rv * dist - uProbePos;
        reflectVec = dot(dir, dir) > 1e-6 ? normalize(dir) : reflectVec;
      }`,
).replace(
  // The captures hold the sky through the windows at full strength; at grazing angles that lit
  // edges up as sparkling dots. A reflection never needs more than a bright wall's worth.
  'return envMapColor.rgb * envMapIntensity;',
  'return (uProbeOn > 0.5 ? min(envMapColor.rgb, vec3(1.2)) : envMapColor.rgb) * envMapIntensity;',
);
export function drawing(material, { poche = false } = {}) {
  material.userData.poche = poche;
  material.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, shared, { uPoche: { value: poche ? 1 : 0 } }, this.userData.probe ?? NO_PROBE);
    shader.vertexShader = `uniform float uCut; varying vec3 vWP;\n#ifdef USE_BAKE_VERTEX\nattribute vec3 bakeLight; varying vec3 vBake;\n#endif\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `vec4 wp = modelMatrix * vec4(transformed, 1.0);
       wp.y = min(wp.y, uCut);
       vWP = wp.xyz;
       #ifdef USE_BAKE_VERTEX
       vBake = bakeLight;
       #endif
       vec4 mvPosition = viewMatrix * wp;
       gl_Position = projectionMatrix * mvPosition;`,
    );
    shader.fragmentShader = `#ifdef USE_BAKE_VERTEX
varying vec3 vBake;
#endif
uniform float uBakeScale; uniform float uCut; uniform float uPoche; uniform vec3 uPaper; uniform vec3 uInk; varying vec3 vWP;
uniform float uProbeOn; uniform vec3 uProbeMin; uniform vec3 uProbeMax; uniform vec3 uProbePos;
      ${REVEAL}\n${shader.fragmentShader}`.replace('#include <envmap_physical_pars_fragment>', PROBE_CHUNK).replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>
       #if defined( RE_IndirectDiffuse ) && defined( USE_BAKE_VERTEX )
       irradiance += pow(vBake, vec3(2.2)) * uBakeScale;
       #endif`,
    ).replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       vec3 faceN = normalize(cross(dFdx(vWP), dFdy(vWP)));
       vec3 paperShade = uPaper * (0.86 + 0.14 * abs(dot(faceN, normalize(vec3(0.35, 0.85, 0.4)))));
       gl_FragColor.rgb = mix(paperShade, gl_FragColor.rgb, revealAt(vWP));
       if (uPoche > 0.5 && vWP.y >= uCut - 0.004) gl_FragColor = vec4(uInk, 1.0);`,
    );
  };
  return material;
}

export function inkLines() {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    transparent: true,
    depthWrite: false,
    vertexShader: `uniform float uCut; varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y = min(wp.y, uCut);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z -= 0.0006 * gl_Position.w;
      }`,
    fragmentShader: `uniform vec3 uInk; varying vec3 vWP; ${REVEAL}
      void main() { gl_FragColor = vec4(uInk, 0.78 * (1.0 - revealAt(vWP))); }`,
  });
}

// CC0 PBR sets from Poly Haven (polyhaven.com). UVs are in metres, so repeat = 1 / real size.
const manager = new THREE.LoadingManager();
export const texturesReady = new Promise((resolve) => { manager.onLoad = resolve; });
export { manager as loadingManager };
const loader = new THREE.TextureLoader(manager);
const loaded = new Map();

// Surface only: relief and sheen from the scan, colour set per material.
function pbr(id, sizeMeters, { surfaceOnly = false } = {}) {
  if (loaded.has(id)) return loaded.get(id);
  const one = (suffix, srgb) => {
    const texture = loader.load(`textures/${id}_${suffix}.jpg`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(1 / sizeMeters);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const set = { normalMap: one('nor', false), roughnessMap: one('rough', false) };
  if (!surfaceOnly) set.map = one('diff', true);
  loaded.set(id, set);
  return set;
}

const FLOOR = pbr('floor_oak', 3);
const PALE_OAK = pbr('white_oak_veneer', 1.2);
const TILE = pbr('marble_01', 1.5);
const PLASTER = pbr('painted_plaster_wall', 2, { surfaceOnly: true });
const LINEN = pbr('rough_linen', 0.27, { surfaceOnly: true });
const BOUCLE = pbr('wool_boucle', 0.33, { surfaceOnly: true });

function drawn(size, repeat, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.setScalar(repeat);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
let seedValue = 37;
const rnd = () => ((seedValue = (seedValue * 16807) % 2147483647) - 1) / 2147483646;

// Surface relief written in code: a height field turned into a normal map plus a roughness map,
// so painted doors, brushed steel and plastic stop reading as flat colour.
function relief(size, repeat, height, { strength = 1, roughBase = 0.5, roughSpread = 0.15 } = {}) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const nrm = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    nrm.set([(-dx / len * 0.5 + 0.5) * 255, (-dy / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255, 255], i);
    const r = Math.min(1, Math.max(0, roughBase + (at(x, y) - 0.5) * roughSpread * 2)) * 255;
    rough.set([r, r, r, 255], i);
  }
  const make = (data) => {
    const t = new THREE.DataTexture(data, size, size);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.setScalar(repeat);
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { normalMap: make(nrm), roughnessMap: make(rough) };
}
// Smooth value noise that tiles.
function tileNoise(cells, seed) {
  const g = Array.from({ length: cells * cells }, (_, i) => {
    const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  });
  return (u, v) => {
    const x = u * cells, y = v * cells, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const s = (t) => t * t * (3 - 2 * t);
    const c = (i, j) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    const a = c(x0, y0) + (c(x0 + 1, y0) - c(x0, y0)) * s(fx);
    const b = c(x0, y0 + 1) + (c(x0 + 1, y0 + 1) - c(x0, y0 + 1)) * s(fx);
    return a + (b - a) * s(fy);
  };
}
const nLacquerA = tileNoise(24, 1), nLacquerB = tileNoise(64, 2);
// Satin lacquer on the cream joinery: a soft orange peel and faint roller marks.
const LACQUER = relief(256, 1 / 0.6, (u, v) => 0.7 * nLacquerA(u, v) + 0.3 * nLacquerB(u, v), { strength: 0.25, roughBase: 0.46, roughSpread: 0.04 });
// Brushed steel: long fine streaks along one axis.
const rowNoise = Array.from({ length: 512 }, () => rnd());
const BRUSHED = relief(256, 1 / 0.25, (u, v) => rowNoise[Math.floor(v * 512)] * 0.7 + 0.3 * nLacquerB(u * 0.1, v), { strength: 0.35, roughBase: 0.4, roughSpread: 0.06 });
// Matte textured plastic for the PC parts, monitor backs and chairs' shells.
const nGrain = tileNoise(128, 5);
const GRAIN = relief(256, 1 / 0.15, (u, v) => nGrain(u, v), { strength: 2.2, roughBase: 0.5, roughSpread: 0.1 });

// Greige porcelain, 60 x 120 cm, for the bathroom walls.
const porcelain = drawn(1024, 1 / 1.2, (ctx, n) => {
  ctx.fillStyle = '#a7a196';
  ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,250,240' : '50,46,40'},${rnd() * 0.05})`;
    ctx.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  ctx.fillStyle = '#6e6a62';
  ctx.fillRect(0, 0, n, 3);
  ctx.fillRect(0, n / 2, n, 3);
  ctx.fillRect(0, 0, 3, n);
});
// Glazed green tiles, 10 cm, slightly uneven: the photos' backsplash.
const zellige = drawn(512, 1 / 0.4, (ctx, n) => {
  const cell = n / 4;
  ctx.fillStyle = '#c9cdbb';
  ctx.fillRect(0, 0, n, n);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const t = 0.88 + rnd() * 0.16;
      const g = ctx.createRadialGradient(x * cell + cell * rnd(), y * cell + cell * rnd(), 4, x * cell + cell / 2, y * cell + cell / 2, cell * 0.8);
      g.addColorStop(0, `rgb(${Math.round(172 * t)},${Math.round(186 * t)},${Math.round(160 * t)})`);
      g.addColorStop(1, `rgb(${Math.round(132 * t)},${Math.round(150 * t)},${Math.round(124 * t)})`);
      ctx.fillStyle = g;
      ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    }
  }
});
// White terrazzo with grey and warm chips.
const terrazzo = drawn(1024, 1 / 0.6, (ctx, n) => {
  ctx.fillStyle = '#efebe4';
  ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) {
    const tone = rnd();
    ctx.fillStyle = tone > 0.7 ? '#8d877e' : tone > 0.45 ? '#b9a48a' : tone > 0.2 ? '#cfc8bd' : '#5f5a54';
    ctx.beginPath();
    ctx.ellipse(rnd() * n, rnd() * n, 1 + rnd() * 4, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
});
// Cream and beige stripes for the oval rug.
const stripes = drawn(256, 1 / 0.24, (ctx, n) => {
  ctx.fillStyle = '#e7e0d3';
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = '#c9bca6';
  for (let x = 0; x < n; x += n / 6) ctx.fillRect(x, 0, n / 14, n);
});
// Woven seagrass, for the rug and table mats.
const seagrass = drawn(512, 1 / 0.28, (ctx, n) => {
  ctx.fillStyle = '#9a8655';
  ctx.fillRect(0, 0, n, n);
  const cell = 16;
  for (let y = 0; y < n; y += cell) {
    for (let x = 0; x < n; x += cell) {
      const over = ((x + y) / cell) % 2 === 0, tone = 145 + rnd() * 50;
      ctx.fillStyle = `rgb(${tone + 24},${tone + 6},${tone - 52})`;
      if (over) ctx.fillRect(x + 1, y + 3, cell - 2, cell - 6);
      else ctx.fillRect(x + 3, y + 1, cell - 6, cell - 2);
    }
  }
});
// Woven rattan, for the pendants.
const rattan = drawn(256, 1 / 0.09, (ctx, n) => {
  ctx.fillStyle = '#6e4a27';
  ctx.fillRect(0, 0, n, n);
  for (let y = 0; y < n; y += 8) {
    for (let x = 0; x < n; x += 8) {
      const t = 165 + rnd() * 45;
      ctx.fillStyle = `rgb(${t + 25},${t - 15},${t - 75})`;
      if (((x + y) / 8) % 2 === 0) ctx.fillRect(x + 1, y + 2, 6, 4);
    }
  }
});
const OAK = pbr('oak_veneer_01', 1.83);
const WALNUT = pbr('walnut_veneer_02', 1);

const standard = (options) => drawing(new THREE.MeshStandardMaterial(options));

export const mats = {
  wood: standard({ ...FLOOR, roughness: 1 }),
  tile: standard({ ...TILE, roughness: 0.8 }),
  wall: drawing(new THREE.MeshStandardMaterial({ ...PLASTER, color: 0xede6d9, roughness: 1, normalScale: new THREE.Vector2(0.25, 0.25) }), { poche: true }),
  shaft: drawing(new THREE.MeshStandardMaterial({ ...PLASTER, color: 0xede6d9, roughness: 1, normalScale: new THREE.Vector2(0.25, 0.25) }), { poche: true }),
  ceiling: standard({ color: 0xf4f2ec, roughness: 0.95 }),
  trim: standard({ color: 0xf6f4ee, roughness: 0.6 }),
  door: standard({ color: 0xf1eee6, roughness: 0.5 }),
  frame: standard({ color: 0x2d2e30, roughness: 0.45, metalness: 0.5 }),
  metal: standard({ color: 0x9a9c9e, roughness: 0.3, metalness: 0.9 }),
  blackMetal: standard({ ...BRUSHED, color: 0x1b1b1c, roughness: 1, metalness: 0.6 }),
  ceramic: standard({ color: 0xf5f4ef, roughness: 0.14 }),
  stone: standard({ color: 0xe9e4da, roughness: 0.22 }),
  bathWall: standard({ map: porcelain, roughness: 0.32 }),
  showerFloor: standard({ map: porcelain, roughness: 0.5 }),
  backsplash: standard({ color: 0xf3efe6, roughness: 0.18 }),
  zellige: standard({ map: zellige, roughness: 0.1 }),
  terrazzo: standard({ map: terrazzo, roughness: 0.35 }),
  stripeRug: standard({ map: stripes, roughness: 1 }),
  cane: drawing(new THREE.MeshStandardMaterial({ map: rattan, color: 0xe2c79a, roughness: 0.8 })),
  panelCream: standard({ ...PLASTER, color: 0xe6dccb, roughness: 0.9 }),
  paintBeige: standard({ ...PLASTER, color: 0xc8b089, roughness: 1 }),
  whiteSlat: standard({ color: 0xf1eee7, roughness: 0.6 }),
  seatBeige: standard({ ...LINEN, color: 0xb9ab95, roughness: 1 }),
  pillowGreen: standard({ ...BOUCLE, color: 0x55603d, roughness: 1 }),
  pillowTan: standard({ ...LINEN, color: 0xa77d4f, roughness: 1 }),
  plateBlue: standard({ color: 0x27468a, roughness: 0.3 }),
  printBlue: standard({ color: 0x24497f, roughness: 0.9 }),
  printGreen: standard({ color: 0x8fb0a0, roughness: 0.9 }),
  printStripe: standard({ color: 0x3a5b9a, roughness: 0.9 }),
  blind: standard({ color: 0xf2efe8, roughness: 1 }),
  globe: standard({ color: 0xffffff, emissive: 0xfff1da, emissiveIntensity: 1.8, roughness: 0.4 }),
  curtainDark: drawing(new THREE.MeshStandardMaterial({ ...LINEN, color: 0x30333d, roughness: 1, side: THREE.DoubleSide })),
  sage: standard({ color: 0x9aa58c, roughness: 0.42 }),
  cabinetCream: standard({ ...LACQUER, color: 0xddd5c5, roughness: 1 }),
  oakPale: standard({ ...PALE_OAK, color: 0xf2e6d2, roughness: 0.9 }),
  ripado: standard({ ...PALE_OAK, color: 0xf5e4c8, roughness: 0.85 }),
  whiteTop: standard({ ...LACQUER, color: 0xf1eee7, roughness: 0.62 }),
  fridgeBlack: standard({ ...BRUSHED, color: 0x141518, roughness: 0.95, metalness: 0.55 }),
  cream: standard({ ...LINEN, color: 0xede5d5, roughness: 1 }),
  creamDark: standard({ ...BOUCLE, color: 0xd8cbb5, roughness: 1 }),
  linenWhite: standard({ ...LINEN, color: 0xf3f0e9, roughness: 1 }),
  duvet: standard({ ...LINEN, color: 0xcfc8b8, roughness: 1 }),
  seagrass: standard({ map: seagrass, roughness: 0.95 }),
  rattan: drawing(new THREE.MeshStandardMaterial({ map: rattan, side: THREE.DoubleSide, roughness: 0.8, emissive: 0xffb36a, emissiveIntensity: 0.28, emissiveMap: rattan })),
  ledWarm: standard({ color: 0x000000, emissive: 0xffd6a0, emissiveIntensity: 2.4 }),
  sheer: drawing(new THREE.MeshStandardMaterial({ color: 0xfbf7ee, transparent: true, opacity: 0.52, side: THREE.DoubleSide, roughness: 1, depthWrite: false })),
  cabinet: standard({ color: 0x5f6a60, roughness: 0.55 }),
  oak: standard({ ...OAK, roughness: 0.9 }),
  walnut: standard({ ...WALNUT, roughness: 0.9 }),
  sofa: standard({ ...BOUCLE, color: 0x8d8a7f, roughness: 1 }),
  cushion: standard({ ...LINEN, color: 0xb9653c, roughness: 1 }),
  linen: standard({ ...LINEN, color: 0xe9e4d8, roughness: 1 }),
  blanket: standard({ ...LINEN, color: 0x4f6459, roughness: 1 }),
  rug: standard({ ...BOUCLE, color: 0xb9ae98, roughness: 1 }),
  curtain: drawing(new THREE.MeshStandardMaterial({ ...LINEN, color: 0xe6dfd0, roughness: 1, side: THREE.DoubleSide })),
  screen: standard({ color: 0x0b0c0e, roughness: 0.12, metalness: 0.2 }),
  appliance: standard({ ...BRUSHED, color: 0xc4c6c6, roughness: 0.95, metalness: 0.75 }),
  leaf: standard({ color: 0x47663f, roughness: 0.75 }),
  pot: standard({ color: 0xb4674a, roughness: 0.85 }),
  mirror: standard({ color: 0xc9d2d4, roughness: 0.04, metalness: 1 }),
  lampShade: drawing(new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffd9a0, emissiveIntensity: 1.1, roughness: 0.8 })),
  art: standard({ color: 0xc66a3c, roughness: 0.85 }),
  artDark: standard({ color: 0x25342f, roughness: 0.85 }),
  darkPaint: standard({ ...PLASTER, color: 0x3d4150, roughness: 1, normalScale: new THREE.Vector2(0.3, 0.3) }),
  plastic: standard({ ...GRAIN, color: 0x121316, roughness: 0.85 }),
  chairPad: standard({ ...LINEN, color: 0x2e3036, roughness: 1 }),
  chairPink: standard({ ...LINEN, color: 0xb3245f, roughness: 1 }),
  chairCyan: standard({ ...LINEN, color: 0x167f9c, roughness: 1 }),
  neonPink: standard({ color: 0x000000, emissive: 0xff2d95, emissiveIntensity: 2.6 }),
  neonCyan: standard({ color: 0x000000, emissive: 0x1fd8ff, emissiveIntensity: 2.6 }),
  fridgeLight: standard({ color: 0x000000, emissive: 0xfff4e0, emissiveIntensity: 1.5 }),
  canRed: standard({ color: 0xc9241f, roughness: 0.28, metalness: 0.75 }),
  canBlue: standard({ color: 0x1c4fbf, roughness: 0.28, metalness: 0.75 }),
  canGreen: standard({ color: 0x1f8a4a, roughness: 0.28, metalness: 0.75 }),
  glass: drawing(new THREE.MeshPhysicalMaterial({ color: 0xdfeef0, transparent: true, opacity: 0.08, roughness: 0.04, metalness: 0, depthWrite: false })),
  showerGlass: drawing(new THREE.MeshPhysicalMaterial({ color: 0xcfe0de, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0, depthWrite: false })),
};

// Original wallpaper for the monitors, drawn in code.
export function monitorScreen(x0, y0, width, height, top, bottom, accent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 300;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 300);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(256, 165, 58, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#0a0b12';
  ctx.fillRect(0, 165, 512, 135);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const y = 165 + i * i * 3.2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(256 + i * 14, 165); ctx.lineTo(256 + i * 70, 300); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / width, 1 / height);
  texture.offset.set(-x0 / width, -y0 / height);
  return standard({ color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.25, roughness: 0.2 });
}
