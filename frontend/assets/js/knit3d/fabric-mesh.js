// KnitAdvisor · knit3d — yarn paths → renderable tube meshes.
//
// Each course path becomes ONE smooth centripetal Catmull-Rom tube (continuous
// along the whole course), with a small rounded cap at each open selvedge end so
// no hollow tube mouths show. All tubes share one yarn material (cheap, and lets
// the wireframe / colour controls act globally).

import * as THREE from 'three';
import { hash2 } from './noise.js?v=20260608g';

// Staple/natural fibres get slub (thick-thin) + nep; smooth filament stays even.
const NATURAL = new Set(['cotton', 'linen', 'hemp', 'wool', 'viscose', 'modal', 'acrylic']);

// Thickness profile along a yarn (0..1): low-freq slubs + rare sharp neps.
function slubProfile(t, phase) {
  const s = Math.sin((t * 7.3 + phase) * Math.PI * 2) * 0.55
          + Math.sin((t * 13.1 + phase * 1.7) * Math.PI * 2) * 0.30;
  let v = s * 0.11;                                   // ±~11% slub
  const np = Math.sin((t * 41.0 + phase * 3.1) * Math.PI * 2);
  if (np > 0.95) v += 0.5 * (np - 0.95);             // occasional nep bump
  return v;
}

// Displace each tube ring outward by the slub profile (stable per path).
function applySlub(geo, curve, tubular, radial, phase) {
  const pos = geo.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    curve.getPointAt(i / tubular, c);
    const scale = 1 + slubProfile(i / tubular, phase);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const x = pos.getX(idx), y = pos.getY(idx), z = pos.getZ(idx);
      pos.setXYZ(idx, c.x + (x - c.x) * scale, c.y + (y - c.y) * scale, c.z + (z - c.z) * scale);
    }
  }
  // A uniform radial scale about the axis leaves the surface normals'
  // directions unchanged; recomputing them from faces instead would split
  // the tube's UV seam into a visible shading line.
  pos.needsUpdate = true;
}

// Real yarn in a fabric is not round: inter-yarn pressure flattens it,
// wider in the fabric plane, thinner through it (~1.2-1.4 : 1). Scale each
// ring about its own axis point; normals take the inverse scale, exactly.
function flattenCrossSection(geo, curve, tubular, radial, inPlane, through) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    curve.getPointAt(i / tubular, c);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      pos.setXYZ(idx,
        c.x + (pos.getX(idx) - c.x) * inPlane,
        c.y + (pos.getY(idx) - c.y) * inPlane,
        c.z + (pos.getZ(idx) - c.z) * through);
      const nx = nor.getX(idx) / inPlane, ny = nor.getY(idx) / inPlane, nz = nor.getZ(idx) / through;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.setXYZ(idx, nx / l, ny / l, nz / l);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

// Map u along each tube to ARC LENGTH in twist turns, so one texture tile is
// one real helix turn of yarn (see yarn-material.js `twistPitch`).
// `phase` shifts each yarn's texture start, so neighbouring courses don't
// line up the same fibres wale after wale (which reads as stripes).
function arcLengthUVs(geo, curveLength, pitch, phase) {
  const uv = geo.attributes.uv;
  const k = curveLength / Math.max(1e-3, pitch);
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k + phase);
  uv.needsUpdate = true;
}

/**
 * Yarn tube radius in SCENE units, from real yarn geometry tied to stitch pitch.
 *   tex = 590.5 / Ne ;  yarn dia (mm) = 0.907/√Ne  ==  0.03733·√tex  (cotton
 *     packing — canonical constant, matches advanced_fleece_fabrication_
 *     visualization.md §1.1: d(mm) = 0.907/√Ne. Verified against its own
 *     worked examples: Ne 30 → 0.166mm, Ne 70 → 0.108mm, Ne 16 → 0.227mm.)
 *   wale spacing (mm) = 10 / wales-per-cm
 *   radius = ½ · (dia / waleSpacing) · PITCH_X · coverGain   (overlap for cover)
 * So a fat yarn at fine gauge fully covers; a thin yarn at coarse gauge reads
 * open — i.e. loose vs dense fabrics actually look different. Falls back to a
 * count-only estimate (same canonical formula, render-space units) when
 * density is absent.
 *
 * The 0.907/√Ne constant is Ashenhurst's, derived for COTTON packing. A
 * fabric of any other fibre is scaled by `density.fibreDensityScale`
 * (√(1.52/blendDensity), from fabric-visualizer.js `_stitchDensity`) — the
 * same correction the backend applies in yarn-engine.js `yarnDiameterMm`. A
 * wool loop at the same count as cotton is a real 8% fatter yarn; without
 * this every fibre rendered as if it were cotton.
 */
export function yarnDiameterMm(ne) {
  return 0.907 / Math.sqrt(ne || 30);
}

export function yarnRadius(countNe, tf, density) {
  const ne = countNe || 30;
  const t = typeof tf === 'number' ? tf : 14;
  const tex = (density && density.tex) || (590.5 / ne);
  // 0.03733·√tex assumes cotton's packing density (1.52 g/cm3). Every other
  // fibre is a different bulk at the same tex — wool comes out 8% fatter,
  // nylon 15% — and the engine already computes that correction
  // (yarn-engine.js yarnDiameterMm, exposed as yarn.expertise.blend_physical
  // .density) for exactly this reason. `fibreDensityScale` carries it here so
  // a wool loop actually renders fatter than a cotton loop at the same count,
  // instead of every fabric being drawn as if it were cotton.
  const fibreScale = (density && density.fibreDensityScale) || 1;
  const diaMm = 0.03733 * Math.sqrt(tex) * fibreScale;   // physical yarn diameter — see doc §1.1 above
  const tfGain = 1 + (t - 14) * 0.012;             // tighter → fuller coverage
  let r;
  if (density && density.wpc > 0) {
    const waleSpacingMm = 10 / density.wpc;        // real wale pitch
    r = 0.5 * (diaMm / waleSpacingMm) * 1.0 /* PITCH_X */ * 1.30 * tfGain;
  } else {
    r = (0.165 + (30 - ne) * 0.0020) * fibreScale * tfGain;   // count-only fallback
  }
  return Math.max(0.10, Math.min(r, 0.30));
}

/**
 * @param {{points: THREE.Vector3[]}[]} paths
 * @param {THREE.Material} material
 * @param {object} opts { radius, radialSegments }
 * @returns {THREE.Group}
 */
// ── Contact occlusion from the real yarn layout ────────────────────────────
// A real knit is dark exactly where one yarn passes over or under another and
// bright where a loop is exposed. The old shading only looked at which way a
// surface faced (darkening anything facing away from +z), which neither
// knew where the crossings were nor worked on the flipped back view. Here
// every vertex looks for yarn axis samples sitting IN FRONT of its own normal
// within a few yarn radii: the closer and more head-on that yarn is, the less
// light reaches the vertex. Computed once at build time into vertex colours —
// no post-processing pass, same cost at render time as before.
// Dense uniform grid over all yarn-axis samples (counting-sort layout: one
// flat Float32Array, per-cell start offsets) — the occlusion pass touches
// ~200k vertices × a few dozen neighbours, so no Maps, strings or closures.
function buildAxisGrid(pts, cell) {
  const n = pts.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const nx = Math.floor((maxX - minX) / cell) + 1;
  const ny = Math.floor((maxY - minY) / cell) + 1;
  const nz = Math.floor((maxZ - minZ) / cell) + 1;
  const cellOf = (x, y, z) =>
    (Math.floor((z - minZ) / cell) * ny + Math.floor((y - minY) / cell)) * nx + Math.floor((x - minX) / cell);
  const starts = new Int32Array(nx * ny * nz + 1);
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) { ids[i] = cellOf(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); starts[ids[i] + 1]++; }
  for (let c = 0; c < nx * ny * nz; c++) starts[c + 1] += starts[c];
  const cursor = starts.slice(0, nx * ny * nz);
  const sorted = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = cursor[ids[i]]++ * 3;
    sorted[o] = pts[i * 3]; sorted[o + 1] = pts[i * 3 + 1]; sorted[o + 2] = pts[i * 3 + 2];
  }
  return { minX, minY, minZ, nx, ny, nz, cell, starts, sorted };
}

function contactOcclusionColours(geo, g, radius, reach, loopSeed, shade = 1) {
  const P = geo.attributes.position.array;
  const N = geo.attributes.normal.array;
  const count = geo.attributes.position.count;
  const variation = 1 + (hash2(loopSeed, 7) - 0.5) * 0.10;   // ±5% per course
  const col = new Float32Array(count * 3);
  const expo = new Float32Array(count);   // how exposed a point is to wear (dye-shader.js fade)
  const { minX, minY, minZ, nx, ny, nz, cell, starts, sorted } = g;
  const invReach = 1 / reach;
  for (let v = 0; v < count; v++) {
    const o = v * 3;
    const px = P[o], py = P[o + 1], pz = P[o + 2];
    const qx = N[o], qy = N[o + 1], qz = N[o + 2];
    const cx = Math.floor((px - minX) / cell), cy = Math.floor((py - minY) / cell), cz = Math.floor((pz - minZ) / cell);
    let occ = 0;
    for (let k = cz - 1; k <= cz + 1; k++) {
      if (k < 0 || k >= nz) continue;
      for (let j = cy - 1; j <= cy + 1; j++) {
        if (j < 0 || j >= ny) continue;
        const row = (k * ny + j) * nx;
        const i0 = Math.max(0, cx - 1), i1 = Math.min(nx - 1, cx + 1);
        const s0 = starts[row + i0] * 3, s1 = starts[row + i1 + 1] * 3;
        for (let s = s0; s < s1; s += 3) {
          const dx = sorted[s] - px, dy = sorted[s + 1] - py, dz = sorted[s + 2] - pz;
          const dot = dx * qx + dy * qy + dz * qz;        // >0: that yarn is in front
          if (dot <= 0) continue;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const facing = dot / d;
          if (facing <= 0.05) continue;
          const fall = 1 - Math.max(0, d - radius) * invReach;
          if (fall <= 0) continue;
          occ += facing * fall * fall;
        }
      }
    }
    const ao = 1 - Math.min(0.78, occ * 0.24);
    const kk = ao * variation * shade;     // shade: a yarn that reads lighter (a soft loop yarn)
    col[o] = kk; col[o + 1] = kk; col[o + 2] = kk;
    // Abrasion and washing reach the outermost yarn first, on either face:
    // unoccluded AND facing out of the fabric plane.
    expo[v] = (1 - Math.min(1, occ * 0.31)) * Math.sqrt(Math.abs(qz));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aExposure', new THREE.BufferAttribute(expo, 1));
}

export function buildFabricMesh(paths, material, opts = {}) {
  const radius = opts.radius != null ? opts.radius : 0.18;
  const radial = opts.radialSegments || 7;
  const shadows = !!opts.shadows;
  const pitch = opts.twistPitch || radius * 15;
  // slub/nep only for natural fibres, and only on the capable (shadow) tier
  const slub = shadows && NATURAL.has(opts.fiberType || 'cotton');
  const group = new THREE.Group();
  const cap = new THREE.SphereGeometry(radius * 0.96, 8, 6);
  // Caps take the same vertex-colour path as the yarn (white = no change), or
  // vertexColors would read them as black.
  cap.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap.attributes.position.count * 3).fill(0.8), 3));
  // The shared material multiplies its colour by these vertex colours.
  material.vertexColors = true;
  material.needsUpdate = true;

  const reach = radius * 2.6;
  const axis = [];
  const built = [];
  let pi = 0;
  for (const path of paths) {
    if (!path.points || path.points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(path.points, false, 'centripetal', 0.5);
    const length = curve.getLength();
    // ~3 tubular segments per control-point span → smooth yet light.
    const tubular = Math.min(Math.max(48, path.points.length * 3), 4000);
    // A path can carry its own yarn (e.g. fleece's much thicker fleecy yarn).
    const r = radius * (path.radiusScale || 1);
    const geo = new THREE.TubeGeometry(curve, tubular, r, radial, false);
    flattenCrossSection(geo, curve, tubular, radial, 1.10, 0.84);
    if (slub) applySlub(geo, curve, tubular, radial, hash2(pi, 1));
    const phase = opts.uvPhase ? opts.uvPhase(path, pi) : hash2(pi, 13) * 17;
    arcLengthUVs(geo, length, pitch * (r / radius), phase);   // same twist angle on a thicker yarn
    geo.computeTangents();   // anisotropic specular runs along the yarn
    const samples = Math.max(8, Math.ceil(length / (radius * 0.8)));
    for (const p of curve.getSpacedPoints(samples)) axis.push(p.x, p.y, p.z);
    built.push({ geo, path, seed: pi, r });
    group.userData.totalLength = (group.userData.totalLength || 0) + length;
    pi++;
  }
  group.userData.tubes = built.map(b => b.geo);
  const grid = buildAxisGrid(axis, radius + reach);

  for (const { geo, path, seed, r } of built) {
    contactOcclusionColours(geo, grid, r, reach, seed, path.shade || 1);
    const mesh = new THREE.Mesh(geo, material);
    if (shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);

    // round off the two open ends (selvedge) so no hollow mouth is visible
    const a = path.points[0], b = path.points[path.points.length - 1];
    const ca = new THREE.Mesh(cap, material); ca.position.copy(a);
    const cb = new THREE.Mesh(cap, material); cb.position.copy(b);
    ca.scale.setScalar(r / radius); cb.scale.setScalar(r / radius);
    if (shadows) { ca.castShadow = cb.castShadow = true; }
    group.add(ca); group.add(cb);
  }
  return group;
}
