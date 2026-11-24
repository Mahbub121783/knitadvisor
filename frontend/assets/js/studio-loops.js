// KnitAdvisor · Fabric Studio — the loop view: every yarn of a few repeats of
// the drawn programme, one tube per course, coloured by the feeder that laid
// it. Close enough to read each knit, tuck and miss and to follow a yarn from
// needle to needle; the geometry is in studio-loop-geom.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './studio-loop-geom.js?v=20261122d';
import './view-guard.js?v=20261111b';
import { fibresGeometry, materialFor } from './yarn-real.js?v=20261122a';

// dyed-yarn tones, not plastic primaries: each feeder still reads apart
const FEED_COLOURS = ['#34558f', '#3f8a6e', '#b8613a', '#6d5aa6', '#b48a35', '#3a7d8f', '#a5486f', '#5f7f3a', '#8e4b2f', '#4a5568', '#3d6fa5', '#9a7a2e'];
const ROLE_COLOURS = { ground: '#34558f', face: '#34558f', binder: '#6d5aa6', loop: '#b8613a' };
const ELASTANE = '#f5f5f4';

// ── the yarn's surface: fibres twisted round the yarn, and the loose fibre ends that stand off it ─────────────
// A tube's u runs along the yarn and v round it, so a helix is a straight slanted line in (u, v): one tile is one
// twist pitch. Drawn once, shared by every yarn (each mesh repeats it by its own length).
let FIBRE_TEX = null, FUZZ_TEX = null;
function fibreTexture() {
  if (FIBRE_TEX) return FIBRE_TEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, 256, 128);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 520; k++) {
    const x = rnd() * 256, l = 0.55 + rnd() * 0.45, v = Math.round(150 + rnd() * 105);
    g.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.lineWidth = 0.6 + rnd() * 1.4;
    // one tile across = one turn round the yarn: the fibre climbs the full height over the tile's width
    for (const dx of [-256, 0, 256]) { g.beginPath(); g.moveTo(x + dx, 128); g.lineTo(x + dx + 256 * l * 0.9, 128 - 128 * l); g.stroke(); }
  }
  FIBRE_TEX = new THREE.CanvasTexture(c);
  FIBRE_TEX.wrapS = FIBRE_TEX.wrapT = THREE.RepeatWrapping; FIBRE_TEX.colorSpace = THREE.SRGBColorSpace; FIBRE_TEX.anisotropy = 4;
  return FIBRE_TEX;
}
function fuzzTexture() {
  if (FUZZ_TEX) return FUZZ_TEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 64);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 900; k++) { const x = rnd() * 256, y = rnd() * 64, a = rnd() * Math.PI, l = 2 + rnd() * 7, v = Math.round(90 + rnd() * 165); g.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  FUZZ_TEX = new THREE.CanvasTexture(c); FUZZ_TEX.wrapS = FUZZ_TEX.wrapT = THREE.RepeatWrapping;
  return FUZZ_TEX;
}
// soft studio light for the yarn's sheen: a grey room with three light panels, pre-filtered once
function studioEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x8c9098, side: THREE.BackSide })));
  [[0, 8, 6, 6], [-8, 3, 2, 3], [7, 2, -6, 2]].forEach(([x, y, z, k]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m);
  });
  const env = pm.fromScene(room, 0.04).texture; pm.dispose();
  return env;
}

export function feedColour(spec, f) {
  if (spec.colours && spec.colourBy !== 'one') return spec.colours[f % spec.colours.length];   // warp: one colour per guide bar
  if (spec.colourBy === 'role') return ROLE_COLOURS[(spec.feeds[f] || {}).role] || ROLE_COLOURS.ground;
  if (spec.colourBy === 'one') return spec.colour || '#3d5a80';
  return FEED_COLOURS[f % FEED_COLOURS.length];
}

export class LoopView {
  constructor(host, onHover, onPick) {
    this.host = host;
    window.__loopView = this;      // for the performance checks in the headless tests
    this.onHover = onHover || (() => {});
    this.onPick = onPick || (() => {});
    const w = host.clientWidth || 600, hh = host.clientHeight || 420;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;        // the swatch is cut clean at its edges, like a cut sample
    this.renderer.setSize(w, hh);
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, w / hh, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // drawn on demand, not every frame: the page stays light while you edit
    this.controls.addEventListener('change', () => this.redraw());
    // the wheel scrolls the page past the view; Ctrl/⌘ + wheel, a pinch, or a click first zooms it
    this._unguard = window.KAViewGuard ? window.KAViewGuard.wheel(this.renderer.domElement, this.controls) : null;
    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7480, 0.55));
    const key = new THREE.DirectionalLight(0xfff8ef, 1.5); key.position.set(-4, 7, 10); this.scene.add(key); this._key = key;
    const rim = new THREE.DirectionalLight(0xe8f0ff, 0.7); rim.position.set(5, -3, -9); this.scene.add(rim);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.meshes = [];
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._move = (e) => this._hover(e);
    this._leave = () => this.onHover(null);
    // a press and release that did not drag is a pick: the stitch under it (or nothing)
    this._down = (e) => { this._pd = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    this._up = (e) => { const d = this._pd; this._pd = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 700) this.onPick(this._stitchAt(e)); };
    this.renderer.domElement.addEventListener('pointerdown', this._down);
    this.renderer.domElement.addEventListener('pointerup', this._up);
    this.renderer.domElement.addEventListener('pointermove', this._move);
    this.renderer.domElement.addEventListener('pointerleave', this._leave);
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(host);
  }

  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderer.render(this.scene, this.camera); });
  }

  // What the relaxed yarn paths depend on, rounded so that a tiny change of the density (every analysis moves wpc / cpc a little)
  // does not count as a new design: the loop spacing to 0.05 wale, a yarn's radius to 0.01.
  _plain(spec) {
    const q = (v, k) => Math.round(v / k) * k;
    return {
      C: spec.C, D: spec.D, bed: spec.bed, feeds: (spec.feeds || []).map((f) => ({ role: f && f.role, course: f && f.course })), transferDir: spec.transferDir,
      h: q(spec.h || 0.75, 0.05), wales: spec.wales, courses: spec.courses, radius: (spec.radius || []).map((r) => q(r, 0.01)),
      pileFeeds: spec.pileFeeds, pileH: spec.pileH, pileArrangement: spec.pileArrangement, lead: 1,
    };
  }

  // the relaxed paths of a programme (solid yarns that do not pass through each other: studio-loop-geom.js relax). Relaxing takes about
  // half a second, so it runs in a worker: the view draws the plain paths at once and swaps the relaxed ones in when they arrive.
  _geometry(spec, sync) {
    if (spec.geo) return spec.geo;
    const plain = this._plain(spec), key = JSON.stringify(plain);
    this._cache = this._cache || new Map();
    if (spec.real) {
      return globalThis.KALoopGeom.buildLoopPaths({ ...spec, lead: 1, relax: false });
    }
    if (this._cache.has(key)) return this._cache.get(key);
    if (sync) {                                                       // the fibre close-up needs the relaxed paths now
      const g = globalThis.KALoopGeom.buildLoopPaths({ ...plain, relax: true });
      this._cache.set(key, g); return g;
    }
    // relaxing grows faster than the number of loops (about 9 s for 2,800 loops): a big programme is drawn as the plain paths, a smaller repeat relaxes
    this._relaxSkipped = plain.C.length * plain.C[0].length * (plain.D ? 2 : 1) > 1500;
    this._wanted = this._relaxSkipped ? null : key;
    if (!this._relaxSkipped) this._relaxInWorker(plain, key);
    this._fast = this._fast || new Map();
    if (!this._fast.has(key)) { this._fast.set(key, globalThis.KALoopGeom.buildLoopPaths({ ...plain, relax: false })); if (this._fast.size > 6) this._fast.delete(this._fast.keys().next().value); }
    return this._fast.get(key);
  }

  _relaxInWorker(plain, key) {
    if (this._pending === key) return;
    this._pending = key;
    if (this._worker === undefined) {
      try {
        const url = new URL('./studio-loop-geom.js?v=20261122d', import.meta.url).href;
        const src = "importScripts('" + url + "');self.onmessage=function(e){var d=e.data;var g=self.KALoopGeom.buildLoopPaths(Object.assign({},d.spec,{relax:true}));postMessage({key:d.key,geo:g});};";
        this._worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this._worker.onmessage = (e) => {
          const { key: k, geo } = e.data;
          this._cache.set(k, geo); if (this._cache.size > 6) this._cache.delete(this._cache.keys().next().value);
          if (this._pending === k) this._pending = null;
          // still the design on screen: draw the relaxed paths
          if (this._wanted === k && this.spec && !this._close) { this._relaxedNow = true; this.draw(this.spec); }
        };
        this._worker.onerror = () => { this._worker = null; };
      } catch (_) { this._worker = null; }
    }
    if (this._worker) this._worker.postMessage({ spec: plain, key });
    else {                                                            // no worker (a locked-down browser): relax here, once
      this._pending = null;
      const g = globalThis.KALoopGeom.buildLoopPaths({ ...plain, relax: true });
      this._cache.set(key, g);
    }
  }

  _yarnMaterial(colour, len, r) {
    const tex = fibreTexture().clone(); tex.needsUpdate = true;
    // one tile = one twist pitch; an S-twisted yarn's fibres slant the other way
    tex.repeat.set(Math.max(1, len / (8 * r)), (this.spec && this.spec.twist === 'S') ? -1 : 1);
    if (this.spec && this.spec.filament) return new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.38, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4, sheen: 0.3, envMapIntensity: 0.8, side: THREE.DoubleSide, clippingPlanes: this._clip, transparent: true, opacity: 1 });
    return new THREE.MeshPhysicalMaterial({
      color: colour, map: tex, bumpMap: tex, bumpScale: 1.6, roughness: 0.86, metalness: 0,
      sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(colour).lerp(new THREE.Color(0xffffff), 0.55),
      envMapIntensity: 0.55, side: THREE.DoubleSide, clippingPlanes: this._clip, transparent: true, opacity: 1,
    });
  }

  _fuzz(curve, segs, r, colour, len, course, feed) {
    const t = fuzzTexture().clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, len / (3 * r)), 1);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r * 1.28, 6, false),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).lerp(new THREE.Color(0xffffff), 0.25), alphaMap: t, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1, clippingPlanes: this._clip }));
    const hair = this.spec && this.spec.hair != null ? this.spec.hair : 1;
    m.material.opacity = Math.min(0.85, 0.42 * hair);
    m.userData = { course, feed, fuzz: true, base: m.material.opacity };
    return m;
  }

  draw(spec) {
    this.spec = spec;
    if (this._close) { this.closeUp(true); return this._geometry(spec, true); }
    this._clear();
    if (this.camera.near !== 0.1) { this.camera.near = 0.1; this.camera.far = 500; this.camera.updateProjectionMatrix(); }
    if (this.scene.background) { this.scene.background = null; this._key.castShadow = false; this._key.position.set(-4, 7, 10); this.renderer.shadowMap.enabled = false; }
    // a ready-made geometry (warp: one path per end) or the weft programme's, relaxed
    const geo = this._geometry(spec);
    this.geo = geo;
    const cx = (geo.wales - 1) / 2 + (spec.D && geo.bed === 'rib' ? 0.25 : 0), cy = (geo.rows - 1) * geo.h / 2 + 0.4 * geo.h;
    this.centre = new THREE.Vector3(cx, cy, 0);
    // cut the swatch clean: part-way up the course below the first one, and just outside the outer wales
    const step = geo.step || geo.h;
    this._clip = spec.geo ? [] : [
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(-step + 0.42 * geo.h - cy)),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(-0.62 - cx)),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), (geo.wales - 0.38 - cx)),
    ];
    const tube = (co, lead) => {
      const r = (spec.radius && spec.radius[co.feed]) || 0.13;
      const v = co.points.map((p) => new THREE.Vector3(p.x - cx, p.y - cy, p.z));
      const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
      const len = curve.getLength(), segs = Math.max(40, Math.min(420, Math.round(len / (r * 1.3))));
      const colour = spec.real ? (spec.colour || '#3d5a80') : spec.colourBy === 'stripe' && spec.stripeColour ? spec.stripeColour(co.course) : feedColour(spec, co.feed);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 8, false), this._yarnMaterial(colour, len, r));
      mesh.userData = { course: co.course, feed: co.feed, lead: !!lead, base: 1 };
      this.group.add(mesh); this.meshes.push(mesh);
      // the loose fibre ends round a spun yarn (not on the diagram of a warp)
      if (!spec.geo && !spec.filament) { const f = this._fuzz(curve, Math.round(segs / 3), r, colour, len, co.course, co.feed); f.userData.lead = !!lead; this.group.add(f); this.meshes.push(f); }
      return r;
    };
    (geo.lead || []).forEach((co) => tube(co, true));
    geo.courses.forEach((co) => {
      const r = tube(co, false);
      if (co.pile) {
        // plush: the pile yarn, its standing loops on the back
        const pv = co.pile.map((p) => new THREE.Vector3(p.x - cx, p.y - cy, p.z));
        const pc = new THREE.CatmullRomCurve3(pv, false, 'centripetal', 0.5);
        const pr = spec.pileRadius || r;
        const pm = new THREE.Mesh(new THREE.TubeGeometry(pc, Math.max(48, Math.min(500, pv.length * 3)), pr, 8, false), this._yarnMaterial(spec.real ? (spec.colour || '#3d5a80') : (spec.pileColour || '#c2410c'), pc.getLength(), pr));
        pm.userData = { course: co.course, feed: co.feed, pile: true, base: 1 };
        this.group.add(pm); this.meshes.push(pm);
      }
      if (spec.plated && spec.plated[co.feed]) {
        // the elastane is plated: it follows the ground yarn's path, one yarn's width toward the technical back of its bed
        const e = co.points.map((p, i) => new THREE.Vector3(p.x - cx, p.y - cy, p.z - (co.side[i] || 1) * (r * 1.1)));
        const ec = new THREE.CatmullRomCurve3(e, false, 'centripetal', 0.5);
        const em = new THREE.Mesh(new THREE.TubeGeometry(ec, Math.max(48, Math.min(500, e.length)), r * 0.42, 6, false),
          new THREE.MeshPhysicalMaterial({ color: ELASTANE, roughness: 0.35, clearcoat: 0.4, metalness: 0, transparent: true, opacity: 1, clippingPlanes: this._clip, side: THREE.DoubleSide }));
        em.userData = { course: co.course, feed: co.feed, elastane: true, base: 1 };
        this.group.add(em); this.meshes.push(em);
      }
    });
    if (spec.real) {
      // the real view is the whole cloth: no build step, no picked-out feeder
      this.meshes.forEach((m) => { m.visible = true; m.material.opacity = m.userData.base || 1; });
    } else {
      this.setStep(this._step == null ? null : this._step);
      this.highlight(this._hl == null ? null : this._hl);
    }
    // re-frame when the swatch changes size (another bed, more feeds or needles)
    const dims = `${geo.wales}x${geo.rows}x${geo.bed}`;
    if (!this._viewed) this.view(spec.real ? 'face' : 'angle');
    else if (dims !== this._dims) this.view(this._lastView || 'angle');
    this._dims = dims;
    this._drawMarks();
    return geo;
  }

  // ── fibre close-up: the yarn engine's own fibres (yarn-real-geom.js), laid along the relaxed loops ─────────────
  // A few loops in the middle of the swatch, each yarn built fibre by fibre for its real count, fibre, spinning system and
  // twist, then bent onto the yarn's path in the cloth: the fibre's place across the yarn rides a frame carried along the
  // path, so the twist, the migration and the hairs follow every bend of the loop. In millimetres.
  closeUp(on) {
    this._close = !!on;
    if (this._markGroup) this._markGroup.visible = !on;
    if (!this.spec) return;
    if (!on) { this.draw(this.spec); return; }
    const spec = this.spec, geo = this._geometry(spec, true);
    const G = globalThis.KAYarnGeom;
    if (!G || !fibresGeometry) return;
    this._clear();
    const mm = spec.waleMm || 0.57;                                   // one wale in mm
    const cxw = (geo.wales - 1) / 2, mid = Math.floor(geo.rows / 2);
    const half = 1.05, x0 = cxw - half, x1 = cxw + half;
    const ylo = (mid - 0.9) * (geo.step || geo.h), yhi = (mid + 1.25) * (geo.step || geo.h);
    this._clip = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(x0 - cxw) * mm), new THREE.Plane(new THREE.Vector3(-1, 0, 0), (x1 - cxw) * mm),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(ylo - mid * (geo.step || geo.h)) * mm), new THREE.Plane(new THREE.Vector3(0, -1, 0), (yhi - mid * (geo.step || geo.h)) * mm),
    ];
    const cyw = mid * (geo.step || geo.h);
    let fibreCount = 0, meta = null;
    geo.courses.forEach((co) => {
      if (co.course < mid - 3 || co.course > mid + 2) return;
      // the run of this yarn inside the window (with a margin: the clip cuts it clean)
      const P = co.points, run = [];
      let best = [], cur = [];
      P.forEach((p) => { if (p.x > x0 - 0.7 && p.x < x1 + 0.7) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } });
      if (cur.length > best.length) best = cur;
      if (best.length < 4) return;
      best.forEach((p) => run.push(new THREE.Vector3((p.x - cxw) * mm, (p.y - cyw) * mm, p.z * mm)));
      // a frame carried along the path (parallel transport): tangent, normal, binormal at every point
      const n = run.length, S = new Float64Array(n), T = [], N = [], B = [];
      for (let i = 0; i < n; i++) {
        if (i) S[i] = S[i - 1] + run[i].distanceTo(run[i - 1]);
        const a = run[Math.max(0, i - 1)], b = run[Math.min(n - 1, i + 1)];
        T.push(new THREE.Vector3().subVectors(b, a).normalize());
      }
      let nn = new THREE.Vector3(0, 0, 1); if (Math.abs(nn.dot(T[0])) > 0.9) nn.set(1, 0, 0);
      nn.sub(T[0].clone().multiplyScalar(nn.dot(T[0]))).normalize();
      for (let i = 0; i < n; i++) {
        if (i) { const t = T[i]; nn = N[i - 1].clone().sub(t.clone().multiplyScalar(N[i - 1].dot(t))); if (nn.lengthSq() < 1e-10) nn = N[i - 1].clone(); nn.normalize(); }
        N.push(nn.clone()); B.push(new THREE.Vector3().crossVectors(T[i], nn).normalize());
      }
      const L = S[n - 1];
      const yarn = (spec.yarnOf && spec.yarnOf(co.feed)) || { fibre: 'cotton', type: 'combed', tex: 19.7, ply: 1 };
      let built;
      try { built = G.build(yarn, { length: L, maxFibres: 240, step: 0.045, seed: co.course * 31 + co.feed }); } catch (e) { return; }
      meta = built.meta;
      const rDraw = ((spec.radius && spec.radius[co.feed]) || 0.13) * mm;
      const kr = built.meta && built.meta.diameter_mm ? rDraw / (built.meta.diameter_mm / 2) : 1;
      let seg = 0;
      const at = (s) => {
        s = Math.max(0, Math.min(L, s));
        while (seg > 0 && S[seg] > s) seg--;
        while (seg < n - 2 && S[seg + 1] < s) seg++;
        const f = (s - S[seg]) / Math.max(1e-9, S[seg + 1] - S[seg]);
        return { P: run[seg].clone().lerp(run[seg + 1], f), N: N[seg].clone().lerp(N[seg + 1], f).normalize(), B: B[seg].clone().lerp(B[seg + 1], f).normalize() };
      };
      const sc = built.length > 0 ? L / built.length : 1;          // the built length onto the path's length
      const fibres = built.fibres.filter((fb, i) => fb.kind !== 'hair' || i % 2 === 0).map((fb) => {
        const p = fb.p, out = new Float32Array(p.length);
        seg = 0;
        for (let k = 0; k < p.length; k += 3) {
          const q = at(p[k + 1] * sc);
          out[k] = q.P.x + (q.N.x * p[k] + q.B.x * p[k + 2]) * kr;
          out[k + 1] = q.P.y + (q.N.y * p[k] + q.B.y * p[k + 2]) * kr;
          out[k + 2] = q.P.z + (q.N.z * p[k] + q.B.z * p[k + 2]) * kr;
        }
        return Object.assign({}, fb, { p: out, rf: fb.rf * kr });
      });
      fibreCount += fibres.length;
      const colour = spec.colourBy === 'one' || spec.real ? (spec.colour || '#f1ead9') : feedColour(spec, co.feed);
      const mat = materialFor(built.meta, colour);
      mat.clippingPlanes = this._clip; mat.side = THREE.DoubleSide;
      if (mat.sheenColor) mat.sheenColor = new THREE.Color(colour).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(0.6);
      mat.envMapIntensity = 0.5;
      const mesh = new THREE.Mesh(fibresGeometry(fibres, 0), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { course: co.course, feed: co.feed, fibres: true, base: 1 };
      this.group.add(mesh); this.meshes.push(mesh);
    });
    this.closeInfo = { fibres: fibreCount, meta };
    // a dark stage and a key light that casts shadows between the yarns: the depth of the interlooping reads
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#23272e');
    const key = this._key; key.castShadow = true;
    const ext = Math.max((x1 - x0), (yhi - ylo)) * mm;
    key.position.set(-ext * 1.2, ext * 2.2, ext * 3); key.target.position.set(0, ((ylo + yhi) / 2 - cyw) * mm, 0); this.scene.add(key.target);
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: ext * 0.2, far: ext * 10 }); key.shadow.camera.updateProjectionMatrix();
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.002;
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    // frame the window
    const w = (x1 - x0) * mm, hgt = (yhi - ylo) * mm, t = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    const d = 1.15 * Math.max(w / (t * this.camera.aspect), hgt / t);
    this.camera.near = d / 200; this.camera.far = d * 50; this.camera.updateProjectionMatrix();
    const cyWin = ((ylo + yhi) / 2 - cyw) * mm;
    this.camera.position.set(-d * 0.12, cyWin + d * 0.1, d); this.controls.target.set(0, cyWin, 0); this.camera.up.set(0, 1, 0); this.controls.update();
    this.redraw();
    return this.closeInfo;
  }

  view(name) {
    this._viewed = true;
    this._lastView = name;
    const g = this.geo; if (!g) return;
    // fit the swatch to whichever of width and height binds at this aspect
    const t = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    const d = 0.96 * Math.max(g.wales / (t * this.camera.aspect), (g.rows * (g.step || g.h) + g.h) / t);
    // edge: from above, along the wales — the cross-section, where the two
    // beds, the tucks behind the held loops and the floats separate in depth
    const at = {
      face: [0, 0, d], back: [0, 0, -d],
      edge: [0, d * 0.97, d * 0.24],
      angle: [-d * 0.38, d * 0.26, d * 0.89],
    }[name] || [0, 0, d];
    this.camera.position.set(at[0], at[1], at[2]);
    this.controls.target.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  // show the fabric as knitted up to course k (null = all of it)
  setStep(k) {
    this._step = k;
    this.meshes.forEach((m) => { m.visible = k == null || m.userData.course <= k; });
    this.redraw();
  }

  highlight(feed) {
    this._hl = feed;
    this.meshes.forEach((m) => { const on = feed == null || m.userData.feed === feed; m.material.opacity = (m.userData.base || 1) * (on ? 1 : 0.12); m.material.depthWrite = on && !m.userData.fuzz; });
    this.redraw();
  }

  _hover(e) { this.onHover(this._stitchAt(e)); }

  _stitchAt(e) {
    if (!this.geo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.meshes.filter((m) => m.visible && !m.userData.fuzz && !m.userData.lead && m.material.opacity > 0.5), false);
    if (!hits.length) return null;
    const hit = hits[0], co = this.geo.courses[hit.object.userData.course];
    if (!co || !co.stitches) return null;
    const px = hit.point.x + this.centre.x, pz = hit.point.z;
    let best = null, bd = 1e9;
    co.stitches.forEach((s) => {
      const bedZ = s.bed === 'C' ? this.geo.zc : -this.geo.zc;
      const dd = Math.abs(s.x - px) + (this.geo.zc ? Math.abs(bedZ - pz) * 0.6 : 0);
      if (dd < bd) { bd = dd; best = s; }
    });
    return best ? { ...best, elastane: !!hit.object.userData.elastane, clientX: e.clientX - r.left, clientY: e.clientY - r.top } : null;
  }

  // a ring round every loop of one needle of the programme (it shows on each repeat), drawn over the cloth; null clears it
  markCell(bed, feed, needle, mod) {
    this._mark = bed == null ? null : { bed, feed, needle, mod };
    this._drawMarks();
  }

  _drawMarks() {
    if (this._markGroup) {
      this.group.remove(this._markGroup);
      this._markGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._markGroup = null;
    }
    const m = this._mark, geo = this.geo;
    if (m && geo && this.centre && !this._close && !geo.courses.some((c) => !c.stitches)) {
      const g = new THREE.Group(), cx = this.centre.x, cy = this.centre.y;
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6a00, depthTest: false, transparent: true, opacity: 0.95 });
      const ring = new THREE.TorusGeometry(0.34, 0.032, 8, 28);
      geo.courses.forEach((co) => co.stitches.forEach((s) => {
        if (s.bed !== m.bed || (s.feed % (m.mod || geo.F)) !== m.feed || s.needle !== m.needle) return;
        const z = (s.bed === 'C' ? 1 : -1) * (geo.zc + 0.3);
        const mesh = new THREE.Mesh(ring, mat);
        mesh.position.set(s.x - cx, ((s.y0 + (s.top == null ? s.y0 : s.top)) / 2) - cy, z);
        mesh.renderOrder = 999;
        g.add(mesh);
      }));
      this.group.add(g); this._markGroup = g;
    }
    this.redraw();
  }

  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
    // the frame follows the box: a view that changes size is fitted again (the close-up keeps its own frame)
    if (this.geo && this._lastView && !this._close) this.view(this._lastView);
    this.redraw();
  }

  _clear() {
    this.meshes.forEach((m) => { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); });
    this.meshes = [];
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    if (this._unguard) this._unguard();
    this._ro.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this._move);
    this.renderer.domElement.removeEventListener('pointerleave', this._leave);
    this.renderer.domElement.removeEventListener('pointerdown', this._down);
    this.renderer.domElement.removeEventListener('pointerup', this._up);
    if (this._worker) { this._worker.terminate(); this._worker = null; }
    this._clear(); this.controls.dispose(); this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
