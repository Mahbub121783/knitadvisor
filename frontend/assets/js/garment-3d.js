// KnitAdvisor · Garment studio — the garment, made from its own pattern pieces.
//
// The front, the back and the sleeve are the FINISHED outlines the pattern engine drew (garment-pattern.js), and each is wrapped round the body or the arm
// the way the cloth would go: a row of the front piece, 2w wide, becomes the front half of an ellipse whose half-perimeter is 2w, so the tube is exactly as
// big round as the chart says (chest 52 flat = 104 round). A sleeve piece is rolled into a tube whose circumference is its own width, its cap on the
// shoulder, its apex at the top of the arm. The knit texture is laid in the pattern's own centimetres, wales along the length: a garment cut with the grain
// the pattern says. It is the garment's FORM from the measurements, not a cloth simulation: it shows the fit, not the drape.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the intervals of a polygon along the row y (even-odd), [x0, x1] pairs
function spans(poly, y) {
  const xs = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  }
  xs.sort((a, b) => a - b);
  const out = []; for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}
function inside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
const halfWidth = (poly, y) => { const s = spans(poly, y); return s.length ? Math.max(...s.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) : 0; };

// a unit ellipse (semi-axes 1 and d), half of it: the cumulative arc length, to turn a length along the cloth into an angle
function arcTable(d, n = 160) {
  const th = [], len = [0];
  for (let i = 0; i <= n; i++) th.push((i / n) * Math.PI);
  for (let i = 1; i <= n; i++) { const a = th[i - 1], b = th[i]; len.push(len[i - 1] + Math.hypot(Math.cos(b) - Math.cos(a), d * (Math.sin(b) - Math.sin(a)))); }
  return { th, len, total: len[n] };
}
function angleAt(tab, f) {                                                   // f in 0..1 of the half arc -> theta
  const L = f * tab.total; let lo = 0, hi = tab.len.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab.len[m] < L) lo = m; else hi = m; }
  const t = (L - tab.len[lo]) / Math.max(1e-9, tab.len[hi] - tab.len[lo]);
  return tab.th[lo] + t * (tab.th[hi] - tab.th[lo]);
}

// the knit of a cloth as a tile of 1 cm: wales across, courses up and down
function knitTexture(wpc, cpc) {
  const W = Math.max(4, Math.round(wpc || 12)), C = Math.max(4, Math.round(cpc || 16));
  const px = 256, cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d'), cw = px / W, ch = px / C;
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, px, px);
  for (let r = -1; r <= C; r++) for (let c = 0; c < W; c++) {
    const x = c * cw, y = r * ch;
    for (const side of [-1, 1]) {                                            // the two legs of a V
      const grad = g.createLinearGradient(x + cw / 2, y, x + cw / 2 + side * cw / 2, y + ch);
      grad.addColorStop(0, '#e6e6e6'); grad.addColorStop(0.55, '#ffffff'); grad.addColorStop(1, '#a4a4a4');
      g.strokeStyle = grad; g.lineWidth = cw * 0.46; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + cw / 2 - side * cw * 0.02, y + ch * 0.02); g.lineTo(x + cw / 2 + side * cw * 0.34, y + ch * 1.0); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class GarmentView {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this._studio();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bfc9, 0.55));
    const key = new THREE.DirectionalLight(0xfff6ea, 1.35); key.position.set(-60, 120, 140); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xe6eeff, 0.35); fill.position.set(120, 40, -90); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(0, 60, -160); this.scene.add(rim);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.spin = false; this.colour = '#3d5a80'; this.mats = [];
    this._raf = 0; this._last = 0;
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(host);
    this.controls.addEventListener('start', () => { this.spin = false; if (this.onSpin) this.onSpin(false); });
    this.resize();
    this._loop = (t) => { this._raf = requestAnimationFrame(this._loop); const dt = Math.min(0.05, (t - this._last) / 1000 || 0); this._last = t; if (this.spin) this.group.rotation.y += dt * 0.6; this._simTick(); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    this._raf = requestAnimationFrame(this._loop);
  }

  // a photographer's studio, made in code: a grey-to-white sky and three soft boxes, turned into the reflections and the soft light on the cloth
  _studio() {
    try {
      const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y * 0.5 + 0.5; gl_FragColor = vec4(mix(vec3(0.42, 0.43, 0.46), vec3(0.95, 0.96, 1.0), h), 1.0); }' })));
      const box = (x, y, z, w, h, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
      box(-22, 26, 26, 24, 18, 5); box(28, 10, 16, 10, 24, 2.5); box(0, 38, -22, 34, 8, 3.5);
      this.scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose();
    } catch (e) { /* no environment: the lights alone */ }
  }

  // the thread of the seams, and the invisible fat line a click lands on
  _mkThread() {
    this._threadMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).offsetHSL(0, 0, 0.16), roughness: 0.85, metalness: 0 });
    this._seamHiMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 0.6, roughness: 0.5 });
    this._pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this.mats.push(this._threadMat, this._seamHiMat, this._pickMat);
  }
  _seam(id, pts, r, closed) {
    if (!pts || pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, !!closed, 'centripetal', 0.5), n = Math.max(24, pts.length * 4);
    const vis = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r, 5, !!closed), this._threadMat); vis.userData.seamVis = id; vis.userData.seamBase = this._threadMat;
    const pick = new THREE.Mesh(new THREE.TubeGeometry(curve, n, Math.max(r * 4, 0.55), 5, !!closed), this._pickMat); pick.userData.seam = id;
    this.group.add(vis, pick);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setColour(hex) { this.colour = hex; if (this._threadMat) this._threadMat.color.set(hex).offsetHSL(0, 0, 0.16); if (this.mats[0]) this.mats[0].color.set(hex); if (this.mats[1]) this.mats[1].color.set(hex).multiplyScalar(0.86); }
  setSpin(on) { this.spin = !!on; }

  clear() {
    this._cloth = null; this._simBusy = false; this._simGroup = null; this._docOverride = null; this._hemRing = null; this._cuffParam = null; this._mannequin = null;
    if (this._hiMats) this._hiMats.clear();
    while (this.group.children.length) { const o = this.group.children[0]; this.group.remove(o); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); }
    this.mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); this.mats = [];
  }

  // size: one entry of result.by_size; fabric: result.fabric
  setGarment(size, fabric) {
    this._gsm = fabric && +fabric.gsm || 0;
    this.clear(); this._mkThread();
    const m = size.m, d = size.derived, P = {}; size.pieces.forEach((p) => { P[p.id] = p; });
    const L = m.length, step = 0.6;
    const tex = knitTexture(fabric.wpc, fabric.cpc);
    const mat = new THREE.MeshStandardMaterial({ color: this.colour, map: tex, bumpMap: tex, bumpScale: 0.9, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).multiplyScalar(0.86), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.mats = [mat, rib];

    // the body: depth/width ratio grows from flat shoulders to a round chest
    const dRatio = (y) => 0.2 + 0.4 * smooth(0, 11, y);                 // the shoulders have a depth of their own: a body is not a flat sheet there
    const tabs = new Map(); const tab = (d0) => { const k = Math.round(d0 * 200); if (!tabs.has(k)) tabs.set(k, arcTable(k / 200)); return tabs.get(k); };
    // the tube's own width: the armhole bows in and steps out at the underarm, but a body does not: from the shoulder to the underarm it widens smoothly
    const cw2 = m.chest / 2, sw2 = m.shoulder / 2, yu = d.underarm_y || (m.slope + m.armhole);
    const tubeW = (piece) => (yp) => { const w = halfWidth(piece, yp); return yp <= m.slope || yp >= yu ? w : Math.max(w * 0.98, sw2 + (cw2 - sw2) * smooth(m.slope, yu, yp)); };
    const at = (piece, front) => (xp, yp) => {                                // a point of the pattern -> the point on the body
      const w = Math.max(halfWidth(piece, yp), 0.5), Wt = Math.max(tubeW(piece)(yp), w), dr = dRatio(yp), tb = tab(dr);
      const a = (2 * Wt) / tb.total, th = angleAt(tb, (xp + w) / (2 * w));
      const x = -a * Math.cos(th), z = a * dr * Math.sin(th);
      const wob = 0.2 * Math.sin(0.33 * xp + 1.6 * Math.sin(0.1 * yp)) * Math.sin(0.17 * yp + 0.6) * smooth(2, 14, yp) * smooth(L, L - 8, yp);   // the cloth is never perfectly flat
      return new THREE.Vector3(front ? x : -x, L - yp, front ? z + wob : -(z + wob));
    };
    const panel = (piece, front) => {
      const map = at(piece, front), pos = [], uv = [], idx = [];
      const rows = []; const nCol = Math.max(8, Math.round((2 * Math.max(...piece.map((p) => Math.abs(p[0])))) / step));
      const ymax = L; const nRow = Math.round(ymax / step);
      for (let j = 0; j <= nRow; j++) {
        const y = (j / nRow) * ymax, w = halfWidth(piece, Math.min(y + 1e-3, ymax)) || halfWidth(piece, y + 0.2), row = [];
        for (let k = 0; k <= nCol; k++) { const x = -w + (2 * w * k) / nCol; row.push(pos.length / 3); const v = map(x, y); pos.push(v.x, v.y, v.z); uv.push(x, y); }
        rows.push({ y, w, row });
      }
      for (let j = 0; j < nRow; j++) for (let k = 0; k < nCol; k++) {
        const A = rows[j], B = rows[j + 1];
        const xc = (A.w * (-1 + (2 * (k + 0.5)) / nCol) + B.w * (-1 + (2 * (k + 0.5)) / nCol)) / 2, yc = (A.y + B.y) / 2;
        if (!inside(piece, xc, yc)) continue;
        const a = A.row[k], b = A.row[k + 1], c = B.row[k], e = B.row[k + 1];
        idx.push(a, c, b, b, c, e);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const fin = (id) => (size.shape && size.shape[id]) || (P[id] && P[id].finished);       // the whole front, even when a zipper cuts it in two
    const front = fin('front'), back = fin('back');
    const tagged = (mesh, piece, material) => { mesh.userData.piece = piece; mesh.userData.base = material; return mesh; };
    this.group.add(tagged(new THREE.Mesh(panel(front, true), mat), 'front', mat), tagged(new THREE.Mesh(panel(back, false), mat), 'back', mat));

    // the sleeve, rolled into a tube along the arm, its cap on the shoulder
    const sl = fin('sleeve'), SL = m.sleeve_l, slope = m.slope;
    const wTop = halfWidth(front, slope + 0.2), gam = 28 * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(gam), -Math.cos(gam), 0), nrm = new THREE.Vector3(Math.cos(gam), Math.sin(gam), 0), zz = new THREE.Vector3(0, 0, 1);
    const tb0 = tab(dRatio(slope)), aTop = (2 * wTop) / tb0.total;
    const shoulder = new THREE.Vector3(aTop, L - slope, 0);                    // the shoulder point, on the right
    const sleeveGeo = (() => {
      const pos = [], uv = [], idx = [], nRow = Math.round(SL / step), nCol = Math.max(16, Math.round((2 * m.bicep) / step)), rows = [];
      for (let j = 0; j <= nRow; j++) {
        const y = (j / nRow) * SL, w = Math.max(halfWidth(sl, Math.max(y, 0.05)), 0.02), r = w / Math.PI, row = [];
        const top = shoulder.clone().addScaledVector(dir, y), C = top.clone().addScaledVector(nrm, -r);
        for (let k = 0; k <= nCol; k++) { const x = -w + (2 * w * k) / nCol, phi = x / r, v = C.clone().addScaledVector(nrm, r * Math.cos(phi)).addScaledVector(zz, r * Math.sin(phi)); row.push(pos.length / 3); pos.push(v.x, v.y, v.z); uv.push(x, y); }
        rows.push({ y, w, row });
      }
      for (let j = 0; j < nRow; j++) for (let k = 0; k < nCol; k++) { const A = rows[j], B = rows[j + 1]; idx.push(A.row[k], B.row[k], A.row[k + 1], A.row[k + 1], B.row[k], B.row[k + 1]); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    })();
    const right = new THREE.Mesh(sleeveGeo, mat), left = new THREE.Mesh(sleeveGeo.clone(), mat); left.scale.x = -1;
    this.group.add(tagged(right, 'sleeve', mat), tagged(left, 'sleeve', mat));

    // the neck band: a tube along the neck seam, front then back (the curve is the engine's: a Bézier level at the centre)
    const nw2 = m.neck_w / 2, mapF = at(front, true), mapB = at(back, false);
    const neckPts = (map, drop) => {
      const out = [];
      for (let i = 0; i <= 30; i++) { const t = i / 30, u = 1 - t, x = 3 * u * u * t * (nw2 * 0.55) + 3 * u * t * t * (nw2 * 0.93) + t * t * t * nw2, y = u * u * u * drop + 3 * u * u * t * drop + 3 * u * t * t * drop * 0.36; out.push([x, y]); }
      const right = out.map(([x, y]) => map(x, y)), leftSide = out.slice().reverse().map(([x, y]) => map(-x, y));   // centre -> right neck point; left neck point -> centre
      return leftSide.concat(right.slice(1));
    };
    const fN = neckPts(mapF, m.neck_df), bN = neckPts(mapB, m.neck_db).reverse();
    const curve = new THREE.CatmullRomCurve3(fN.concat(bN), true, 'centripetal', 0.5);
    const rr = Math.max(0.5, (m.rib_w || 2) * 0.32);
    this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(curve, 200, rr, 10, true), rib), 'band', rib));

    // the hems: a line of stitching round the body and round each sleeve
    const ring = (pts, r, material, seamId) => { if (seamId) this._seam(seamId, pts, r, true); else this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5), 160, r, 6, true), material)); };
    {
      const yh = L - m.hem_h, wF = halfWidth(front, yh), wB = halfWidth(back, yh), pts = [];
      for (let i = 0; i <= 36; i++) pts.push(mapF(-wF + (2 * wF * i) / 36, yh));
      for (let i = 35; i >= 1; i--) pts.push(mapB(-wB + (2 * wB * i) / 36, yh));
      ring(pts, 0.16, rib, 'hem');
      if (size.pieces.some((q) => q.id === 'hemband') && m.hemband_h > 0) {                    // a rib band round the hem, drawn in to its relaxed width
        const ratio = Math.min(1, m.hemband_w / Math.max(1, m.hem)), R = 8, n = pts.length, y0 = pts[0].y, pos = [], idx = []; this._hemRing = { pts: pts.slice(), ratio, y0 };
        for (let j = 0; j <= R; j++) { const t = j / R, sc = 1 + (ratio - 1) * smooth(0, 0.3, t); pts.forEach((v) => pos.push(v.x * sc, y0 - t * m.hemband_h, v.z * sc)); }
        for (let j = 0; j < R; j++) for (let k = 0; k < n; k++) { const a = j * n + k, b = j * n + ((k + 1) % n), c = a + n, d = b + n; idx.push(a, c, b, b, c, d); }
        const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals();
        this.group.add(tagged(new THREE.Mesh(hg, rib), 'hemband', rib));
      }
      const ys = SL - m.sleeve_hem_h, w = Math.max(halfWidth(sl, ys), 0.1), r = w / Math.PI, top = shoulder.clone().addScaledVector(dir, ys), C = top.clone().addScaledVector(nrm, -r), sp = [];
      for (let i = 0; i < 36; i++) { const phi = -Math.PI + (i / 36) * TAU; sp.push(C.clone().addScaledVector(nrm, r * Math.cos(phi)).addScaledVector(zz, r * Math.sin(phi))); }
      ring(sp, 0.16, rib, 'sleeve_hem');
      const sp2 = sp.map((v) => new THREE.Vector3(-v.x, v.y, v.z)); ring(sp2, 0.16, rib, 'sleeve_hem');
    }
    // the rib cuffs, when the garment has them: a ring at the end of each sleeve, drawn in from the sleeve opening to its relaxed width
    if (size.pieces.some((q) => q.id === 'cuff') && m.cuff_h > 0) {
      const r0 = Math.max(halfWidth(sl, SL - 0.05), 0.1) / Math.PI, rc = Math.min(r0, m.cuff_w / Math.PI), rowsN = 8, nC = 28, pos = [], idx = []; this._cuffParam = { r0, rc };
      for (let j = 0; j <= rowsN; j++) { const t = j / rowsN, yy = SL + t * m.cuff_h, r = r0 + (rc - r0) * smooth(0, 0.35, t), tp = shoulder.clone().addScaledVector(dir, yy), C = tp.clone().addScaledVector(nrm, -r);
        for (let k = 0; k <= nC; k++) { const phi = (k / nC) * TAU, v = C.clone().addScaledVector(nrm, r * Math.cos(phi)).addScaledVector(zz, r * Math.sin(phi)); pos.push(v.x, v.y, v.z); } }
      for (let j = 0; j < rowsN; j++) for (let k = 0; k < nC; k++) { const a = j * (nC + 1) + k, b = a + 1, c = a + nC + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx); cg.computeVertexNormals();
      const cr = new THREE.Mesh(cg, rib), cl = new THREE.Mesh(cg.clone(), rib); cl.scale.x = -1; this.group.add(tagged(cr, 'cuff', rib), tagged(cl, 'cuff', rib));
    }
    // the seams of the body and the sleeves, as thread: shoulder, side, armhole, underarm
    {
      const lp = (id) => size.pieces.find((q) => q.id === id), fids = lp('front') ? ['front'] : ['front_r', 'front_l'];
      const runsOf = (ids, labels) => {
        const out = [];
        ids.forEach((pid) => { const q = lp(pid); if (!q) return; let cur = [];
          q.finished.forEach((pt, i) => { if (labels.includes(q.finished_labels[i])) cur.push(pt); else if (cur.length) { cur.push(pt); out.push(cur); cur = []; } });
          if (cur.length) { cur.push(q.finished[0]); out.push(cur); } });
        return out;
      };
      const mid = (r) => r.reduce((a, q) => a + q[0], 0) / r.length;
      runsOf(fids, ['shoulder']).forEach((r) => this._seam('shoulder', r.map(([x, y]) => mapF(x, y)), 0.13, false));
      runsOf(fids, ['side', 'sidehem']).forEach((r) => this._seam('side', r.filter(([, y]) => y <= L - 0.3).map(([x, y]) => mapF(x, y)), 0.13, false));        // down to the hem edge: the folded strip below it has no width on the body
      const up2 = (r) => (r[0][1] > r[r.length - 1][1] ? r.slice().reverse() : r), aF = runsOf(fids, ['armhole']).map(up2), aB = runsOf(['back'], ['armhole']).map(up2);       // each run from the shoulder tip down to the underarm
      aF.forEach((rf) => { const rb = aB.find((q) => Math.sign(mid(q)) === -Math.sign(mid(rf))); if (!rb) return; this._seam('armhole', rf.map(([x, y]) => mapF(x, y)).concat(rb.slice().reverse().map(([x, y]) => mapB(x, y)).slice(1)), 0.14, false); });
      const ch = d.cap_height || 10, up = [];
      for (let y = ch; y <= SL - m.sleeve_hem_h; y += Math.max(0.6, (SL - ch) / 14)) { const w = Math.max(halfWidth(sl, y), 0.1), r = w / Math.PI, tp = shoulder.clone().addScaledVector(dir, y); up.push(tp.clone().addScaledVector(nrm, -2 * r)); }
      if (up.length > 2) { this._seam('underarm', up, 0.13, false); this._seam('underarm', up.map((v) => new THREE.Vector3(-v.x, v.y, v.z)), 0.13, false); }
    }

    // where each piece's flat points sit on the form: the cloth simulation starts from here (the seams are where the pieces start together)
    {
      const sp = (id) => size.pieces.find((q) => q.id === id), vec = (v) => [v.x, v.y, v.z], inst = [];
      const add = (pid, id, map, rest, mat, extra) => { const q = sp(pid); if (q) inst.push(Object.assign({ id, pid, poly: q.finished, labels: q.finished_labels, map, rest: rest || 'flat', mat: mat || 'main' }, extra || {})); };
      // below the hem edge the folded strip has no width of its own on the form: it hangs straight down from the hem
      const below = (map) => (x, y) => { const v = map(x, Math.min(y, L - 0.05)); v.y = L - y; return vec(v); };
      ['front', 'front_r', 'front_l'].forEach((pid) => add(pid, pid, below(mapF)));
      add('back', 'back', below(mapB));
      const sleeveMap = (sg) => (x, y) => { const w = Math.max(halfWidth(sl, Math.min(Math.max(y, 0.05), SL - 0.05)), 0.02), r = w / Math.PI, tp = shoulder.clone().addScaledVector(dir, y), C = tp.clone().addScaledVector(nrm, -r), ph = x / r, v = C.addScaledVector(nrm, r * Math.cos(ph)).addScaledVector(zz, r * Math.sin(ph)); return [sg * v.x, v.y, v.z]; };
      add('sleeve', 'sleeveR', sleeveMap(1)); add('sleeve', 'sleeveL', sleeveMap(-1));
      const bp = sp('band'); if (bp) { const len = Math.max(1, bp.finished_w); add('band', 'band', (x, y) => { const P = curve.getPointAt(Math.min(0.9999, Math.max(0, x / len))); return [P.x, P.y + y * 0.5 + 0.2, P.z + (P.z >= 0 ? 0.3 : -0.3)]; }, 'init', 'rib'); }
      if (this._cuffParam && sp('cuff')) { const cp = this._cuffParam, cm = (sg) => (x, y) => { const t = Math.min(1, Math.max(0, y / (2 * m.cuff_h))), yy = SL + t * m.cuff_h, r = cp.r0 + (cp.rc - cp.r0) * smooth(0, 0.35, t), tp = shoulder.clone().addScaledVector(dir, yy), C = tp.clone().addScaledVector(nrm, -r), phi = (x / (2 * m.cuff_w)) * TAU, v = C.addScaledVector(nrm, r * Math.cos(phi)).addScaledVector(zz, r * Math.sin(phi)); return [sg * v.x, v.y, v.z]; }; add('cuff', 'cuffR', cm(1), 'init', 'rib'); add('cuff', 'cuffL', cm(-1), 'init', 'rib'); }
      if (this._hemRing && sp('hemband')) { const hr = this._hemRing, n = hr.pts.length; add('hemband', 'hemband', (x, y) => { const u = (((x / (2 * m.hemband_w)) % 1) + 1) % 1, f = u * n, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f), a = hr.pts[i], b = hr.pts[j], tt = Math.min(1, Math.max(0, y / (2 * m.hemband_h))), sc = 1 + (hr.ratio - 1) * smooth(0, 0.3, tt); return [(a.x + (b.x - a.x) * t) * sc, hr.y0 - tt * m.hemband_h, (a.z + (b.z - a.z) * t) * sc]; }, 'init', 'rib'); }
      this._sim = { kind: 'tee', size, fabric, mat, rib, inst, hide: ['front', 'back', 'sleeve', 'band', 'cuff', 'hemband'] };
    }

    // a zipper down the centre front, from the neck seam, with its slider
    if (size.zipper && size.zipper.on) {
      const z = size.zipper, pts = [], y0 = m.neck_df + 0.3, y1 = m.neck_df + z.opening_cm;
      for (let i = 0; i <= 28; i++) { const v = mapF(0, y0 + ((y1 - y0) * i) / 28); v.z += 0.22; pts.push(v); }
      const zip = new THREE.MeshStandardMaterial({ color: z.teeth === 'metal' ? 0xb8bcc4 : 0x2b2f36, metalness: z.teeth === 'metal' ? 0.85 : 0.1, roughness: z.teeth === 'metal' ? 0.35 : 0.6 });
      this.mats.push(zip);
      this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, Math.max(0.3, z.tape_w * 0.14), 6, false), zip), 'zipper', zip));
      const slider = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.7), new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.25 }));
      slider.position.copy(pts[1]).add(new THREE.Vector3(0, -0.6, 0.35)); this.group.add(slider); this.mats.push(slider.material);
    }

    // a soft floor shadow
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const fg = fc.getContext('2d'); const gr = fg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); fg.fillStyle = gr; fg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.3, L * 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1; this.group.add(shadow);
    this.mats.push(shadow.material);

    // sit it upright, fit the view
    this.centre = new THREE.Vector3(0, L * 0.5, 0);
    this._L = L; this._wNeed = (m.chest + 2 * m.sleeve_l * 0.95) * 1.0; const dist = this._fit();
    if (!this._placed || Math.abs(L - this._placedL) / this._placedL > 0.35) {                // the first build, or a very different garment: frame it; an edit keeps the view
      this.group.rotation.y = 0; this.camera.position.set(0, L * 0.55, dist); this.controls.target.copy(this.centre); this._placed = true; this._placedL = L;
    }
    this.controls.minDistance = L * 0.4; this.controls.maxDistance = L * 6; this.controls.update();
    this._applyHi(); if (this.simMode) this.startSim();
    this.info = { sleeve_axis_deg: 28, form: 'from the finished pattern pieces' };
  }

  // shorts: two legs, each a tube whose rings are as long round as the front leg piece plus the back leg piece are wide at that height; a waistband ring; a drawcord
  setShorts(size, fabric) {
    this._gsm = fabric && +fabric.gsm || 0;
    this.clear(); this._mkThread();
    const m = size.m, fr = size.shape.front, bk = size.shape.back, F = m.waistband_h, Ll = m.outseam - F, top = m.outseam;
    const tex = knitTexture(fabric.wpc, fabric.cpc);
    const mat = new THREE.MeshStandardMaterial({ color: this.colour, map: tex, bumpMap: tex, bumpScale: 0.9, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).multiplyScalar(0.86), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).multiplyScalar(0.55), roughness: 0.9 });
    this.mats = [mat, rib, dark];
    const tagged = (mesh, piece, material) => { mesh.userData.piece = piece; mesh.userData.base = material; return mesh; };
    const widthAt = (poly, y) => { const sp = spans(poly, y); if (!sp.length) return 0; let lo = Infinity, hi = -Infinity; sp.forEach(([a, b]) => { if (a < lo) lo = a; if (b > hi) hi = b; }); return hi - lo; };
    const K = 0.8, ell = (P) => P / (Math.PI * (3 * (1 + K) - Math.sqrt((3 + K) * (1 + 3 * K))));        // the long semi-axis of an ellipse of perimeter P, short axis K times it
    const step = 0.5, nRow = Math.max(8, Math.round(Ll / step)), nCol = 48, rows = [];
    for (let j = 0; j <= nRow; j++) {
      const y = Math.min(Ll - 0.01, (j / nRow) * Ll) + 0.01, wf = Math.max(1, widthAt(fr, y)), wb = Math.max(1, widthAt(bk, y)), a = ell(wf + wb);
      rows.push({ y, wf, wb, a, b: K * a });
    }
    const gap = 0.5, a0 = rows[0].a, cx = (r) => r.a + gap;
    const legMesh = (sign, front) => {
      const pos = [], uv = [], idx = [];
      rows.forEach((r) => {
        for (let k = 0; k <= nCol; k++) {
          const t = front ? (Math.PI * k) / nCol : Math.PI + (Math.PI * k) / nCol, x = sign * (cx(r) + r.a * Math.cos(t)), z = r.b * Math.sin(t);
          pos.push(x, top - F - r.y, z); uv.push((front ? 1 : -1) * ((t % Math.PI) / Math.PI) * (front ? r.wf : r.wb) * (sign), r.y);
        }
      });
      for (let j = 0; j < nRow; j++) for (let k = 0; k < nCol; k++) { const A = j * (nCol + 1) + k, B = A + 1, C = A + nCol + 1, D = C + 1; idx.push(A, C, B, B, C, D); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return tagged(new THREE.Mesh(g, mat), front ? 'front' : 'back', mat);
    };
    [1, -1].forEach((sg) => { this.group.add(legMesh(sg, true), legMesh(sg, false)); });
    // the hem of each leg: a ring of stitching
    const last = rows[rows.length - 1];
    [1, -1].forEach((sg) => {
      const pts = []; for (let k = 0; k < 40; k++) { const t = (k / 40) * Math.PI * 2; pts.push(new THREE.Vector3(sg * (cx(last) + last.a * Math.cos(t)), top - F - Ll + m.hem_h * 0.9, last.b * Math.sin(t))); }
      this._seam('hem', pts, 0.16, true);
    });
    // the seams of the legs: the side, the inseam, and the rise, which is the same line (the inner edge of the tube) above the crotch
    [1, -1].forEach((sg) => {
      const side = [], inseam = [], rise = [], yc = size.derived.crotch_y;
      rows.forEach((r) => { side.push(new THREE.Vector3(sg * (cx(r) + r.a), top - F - r.y, 0)); const inner = new THREE.Vector3(sg * (cx(r) - r.a), top - F - r.y, 0); (r.y <= yc ? rise : inseam).push(inner); });
      this._seam('side', side, 0.14, false); this._seam('rise', rise, 0.14, false); this._seam('inseam', inseam, 0.14, false);
    });
    // the waistband: a ring round both legs
    const A = cx(rows[0]) + a0 + 0.25, B = rows[0].b + 0.3, bandPos = [], bandUv = [], bandIdx = [], nB = 72;
    for (let j = 0; j <= 1; j++) for (let k = 0; k <= nB; k++) { const t = (k / nB) * Math.PI * 2; bandPos.push(A * Math.cos(t), top - F + j * F, B * Math.sin(t)); bandUv.push((k / nB) * 2 * m.waist, j * F); }
    for (let k = 0; k < nB; k++) { const a = k, b = k + 1, c = k + nB + 1, d = c + 1; bandIdx.push(a, c, b, b, c, d); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bandPos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(bandUv, 2)); bg.setIndex(bandIdx); bg.computeVertexNormals();
    this.group.add(tagged(new THREE.Mesh(bg, rib), 'waistband', rib));
    for (const yy of [top, top - F]) { const pts = []; for (let k = 0; k < 72; k++) { const t = (k / 72) * Math.PI * 2; pts.push(new THREE.Vector3(A * Math.cos(t), yy, B * Math.sin(t))); } if (yy === top - F) this._seam('waistband', pts, 0.15, true); else this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 140, 0.12, 5, true), dark)); }
    // the drawcord: two ends hanging from the eyelets at the front
    const vis = m.drawcord_len || 10, ex = (m.eyelet_dist || 4) / 2 + 0.3, cord = new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.8 });
    this.mats.push(cord);
    [-1, 1].forEach((sg) => {
      const x0 = sg * ex, pts = [new THREE.Vector3(x0, top - F * 0.5, B), new THREE.Vector3(x0 * 1.1, top - F * 0.5 - vis * 0.35, B + 0.5), new THREE.Vector3(x0 * 1.5, top - F * 0.5 - vis * 0.7, B + 0.3), new THREE.Vector3(x0 * 1.8, top - F * 0.5 - vis, B)];
      this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.22, 6, false), cord), 'waistband', cord));
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), cord); knot.position.copy(pts[3]); this.group.add(tagged(knot, 'waistband', cord));
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.1, 6, 12), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.35 })); eye.position.set(x0, top - F * 0.5, B + 0.02); this.group.add(tagged(eye, 'waistband', cord));
    });
    // the slanted front pockets, and the back pockets, drawn as stitching on the cloth
    const onLeg = (sg, front, xp, yp) => { const r = rows[Math.max(0, Math.min(nRow, Math.round(yp / (Ll / nRow))))], w = front ? r.wf : r.wb, t = front ? Math.PI * Math.min(1, xp / w) : TAU - Math.PI * Math.min(1, xp / w); /* the side seam (x 0) is the outer edge of the leg, front and back */ return new THREE.Vector3(sg * (cx(r) + r.a * Math.cos(t)), top - F - yp, r.b * Math.sin(t) * 1.012); };
    if (m.fpocket_l > 0 && m.fpocket_w > 0) [1, -1].forEach((sg) => { const pts = []; for (let i = 0; i <= 10; i++) { const f = i / 10; pts.push(onLeg(sg, true, m.fpocket_w * (1 - f), Math.max(0.05, m.fpocket_l * f))); } this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.12, 5, false), dark), 'front', mat)); });
    if (m.bpocket_w > 0 && m.bpocket_l > 0) [1, -1].forEach((sg) => {
      const x0 = rows[0].wb * 0.5 - m.bpocket_w / 2, x1 = x0 + m.bpocket_w, y0 = m.bpocket_pos, y1 = y0 + m.bpocket_l, loop = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([xp, yp]) => onLeg(sg, false, xp, yp));
      this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true, 'catmullrom', 0.02), 60, 0.1, 5, true), dark), 'back', dark));
    });
    {
      const vec = (v) => [v.x, v.y, v.z], inst = [], sp = (id) => size.pieces.find((q) => q.id === id);
      [['front', true], ['back', false]].forEach(([pid, front]) => { const q = sp(pid); if (!q) return; [1, -1].forEach((sg) => inst.push({ id: pid + (sg > 0 ? 'R' : 'L'), grp: sg > 0 ? 'R' : 'L', pid, poly: q.finished, labels: q.finished_labels, rest: 'flat', mat: 'main', map: (x, y) => vec(onLeg(sg, front, x, y)), pinLabel: 'waist' })); });
      // the start of the drape: each piece laid round the mannequin made from the same measures — above the crotch round the pelvis (a quarter of its ring, side to centre), below it round its own leg (half of the leg's ring, side to inseam), blended through the crotch
      const KS = window.KASim, geo = KS ? KS.bodyLegs(size, {}).geo : null;
      if (geo) {
        const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }, cl = (v, a, b) => Math.max(a, Math.min(b, v));
        const place = (sg, front, poly) => {
          const ys = poly.map((p) => p[1]), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), x0 = Math.min.apply(null, poly.map((p) => p[0])), zs = front ? 1 : -1;
          return (x, y) => {
            const sp = spans(poly, cl(y, y0 + 0.01, y1 - 0.01)); let hi = -Infinity; sp.forEach(([a, b]) => { if (b > hi) hi = b; }); const lo = x0; if (!(hi > lo)) hi = lo + 1;
            const u = cl((x - lo) / (hi - lo), 0, 1), Y = geo.top - geo.F - y, ab = KS.lerpKeys(geo.keys, Y), A = ab[0] + 0.7, Bz = ab[1] + 0.7, th = u * Math.PI / 2;
            const tl = cl((geo.yc + 6 - Y) / (geo.yc + 6), 0, 1), r = geo.rt + (geo.ra - geo.rt) * tl + 0.7, c = sg * geo.cxl * (1 - 0.04 * tl), an = Math.PI * u, w = sm((Y - (geo.yc - 2)) / 8);
            return [(sg * A * Math.cos(th)) * w + (c + sg * r * Math.cos(an)) * (1 - w), Y, (zs * Bz * Math.sin(th)) * w + (zs * r * Math.sin(an)) * (1 - w)];
          };
        };
        inst.forEach((it) => { const q = sp(it.pid); it.map = place(it.grp === 'R' ? 1 : -1, it.pid === 'front', q.finished); });
        const wb = sp('waistband');
        if (wb) { const len = Math.max(1, wb.finished_w || 2 * m.waist), Yb = top - F * 0.5, ab = KS.lerpKeys(geo.keys, Yb); inst.push({ id: 'band', grp: 'B', pid: 'waistband', poly: wb.finished, labels: wb.finished_labels, rest: 'init', mat: 'rib', map: (x, y) => { const s = (x / len) * Math.PI * 2 + Math.PI / 2; return [(ab[0] + 0.9) * Math.cos(s), top - y * 0.5, (ab[1] + 0.9) * Math.sin(s)]; } }); }
      }
      this._sim = { kind: 'legs', size, fabric, mat, rib, inst, hide: ['front', 'back', 'waistband'] };
    }
    this._shadowAndFrame(top, 2 * (cx(rows[0]) + a0) * 1.15 + 6);
  }
  // the floor shadow, then the camera for a garment of this height and width
  _shadowAndFrame(L, wNeed) {
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const fg = fc.getContext('2d'); const gr = fg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); fg.fillStyle = gr; fg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.3, L * 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1; this.group.add(shadow); this.mats.push(shadow.material);
    this.centre = new THREE.Vector3(0, L * 0.5, 0); this._L = L; this._wNeed = wNeed; const dist = this._fit();
    if (!this._placed || Math.abs(L - this._placedL) / this._placedL > 0.35) { this.group.rotation.y = 0; this.camera.position.set(0, L * 0.55, dist); this.controls.target.copy(this.centre); this._placed = true; this._placedL = L; }
    this.controls.minDistance = L * 0.4; this.controls.maxDistance = L * 6; this.controls.update(); this._applyHi(); if (this.simMode) this.startSim();
  }

  // ── cloth simulation: the garment draped on a mannequin of its own measures ──
  setDrape(name) { this._drape = window.KASim && window.KASim.DRAPE[name] ? name : 'medium'; this._drapeSet = true; if (this.simMode) this.startSim(); }
  stopSim() {
    this.simMode = false; this._simBusy = false;
    if (this._simGroup) { this.group.remove(this._simGroup); this._simGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this._simGroup = null; }
    this._cloth = null; this.group.traverse((o) => { if (o.userData && (o.userData.piece || o.userData.seam || o.userData.seamVis)) o.visible = true; });
    if (this.onSim) this.onSim({ state: 'off' });
  }
  // the garment of the form on screen, as a document (made once per drafted size, then kept)
  doc() {
    const K = window.KASim, D = window.KADoc; if (this._docOverride) return this._docOverride;
    const S = this._sim; if (!S || !K || !D) return null;
    if (!S.doc) S.doc = D.fromRaw(S, { K, seamOf: (window.KAGarment && window.KAGarment.seamOf) || null });
    return S.doc;
  }
  // a document from outside (a file, the pattern editor): shown as cloth on its own body, with nothing else drawn
  showDoc(doc) {
    const bad = window.KADoc ? window.KADoc.validate(doc) : ['the document module is not loaded']; if (bad.length) return bad;
    this.clear(); this._sim = null; this._docOverride = doc; this._mkThread();
    const mat = new THREE.MeshStandardMaterial({ color: this.colour, roughness: 0.94, metalness: 0, side: THREE.DoubleSide }), rib = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).multiplyScalar(0.86), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.mats = [mat, rib]; this._docMats = { mat, rib }; this._gsm = doc.fabric && +doc.fabric.gsm || 0;
    const top = (doc.avatar && doc.avatar.top) || 100; this._shadowAndFrame(top - 20, 90);
    this.startSim(); return [];
  }
  startSim() {
    const K = window.KASim, doc = this.doc(); if (!doc || !K) { if (this.onSim) this.onSim({ state: 'unavailable' }); return false; }
    const S = this._sim, mats = S ? { mat: S.mat, rib: S.rib } : this._docMats, hide = S ? S.hide : [];
    this.simMode = true;
    if (this._simGroup) { this.group.remove(this._simGroup); this._simGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const built = K.fromDoc(doc), insts = built.insts, h = built.h;
    /* the stiffness follows the fabric's weight (GSM) unless a cloth setting was chosen by hand: bending stiffness of a sheet grows with its mass and thickness */
    const g = this._gsm || 0, dr = this._drapeSet || !g ? K.DRAPE[this._drape || 'medium'] : { bend: Math.max(0.01, Math.min(0.4, 0.02 * Math.pow(g / 140, 2.2))), stretch: g > 300 ? 0.97 : 0.955 };
    this._cloth = new K.Cloth(insts, built.body, Object.assign({}, dr, built.opt));
    this._simGroup = new THREE.Group(); this._simMeshes = [];
    insts.forEach((it) => {
      const g2 = new THREE.BufferGeometry(), N = it.mesh.pts.length, uv = new Float32Array(2 * N), idx = [];
      it.mesh.pts.forEach((p, i) => { uv[2 * i] = p[0]; uv[2 * i + 1] = p[1]; }); it.mesh.tris.forEach((t) => idx.push(t[0], t[1], t[2]));
      g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * N), 3).setUsage(THREE.DynamicDrawUsage)); g2.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g2.setIndex(idx);
      const material = it.mat === 'rib' ? mats.rib : mats.mat, mesh = new THREE.Mesh(g2, material); mesh.userData.piece = it.pid; mesh.userData.base = material; mesh.frustumCulled = false;
      this._simGroup.add(mesh); this._simMeshes.push({ mesh, off: it.off, N });
    });
    this.group.add(this._simGroup);
    this.group.traverse((o) => { if (o.userData && ((o.userData.piece && hide.indexOf(o.userData.piece) >= 0 && !this._simGroup.children.includes(o)) || o.userData.seam || o.userData.seamVis)) { if (!(this._simGroup && this._simGroup.getObjectById(o.id))) o.visible = false; } });
    this._simSteps = 0; this._simTarget = 300; this._simBusy = true; this._simUpload(); this._applyHi();
    if (this.onSim) this.onSim({ state: 'running', step: 0, total: this._simTarget });
    return true;
  }
  _simUpload() {
    const c = this._cloth; if (!c) return;
    this._simMeshes.forEach(({ mesh, off, N }) => { const a = mesh.geometry.attributes.position; a.array.set(c.X.subarray(3 * off, 3 * (off + N))); a.needsUpdate = true; mesh.geometry.computeVertexNormals(); });
  }
  _simTick() {
    if (!this._simBusy || !this._cloth) return;
    const t0 = performance.now(); while (performance.now() - t0 < 9 && this._simSteps < this._simTarget) { this._cloth.step(); this._simSteps++; }
    this._simUpload();
    if (this._simSteps >= this._simTarget) { this._simBusy = false; if (this.onSim) this.onSim({ state: 'done', stats: this._cloth.stats() }); }
    else if (this.onSim && this._simSteps % 12 === 0) this.onSim({ state: 'running', step: this._simSteps, total: this._simTarget });
  }
  // the mannequin the cloth hangs on, shown or hidden
  showMannequin(on) {
    if (this._mannequin) { this.group.remove(this._mannequin); this._mannequin.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this._mannequin = null; }
    this._showBody = !!on; if (!on || !this._cloth) return;
    const d = this._cloth.body.desc, parts = this._cloth.body.parts || (d && { loft: d.loft && { keys: d.loft.keys, y0: d.loft.from == null ? Math.max(-4, d.loft.keys[d.loft.keys.length - 1][0]) : d.loft.from + 0.5, y1: d.loft.keys[0][0] - 1 }, caps: d.caps || [], spheres: d.spheres || [] }); if (!parts) return;
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xcfc8c0, roughness: 0.9, transparent: true, opacity: 0.55 }), ring = (a, b, y, n = 36) => Array.from({ length: n }, (_, i) => new THREE.Vector3(a * Math.cos((i / n) * TAU), y, b * Math.sin((i / n) * TAU)));
    if (parts.loft) { const L = parts.loft, rows = [], N = 36, steps = 24; for (let j = 0; j <= steps; j++) { const y = L.y1 - ((L.y1 - L.y0) * j) / steps, k = L.keys; let a = k[k.length - 1][1], b = k[k.length - 1][2]; for (let q = 1; q < k.length; q++) if (y >= k[q][0]) { const t = (k[q - 1][0] - y) / (k[q - 1][0] - k[q][0] || 1); a = k[q - 1][1] + (k[q][1] - k[q - 1][1]) * t; b = k[q - 1][2] + (k[q][2] - k[q - 1][2]) * t; break; } if (y >= k[0][0]) { a = k[0][1]; b = k[0][2]; } rows.push(ring(a, b, y, N)); }
      const pos = [], idx = []; rows.forEach((r) => r.forEach((v) => pos.push(v.x, v.y, v.z))); for (let j = 0; j < steps; j++) for (let i = 0; i < N; i++) { const a = j * N + i, b = j * N + ((i + 1) % N), c = a + N, d = b + N; idx.push(a, c, b, b, c, d); }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals(); g.add(new THREE.Mesh(bg, mat)); }
    parts.caps.forEach((c) => { const A = new THREE.Vector3(...c.A), B = new THREE.Vector3(...c.B), len = A.distanceTo(B), cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.rb, c.ra, len, 20, 1, true), mat); cyl.position.copy(A).add(B).multiplyScalar(0.5); cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.add(cyl); [[A, c.ra], [B, c.rb]].forEach(([p, r]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), mat); s.position.copy(p); g.add(s); }); });
    parts.spheres.forEach((s) => { const m2 = new THREE.Mesh(new THREE.SphereGeometry(s.r, 20, 14), mat); m2.position.set(...s.c); g.add(m2); });
    this._mannequin = g; this.group.add(g);
  }

  // how far the camera stands so the garment fits the window in height AND in width (a phone is narrow)
  _fit() {
    const t = Math.tan((this.camera.fov * Math.PI) / 360), asp = this.camera.aspect || 1;
    const dH = ((this._L * 1.25) / 2 / t) * 1.12, dW = (this._wNeed / 2 / (t * asp)) * 0.95;
    return this._dist = Math.max(dH, dW);
  }
  // the camera to a named view: front, back, side, three-quarter
  setView(name) {
    if (!this._L) return;
    const d = this._fit(), y = this._L * 0.55, a = { front: 0, back: Math.PI, side: Math.PI / 2, quarter: Math.PI / 5 }[name];
    if (a == null) return;
    this.group.rotation.y = 0; this.spin = false; if (this.onSpin) this.onSpin(false);
    this.camera.position.set(Math.sin(a) * d, y, Math.cos(a) * d); this.controls.target.copy(this.centre); this.controls.update();
  }
  // the pattern piece under a point of the canvas (client coordinates), or null
  pick(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect(); if (!r.width) return null;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const hit = rc.intersectObjects(this.group.children, true).find((h) => h.object.visible !== false && h.object.userData && (h.object.userData.seam || h.object.userData.piece));
    return hit ? (hit.object.userData.seam ? 'seam:' + hit.object.userData.seam : hit.object.userData.piece) : null;
  }
  // a piece shown in the selection colour
  highlight(id) { this._hi = id || null; this._applyHi(); }
  _applyHi() {
    this._hiMats = this._hiMats || new Map();
    const all = []; this.group.traverse((o) => { if (o !== this.group) all.push(o); });
    all.forEach((o) => {
      if (o.userData && o.userData.seamVis) { o.material = this._hi === 'seam:' + o.userData.seamVis ? this._seamHiMat : o.userData.seamBase; o.scale.setScalar(1); return; }
      const base = o.userData && o.userData.base; if (!base) return;
      if (o.userData.piece === this._hi) {
        let h = this._hiMats.get(base); if (!h) { h = base.clone(); h.emissive = new THREE.Color(0x1857c4); h.emissiveIntensity = 0.42; this._hiMats.set(base, h); this.mats.push(h); }
        o.material = h;
      } else o.material = base;
    });
  }

  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  dispose() {
    cancelAnimationFrame(this._raf); this._ro.disconnect(); this.controls.dispose(); this.clear(); this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
