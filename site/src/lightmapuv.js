import * as THREE from 'three';

// Lightmap coordinates for flat surfaces: every plane of every mesh becomes one rectangle,
// projected along its main axis at a single texel density, then shelf-packed into the atlas.
// Computed on the page and sent to Blender with the model, so both always agree.
export function assignLightmapUV(meshes, size = 4096, pad = 4) {
  const charts = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const P = mesh.geometry.attributes.position;
    const proj = new Float32Array(P.count * 2);
    const byPlane = new Map();
    for (let t = 0; t < P.count; t += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(P, t + k).applyMatrix4(mesh.matrixWorld);
      n.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0]));
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
      const sign = [n.x, n.y, n.z][axis] >= 0 ? 1 : -1;
      const key = `${axis}${sign}:${Math.round([v[0].x, v[0].y, v[0].z][axis] * 200)}`;
      let chart = byPlane.get(key);
      if (!chart) {
        chart = { mesh, tris: [], u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity };
        byPlane.set(key, chart);
        charts.push(chart);
      }
      chart.tris.push(t);
      for (let k = 0; k < 3; k++) {
        const p = v[k];
        const [a, b] = axis === 0 ? [p.z, p.y] : axis === 1 ? [p.x, p.z] : [p.x, p.y];
        proj[(t + k) * 2] = a;
        proj[(t + k) * 2 + 1] = b;
        chart.u0 = Math.min(chart.u0, a); chart.u1 = Math.max(chart.u1, a);
        chart.v0 = Math.min(chart.v0, b); chart.v1 = Math.max(chart.v1, b);
      }
    }
    mesh.userData.lightmapProjection = proj;
  }
  charts.sort((a, b) => (b.v1 - b.v0) - (a.v1 - a.v0));
  const area = charts.reduce((s, c) => s + (c.u1 - c.u0) * (c.v1 - c.v0), 0);
  let scale = Math.sqrt((0.62 * size * size) / Math.max(area, 1e-6));
  while (!pack(charts, scale, size, pad)) scale *= 0.94;

  const uvs = new Map(meshes.map((m) => [m, new Float32Array(m.geometry.attributes.position.count * 2)]));
  for (const c of charts) {
    const uv = uvs.get(c.mesh), proj = c.mesh.userData.lightmapProjection;
    for (const t of c.tris) {
      for (let k = 0; k < 3; k++) {
        const i = (t + k) * 2;
        uv[i] = (c.x + (proj[i] - c.u0) * scale) / size;
        uv[i + 1] = (c.y + (proj[i + 1] - c.v0) * scale) / size;
      }
    }
  }
  for (const mesh of meshes) {
    mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(uvs.get(mesh), 2));
    delete mesh.userData.lightmapProjection;
  }
  return { charts: charts.length, texelsPerMetre: Math.round(scale) };
}

function pack(charts, scale, size, pad) {
  let x = 0, y = 0, row = 0;
  for (const c of charts) {
    const w = Math.max(1, Math.ceil((c.u1 - c.u0) * scale)) + pad, h = Math.max(1, Math.ceil((c.v1 - c.v0) * scale)) + pad;
    if (x + w > size) { x = 0; y += row; row = 0; }
    if (y + h > size) return false;
    c.x = x + pad / 2;
    c.y = y + pad / 2;
    x += w;
    row = Math.max(row, h);
  }
  return true;
}
