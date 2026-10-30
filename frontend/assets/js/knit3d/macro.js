// KnitAdvisor · knit3d — macro view: the whole cloth, at real size.
//
// The loop model (knit-renderer.js _buildFabric) is ~1-2 cm of fabric. Seen
// from 20 cm - 1 m — how a fabric is actually looked at — individual loops
// are near or below a pixel and the cloth reads through its surface texture,
// colour, sheen and folds. So the default view is a full piece of cloth, and
// its surface texture is not painted: it is BAKED from the same yarn-level
// model, one structure repeat rendered straight down into a tileable normal
// map and occlusion map, then laid on the cloth at the real stitch size.
// Zooming in hands over to the loop model itself at the same spot (the
// renderer switches by camera distance), where those loops become geometry.

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

// ── Bake ──────────────────────────────────────────────────────────────────
function bakeTarget(w, h, aniso) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    samples: 4,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  t.texture.anisotropy = aniso;
  return t;
}

/**
 * Render one structure repeat of `object` (yarn tubes in its own local
 * frame, no transform) from the front and from the back into tileable maps.
 *   normal : tangent-space normal map (view-space normals of an unrotated
 *            orthographic camera ARE the tangent frame of a flat sheet)
 *   ao     : the tubes' contact-occlusion vertex colours, unlit; gaps
 *            between yarns come out dark, as they do on a real knit
 * The back pass looks along +z, so its image is already in the frame of a
 * sheet whose u runs along -x (see clothGeometry's back mesh).
 */
export function bakeStructure(renderer, object, win, pxPerUnit) {
  const W = Math.max(64, Math.min(2048, Math.round(win.w * pxPerUnit)));
  const H = Math.max(64, Math.min(2048, Math.round(win.h * pxPerUnit)));
  const scene = new THREE.Scene();
  scene.add(object);
  const cx = win.x0 + win.w / 2, cy = win.y0 + win.h / 2;
  const cam = new THREE.OrthographicCamera(-win.w / 2, win.w / 2, win.h / 2, -win.h / 2, 0.1, 100);
  const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const aoMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const flat = new THREE.Color(0.5, 0.5, 1.0);
  const gap = new THREE.Color(0.1, 0.1, 0.1);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const targets = [];
  const pass = (fromBack, mat, clear) => {
    const t = bakeTarget(W, H, aniso);
    targets.push(t);
    cam.position.set(cx, cy, fromBack ? -50 : 50);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, cy, 0);
    cam.updateMatrixWorld();
    scene.overrideMaterial = mat;
    renderer.setRenderTarget(t);
    renderer.setClearColor(clear, 1);
    renderer.clear();
    renderer.render(scene, cam);
    return t.texture;
  };
  const out = {
    front: { normal: pass(false, normalMat, flat), ao: pass(false, aoMat, gap) },
    back: { normal: pass(true, normalMat, flat), ao: pass(true, aoMat, gap) },
    targets,
  };
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  scene.remove(object);
  normalMat.dispose();
  aoMat.dispose();
  return out;
}

// ── Cloth ─────────────────────────────────────────────────────────────────
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A piece of cloth lying on a table, one corner turned back over itself so
 * the technical back shows on the flap (a page-curl round a cylinder of
 * radius r — the fold's softness). Gentle undulations everywhere except a
 * flat zone round the origin, where the zoom hands over to the loop model.
 * UVs are fixed on the flat rest shape, so the texture follows the fold.
 *
 * Returns two geometries over the same surface: `front` faces +z at rest
 * (face texture), `back` has reversed winding and mirrored u (back texture).
 */
export function clothGeometry(p) {
  const nxs = Math.max(8, Math.round((p.maxX - p.minX) / p.seg));
  const nys = Math.max(8, Math.round((p.maxY - p.minY) / p.seg));
  const count = (nxs + 1) * (nys + 1);
  const pos = new Float32Array(count * 3);
  const uvF = new Float32Array(count * 2);
  const uvB = new Float32Array(count * 2);
  const { n, d0, r, t } = p.fold;
  const L = Math.PI * r;
  const w = p.wave;
  // Undulation of the sheet lying on the table, flat round the origin and
  // flat right at the fold line.
  const sheetZ = (x, y) => {
    const s = x * n.x + y * n.y - d0;
    const mask = smooth(w.flatR, w.rampR, Math.hypot(x, y)) * smooth(0, 4 * r, -s);
    return w.amp * mask * (
      0.6 * Math.sin((x * 0.55 + y * 0.83) * (2 * Math.PI / w.len) + w.phase) +
      0.4 * Math.sin((x * -0.71 + y * 0.70) * (2 * Math.PI / (w.len * 0.62)) + w.phase * 1.7));
  };
  for (let j = 0; j <= nys; j++) {
    for (let i = 0; i <= nxs; i++) {
      const k = j * (nxs + 1) + i;
      const x = p.minX + (p.maxX - p.minX) * (i / nxs);
      const y = p.minY + (p.maxY - p.minY) * (j / nys);
      const u = (x + p.uOff) / p.tileW, v = (y + p.vOff) / p.tileH;
      uvF[k * 2] = u; uvF[k * 2 + 1] = v;
      uvB[k * 2] = -u; uvB[k * 2 + 1] = v;
      const s = x * n.x + y * n.y - d0;
      let X = x, Y = y, Z;
      if (s <= 0) {
        Z = sheetZ(x, y);
      } else {
        const bx = x - n.x * s, by = y - n.y * s;
        if (s < L) {
          const th = s / r;
          X = bx + n.x * r * Math.sin(th);
          Y = by + n.y * r * Math.sin(th);
          Z = r * (1 - Math.cos(th));
        } else {
          // Past the crest the flap settles down onto the cloth beneath it,
          // one fabric thickness above whatever shape that cloth has —
          // a soft fold, not a page held up in the air.
          const e = s - L;
          X = bx - n.x * e;
          Y = by - n.y * e;
          const rest = sheetZ(X, Y) + t * 1.04;     // mid-surfaces one thickness apart
          Z = rest + (2 * r - rest) * (1 - smooth(0, 5 * r, e));
        }
      }
      pos[k * 3] = X; pos[k * 3 + 1] = Y; pos[k * 3 + 2] = Z;
    }
  }
  const idxF = [], idxB = [];
  for (let j = 0; j < nys; j++) {
    for (let i = 0; i < nxs; i++) {
      const a = j * (nxs + 1) + i, b = a + 1, c = a + nxs + 1, d = c + 1;
      idxF.push(a, b, c, b, d, c);
      idxB.push(a, c, b, b, c, d);
    }
  }

  // The cloth has a real thickness t: the face surface sits t/2 out along the
  // mid-surface normal, the back surface t/2 in, and a strip closes the cut
  // edges. So a thick fleece folds round a fat, rounded crest and shows a
  // visible edge, while a thin jersey folds into a sharp, thin one.
  const mid = new THREE.BufferGeometry();
  mid.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  mid.setIndex(idxF);
  mid.computeVertexNormals();
  const nrm = mid.attributes.normal.array;
  const posF = new Float32Array(count * 3), posB = new Float32Array(count * 3);
  for (let k = 0; k < count * 3; k++) {
    posF[k] = pos[k] + nrm[k] * t * 0.5;
    posB[k] = pos[k] - nrm[k] * t * 0.5;
  }
  mid.dispose();
  const make = (p3, uv, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p3, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Edge strip round the perimeter (face edge → back edge).
  const ring = [];
  for (let i = 0; i <= nxs; i++) ring.push(i);
  for (let j = 1; j <= nys; j++) ring.push(j * (nxs + 1) + nxs);
  for (let i = nxs - 1; i >= 0; i--) ring.push(nys * (nxs + 1) + i);
  for (let j = nys - 1; j >= 1; j--) ring.push(j * (nxs + 1));
  const ep = new Float32Array(ring.length * 2 * 3);
  const euv = new Float32Array(ring.length * 2 * 2);
  ring.forEach((v, i) => {
    for (let a = 0; a < 3; a++) {
      ep[(i * 2) * 3 + a] = posF[v * 3 + a];
      ep[(i * 2 + 1) * 3 + a] = posB[v * 3 + a];
    }
    euv[i * 4] = i; euv[i * 4 + 1] = 0; euv[i * 4 + 2] = i; euv[i * 4 + 3] = 1;
  });
  const eidx = [];
  for (let i = 0; i < ring.length; i++) {
    const a = i * 2, b = ((i + 1) % ring.length) * 2;
    eidx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  edge.setAttribute('uv', new THREE.BufferAttribute(euv, 2));
  edge.setIndex(eidx);
  edge.computeVertexNormals();

  return { front: make(posF, uvF, idxF), back: make(posB, uvB, idxB), edge };
}

// ── Surface fibre textures (finished backs) ─────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * Tileable normal map for a surface whose structure is hidden under fibre:
 *   'nap'   — a brushed/raised surface: a felt of short, curved, torn fibres
 *   'loops' — an uncut loop pile (french-terry back): small yarn loops
 */
export function fibreSurfaceTexture(kind, aniso) {
  const size = 256;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  const R = rng(kind === 'nap' ? 9173 : 3307);
  const wrap = (fn) => { for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy); };
  if (kind === 'nap') {
    // Raised fibre doesn't stand evenly: it curls and clumps into soft
    // pebbles a couple of millimetres across (the tile is ~1.6 cm), which is
    // what gives a brushed back its mottled, velvety look from a distance.
    for (let k = 0; k < 150; k++) {
      const x0 = R() * size, y0 = R() * size, rad = 7 + R() * 9;
      wrap((ox, oy) => {
        const g = ctx.createRadialGradient(x0 + ox, y0 + oy, 0, x0 + ox, y0 + oy, rad);
        g.addColorStop(0, 'rgba(215,215,215,0.75)');
        g.addColorStop(1, 'rgba(128,128,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x0 + ox, y0 + oy, rad, 0, Math.PI * 2); ctx.fill();
      });
    }
    for (let k = 0; k < 2600; k++) {
      const x0 = R() * size, y0 = R() * size, a = R() * Math.PI * 2;
      const len = 5 + R() * 16, bend = (R() - 0.5) * 12;
      const x2 = x0 + Math.cos(a) * len, y2 = y0 + Math.sin(a) * len;
      const qx = (x0 + x2) / 2 - Math.sin(a) * bend, qy = (y0 + y2) / 2 + Math.cos(a) * bend;
      const v = 70 + (R() * 150 | 0);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      ctx.lineWidth = 1 + R() * 1.8;
      wrap((ox, oy) => { ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.quadraticCurveTo(qx + ox, qy + oy, x2 + ox, y2 + oy); ctx.stroke(); });
    }
  } else {
    // Uncut loops ~1-2 mm across on a dark ground (the tile is ~2.4 cm), in
    // loose rows — they come from the loop yarn's floats, course by course.
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0, size, size);
    const rows = 16;
    for (let r = 0; r < rows; r++) {
      const cy = (r + 0.5) * size / rows;
      for (let k = 0; k < 22; k++) {
        const x0 = (k + R() * 0.8) * size / 22, y0 = cy + (R() - 0.5) * 6;
        const rx = 6 + R() * 4, ry = rx * (0.55 + R() * 0.35), rot = (R() - 0.5) * 0.9;
        ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = 5.5;
        wrap((ox, oy) => { ctx.beginPath(); ctx.ellipse(x0 + ox, y0 + oy, rx, ry, rot, 0, Math.PI * 2); ctx.stroke(); });
        const v = 190 + (R() * 50 | 0);
        ctx.strokeStyle = `rgb(${v},${v},${v})`; ctx.lineWidth = 3.4;
        wrap((ox, oy) => { ctx.beginPath(); ctx.ellipse(x0 + ox, y0 + oy, rx, ry, rot, 0, Math.PI * 2); ctx.stroke(); });
      }
    }
  }
  // The same height field doubles as a shade map: gaps between fibres or
  // loops are where light does not reach.
  const shade = document.createElement('canvas'); shade.width = shade.height = size;
  shade.getContext('2d').drawImage(c, 0, 0);
  const src = ctx.getImageData(0, 0, size, size).data;
  const Hf = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  const out = document.createElement('canvas'); out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const strength = kind === 'nap' ? 2.0 : 3.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (Hf(x - 1, y) - Hf(x + 1, y)) * strength;
      const dy = (Hf(x, y - 1) - Hf(x, y + 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const normal = new THREE.CanvasTexture(out);
  normal.colorSpace = THREE.NoColorSpace;
  const shadeTex = new THREE.CanvasTexture(shade);
  shadeTex.colorSpace = THREE.NoColorSpace;   // a linear multiplier, not a colour
  for (const t of [normal, shadeTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
  }
  return { normal, shade: shadeTex };
}

// Deterministic phase for the cloth's undulation, so a fabric always lies
// the same way.
export function wavePhase(seed) { return hash2(seed, 11) * Math.PI * 2; }
