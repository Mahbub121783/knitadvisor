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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.35;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bfc9, 1.25));
    const key = new THREE.DirectionalLight(0xfff6ea, 2.1); key.position.set(-60, 120, 140); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xe6eeff, 0.55); fill.position.set(120, 40, -90); this.scene.add(fill);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.spin = false; this.colour = '#3d5a80'; this.mats = [];
    this._raf = 0; this._last = 0;
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(host);
    this.controls.addEventListener('start', () => { this.spin = false; if (this.onSpin) this.onSpin(false); });
    this.resize();
    this._loop = (t) => { this._raf = requestAnimationFrame(this._loop); const dt = Math.min(0.05, (t - this._last) / 1000 || 0); this._last = t; if (this.spin) this.group.rotation.y += dt * 0.6; this.controls.update(); this.renderer.render(this.scene, this.camera); };
    this._raf = requestAnimationFrame(this._loop);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setColour(hex) { this.colour = hex; if (this.mats[0]) this.mats[0].color.set(hex); if (this.mats[1]) this.mats[1].color.set(hex).multiplyScalar(0.86); }
  setSpin(on) { this.spin = !!on; }

  clear() {
    if (this._hiMats) this._hiMats.clear();
    while (this.group.children.length) { const o = this.group.children[0]; this.group.remove(o); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); }
    this.mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); this.mats = [];
  }

  // size: one entry of result.by_size; fabric: result.fabric
  setGarment(size, fabric) {
    this.clear();
    const m = size.m, d = size.derived, P = {}; size.pieces.forEach((p) => { P[p.id] = p; });
    const L = m.length, step = 0.6;
    const tex = knitTexture(fabric.wpc, fabric.cpc);
    const mat = new THREE.MeshStandardMaterial({ color: this.colour, map: tex, bumpMap: tex, bumpScale: 0.9, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colour).multiplyScalar(0.86), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.mats = [mat, rib];

    // the body: depth/width ratio grows from flat shoulders to a round chest
    const dRatio = (y) => 0.6 * smooth(0, 11, y);
    const tabs = new Map(); const tab = (d0) => { const k = Math.round(d0 * 200); if (!tabs.has(k)) tabs.set(k, arcTable(k / 200)); return tabs.get(k); };
    // the tube's own width: the armhole bows in and steps out at the underarm, but a body does not: from the shoulder to the underarm it widens smoothly
    const cw2 = m.chest / 2, sw2 = m.shoulder / 2, yu = d.underarm_y || (m.slope + m.armhole);
    const tubeW = (piece) => (yp) => { const w = halfWidth(piece, yp); return yp <= m.slope || yp >= yu ? w : Math.max(w * 0.98, sw2 + (cw2 - sw2) * smooth(m.slope, yu, yp)); };
    const at = (piece, front) => (xp, yp) => {                                // a point of the pattern -> the point on the body
      const w = Math.max(halfWidth(piece, yp), 0.5), Wt = Math.max(tubeW(piece)(yp), w), dr = dRatio(yp), tb = tab(dr);
      const a = (2 * Wt) / tb.total, th = angleAt(tb, (xp + w) / (2 * w));
      const x = -a * Math.cos(th), z = a * dr * Math.sin(th);
      return new THREE.Vector3(front ? x : -x, L - yp, front ? z : -z);
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
    const ring = (pts, r, material) => this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5), 160, r, 6, true), material));
    {
      const yh = L - m.hem_h, wF = halfWidth(front, yh), wB = halfWidth(back, yh), pts = [];
      for (let i = 0; i <= 36; i++) pts.push(mapF(-wF + (2 * wF * i) / 36, yh));
      for (let i = 35; i >= 1; i--) pts.push(mapB(-wB + (2 * wB * i) / 36, yh));
      ring(pts, 0.14, rib);
      const ys = SL - m.sleeve_hem_h, w = Math.max(halfWidth(sl, ys), 0.1), r = w / Math.PI, top = shoulder.clone().addScaledVector(dir, ys), C = top.clone().addScaledVector(nrm, -r), sp = [];
      for (let i = 0; i < 36; i++) { const phi = -Math.PI + (i / 36) * TAU; sp.push(C.clone().addScaledVector(nrm, r * Math.cos(phi)).addScaledVector(zz, r * Math.sin(phi))); }
      ring(sp, 0.14, rib);
      const sp2 = sp.map((v) => new THREE.Vector3(-v.x, v.y, v.z)); ring(sp2, 0.14, rib);
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
    this._applyHi();
    this.info = { sleeve_axis_deg: 28, form: 'from the finished pattern pieces' };
  }

  // shorts: two legs, each a tube whose rings are as long round as the front leg piece plus the back leg piece are wide at that height; a waistband ring; a drawcord
  setShorts(size, fabric) {
    this.clear();
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
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.14, 5, true), dark));
    });
    // the waistband: a ring round both legs
    const A = cx(rows[0]) + a0 + 0.25, B = rows[0].b + 0.3, bandPos = [], bandUv = [], bandIdx = [], nB = 72;
    for (let j = 0; j <= 1; j++) for (let k = 0; k <= nB; k++) { const t = (k / nB) * Math.PI * 2; bandPos.push(A * Math.cos(t), top - F + j * F, B * Math.sin(t)); bandUv.push((k / nB) * 2 * m.waist, j * F); }
    for (let k = 0; k < nB; k++) { const a = k, b = k + 1, c = k + nB + 1, d = c + 1; bandIdx.push(a, c, b, b, c, d); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bandPos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(bandUv, 2)); bg.setIndex(bandIdx); bg.computeVertexNormals();
    this.group.add(tagged(new THREE.Mesh(bg, rib), 'waistband', rib));
    for (const yy of [top, top - F]) { const pts = []; for (let k = 0; k < 72; k++) { const t = (k / 72) * Math.PI * 2; pts.push(new THREE.Vector3(A * Math.cos(t), yy, B * Math.sin(t))); } this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 140, 0.12, 5, true), dark)); }
    // the drawcord: two ends hanging from the eyelets at the front
    const vis = m.drawcord_len || 10, ex = (m.eyelet_dist || 4) / 2 + 0.3, cord = new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.8 });
    this.mats.push(cord);
    [-1, 1].forEach((sg) => {
      const x0 = sg * ex, pts = [new THREE.Vector3(x0, top - F * 0.5, B), new THREE.Vector3(x0 * 1.1, top - F * 0.5 - vis * 0.35, B + 0.5), new THREE.Vector3(x0 * 1.5, top - F * 0.5 - vis * 0.7, B + 0.3), new THREE.Vector3(x0 * 1.8, top - F * 0.5 - vis, B)];
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.22, 6, false), cord));
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), cord); knot.position.copy(pts[3]); this.group.add(knot);
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.1, 6, 12), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.35 })); eye.position.set(x0, top - F * 0.5, B + 0.02); this.group.add(eye);
    });
    // the slanted front pockets, and the back pockets, drawn as stitching on the cloth
    const onLeg = (sg, front, xp, yp) => { const r = rows[Math.max(0, Math.min(nRow, Math.round(yp / (Ll / nRow))))], w = front ? r.wf : r.wb, t = (front ? 0 : Math.PI) + Math.PI * Math.min(1, xp / w); return new THREE.Vector3(sg * (cx(r) + r.a * Math.cos(t)), top - F - yp, r.b * Math.sin(t) * 1.012); };
    if (m.fpocket_l > 0 && m.fpocket_w > 0) [1, -1].forEach((sg) => { const pts = []; for (let i = 0; i <= 10; i++) { const f = i / 10; pts.push(onLeg(sg, true, m.fpocket_w * (1 - f), Math.max(0.05, m.fpocket_l * f))); } this.group.add(tagged(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.12, 5, false), dark), 'front', mat)); });
    if (m.bpocket_w > 0 && m.bpocket_l > 0) [1, -1].forEach((sg) => {
      const x0 = rows[0].wb * 0.5 - m.bpocket_w / 2, x1 = x0 + m.bpocket_w, y0 = m.bpocket_pos, y1 = y0 + m.bpocket_l, loop = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([xp, yp]) => onLeg(sg, false, xp, yp));
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true, 'catmullrom', 0.02), 60, 0.1, 5, true), dark));
    });
    this._shadowAndFrame(top, 2 * (cx(rows[0]) + a0) * 1.15 + 6);
  }
  // the floor shadow, then the camera for a garment of this height and width
  _shadowAndFrame(L, wNeed) {
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const fg = fc.getContext('2d'); const gr = fg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); fg.fillStyle = gr; fg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.3, L * 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1; this.group.add(shadow); this.mats.push(shadow.material);
    this.centre = new THREE.Vector3(0, L * 0.5, 0); this._L = L; this._wNeed = wNeed; const dist = this._fit();
    if (!this._placed || Math.abs(L - this._placedL) / this._placedL > 0.35) { this.group.rotation.y = 0; this.camera.position.set(0, L * 0.55, dist); this.controls.target.copy(this.centre); this._placed = true; this._placedL = L; }
    this.controls.minDistance = L * 0.4; this.controls.maxDistance = L * 6; this.controls.update(); this._applyHi();
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
    const hit = rc.intersectObjects(this.group.children, false).find((h) => h.object.userData && h.object.userData.piece);
    return hit ? hit.object.userData.piece : null;
  }
  // a piece shown in the selection colour
  highlight(id) { this._hi = id || null; this._applyHi(); }
  _applyHi() {
    this._hiMats = this._hiMats || new Map();
    this.group.children.forEach((o) => {
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
