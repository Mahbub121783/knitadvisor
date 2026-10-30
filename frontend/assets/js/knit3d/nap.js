// KnitAdvisor · knit3d — brushed nap (the raised back of a finished fleece).
//
// Brushing tears the fleecy yarn's floats open into a dense, matted layer of
// fine fibres that almost hides the loop structure underneath. A few thousand
// individual fibre meshes can never reach that density — they read as
// scattered spikes. So the nap is built the way real-time fur, velvet and
// felt are:
//
//   • SHELLS — a stack of thin layers following the fabric's real back
//     surface, each alpha-tested against the same fibre texture. A texel
//     that survives several layers is a strand; strands thin out toward the
//     tips and lean in the brushing direction. Lower layers are darker
//     (fibres shade each other), which is what gives the nap its depth.
//   • STRAY FIBRES — fine curled fibres rooted on the actual floats, for the
//     tangled silhouette that shells alone don't give at a grazing angle.
//
// Everything is deterministic (seeded), so the swatch is stable.

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Tileable fibre-tangle mask. Brightness per fibre varies, so higher shells
// (higher alphaTest) keep fewer of them — the nap thins toward the tips.
function napTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  const R = rng(4242);
  for (let k = 0; k < 2400; k++) {
    const x0 = R() * size, y0 = R() * size;
    const a = R() * Math.PI * 2;
    const len = 6 + R() * 18;
    const bend = (R() - 0.5) * 14;
    const x2 = x0 + Math.cos(a) * len, y2 = y0 + Math.sin(a) * len;
    const cx = (x0 + x2) / 2 - Math.sin(a) * bend, cy = (y0 + y2) / 2 + Math.cos(a) * bend;
    const v = Math.round(255 * (0.3 + 0.7 * R()));
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 1.2 + R() * 1.6;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath();
      ctx.moveTo(x0 + ox, y0 + oy);
      ctx.quadraticCurveTo(cx + ox, cy + oy, x2 + ox, y2 + oy);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// The back surface of the fleecy yarn as a smooth height field z(x,y):
// the back-most yarn point in each cell, pushed back by one yarn radius,
// gaps filled from neighbours, then lightly blurred.
function backSurface(points, yarnR, cell) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const nx = Math.max(2, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(2, Math.ceil((maxY - minY) / cell) + 1);
  let z = new Float32Array(nx * ny).fill(NaN);
  for (const p of points) {
    const i = Math.round((p.x - minX) / cell), j = Math.round((p.y - minY) / cell);
    const k = j * nx + i;
    const v = p.z - yarnR;
    if (!(z[k] <= v)) z[k] = v;
  }
  for (let pass = 0; pass < 12; pass++) {                       // fill holes
    let missing = 0;
    const out = z.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!Number.isNaN(z[k])) continue;
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const v = z[jj * nx + ii];
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n) out[k] = s / n; else missing++;
    }
    z = out;
    if (!missing) break;
  }
  for (let pass = 0; pass < 2; pass++) {                        // smooth
    const out = z.slice();
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += z[(j + dj) * nx + i + di];
      out[j * nx + i] = Math.min(z[j * nx + i], s / 9);         // never in front of the yarn
    }
    z = out;
  }
  return { z, nx, ny, minX, minY, cell };
}

function surfaceGeometry(sf, uvScale) {
  const { z, nx, ny, minX, minY, cell } = sf;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const x = minX + i * cell, y = minY + j * cell;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = Number.isNaN(z[k]) ? 0 : z[k];
    uv[k * 2] = x * uvScale; uv[k * 2 + 1] = y * uvScale;
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * @param {object} p
 *   points     : THREE.Vector3[] — the fleecy yarn's (post-drape) path points
 *   anchors    : {x,y,z}[]       — float midpoints (nap roots)
 *   yarnRadius : fleecy yarn tube radius
 *   color      : THREE.Color     — the dyed colour
 *   napLength  : nap height in scene units
 *   fibreGeometry : unit curled fibre (hairiness.js) for the stray fibres
 * @returns {{ group: THREE.Group, dispose: () => void }}
 */
export function buildNap(p) {
  const group = new THREE.Group();
  const disposables = [];
  const tex = napTexture();
  disposables.push(tex);

  const sf = backSurface(p.points, p.yarnRadius, 0.22);
  const base = surfaceGeometry(sf, 0.55);                        // ~1.8 units per texture tile
  disposables.push(base);

  // Nap colour: brushing exposes fibre ends that scatter more light than
  // the twisted yarn — slightly lighter and fully matte.
  const napColor = p.color.clone().lerp(new THREE.Color(1, 1, 1), 0.12);
  const tinted = [];                       // [material, brightness] for setColor
  const SHELLS = p.shells || 16;
  const lean = p.napLength * 0.45;                               // laid in the brushing direction (down the wale)
  for (let s = 0; s < SHELLS; s++) {
    const f = (s + 1) / SHELLS;
    const shade = 0.5 + 0.5 * Math.pow(f, 0.6);
    // The root shell is solid: a real nap is a closed mat at its base, and
    // any texel discarded by every layer let light leak through as sparkles.
    const mat = new THREE.MeshStandardMaterial({
      color: napColor.clone().multiplyScalar(shade),
      roughness: 1.0,
      metalness: 0.0,
      alphaMap: s === 0 ? null : tex,
      alphaTest: s === 0 ? 0 : 0.06 + 0.82 * Math.pow(f, 1.1),
      side: THREE.DoubleSide,
    });
    disposables.push(mat);
    tinted.push([mat, shade]);
    const shell = new THREE.Mesh(base, mat);
    shell.position.set(0, -lean * f * f, -p.napLength * f);
    group.add(shell);
  }

  // Stray fibres on the floats for a tangled, non-planar silhouette.
  if (p.fibreGeometry && p.anchors.length) {
    // A thin cylinder is mostly side-lit, so at the nap's own colour it reads
    // darker than the mat around it (like dirt). Lift it toward the lit
    // fibre-tip tone instead.
    const perAnchor = 3;
    const count = Math.min(12000, p.anchors.length * perAnchor);
    const mat = new THREE.MeshStandardMaterial({ color: napColor.clone().lerp(new THREE.Color(1, 1, 1), 0.25), roughness: 0.95 });
    disposables.push(mat);
    tinted.push([mat, 1.12]);
    const mesh = new THREE.InstancedMesh(p.fibreGeometry, mat, count);
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = p.anchors[i % p.anchors.length];
      dir.set((hash2(i, 51) - 0.5) * 1.6, (hash2(i, 52) - 0.5) * 1.6 - 0.5, -0.7).normalize();
      dummy.position.set(
        a.x + (hash2(i, 53) - 0.5) * 0.7,
        a.y + (hash2(i, 54) - 0.5) * 0.7,
        a.z - p.yarnRadius * 0.6,
      );
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.scale.setScalar(p.napLength * (0.8 + hash2(i, 55) * 1.4));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  return {
    group,
    dispose: () => disposables.forEach((d) => d.dispose()),
    setColor: (c) => {
      const base = c.clone().lerp(new THREE.Color(1, 1, 1), 0.12);
      for (const [m, k] of tinted) m.color.copy(base).multiplyScalar(k);
    },
  };
}
