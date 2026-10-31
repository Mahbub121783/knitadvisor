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
// Exposure (fabric-mesh.js aExposure) as a grey value — where wear shows.
const exposureMaterial = () => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  vertexShader: 'attribute float aExposure; varying float vE; void main(){ vE = aExposure; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying float vE; void main(){ gl_FragColor = vec4(vE, vE, vE, 1.0); }',
});

// Melange: the per-fibre random field (yarn-material.js melangeField) read
// through each yarn's own UVs and thresholded — 1 where a fibre is light.
// Thresholding here (not in the cloth shader) lets the baked map's mipmaps
// average to the true light fraction at a distance.
export const melangeMaterial = (field) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uField: { value: field }, uF: { value: 0.5 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D uField; uniform float uF; varying vec2 vUv; void main(){ float l = texture2D(uField, vUv).r < uF ? 1.0 : 0.0; gl_FragColor = vec4(l, l, l, 1.0); }',
});

/**
 * Bakes the passes of one structure repeat (see bakeStructure) and returns a
 * `rebake(name, material, clear)` that re-renders one pass into the same
 * textures — used when the melange fraction changes with the shade.
 */
export function bakeStructure(renderer, object, win, pxPerUnit, opts = {}) {
  const W = Math.max(64, Math.min(2048, Math.round(win.w * pxPerUnit)));
  const H = Math.max(64, Math.min(2048, Math.round(win.h * pxPerUnit)));
  const scene = new THREE.Scene();
  scene.add(object);
  const cx = win.x0 + win.w / 2, cy = win.y0 + win.h / 2;
  const cam = new THREE.OrthographicCamera(-win.w / 2, win.w / 2, win.h / 2, -win.h / 2, 0.1, 100);
  const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const aoMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const expMat = exposureMaterial();
  const flat = new THREE.Color(0.5, 0.5, 1.0);
  const gap = new THREE.Color(0.1, 0.1, 0.1);
  const black = new THREE.Color(0, 0, 0);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const targets = [];
  const byName = {};
  const render = (t, fromBack, mat, clear) => {
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    cam.position.set(cx, cy, fromBack ? -50 : 50);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, cy, 0);
    cam.updateMatrixWorld();
    scene.overrideMaterial = mat;
    renderer.setRenderTarget(t);
    renderer.setClearColor(clear, 1);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
  };
  const pass = (name, fromBack, mat, clear) => {
    const t = bakeTarget(W, H, aniso);
    targets.push(t);
    (byName[name] = byName[name] || {})[fromBack ? 'back' : 'front'] = t;
    render(t, fromBack, mat, clear);
    return t.texture;
  };
  const out = { front: {}, back: {}, targets };
  for (const side of ['front', 'back']) {
    const b = side === 'back';
    out[side].normal = pass('normal', b, normalMat, flat);
    out[side].ao = pass('ao', b, aoMat, gap);
    out[side].exp = pass('exp', b, expMat, black);
    if (opts.melMaterial) out[side].mel = pass('mel', b, opts.melMaterial, black);
  }
  normalMat.dispose();
  aoMat.dispose();
  expMat.dispose();

  if (opts.keep) {
    out.rebake = (name, mat, clear = black) => {
      const t = byName[name];
      if (!t) return;
      render(t.front, false, mat, clear);
      render(t.back, true, mat, clear);
    };
    out.release = () => { scene.remove(object); };
  } else {
    scene.remove(object);
  }
  return out;
}

// ── Cloth ─────────────────────────────────────────────────────────────────
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Catmull-Rom weights for a fractional position t in [0,1).
function crWeights(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/**
 * A piece of cloth lying on a table (mid-surface on z = 0), one corner turned
 * back over itself so the back shows on the flap — a page curl round a
 * cylinder of radius r (the fold's softness), the flap settling one fabric
 * thickness above the cloth beneath. Ripples rise from the table except in a
 * flat zone round the origin, where the zoom hands over to the loop model.
 *
 * Two sources for its shape:
 *   - authored (the pose above): the default, costs nothing per frame
 *   - a simulation grid (cloth-physics.js), interpolated up to the render
 *     resolution with Catmull-Rom splines, so folds stay round between
 *     particles
 * UVs are fixed on the flat layout, so the texture follows every fold and
 * stretch. The front surface faces +z at rest (face texture); the back has
 * reversed winding and mirrored u (back texture); the edge strip closes the
 * cut edge.
 */
export class ClothSurface {
  constructor(p) {
    this.p = p;
    // Simulation grid: spacing p.simH, covering the sheet exactly; the
    // render grid subdivides each sim cell k times.
    const W = p.maxX - p.minX, H = p.maxY - p.minY;
    this.snx = Math.max(8, Math.round(W / p.simH) + 1);
    this.sh = W / (this.snx - 1);
    this.sny = Math.max(8, Math.round(H / this.sh) + 1);
    this.k = Math.max(2, Math.min(5, Math.round(this.sh / p.seg)));
    this.rnx = (this.snx - 1) * this.k + 1;
    this.rny = (this.sny - 1) * this.k + 1;
    const rc = this.rnx * this.rny;
    this.mid = new Float32Array(rc * 3);
    this.nrm = new Float32Array(rc * 3);
    this.rest = new Float32Array(rc * 2);          // flat layout of each render vertex

    const uvF = new Float32Array(rc * 2), uvB = new Float32Array(rc * 2);
    const Hs = (this.sny - 1) * this.sh;
    for (let j = 0; j < this.rny; j++) {
      for (let i = 0; i < this.rnx; i++) {
        const k = j * this.rnx + i;
        const x = p.minX + W * (i / (this.rnx - 1)), y = p.minY + Hs * (j / (this.rny - 1));
        this.rest[k * 2] = x; this.rest[k * 2 + 1] = y;
        const u = (x + p.uOff) / p.tileW, v = (y + p.vOff) / p.tileH;
        uvF[k * 2] = u; uvF[k * 2 + 1] = v; uvB[k * 2] = -u; uvB[k * 2 + 1] = v;
      }
    }
    const idxF = [], idxB = [];
    for (let j = 0; j < this.rny - 1; j++) {
      for (let i = 0; i < this.rnx - 1; i++) {
        const a = j * this.rnx + i, b = a + 1, c = a + this.rnx, d = c + 1;
        idxF.push(a, b, c, b, d, c);
        idxB.push(a, c, b, b, c, d);
      }
    }
    const mk = (uv, idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rc * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rc * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    };
    this.front = mk(uvF, idxF);
    this.back = mk(uvB, idxB);

    // Edge strip round the perimeter (face edge to back edge).
    const ring = [];
    for (let i = 0; i < this.rnx; i++) ring.push(i);
    for (let j = 1; j < this.rny; j++) ring.push(j * this.rnx + this.rnx - 1);
    for (let i = this.rnx - 2; i >= 0; i--) ring.push((this.rny - 1) * this.rnx + i);
    for (let j = this.rny - 2; j >= 1; j--) ring.push(j * this.rnx);
    this.ring = ring;
    const euv = new Float32Array(ring.length * 4);
    ring.forEach((v, i) => { euv[i * 4] = i; euv[i * 4 + 2] = i; euv[i * 4 + 3] = 1; });
    const eidx = [];
    for (let i = 0; i < ring.length; i++) {
      const a = i * 2, b = ((i + 1) % ring.length) * 2;
      eidx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    this.edge = new THREE.BufferGeometry();
    this.edge.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ring.length * 6), 3));
    this.edge.setAttribute('uv', new THREE.BufferAttribute(euv, 2));
    this.edge.setIndex(eidx);

    // Separable interpolation scratch: sim rows to render columns.
    this._rowTmp = new Float32Array(this.sny * this.rnx * 3);
    this._wts = [];
    for (let s = 0; s < this.k; s++) this._wts.push(crWeights(s / this.k));

    this.setAuthored();
  }

  /** The authored pose: mid-surface point for a flat-layout (x, y). */
  poseAt(x, y) {
    const { n, d0, r, t } = this.p.fold;
    const w = this.p.wave;
    const L = Math.PI * r;
    const sheetZ = (sx, sy) => {
      const s = sx * n.x + sy * n.y - d0;
      const mask = smooth(w.flatR, w.rampR, Math.hypot(sx, sy)) * smooth(0, 4 * r, -s);
      // ripples RISE from the table; the cloth rests on it everywhere else
      return w.amp * mask * 0.5 * (1 +
        0.6 * Math.sin((sx * 0.55 + sy * 0.83) * (2 * Math.PI / w.len) + w.phase) +
        0.4 * Math.sin((sx * -0.71 + sy * 0.70) * (2 * Math.PI / (w.len * 0.62)) + w.phase * 1.7));
    };
    const s = x * n.x + y * n.y - d0;
    if (s <= 0) return [x, y, sheetZ(x, y)];
    const bx = x - n.x * s, by = y - n.y * s;
    if (s < L) {
      const th = s / r;
      return [bx + n.x * r * Math.sin(th), by + n.y * r * Math.sin(th), r * (1 - Math.cos(th))];
    }
    // Past the crest the flap settles onto the cloth beneath it, mid-surfaces
    // one thickness apart: a soft fold, not a page held up in the air.
    const e = s - L;
    const X = bx - n.x * e, Y = by - n.y * e;
    const restZ = sheetZ(X, Y) + t * 1.04;
    return [X, Y, restZ + (2 * r - restZ) * (1 - smooth(0, 5 * r, e))];
  }

  /** Flat layout and authored pose sampled on the simulation grid. */
  simGrids() {
    const n = this.snx * this.sny;
    const flat = new Float32Array(n * 3), init = new Float32Array(n * 3);
    for (let j = 0; j < this.sny; j++) {
      for (let i = 0; i < this.snx; i++) {
        const k = j * this.snx + i;
        const x = this.p.minX + i * this.sh, y = this.p.minY + j * this.sh;
        flat[k * 3] = x; flat[k * 3 + 1] = y;
        const q = this.poseAt(x, y);
        init[k * 3] = q[0]; init[k * 3 + 1] = q[1]; init[k * 3 + 2] = q[2];
      }
    }
    return { flat, init };
  }

  setAuthored() {
    for (let k = 0; k < this.rnx * this.rny; k++) {
      const q = this.poseAt(this.rest[k * 2], this.rest[k * 2 + 1]);
      this.mid[k * 3] = q[0]; this.mid[k * 3 + 1] = q[1]; this.mid[k * 3 + 2] = q[2];
    }
    this._write();
  }

  /** Render surface from simulation positions (snx x sny x 3). */
  setFromSim(xs) {
    const { snx, sny, rnx, rny, k } = this;
    const row = this._rowTmp, mid = this.mid, wts = this._wts;
    const at = (n, i) => Math.max(0, Math.min(n - 1, i));
    const last = [0, 0, 1, 0];
    // along x, per sim row
    for (let j = 0; j < sny; j++) {
      for (let i = 0; i < rnx; i++) {
        const c = Math.min(snx - 2, Math.floor(i / k)), s = i - c * k;
        const wv = s >= k ? last : wts[s];
        const o = (j * rnx + i) * 3;
        let ax = 0, ay = 0, az = 0;
        for (let m = 0; m < 4; m++) {
          const src = (j * snx + at(snx, c - 1 + m)) * 3, wm = wv[m];
          ax += xs[src] * wm; ay += xs[src + 1] * wm; az += xs[src + 2] * wm;
        }
        row[o] = ax; row[o + 1] = ay; row[o + 2] = az;
      }
    }
    // along y
    for (let j = 0; j < rny; j++) {
      const c = Math.min(sny - 2, Math.floor(j / k)), s = j - c * k;
      const wv = s >= k ? last : wts[s];
      for (let i = 0; i < rnx; i++) {
        const o = (j * rnx + i) * 3;
        let ax = 0, ay = 0, az = 0;
        for (let m = 0; m < 4; m++) {
          const src = (at(sny, c - 1 + m) * rnx + i) * 3, wm = wv[m];
          ax += row[src] * wm; ay += row[src + 1] * wm; az += row[src + 2] * wm;
        }
        mid[o] = ax; mid[o + 1] = ay; mid[o + 2] = az;
      }
    }
    this._write();
  }

  // Normals by central differences on the render grid; face and back
  // surfaces one half-thickness either side of the mid-surface.
  _write() {
    const { rnx, rny, mid, nrm } = this;
    const t = this.p.fold.t;
    const fp = this.front.attributes.position.array, fn = this.front.attributes.normal.array;
    const bp = this.back.attributes.position.array, bn = this.back.attributes.normal.array;
    for (let j = 0; j < rny; j++) {
      for (let i = 0; i < rnx; i++) {
        const o = (j * rnx + i) * 3;
        const ia = (j * rnx + Math.max(0, i - 1)) * 3, ib = (j * rnx + Math.min(rnx - 1, i + 1)) * 3;
        const ja = (Math.max(0, j - 1) * rnx + i) * 3, jb = (Math.min(rny - 1, j + 1) * rnx + i) * 3;
        const ux = mid[ib] - mid[ia], uy = mid[ib + 1] - mid[ia + 1], uz = mid[ib + 2] - mid[ia + 2];
        const vx = mid[jb] - mid[ja], vy = mid[jb + 1] - mid[ja + 1], vz = mid[jb + 2] - mid[ja + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
        fp[o] = mid[o] + nx * t * 0.5; fp[o + 1] = mid[o + 1] + ny * t * 0.5; fp[o + 2] = mid[o + 2] + nz * t * 0.5;
        bp[o] = mid[o] - nx * t * 0.5; bp[o + 1] = mid[o + 1] - ny * t * 0.5; bp[o + 2] = mid[o + 2] - nz * t * 0.5;
        fn[o] = nx; fn[o + 1] = ny; fn[o + 2] = nz;
        bn[o] = -nx; bn[o + 1] = -ny; bn[o + 2] = -nz;
      }
    }
    const ep = this.edge.attributes.position.array;
    const ring = this.ring;
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i] * 3;
      for (let a = 0; a < 3; a++) { ep[i * 6 + a] = fp[v + a]; ep[i * 6 + 3 + a] = bp[v + a]; }
    }
    for (const g of [this.front, this.back]) {
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    }
    this.edge.attributes.position.needsUpdate = true;
    this.edge.computeVertexNormals();
  }

  dispose() { this.front.dispose(); this.back.dispose(); this.edge.dispose(); }
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
