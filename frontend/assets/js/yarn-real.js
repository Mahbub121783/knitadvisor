// KnitAdvisor · Fabric Studio — the yarn, real view.
//
// Draws the yarn as its fibres (geometry from yarn-real-geom.js): each fibre
// is its own tube, with the cross-section of its fibre (cotton a flattened,
// convoluted ribbon) and a fine fibrillar surface. Nothing is a picture, so
// zooming in keeps adding detail: the twist from a distance, single fibres and
// hairs closer, each fibre's section and convolutions at the closest. The fine
// surface is a normal map tiled in millimetres; its mipmaps fade it out as you
// step back, which is how the detail appears only when you are close enough
// to see it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './yarn-real-geom.js?v=20261119b';
import './view-guard.js?v=20261111b';

const G = globalThis.KAYarnGeom;
const STAGE = '#272c34';            // a dark slate stage: the yarn's own light, edges and hairs read best on it
const TILE_MM = 0.15;               // one tile of fibre surface texture along the fibre

// ── fibre surface: fine striations along the fibre, as a normal map ──────
let SURFACE = null;
function surfaceMap() {
  if (SURFACE) return SURFACE;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  // height: ridges that run along the fibre (x = along, y = around)
  const waves = [[7, 0.5, 0.0], [13, 0.3, 1.3], [23, 0.18, 2.1], [41, 0.1, 0.7]];
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [f, a, p] of waves) v += a * Math.sin((2 * Math.PI * f * y) / N + p + 0.6 * Math.sin((2 * Math.PI * 2 * x) / N + f));
    v += 0.08 * Math.sin((2 * Math.PI * 3 * x) / N) * Math.sin((2 * Math.PI * 5 * y) / N);
    h[y * N + x] = v;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const hy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    let nx = -hx * 1.4, ny = -hy * 1.4, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  SURFACE = new THREE.CanvasTexture(c);
  SURFACE.wrapS = SURFACE.wrapT = THREE.RepeatWrapping;
  SURFACE.colorSpace = THREE.NoColorSpace;
  return SURFACE;
}

// ── tubes: every fibre with its own section, merged into one geometry ────
function fibresGeometry(fibres, xOffset) {
  const RAD = { body: 7, hair: 5, loop: 5, wrap: 5, nep: 5, tuft: 5, mono: 48, filament: 8, core: 40, cover: 8 };
  const radialOf = (f) => (f.shape === 'lobed' ? (f.kind === 'core' ? Math.max(RAD.core, 14 * f.lobes) : Math.max(8, 4 * f.lobes)) : f.kind === 'filament' && f.shape === 'trilobal' ? 12 : f.kind === 'mono' && f.shape === 'trilobal' ? 60 : RAD[f.kind] || 6);
  let nv = 0, ni = 0;
  for (const f of fibres) { const n = f.p.length / 3; if (n < 2) continue; const r = radialOf(f); nv += n * (r + 1); ni += (n - 1) * r * 6; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let v = 0, k = 0;
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3(), A = new THREE.Vector3(), Pp = new THREE.Vector3();
  fibres.forEach((f, fi) => {
    const p = f.p, n = p.length / 3; if (n < 2) return;
    const radial = radialOf(f);
    const tri = f.shape === 'trilobal' || f.shape === 'lobed';
    // a lobed section: r(φ) = r0·k·(1 + m·cos Nφ), k keeping the area (trilobal: N = 3, m = 0.3; coalesced elastane: N filaments, m small)
    const LN = f.shape === 'lobed' ? f.lobes : 3, TM = f.shape === 'lobed' ? f.lobeAmp : 0.3, TK = 1 / Math.sqrt(1 + (TM * TM) / 2);
    const asp = f.aspect || 1, a0 = f.rf * Math.sqrt(asp), b0 = f.rf / Math.sqrt(asp);
    const serr = f.fibre === 'viscose';
    // convolutions: the ribbon turns half a turn per convolution, reversing now and then
    let psi = fi * 1.7, sgn = 1, nextRev = 0.5 + ((fi * 0.37) % 1);
    let s = 0;
    // the first normal: perpendicular to the first tangent
    T.set(p[3] - p[0], p[4] - p[1], p[5] - p[2]).normalize();
    A.set(Math.abs(T.y) < 0.9 ? 0 : 1, Math.abs(T.y) < 0.9 ? 1 : 0, 0);
    Nn.crossVectors(T, A).normalize();
    // light that reaches a fibre falls off as it dives into the yarn (a cheap ambient occlusion)
    const filK = f.kind === 'filament' || f.kind === 'mono' || f.kind === 'cover' || f.kind === 'core';   // smooth filaments pass light on to their neighbours: less shadow
    const aoAt = (i) => (f.depth ? (filK ? 0.55 + 0.45 * Math.pow(f.depth[i], 1.3) : 0.32 + 0.68 * Math.pow(f.depth[i], 1.6)) : f.kind === 'body' ? 0.5 + 0.5 * Math.pow(f.u, 0.7) : 1);
    const taper = f.kind === 'hair';
    const base = v;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = Math.min(n - 1, i + 1) * 3;
      T.set(p[i1] - p[i0], p[i1 + 1] - p[i0 + 1], p[i1 + 2] - p[i0 + 2]).normalize();
      Nn.addScaledVector(T, -T.dot(Nn)).normalize();       // parallel transport
      B.crossVectors(T, Nn);
      if (i > 0) {
        const ds = Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
        s += ds;
        if (f.conv) { psi += sgn * Math.PI * f.conv * ds; if (s > nextRev) { sgn = -sgn; nextRev = s + 0.4 + ((fi * 0.61 + s) % 1) * 0.9; } }
      }
      let tf = taper ? Math.min(1, 0.25 + 0.75 * (n - 1 - i) / Math.max(1, n * 0.3)) : 1;
      // wool's scale edges and flax's nodes: the fibre's own size varies along it
      if (f.modAmp) tf *= 1 + f.modAmp * (((s / f.modPitch) % 1) - 0.5) * 2;
      if (f.nodeAmp) tf *= 1 + f.nodeAmp * Math.exp(-Math.pow((((s / f.nodePitch) % 1) - 0.5) / 0.08, 2));
      const ao = aoAt(i);
      const a = a0 * tf, b = b0 * tf, cp = Math.cos(psi), sp = Math.sin(psi);
      Pp.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      for (let j = 0; j <= radial; j++) {
        const ph = (2 * Math.PI * j) / radial, c = Math.cos(ph), sn = Math.sin(ph);
        let ex, ey, nx, ny;
        if (tri) {
          const rr = a * TK * (1 + TM * Math.cos(LN * ph)), dr = -LN * a * TK * TM * Math.sin(LN * ph);
          ex = rr * c; ey = rr * sn;
          const tx = dr * c - rr * sn, ty = dr * sn + rr * c;   // the outline's tangent; its normal points out
          nx = ty; ny = -tx;
        } else {
          const m = serr ? 1 + 0.09 * Math.sin(7 * ph) : 1;
          ex = a * c * m; ey = b * sn * m;
          nx = b * c; ny = a * sn;
        }
        const lx = ex * cp - ey * sp, ly = ex * sp + ey * cp;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const mx = nx * cp - ny * sp, my = nx * sp + ny * cp;
        const o = v * 3;
        pos[o] = Pp.x + Nn.x * lx + B.x * ly + xOffset; pos[o + 1] = Pp.y + Nn.y * lx + B.y * ly; pos[o + 2] = Pp.z + Nn.z * lx + B.z * ly;
        nor[o] = Nn.x * mx + B.x * my; nor[o + 1] = Nn.y * mx + B.y * my; nor[o + 2] = Nn.z * mx + B.z * my;
        uv[v * 2] = s / TILE_MM; uv[v * 2 + 1] = j / radial;
        col[o] = f.tone[0] * ao; col[o + 1] = f.tone[1] * ao; col[o + 2] = f.tone[2] * ao;
        v++;
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
      const q = base + i * (radial + 1) + j, w = q + radial + 1;
      idx[k++] = q; idx[k++] = w; idx[k++] = q + 1;
      idx[k++] = w; idx[k++] = w + 1; idx[k++] = q + 1;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

// filament lustre: the delustrant (TiO2) scatters light inside the polymer, so a bright
// filament is clear and mirror-smooth, a full-dull one chalky. A monofilament is a
// solid rod: bright is glass-clear (refractive index of the polymer), dull is milky.
const LUSTRE_LOOK = {
  bright:    { rough: 0.08, coat: 0.8, env: 2.2, trans: 1.0 },
  semi_dull: { rough: 0.24, coat: 0.35, env: 1.5, trans: 0.5 },
  full_dull: { rough: 0.55, coat: 0.0, env: 0.9, trans: 0.0 },
};
function filamentMaterial(meta, colour) {
  const L = LUSTRE_LOOK[meta.lustre] || LUSTRE_LOOK.semi_dull;
  const tri = meta.section === 'trilobal';
  const base = !colour || colour.toLowerCase() === '#f1ead9' ? '#f7f7f5' : colour;
  const mono = meta.system === 'mono';
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(base), vertexColors: true, metalness: 0,
    roughness: L.rough * (tri ? 0.7 : 1), clearcoat: L.coat, clearcoatRoughness: L.rough * 0.6,
    ior: meta.refractive_index || 1.57, specularIntensity: 1, envMapIntensity: L.env,
    // a lone clear rod lets the stage show through; its surface reflections stay bright
    // (the light that passes is not drawn, only what the rod gives back)
    transparent: mono && L.trans > 0, opacity: mono ? 1 - 0.8 * L.trans : 1, depthWrite: !(mono && L.trans > 0),
    normalMap: surfaceMap(), normalScale: new THREE.Vector2(0.06, 0.06),
  });
  m.normalMap.anisotropy = 8;
  return m;
}
// bare elastane is a clear, slightly hazy rubber: it lets the stage show through
function elastaneMaterial(meta) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xdfe3e8), vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, ior: meta.refractive_index || 1.5,
    envMapIntensity: 1.2, transparent: true, opacity: 0.5, depthWrite: false,
  });
}
// the cover yarn is a bright continuous filament (nylon or polyester)
const coverMeta = (meta) => ({ system: 'fdy', filament: true, lustre: 'bright', section: 'round', refractive_index: meta.cover_refractive_index || 1.565, diameter_mm: meta.diameter_mm });
function materialFor(meta, colour, roughScale) {
  if (meta.elastane === 'covered' || meta.elastane === 'dcovered') return filamentMaterial(coverMeta(meta), colour);
  const filament = meta.filament;
  if (filament) return filamentMaterial(meta, colour);
  const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.35,
    color: new THREE.Color(colour || '#f1ead9'), vertexColors: true,
    roughness: Math.max(0.12, Math.min(0.95, (filament ? (meta.system === 'fdy' ? 0.26 : 0.4) : meta.fibre === 'polyester_spun' ? 0.5 : 0.66) * (roughScale || 1))),   // the look engine's sheen, relative to a cotton yarn
    metalness: 0,
    sheen: filament ? 0.25 : 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xfff0dc).multiplyScalar(meta.mottled ? 0.12 : 0.4),   // a dyed fibre keeps its hue: less white haze
    clearcoat: filament ? 0.35 : 0, clearcoatRoughness: 0.3,
    normalMap: surfaceMap(), normalScale: new THREE.Vector2(0.55, 0.55),
  });
  m.normalMap.anisotropy = 8;
  return m;
}

// the reflections a glossy filament shows: a dark studio with two tall strip lights and a softbox
function studioEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x0c0d10, side: THREE.BackSide })));
  const panel = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.97), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(1.6, 22, -9, 0, 5, 14);     // tall strip, front left: the long highlight down a filament
  panel(1.2, 22, 9, 0, 3, 8);      // tall strip, right
  panel(10, 6, -3, 10, 6, 3);      // softbox above
  panel(6, 22, 0, 0, -12, 0.6);    // faint back wall
  const t = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  return t;
}

export class YarnView {
  constructor(host) {
    this.host = host;
    const w = host.clientWidth || 640, h = host.clientHeight || 440;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.style.display = 'block';
    host.appendChild(this.renderer.domElement);
    if (SURFACE) SURFACE.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.renderer.setClearColor(new THREE.Color(STAGE), 1);
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.0005, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 120;
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.redraw());
    this._unguard = window.KAViewGuard ? window.KAViewGuard.wheel(this.renderer.domElement, this.controls) : null;
    // light: a soft warm key from the upper left, a cool rim behind, a little fill
    this.scene.add(new THREE.HemisphereLight(0xfff3e2, 0x1b1712, 0.7));
    const key = new THREE.DirectionalLight(0xfff1de, 2.8); key.position.set(-7, 4, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xf2efe8, 1.1); rim.position.set(3, -2, -6); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(6, 1, 3); this.scene.add(fill);
    this.scene.add(this.camera);
    this.scene.environment = studioEnvironment(this.renderer);
    this.group = new THREE.Group(); this.scene.add(this.group);
    // overlays: labels for each yarn, and a scale bar that follows the zoom
    this.over = document.createElement('div');
    this.over.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:300 15px/1 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.08em;color:#eef0f3';
    host.appendChild(this.over);
    this.bar = document.createElement('div');
    this.bar.style.cssText = 'position:absolute;left:14px;bottom:12px;font:500 11px "IBM Plex Mono",ui-monospace,monospace;color:#e6e9ee;display:grid;gap:4px;pointer-events:none;background:rgba(30,34,41,.72);padding:6px 8px;border-radius:6px';
    host.appendChild(this.bar);
    this.labels = [];
    this.items = [];
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(host);
  }

  /**
   * @param list [{yarn:{fibre,type,tex,ply,filaments}, label}]
   * @param opt  {colour}
   * @returns the meta of every yarn drawn
   */
  draw(list, opt = {}) {
    this._clear();
    // yarns side by side share one length, so none ends short of the others
    const aspect = this.camera.aspect || 1.5;
    const D0 = Math.max(...list.map((it) => G.build(it.yarn, { lengthOnly: true }).diameter));
    // a slub or a flame is judged along its length: the view is as tall as the yarn shown, not 22 diameters
    const lens = list.map((it) => G.build(it.yarn, { lengthOnly: true }).length);
    const longView = list.some((it) => it.yarn.form === 'slub' || it.yarn.form === 'flame') ? Math.max(...lens) * 0.92 : 0;
    const need = Math.max(D0 * 22, list.length > 1 ? (list.length * D0 * 5) / aspect : 0, longView);   // the side view's height
    const L0 = Math.max(need / 0.88, ...list.map((it) => G.build(it.yarn, { lengthOnly: true }).length));
    const built = list.map((it) => ({ it, b: G.build(it.yarn, Object.assign(list.length > 1 ? { length: L0 } : {}, opt.cutaway ? { cutaway: true } : {})) }));
    const L = Math.max(...built.map((x) => x.b.length));
    const D = Math.max(...built.map((x) => x.b.meta.diameter_mm));
    // the side view is a macro shot: about 22 yarn diameters tall, the yarns
    // spread across the width (never closer than 6 diameters)
    const hSide = Math.min(L * 0.88, need);
    const gap = list.length > 1 ? Math.max(D * 5, (hSide * aspect * 0.92) / list.length) : 0;
    this.L = L; this.D = D; this.gap = gap; this.n = list.length; this.hSide = hSide;
    built.forEach((x, i) => {
      const xo = (i - (list.length - 1) / 2) * gap;
      const m = x.b.meta;
      const clearRod = (geo, mat, rough, env) => {           // a see-through rod and its reflections, added at full strength on top
        const mesh = new THREE.Mesh(geo, mat);
        const glint = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
          color: 0x000000, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.04, ior: m.refractive_index || 1.5,
          envMapIntensity: env, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glint.renderOrder = 2; mesh.add(glint); mesh.userData.glint = glint;
        return mesh;
      };
      const parts = [];
      if (m.elastane) {
        const core = x.b.fibres.filter((q) => q.kind === 'core'), rest = x.b.fibres.filter((q) => q.kind !== 'core');
        if (core.length) { const mc = clearRod(fibresGeometry(core, xo), elastaneMaterial(m), 0.16, 1.8); mc.renderOrder = 1; parts.push(mc); }
        if (rest.length) parts.push(new THREE.Mesh(fibresGeometry(rest, xo), materialFor(m, opt.colour)));
      } else {
        const geo = fibresGeometry(x.b.fibres, xo);
        // a lone clear rod: its reflections are added at full strength over the see-through body
        if (m.filament && m.system === 'mono' && m.lustre !== 'full_dull') parts.push(clearRod(geo, materialFor(m, m.mottled ? '#ffffff' : opt.colour, opt.roughScale), m.lustre === 'bright' ? 0.05 : 0.2, m.lustre === 'bright' ? 2.4 : 1.2));
        else parts.push(new THREE.Mesh(geo, materialFor(m, m.mottled ? '#ffffff' : opt.colour, opt.roughScale)));
      }
      // centre the yarn's length on y = 0
      parts.forEach((p) => { p.position.y = -x.b.length / 2; this.group.add(p); });
      this.items.push({ parts, x: xo, meta: x.b.meta, label: x.it.label });
      if (x.it.label) {
        const el = document.createElement('div');
        el.textContent = x.it.label.toUpperCase();
        el.style.cssText = 'position:absolute;transform:translate(-100%,-50%);white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.5)';
        this.over.appendChild(el); this.labels.push({ el, x: xo });
      }
    });
    const resized = (this._lastD && Math.abs(D / this._lastD - 1) > 0.1) || (this._lastL && Math.abs(L / this._lastL - 1) > 0.15);   // a different size or length of yarn is framed afresh
    this._lastD = D; this._lastL = L;
    if (!this._viewed || this._lastN !== list.length || resized) { this.view('side'); this._viewed = true; } else this.redraw();
    this._lastN = list.length;
    this._resize();                                      // the host may have changed height since the renderer was made
    return this.items.map((x) => x.meta);
  }

  /** side: every yarn whole · close: a few twist turns · fibre: the surface fibres */
  view(kind) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1.5;
    const L = this.L || 6, W = this.n > 1 ? this.gap * this.n : 0;
    let h;
    if (kind === 'close') h = Math.max(this.D * 9, 0.6);
    else if (kind === 'fibre') h = Math.max(this.D * 1.6, 0.12);
    else h = Math.max(this.hSide || L * 0.94, (W / aspect) * 1.02);
    const x = kind === 'side' || this.n <= 1 ? 0 : this.items[0].x;    // close-ups look at the first yarn
    const target = new THREE.Vector3(kind === 'fibre' ? x + this.D * 0.3 : x, 0, 0);
    const dist = h / 2 / Math.tan(fov / 2);
    this.controls.target.copy(target);
    this.camera.position.set(target.x, target.y + dist * 0.02, dist);
    this.camera.near = Math.max(0.0002, dist / 400);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.redraw();
  }

  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const dist = this.camera.position.distanceTo(this.controls.target);
      const near = Math.max(0.0002, dist / 400);
      if (Math.abs(near - this.camera.near) / this.camera.near > 0.2) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
      this.renderer.render(this.scene, this.camera);
      this._overlay(dist);
    });
  }

  _overlay(dist) {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    // labels: beside each yarn when there is room (as on a yarn board), else above it
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    a.set(0, 0, 0).project(this.camera); b.set(this.gap || 1, 0, 0).project(this.camera);
    const gapPx = Math.abs(b.x - a.x) * w / 2;
    const beside = gapPx > 170;
    this.labels.forEach((lb) => {
      v.set(lb.x - (beside ? this.gap * 0.14 : 0), 0, 0).project(this.camera);
      const x = ((v.x + 1) / 2) * w;
      const on = v.z < 1 && x > -40 && x < w + 40;
      lb.el.style.display = on ? 'block' : 'none';
      lb.el.style.left = x + 'px';
      lb.el.style.top = beside ? ((1 - v.y) / 2) * h + 'px' : '22px';
      lb.el.style.transform = beside ? 'translate(-100%,-50%)' : 'translate(-50%,0)';
      lb.el.style.fontSize = beside ? '15px' : '12px';
      lb.el.style.background = beside ? 'none' : 'rgba(39,44,52,.75)';
      lb.el.style.padding = beside ? '0' : '3px 6px';
    });
    // scale bar: mm per pixel at the target's distance
    const visH = 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360);
    const pxPerMm = h / visH;
    const steps = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005];
    const len = steps.find((s) => s * pxPerMm <= w * 0.22) || steps[steps.length - 1];
    const txt = len >= 1 ? len + ' mm' : Math.round(len * 1000) + ' µm';
    this.bar.innerHTML = '<span>' + txt + '</span><span style="display:block;height:2px;background:#d6dae0;width:' + Math.round(len * pxPerMm) + 'px"></span>';
  }

  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.redraw();
  }

  _clear() {
    this.items.forEach((x) => x.parts.forEach((p) => { p.geometry.dispose(); p.material.dispose(); if (p.userData.glint) p.userData.glint.material.dispose(); this.group.remove(p); }));
    this.items = [];
    this.labels.forEach((l) => l.el.remove()); this.labels = [];
  }

  dispose() {
    this._clear();
    if (this._unguard) this._unguard();
    this._ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove(); this.over.remove(); this.bar.remove();
  }
}
