import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';

// While the apartment loads: a ruler, a pencil and an eraser lying on the drawing paper, turning
// slowly, the pencil tracing a line. Small scene on its own canvas, thrown away when the page is ready.
export function startLoader(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.hidden = true;
    return { progress() {}, stop() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 50);
  camera.position.set(0, 1.85, 1.75);
  camera.lookAt(-0.1, 0, 0.02);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xcfc4ae, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(1.5, 4, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 6;
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
  scene.add(sun);

  // The paper only catches the shadows; its colour is the page behind the canvas.
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.16 }));
  paper.rotation.x = -Math.PI / 2;
  paper.receiveShadow = true;
  scene.add(paper);

  const tools = new THREE.Group();
  scene.add(tools);
  const add = (mesh, castShadow = true) => { mesh.castShadow = castShadow; tools.add(mesh); return mesh; };

  // Ruler: 30 cm in boxwood colour, centimetre and millimetre ticks drawn on top.
  const ticks = document.createElement('canvas');
  ticks.width = 1536; ticks.height = 160;
  const g = ticks.getContext('2d');
  g.fillStyle = '#eadcbf'; g.fillRect(0, 0, ticks.width, ticks.height);
  g.fillStyle = '#17181a'; g.font = '30px Consolas, "Courier New", monospace';
  for (let mm = 0; mm <= 300; mm++) {
    const x = 18 + mm * 5;
    const h = mm % 10 === 0 ? 62 : mm % 5 === 0 ? 44 : 26;
    g.fillRect(x, 0, 2, h);
    if (mm % 50 === 0) g.fillText(String(mm / 10), x + 5, 104);
  }
  g.fillStyle = '#a8491f'; g.fillText('1:50', 1400, 140);
  const tickMap = new THREE.CanvasTexture(ticks);
  tickMap.colorSpace = THREE.SRGBColorSpace;
  tickMap.anisotropy = 8;
  const wood = new THREE.MeshStandardMaterial({ color: 0xe2d1ae, roughness: 0.6 });
  const ruler = add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.035, 0.24), [wood, wood, new THREE.MeshStandardMaterial({ map: tickMap, roughness: 0.55 }), wood, wood, wood]));
  ruler.position.set(-0.05, 0.0175, 0.42);
  ruler.rotation.y = 0.12;

  // Pencil: six-sided body, sharpened wood cone, graphite point, metal band and pink eraser.
  const pencil = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.45 }));
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0495, 0.012, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0xd9b88a, roughness: 0.8 }));
  cone.position.y = -0.75;
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.35, metalness: 0.3 }));
  lead.rotation.x = Math.PI;
  lead.position.y = -0.875;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.053, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.3, metalness: 0.9 }));
  band.position.y = 0.7;
  const rubber = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0xd98c8c, roughness: 0.9 }));
  rubber.position.y = 0.79;
  pencil.add(body, cone, lead, band, rubber);
  pencil.traverse((m) => { m.castShadow = true; });
  pencil.rotation.z = Math.PI / 2;
  pencil.rotation.y = -0.5;
  pencil.position.set(0.15, 0.05, -0.2);
  tools.add(pencil);

  // Eraser: rounded white block in a paper sleeve.
  const eraser = add(new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.14, 0.24, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.85 })));
  const sleeve = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.146, 0.246), new THREE.MeshStandardMaterial({ color: 0xa8491f, roughness: 0.7 })));
  eraser.position.set(-0.85, 0.07, -0.3);
  sleeve.position.set(-0.78, 0.07, -0.3);
  eraser.rotation.y = sleeve.rotation.y = 0.5;

  // The line the pencil draws, growing as the loading bar does.
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.012), new THREE.MeshBasicMaterial({ color: 0x17181a }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(-0.6, 0.002, -0.62);
  line.scale.x = 0.001;
  scene.add(line);

  let progress = 0, running = true;
  function resize() {
    const w = canvas.clientWidth || 360, h = canvas.clientHeight || 180;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  (function frame(now) {
    if (!running) return;
    const t = (now - start) / 1000;
    if (!still) {
      tools.rotation.y = Math.sin(t * 0.4) * 0.18;
      pencil.position.y = 0.05 + Math.max(0, Math.sin(t * 2.2)) * 0.03;
    }
    line.scale.x = Math.max(0.001, progress * 1.25);
    line.position.x = -0.6 + line.scale.x / 2;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  })(start);

  return {
    progress(share) { progress = share; },
    stop() {
      running = false;
      removeEventListener('resize', resize);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
