import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { drawing, mats } from './materials.js';

// CC0 models from Poly Haven, in site/m/. Their materials join the same paper-to-material reveal
// and are registered in `mats`, so they take the baked light like everything else.
// Only the ones the rooms place: every extra model was megabytes nobody saw.
const NAMES = ['potted_plant_04', 'ceramic_vase_01', 'ceramic_vase_04', 'gaming_console'];

export async function loadModels(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, done, total) => onProgress(done / total);
  const loader = new GLTFLoader(manager);
  const models = {};
  await Promise.all(NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`m/${name}.gltf`);
    const seen = new Map();
    gltf.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (!seen.has(mesh.material)) {
        const material = drawing(mesh.material);
        mats[`mdl_${name}_${seen.size}`] = material;
        seen.set(mesh.material, material);
      }
      mesh.material = seen.get(mesh.material);
    });
    models[name] = gltf.scene;
  }));
  return models;
}
