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
// Raised cotton/polyester fibre is fine (15-25 µm) and curly, 0.3-1.5 mm of it
// standing free: drawn at 1024 px over a 4-wale tile a fibre is 1-2 px wide
// and 40-220 px long, curved like a torn-out staple, not a straight scratch.
// Most fibres lie roughly along the raising direction (the wire rollers comb
// them), a share lie anywhere — the matted look.
function napTexture(size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  const R = rng(4242);
  const N = 15000;
  for (let k = 0; k < N; k++) {
    const x0 = R() * size, y0 = R() * size;
    const combed = R() < 0.55;
    const a = combed ? (Math.PI / 2 + (R() - 0.5) * 1.1) : R() * Math.PI * 2;
    const len = 40 + Math.pow(R(), 1.6) * 180;
    const curl = (R() - 0.5) * len * 0.9;
    const pts = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bend = Math.sin(t * Math.PI * (1 + R() * 0.6)) * curl * 0.5;
      pts.push([x0 + Math.cos(a) * len * t - Math.sin(a) * bend, y0 + Math.sin(a) * len * t + Math.cos(a) * bend]);
    }
    const v = Math.round(255 * (0.25 + 0.75 * R()));
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 0.9 + R() * 1.3;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const minX = Math.min(...pts.map(p => p[0])) + ox, maxX = Math.max(...pts.map(p => p[0])) + ox;
      const minY = Math.min(...pts.map(p => p[1])) + oy, maxY = Math.max(...pts.map(p => p[1])) + oy;
      if (maxX < 0 || minX > size || maxY < 0 || minY > size) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0] + ox, pts[i][1] + oy, mx + ox, my + oy);
      }
      ctx.lineTo(pts[pts.length - 1][0] + ox, pts[pts.length - 1][1] + oy);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
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
  const base = surfaceGeometry(sf, 0.25);                        // 4 units (≈4 wales) per texture tile
  disposables.push(base);

  // Nap colour: brushing exposes fibre ends that scatter more light than
  // the twisted yarn — slightly lighter and fully matte.
  const napColor = p.color.clone().lerp(new THREE.Color(1, 1, 1), 0.12);
  const tinted = [];                       // [material, brightness] for setColor
  const SHELLS = p.shells || 24;
  // laid slightly in the brushing direction (down the wale); capped so a tall
  // pile stands up rather than being combed into long streaks
  const lean = Math.min(p.napLength * 0.45, p.yarnRadius * 1.4);
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
      // MSAA-smoothed cut-outs: a hard alpha test at close range broke the
      // shells into stepped, fern-like slices
      alphaToCoverage: s !== 0,
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
      // A stray is one fibre: its size does not grow with pile height (a
      // taller nap is more fibre, not fatter fibre) — the shells carry height.
      dummy.scale.setScalar(Math.min(p.napLength, p.yarnRadius * 3.2) * (0.8 + hash2(i, 55) * 1.4));
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
