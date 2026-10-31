// KnitAdvisor · knit3d — WebGL renderer / lifecycle.
//
// Public API is a drop-in replacement for the previous Fabric3D class so the
// visualiser only needs to swap the import:
//   mount(container, opts) · setColor(hex) · setView('front'|'back') ·
//   resetView() · toggleWire() · resize() · dispose()
//
// opts (from FabricVisualizer._render3DView):
//   { dyed:{r,g,b}, construction:{type,ribRepeat,...}, countNe, tf,
//     fiberType, sheen, sample(w,c) -> 'knit'|'purl'|'tuck'|'miss' }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { buildYarnPaths, floatAnchorsFromPaths, structureRepeat } from './topology-builder.js?v=20260608g';
import { bakeStructure, ClothSurface, fibreSurfaceTexture, wavePhase, melangeMaterial } from './macro.js?v=20260608g';
import { ClothSim } from './cloth-physics.js?v=20260608g';
import { fabricBody, fabricMechanics } from './fabric-body.js?v=20260608g';
import { hash2 } from './noise.js?v=20260608g';
import { buildNap } from './nap.js?v=20260608g';
import { fibreGeometry } from './hairiness.js?v=20260608g';
import { createYarnMaterial, setYarnColorHex, twistPitch, applyYarnLook } from './yarn-material.js?v=20260608g';
import { finishedLook, greigeLook, GREIGE_HEX } from './finish-profile.js?v=20260608g';
import { patchDye, melangeSplit } from './dye-shader.js?v=20260608g';
import { buildFabricMesh, yarnRadius } from './fabric-mesh.js?v=20260608g';
import { addStudioLighting, configureShadowCamera, applyLightPreset, DEFAULT_LIGHT_PRESET, buildStudioEnvironment } from './lighting.js?v=20260608g';
import { buildPile } from './pile.js?v=20260608g';
import { buildHairiness } from './hairiness.js?v=20260608g';
import { applyDrape } from './drape.js?v=20260608g';
import { BACKING, PITCH_Y, RIB_PITCH_SCALE } from './constants.js?v=20260608g';

const VIEW_HEIGHT = 380;

export class Knit3D {
  constructor() {
    this._raf = null;
    this._ro = null;
    this._disposed = false;
  }

  mount(container, opts) {
    this.container = container;
    this.opts = opts || {};

    const W = container.clientWidth || 460;
    const H = VIEW_HEIGHT;

    // Real shadows (microfiber self-shadowing) on capable viewports; disabled on
    // the low-LOD tier (small / low-DPR) to stay smooth.
    this._shadows = this._lodScale() >= 0.85;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: reproduces the base (dyed) colour faithfully and
    // only rolls off highlights. ACES Filmic shifted hue and desaturated mid
    // tones — wrong for a tool whose whole point is showing a shade.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (this._shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    renderer.domElement.style.cssText =
      'width:100%;height:380px;display:block;border-radius:12px;cursor:grab;';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const lights = addStudioLighting(scene, this._shadows);
    // Studio room as image-based light — real specular glints on every loop.
    this._envTarget = buildStudioEnvironment(renderer);
    scene.environment = this._envTarget.texture;
    scene.environmentIntensity = 0.75;
    this._key = lights.key;
    this._fill = lights.fill;
    this._rim = lights.rim;
    this._hemi = lights.hemi;
    this._lightPreset = DEFAULT_LIGHT_PRESET;
    // authored ("front") Z positions — _setLightSide mirrors these across the
    // fabric when a free orbit carries the CAMERA past the edge, so whichever
    // side faces it gets the strong key light instead of the rim's leftover
    // intensity aimed the wrong way.
    this._lightBaseZ = { key: this._key.position.z, fill: this._fill.position.z, rim: this._rim.position.z };
    this._keyDir = this._key.position.clone().normalize();
    this._showingBack = false;

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    this._buildFabric();
    if (this._macro) {
      camera.far = Math.max(200, this._distForWidth(this._macro.fullW) * 4);
      camera.updateProjectionMatrix();
      if (this._shadows) this._key.shadow.mapSize.set(2048, 2048);
    }
    if (this._shadows) this._fitShadow(this._size);

    // Default view BEFORE OrbitControls so it becomes the saved reset state:
    // a swatch lying on a table seen from a seated viewer (24° down, a touch
    // off-axis), not a dead-on orthographic stare — head-on, loop relief
    // collapses into a flat pattern; at an angle the over/under depth and
    // the yarn's roundness read at first glance.
    // Slightly inside the flat-on cover distance: tilted, the far edge
    // foreshortens and would otherwise pull the swatch's border into frame.
    // With a macro view, the default is the whole cloth at ~14 cm across —
    // how a fabric is actually first looked at; zooming in reaches the loops.
    const el = 24 * Math.PI / 180, az = 8 * Math.PI / 180;
    const d0 = this._macro ? this._distForWidth(this._macro.viewW) : this._fitDist * 0.8;
    camera.position.set(
      d0 * Math.sin(az) * Math.cos(el),
      -d0 * Math.sin(el),
      d0 * Math.cos(az) * Math.cos(el),
    );
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.85;
    // Close enough to actually resolve individual fibres (the 'ultra' LOD
    // tier in _applyLod below), not just the loop shapes — floored so a very
    // small/low-LOD patch can never let the camera clip through the yarn.
    controls.minDistance = Math.max(0.6, this._fitDist * 0.12);
    controls.maxDistance = this._macro ? this._distForWidth(this._macro.fullW) : this._fitDist * 2.2;
    if (this._macro) {
      // ~25x of zoom range (whole cloth → single fibres): faster wheel steps,
      // and no panning — the zoom always dives into the point where the
      // loop model sits.
      controls.zoomSpeed = 2.2;
      controls.enablePan = false;
    }
    controls.target.set(0, 0, 0);
    controls.update();
    controls.saveState();
    this.controls = controls;
    this._applyMode();

    // real camera-distance LOD: boost fibre relief up close, soften far away
    // (cheap material-tier swap — only touched on tier transitions)
    this._lodTier = 'mid';
    controls.addEventListener('change', () => {
      this._applyMode();
      this._applyLod();
      // Free-orbiting (not just the Front/Back buttons) can carry the camera
      // past the fabric's edge into "looking at the back" territory — re-side
      // the lights off the camera's ACTUAL hemisphere, not just button state,
      // so a manual drag-around never lands on the same near-black view the
      // Back button used to produce.
      this._setLightSide(this.camera.position.z < 0);
      this._syncBacking();
    });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    if (this._macro) this._initHandling();

    const tick = () => {
      if (this._disposed) return;
      this._stepCloth();
      controls.update();
      renderer.render(scene, camera);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ── Handling the cloth (cloth-physics.js) ───────────────────────────────
  // With "Handle" on, dragging the cloth lifts, pulls or folds it (Shift
  // slides it along the table); right-drag still orbits. The simulation is
  // created on first use and sleeps whenever the cloth is still.
  _initHandling() {
    const el = this.renderer.domElement;
    this._handle = false;
    this._raycaster = new THREE.Raycaster();
    const ndcOf = (e) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, px: e.clientX - r.left, py: e.clientY - r.top, w: r.width, h: r.height };
    };
    this._onDown = (e) => {
      if (!this._canHandle() || e.button !== 0) return;
      const pick = this._pick(ndcOf(e));
      if (pick < 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      this._startGrab(pick, ndcOf(e), e.shiftKey);
      el.style.cursor = 'grabbing';
    };
    this._onMove = (e) => {
      if (this._grab) { this._moveGrab(ndcOf(e)); return; }
      if (!this._canHandle() || e.buttons) return;
      el.style.cursor = this._pick(ndcOf(e)) >= 0 ? 'grab' : '';
    };
    this._onUp = (e) => {
      if (!this._grab) return;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      this._endGrab();
      el.style.cursor = this._canHandle() ? 'grab' : '';
    };
    // capture phase: decide before OrbitControls sees the press
    el.addEventListener('pointerdown', this._onDown, true);
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointercancel', this._onUp);
    el.addEventListener('contextmenu', (e) => { if (this._handle) e.preventDefault(); });
  }

  get hasCloth() { return !!this._macro; }

  /** Toggle cloth handling; returns the new state. */
  toggleHandle() {
    this._handle = !this._handle;
    if (this.controls) {
      // right-drag orbits while handling (left drags the cloth)
      this.controls.mouseButtons.RIGHT = this._handle ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    }
    if (!this._handle) this.renderer.domElement.style.cursor = '';
    return this._handle;
  }

  // Only the face-up cloth, seen from above, in the macro view.
  _canHandle() {
    return this._handle && this._macro && this._mode === 'macro' && !this._stretch &&
      this._pivot.rotation.y === 0;
  }

  _ensureSim() {
    if (this._sim) return this._sim;
    const m = this._macro;
    const { flat, init } = m.cloth.simGrids();
    const mech = fabricMechanics({
      gsm: this.opts.gsm, construction: this.opts.construction, fiberType: this.opts.fiberType,
      elastanePct: this.opts.elastanePct, physics: this.opts.physics, tf: this.opts.tf,
      fibreRecovery1: this.opts.fibreRecovery1,
    }, this.body);
    this._mech = mech;
    this._sim = new ClothSim({
      nx: m.cloth.snx, ny: m.cloth.sny, h: m.cloth.sh, unit: m.cm * 100,
      init, flat, mech, substeps: this._shadows ? 24 : 16,
    });
    return this._sim;
  }

  // Nearest particle under the pointer (within ~20 px), front-most layer.
  _pick(ndc) {
    const m = this._macro;
    const pts = this._sim ? this._sim.x : (this._simInit || (this._simInit = m.cloth.simGrids().init));
    const M = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(m.group.matrixWorld);
    const e = M.elements;
    const r2 = Math.pow(20 / (ndc.w * 0.5), 2);
    let best = -1, bestZ = Infinity, bestD = Infinity;
    for (let p = 0, n = pts.length / 3; p < n; p++) {
      const x = pts[p * 3], y = pts[p * 3 + 1], z = pts[p * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const dx = sx - ndc.x, dy = (sy - ndc.y) * (ndc.h / ndc.w);
      const d = dx * dx + dy * dy;
      if (d > r2) continue;
      const sz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      // prefer the nearer layer; within a layer, the closer particle
      if (sz < bestZ - 1e-4 || (Math.abs(sz - bestZ) <= 1e-4 && d < bestD)) { best = p; bestZ = sz; bestD = d; }
    }
    return best;
  }

  _startGrab(p, ndc, slide) {
    const sim = this._ensureSim();
    const { nx, ny } = sim;
    const ip = p % nx, jp = (p / nx) | 0;
    // a fingertip-sized grip (~1.2 cm each way), not a single point: the
    // lifted weight spreads over it, as it does in a real pinch
    const r = Math.max(1, Math.round(1.2 * this._macro.cm / sim.h));
    const idx = [];
    for (let j = Math.max(0, jp - r); j <= Math.min(ny - 1, jp + r); j++) {
      for (let i = Math.max(0, ip - r); i <= Math.min(nx - 1, ip + r); i++) idx.push(j * nx + i);
    }
    const o = [sim.x[p * 3], sim.x[p * 3 + 1], sim.x[p * 3 + 2]];
    const g = sim.pin(idx, o, p);
    g.held = true;
    // Drag plane through the grabbed point: facing the camera (lift and
    // fold), or the table's own plane with Shift (slide).
    const mw = this._macro.group.matrixWorld;
    const pw = new THREE.Vector3(...o).applyMatrix4(mw);
    const nrm = slide
      ? new THREE.Vector3(0, 0, 1).transformDirection(mw)
      : this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this._grab = { g, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, pw) };
    this.controls.enabled = false;
  }

  _moveGrab(ndc) {
    const gr = this._grab;
    this._raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hit = this._raycaster.ray.intersectPlane(gr.plane, new THREE.Vector3());
    if (!hit) return;
    const local = this._macro.group.worldToLocal(hit);
    gr.g.goal = [local.x, local.y, Math.max(0, local.z)];
    this._sim.wake();
  }

  _endGrab() {
    this._sim.unpin(this._grab.g);
    this._grab = null;
    this.controls.enabled = true;
  }

  _stepCloth() {
    const sim = this._sim;
    if (this._stretch) this._stretchTick();
    if (!sim || !sim.step()) { this._followTarget(); return; }
    this._macro.cloth.setFromSim(sim.x);
    this._syncAnchor();
    this._followTarget();
  }

  // Loop model rides the cloth at the dive point (the origin of the flat
  // layout): moved, tilted and stretched with it.
  _syncAnchor() {
    const sim = this._sim, a = this._anchor;
    if (!sim || !a) return;
    const c = this._macro.cloth;
    const fi = (0 - c.p.minX) / c.sh, fj = (0 - c.p.minY) / c.sh;
    const i0 = Math.max(0, Math.min(c.snx - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(c.sny - 2, Math.floor(fj)));
    const fx = fi - i0, fy = fj - j0, nx = c.snx, X = sim.x;
    const P = (i, j) => new THREE.Vector3(X[(j * nx + i) * 3], X[(j * nx + i) * 3 + 1], X[(j * nx + i) * 3 + 2]);
    const p00 = P(i0, j0), p10 = P(i0 + 1, j0), p01 = P(i0, j0 + 1), p11 = P(i0 + 1, j0 + 1);
    const pos = p00.clone().multiplyScalar((1 - fx) * (1 - fy)).addScaledVector(p10, fx * (1 - fy))
      .addScaledVector(p01, (1 - fx) * fy).addScaledVector(p11, fx * fy);
    const du = p10.clone().sub(p00).multiplyScalar(1 - fy).addScaledVector(p11.clone().sub(p01), fy);
    const dv = p01.clone().sub(p00).multiplyScalar(1 - fx).addScaledVector(p11.clone().sub(p10), fx);
    const sx = du.length() / c.sh, sy = dv.length() / c.sh;
    const t = du.clone().normalize();
    const n = du.clone().cross(dv).normalize();
    const b = n.clone().cross(t);
    a.position.copy(pos);
    a.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, b, n));
    a.scale.set(sx, sy, 1);
    this._anchorMoved = true;
  }

  // Keep the orbit / zoom centre on the cloth's dive point once it settles,
  // so zooming in still lands on the loops wherever the cloth went.
  _followTarget() {
    if (!this._anchorMoved || !this.controls || this._grab) return;
    const goal = this._anchor.getWorldPosition(new THREE.Vector3());
    const tgt = this.controls.target;
    const d = goal.distanceTo(tgt);
    if (d < 1e-3) { this._anchorMoved = !!(this._sim && !this._sim.asleep); return; }
    const delta = goal.sub(tgt).multiplyScalar(Math.min(1, 0.12 + (d < 0.05 ? 1 : 0)));
    tgt.add(delta);
    this.camera.position.add(delta);
  }

  /** Back to the laid-out cloth (authored pose), sleeping. */
  resetCloth() {
    this._stretch = null;
    if (this._stretchUi) this._stretchUi.style.display = 'none';
    if (this._grab) this._endGrab();
    if (this._sim) this._sim.reset();
    if (this._macro) this._macro.cloth.setAuthored();
    if (this._anchor) { this._anchor.position.set(0, 0, 0); this._anchor.quaternion.identity(); this._anchor.scale.set(1, 1, 1); }
    this._anchorMoved = false;
  }

  // ── Stretch test ──────────────────────────────────────────────────────
  // Lay the cloth flat, clamp its two side edges, pull across the width to
  // the stretch the fabric reaches at the standard load (fabricMechanics),
  // hold, release the moving clamp, and let it recover. The growth that
  // remains is the (estimated) unrecovered part. Zoom in during or after it
  // and the loops are stretched with the cloth.
  stretchTest() {
    if (!this._macro) return;
    if (this._grab) this._endGrab();
    const sim = this._ensureSim();
    sim.reset(sim.flat);
    this._macro.cloth.setFromSim(sim.x);
    const mech = this._mech;
    sim.muTable = 0;                                // slides freely between the clamps
    sim.limX = Math.max(0.03, mech.stretchX * 1.35);
    const { nx, ny } = sim;
    const left = [], right = [];
    for (let j = 0; j < ny; j++) { left.push(j * nx); right.push(j * nx + nx - 1); }
    const gl = sim.pin(left, [sim.x[0], sim.x[1], sim.x[2]]);
    const r0 = [sim.x[(nx - 1) * 3], sim.x[(nx - 1) * 3 + 1], sim.x[(nx - 1) * 3 + 2]];
    const gr = sim.pin(right, r0);
    gl.held = gr.held = true;
    const W = (nx - 1) * sim.h;
    this._stretch = { t0: performance.now(), gl, gr, r0, W, phase: 'pull' };
    this._showStretch(`Pulling across the width… (estimate)`);
  }

  _stretchTick() {
    const st = this._stretch, sim = this._sim, mech = this._mech;
    const t = (performance.now() - st.t0) / 1000;
    const ease = (u) => u * u * (3 - 2 * u);
    if (st.phase === 'pull') {
      const u = Math.min(1, t / 1.4);
      st.gr.goal = [st.r0[0] + st.W * mech.stretchX * ease(u), st.r0[1], st.r0[2]];
      this._showStretch(`Stretch ${Math.round(mech.stretchX * 100 * ease(u))}% across the width at the standard load (estimate)`);
      if (t > 2.4) {
        // release: what does not recover stays as growth (longer rest length)
        st.phase = 'recover';
        const growth = mech.stretchX * (1 - mech.recovery);
        const diag = Math.sqrt(((1 + growth) * (1 + growth) + 1) / 2);
        for (let c = 0; c < sim.dK.length; c++) {
          if (sim.dK[c] === 0) sim.dL[c] = sim.dL0[c] * (1 + growth);
          else if (sim.dK[c] === 2) sim.dL[c] = sim.dL0[c] * diag;
        }
        sim.unpin(st.gr);
        st.t1 = t;
      }
    } else if (st.phase === 'recover' && t - st.t1 > 2.5) {
      sim.unpin(st.gl);
      sim.muTable = mech.frictionTable;
      st.phase = 'done';
      this._showStretch(`Stretched ${Math.round(mech.stretchX * 100)}% across the width · recovered ${Math.round(mech.recovery * 100)}% · ${(mech.stretchX * (1 - mech.recovery) * 100).toFixed(1)}% growth remains (estimate — ⟳ to reset)`);
      this._stretch = null;
    }
  }

  _showStretch(text) {
    if (!this._stretchUi) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:10px;bottom:10px;max-width:calc(100% - 20px);padding:5px 9px;border-radius:7px;' +
        'background:rgba(15,18,24,.72);color:#fff;font:11px/1.35 var(--mono,monospace);pointer-events:none;';
      if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
      this.container.appendChild(d);
      this._stretchUi = d;
    }
    this._stretchUi.textContent = text;
    this._stretchUi.style.display = '';
  }

  _buildFabric() {
    const { material, melField, textures } = createYarnMaterial({
      dyed: this.opts.dyed,
      fiberType: this.opts.fiberType,
      physics: this.opts.physics,
      twist: this.opts.twist,
    });
    this._material = material;
    this._textures = textures;
    this._melField = melField;

    // Knitting → dyeing → finishing. The As-Knit state is the greige cloth
    // off the machine: raw fibre colour (unless the yarn was coloured before
    // knitting, as in a melange), natural hairiness, no finish. Finished =
    // dyed by the real dyeing route, with the real finish (finish-profile.js).
    const d = this.opts.dyed || { r: 120, g: 124, b: 134 };
    this._dyeHex = '#' + [d.r, d.g, d.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    this._melange = !!this.opts.melange;
    this._rawHex = GREIGE_HEX[this.opts.fiberType] || GREIGE_HEX.cotton;
    // A melange is spun from fibres coloured BEFORE knitting, so its greige
    // already shows the mix; piece-dyed cloth comes off the machine raw.
    this._greigeHex = this._melange ? null : this._rawHex;
    this._finishLook = finishedLook(this.opts.physics && this.opts.physics.finish_id, this.opts.dyeMethod);
    this._greigeLook = greigeLook();
    this._dyeUniforms = [patchDye(material, { exposure: 'attr', melMode: 'threshold', melMap: melField })];

    // Size the patch to the viewport so the cloth FILLS the frame (no floating
    // square): build it landscape to match the canvas aspect, denser on big
    // screens, lighter on small/low-DPR devices (LOD) so weak GPUs stay smooth.
    // Real stitch density (GSM·gauge·loop-length) drives loop height + how many
    // stitches to show, so a tight 350gsm reads denser than a loose 150gsm.
    const con = this.opts.construction || {};
    this.body = fabricBody({
      gsm: this.opts.gsm, construction: con, fiberType: this.opts.fiberType,
      elastanePct: this.opts.elastanePct, physics: this.opts.physics,
      countNe: this.opts.countNe, loopNe: this.opts.loopNe,
    });
    const DENSITY_DEFAULTS = { aspect: 1.22, scalar: 1, wpc: 9, tex: 20 };
    // A denier-based warp-knit fabric (tricot/spacer/...) has no real
    // wales/courses-per-cm to report, so the caller's density.aspect/scalar
    // arrive NaN rather than absent — `this.opts.density || DEFAULTS` only
    // catches a missing object, not NaN fields inside a present one, and an
    // unguarded NaN here poisons pitchY/courses/wales below (every warp path
    // built from a NaN pitchY gets a NaN Y coordinate, which crashes
    // TubeGeometry's Frenet-frame computation and silently falls back to the
    // flat cube renderer — see fabric-visualizer.js's mount().catch()).
    const rawDensity = this.opts.density || DENSITY_DEFAULTS;
    const density = {
      ...rawDensity,
      aspect: Number.isFinite(rawDensity.aspect) ? rawDensity.aspect : DENSITY_DEFAULTS.aspect,
      scalar: Number.isFinite(rawDensity.scalar) ? rawDensity.scalar : DENSITY_DEFAULTS.scalar,
    };
    const aspect = this.camera.aspect || 1.8;
    const lod = this._lodScale();
    // 3-thread fleece now builds a real second (binding+fleecy) course per
    // row alongside the face course — same point-count order as interlock's
    // two beds, so both the stitch-count cap and the base density below
    // treat it the same way.
    const isFleece3Thread = con.type === 'fleece' && con.pile === 'brush';
    // The binding+fleecy course doubles the path count the same way
    // interlock's second bed does, so it needs the same cap treatment —
    // a lighter cap here let the stitch grid grow enough to stall the main
    // thread building the pile instances (found while tuning nap density).
    const beds = (con.type === 'interlock' || isFleece3Thread) ? 2 : 1;

    // effective course spacing (loop height): taller when loose (low cpc/wpc)
    const ribComp = con.type === 'rib' ? 1 / RIB_PITCH_SCALE : 1;
    // A piqué's held loops pull its courses closer than a jersey's (the
    // engine solves its courses from the GSM), so its cap is a little higher.
    const pitchY = PITCH_Y * (1 / Math.max(0.6, Math.min(density.aspect, this.opts.pique ? 1.75 : 1.6)));

    // Stitch count that actually FILLS the frame, not a wide-shot of the whole
    // swatch: at the old baseCourses (40/30), the "cover" framing packed
    // ~40-70 stitches into a 380px-tall canvas — under 10px per stitch, which
    // put the yarn radius (already clamped to 0.10-0.30 local units) and the
    // pile fibre radius (as low as 0.1 units) at UNDER 1 screen pixel. No
    // amount of material/normal-map/pile-density tuning can make sub-pixel
    // geometry read as detail — it just aliases into flat noise (front) or
    // near-invisible specks (the brushed-pile back). Real macro fabric
    // photography shows a handful of stitches filling the frame, not dozens;
    // matching that (roughly a 2.5x reduction) puts each stitch at 20px+ and
    // the yarn/pile radius at a legible several px.
    const baseCourses = (con.type === 'interlock' || isFleece3Thread) ? 12 : 16;
    let courses = Math.max(10, Math.round(baseCourses * lod * density.scalar));
    let wales = Math.max(12, Math.round(courses * pitchY * aspect * ribComp));
    // performance cap — keep total stitches bounded; shrink loops, not the count
    const CAP = 900;
    if (wales * courses * beds > CAP) {
      const k = Math.sqrt(CAP / (wales * courses * beds));
      courses = Math.max(12, Math.round(courses * k));
      wales = Math.max(14, Math.round(wales * k));
    }

    const radius = yarnRadius(this.opts.countNe, this.opts.tf, density);
    const { paths, floatAnchors } = buildYarnPaths({
      construction: con, sample: this.opts.sample, sampleBack: this.opts.sampleBack,
      pattern: this.opts.pattern, wales, courses, pitchY,
      pique: this.opts.pique, yarnRadius: radius,
    });
    // Real 3-thread fleece (see topology-builder.js): the binding+fleecy
    // yarn's floats already give the back real structural coverage, so the
    // flat opaque "backing board" every other construction needs (to hide
    // see-through gaps) is not just unnecessary here, it is exactly the flat
    // slab artefact the realism review flagged — a real fabric has no such
    // extra opaque layer, the floats and the brushed nap ARE the backing.
    const skipFlatBacking = !!floatAnchors;

    // drape — a real coarse cloth relaxation (cloth-sim.js) for the macro
    // bulge/sag, plus a small procedural wrinkle on top for yarn-scale
    // detail. Heavier / denser / double-bed fabrics drape less.
    const doubleBed = con.type === 'interlock' || con.type === 'rib';
    const drapeAmount = Math.max(0.2, Math.min(
      0.72 - (density.scalar - 1) * 0.35 - (doubleBed ? 0.15 : 0), 0.75));
    applyDrape(paths, { amount: drapeAmount, wales, courses });
    // Nap roots from the floats' real, post-drape positions.
    const anchors = floatAnchors ? floatAnchorsFromPaths(paths) : null;

    // The fleecy yarn is its own, much coarser count (e.g. 10-16 Ne behind a
    // 30 Ne face): yarn diameter ∝ 1/√Ne, so it renders √(face/loop) thicker.
    // Drawn at the face yarn's thickness it left the back thin and the face
    // see-through.
    const fleecyScale = this.opts.loopNe && this.opts.countNe
      ? Math.max(1, Math.min(2.2, Math.sqrt(this.opts.countNe / this.opts.loopNe)))
      : 1.37;
    // Tie-in binder (fine filament, e.g. 75D ≈ 71 Ne) — √(face/binder) thinner.
    const binderScale = this.opts.tieNe && this.opts.countNe
      ? Math.max(0.35, Math.min(1, Math.sqrt(this.opts.countNe / this.opts.tieNe)))
      : 0.65;
    this._applyYarnScales = (ps) => {
      for (const p of ps) {
        if (p.role === 'fleecy') p.radiusScale = fleecyScale;
        else if (p.role === 'binder') p.radiusScale = binderScale;
      }
    };
    this._applyYarnScales(paths);
    this._fleecyRadius = radius * fleecyScale;
    const group = buildFabricMesh(paths, material, {
      radius, radialSegments: 10, shadows: this._shadows,  // rounder cross-section — a hexagonal tube facets badly now that zooming in close is possible
      fiberType: this.opts.fiberType,
      twistPitch: twistPitch(radius, this.opts.twist),
    });
    this.group = group;

    // measure the loops, then add an opaque backing so the swatch has body and
    // the valleys / eyelets read as dark shadow instead of see-through gaps.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._addHairiness(group, radius);
    // Compute the pile's sizing ONCE — the backing plane must sit behind the
    // pile's full reach (fibres can extend well past the bare loop mesh), or
    // the "flip to back" view stares straight into an opaque backing instead
    // of the brushed nap (previously the backing only cleared the plain loop
    // geometry, so it silently occluded most/all of the pile from behind).
    const pileParams = this._pileParams(radius);
    // Fleece (nap path): the backing sits directly behind the floats and only
    // shows in the As-Knit state — the dark yarn mass a real greige fleece's
    // gaps show — and hands over to the nap's own solid root once brushed
    // (see _syncBacking). It is inset (BACKING.pad < 1), so no slab edge.
    const napPath = !!(anchors && anchors.length && pileParams);
    this._backingYieldsToNap = napPath;
    if (!skipFlatBacking || napPath) {
      this._addBacking(group, center, size, radius, box, napPath ? 0 : (pileParams ? pileParams.maxReach : 0));
    }
    if (napPath) {
      this._addNap(group, paths, anchors, pileParams);
    } else {
      this._addPile(group, box, pileParams, null);
    }
    this._syncBacking();
    this._addGrainline(group, box, size);

    // centre on the loops + fit so the fabric COVERS the frame (fills edge-to-edge)
    group.position.sub(center);

    // setView('back') needs to spin the fabric 180° around its own visual
    // centre — but `group`'s own local origin is nowhere near that centre
    // (its children's authored coordinates run ~0..wales·PITCH_X, and the
    // centring above works by offsetting `group`'s POSITION, not by moving
    // its children to straddle zero). Object3D.rotation always turns around
    // the LOCAL origin, so rotating `group` directly span the patch around
    // one edge, flinging most of it off-frame. A pivot wrapper fixes this:
    // `group` sits inside it already centred (offset by -center, same as
    // before), so the PIVOT's own local origin — the thing rotation.y
    // actually turns around — now coincides with the fabric's visual centre.
    const pivot = new THREE.Group();
    // The loop model rides on the cloth at the dive point: when the cloth is
    // moved, folded or stretched, the anchor carries the loops with it —
    // stretched loops included (see _syncAnchor). Identity at rest.
    const anchor = new THREE.Group();
    anchor.add(group);
    pivot.add(anchor);
    this._anchor = anchor;
    this._pivot = pivot;
    this.scene.add(pivot);

    this._size = size;
    this._fitDist = this._coverDistance(size);
    this._buildMacro({ con, density, pitchY, radius, center });
    this._applyStage(true);
  }

  // ── Macro view (macro.js) ──────────────────────────────────────────────
  // A full piece of cloth at real size, textured with maps baked from one
  // repeat of this same structure. It is the default view; the loop model
  // above takes over once the camera comes close enough (_applyMode).
  _buildMacro({ con, density, pitchY, radius, center }) {
    this._macro = null;
    const wpc = density && density.wpc;
    const rep = structureRepeat(con, this.opts.pattern);
    if (!rep || !(wpc > 0)) return;            // no fixed repeat / no real stitch size

    // Tile: a whole number of repeats, at least ~6 units each way, with a
    // margin of whole repeats around it so every yarn in the tile has its
    // real neighbours (crossings, occlusion) on all sides.
    //
    // The repeat count is a power of two whenever the repeat itself is, so
    // the power-of-two bake (macro.js) gives every stitch a whole power-of-two
    // number of texels: each mip level then averages whole stitches. With
    // 6 wales in 256 texels (42.7 each) the mips beat against the stitch and
    // the whole cloth shows a false grid at the tile period.
    const TILE_MIN = 6;
    const isPot = (n) => (n & (n - 1)) === 0;
    const tileCount = (r, pitch) => {
      const k = Math.max(1, Math.ceil(TILE_MIN / (r * pitch)));
      return Math.min(32, r * (isPot(r) ? 2 ** Math.ceil(Math.log2(k)) : k));
    };
    const tileWales = tileCount(rep.wales, rep.xPitch);
    const tileCourses = tileCount(rep.courses, pitchY);
    const mW = rep.wales * Math.ceil(2 / rep.wales);
    const mC = rep.courses * Math.ceil(2 / rep.courses);
    const { paths } = buildYarnPaths({
      construction: con, sample: this.opts.sample, sampleBack: this.opts.sampleBack,
      pattern: this.opts.pattern, wales: tileWales + 2 * mW, courses: tileCourses + 2 * mC, pitchY,
      pique: this.opts.pique, yarnRadius: radius,
      // Stitch irregularity repeats with the STRUCTURE, not the tile. Jitter
      // that repeats once per tile (~0.5 cm) survives every mip level as a
      // regular grid across the whole cloth — a ripstop look no knit has. The
      // irregularity a real knit shows at a distance is added in the cloth
      // shader instead (dye-shader.js, uCloth), where it never repeats.
      jitterPeriod: { w: rep.wales, c: rep.courses },
    });
    this._applyYarnScales(paths);
    const tmp = new THREE.MeshBasicMaterial();
    const roleSeed = { fleecy: 3, binder: 5 };
    const tile = buildFabricMesh(paths, tmp, {
      radius, radialSegments: 8, shadows: false, fiberType: this.opts.fiberType,
      twistPitch: twistPitch(radius, this.opts.twist),
      // per-course texture phase, periodic with the structure (see jitterPeriod)
      uvPhase: (path) => {
        const c = Math.floor(path.points[0].y / pitchY + 0.25);
        const cm = ((c % rep.courses) + rep.courses) % rep.courses;
        return hash2(cm, 13 + (roleSeed[path.role] || 0)) * 17;
      },
    });
    const win = { x0: mW * rep.xPitch, y0: mC * pitchY, w: tileWales * rep.xPitch, h: tileCourses * pitchY };
    // A melange keeps the tile so the fibre mix can be re-baked when the
    // shade (and so the light-fibre fraction) changes.
    const melMat = this._melange ? melangeMaterial(this._melField) : null;
    // Texels per stitch: a power of two each way, so every mip level
    // averages whole stitches whatever the repeat (see tileCount above).
    const p2 = (v) => 2 ** Math.max(2, Math.round(Math.log2(Math.max(1, v))));
    let tw = p2(48 * rep.xPitch), th = p2(48 * pitchY);
    while (tileWales * tw > 2048 && tw > 4) tw /= 2;
    while (tileCourses * th > 2048 && th > 4) th /= 2;
    const bake = bakeStructure(this.renderer, tile, win, 48, {
      melMaterial: melMat, keep: !!melMat, size: { w: tileWales * tw, h: tileCourses * th },
    });
    const disposeTile = () => { tile.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); tmp.dispose(); };
    if (!melMat) disposeTile();

    // Real size: one wale (rep.xPitch units) is 1/wpc cm.
    const cm = wpc * rep.xPitch;
    const S = 24;                                // cloth edge, cm
    const scalar = Number.isFinite(density.scalar) ? density.scalar : 1;
    const body = this.body;
    // The near-right corner is turned back over itself. The fold line stays
    // 5.5 cm out from the dive point (origin) whatever the fabric, and the
    // corner is placed so the flat flap always reaches 2.5 cm past the crest
    // — a stiff fabric's wide crest then doesn't swallow the flap, and the
    // flap's tip never reaches the origin, where the zoom hands over to the
    // loop model of the FACE.
    const FOLD_D = 5.5, FLAP = 2.5;
    const cornerS = FOLD_D + Math.PI * body.foldRadiusCm + FLAP;     // along the fold normal
    const a = cornerS / Math.SQRT2;                                   // corner at (a, -a)
    const geo = new ClothSurface({
      minX: -(S - a) * cm, maxX: a * cm, minY: -a * cm, maxY: (S - a) * cm,
      seg: 0.12 * cm,
      // Simulation spacing. Coarser grids with more substeps hold a lifted
      // cloth far better than fine grids with few: position-based stretch
      // error grows with (substep time)^2 x (links)^2. Folds tighter than
      // about one spacing are rounded off; the authored pose is exact.
      simH: (this._shadows ? 0.75 : 0.9) * cm,
      tileW: win.w, tileH: win.h, uOff: center.x - win.x0, vOff: center.y - win.y0,
      // Fold radius, thickness and drape waves all come from the fabric
      // body (fabric-body.js): GSM, structure, fibre and finish.
      fold: {
        n: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, d0: FOLD_D * cm,
        r: body.foldRadiusCm * cm,
        t: (body.thicknessMm / 10) * cm,
      },
      wave: {
        amp: body.waveAmpCm * cm, len: body.waveLenCm * cm,
        flatR: 2.2 * cm, rampR: 5 * cm, phase: wavePhase(wpc * 7 + scalar),
      },
    });

    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const y = this._material;
    // Optics (roughness / sheen / relief) are set per state by _applyStage;
    // the sheen rim is most of what a peached or raised surface looks like
    // from a distance, where its micro-fuzz is far below a pixel.
    const clothMat = (maps) => {
      const m = new THREE.MeshPhysicalMaterial({
        color: y.color.clone(), map: maps.ao, normalMap: maps.normal,
        normalScale: new THREE.Vector2(1, 1),
        roughness: y.roughness, metalness: 0,
        sheen: y.sheen, sheenRoughness: y.sheenRoughness,
        sheenColor: y.sheenColor.clone(),
        // a fibre surface's coat is never mirror-sharp (the default 0 is)
        clearcoatRoughness: y.clearcoatRoughness,
      });
      m.shadowSide = THREE.DoubleSide;
      this._dyeUniforms.push(patchDye(m, {
        exposure: 'map', expMap: maps.exp, melMode: 'direct', melMap: maps.mel || null,
        cloth: {
          wales: tileWales, courses: tileCourses, tileCm: win.w / cm, amp: 0.05,
          // cavity over one structure repeat; a piqué's cell is the point
          height: maps.height,
          cavityLod: Math.log2(Math.max(2, Math.min(rep.wales * tw, rep.courses * th))),
          cavity: this.opts.pique ? 0.55 : 0.3,
        },
      }));
      return m;
    };
    const faceMat = clothMat(bake.front);
    const backMat = clothMat(bake.back);

    // Finished backs whose structure is hidden under fibre: a brushed nap
    // (fleece / velour) appears with the "Finished" state; a loop-pile back
    // (french terry) is knitted that way, so it is always there.
    let napMat = null, napTex = null;
    if (con.pile === 'brush' || con.pile === 'velour' || con.pile === 'loop') {
      const kind = con.pile === 'loop' ? 'loops' : 'nap';
      const surf = fibreSurfaceTexture(kind, aniso);
      napTex = surf.normal;
      const t = (kind === 'nap' ? 1.6 : 2.4) * cm;   // texture tile, cm
      for (const tx of [surf.normal, surf.shade]) tx.repeat.set(win.w / t, win.h / t);
      this._napShade = surf.shade;
      // The shade map is a mid-grey field; lift the base colour so the lit
      // tops land on the dyed shade rather than below it.
      const lift = kind === 'nap' ? 1.6 : 1.45;
      napMat = new THREE.MeshPhysicalMaterial({
        color: y.color.clone().lerp(new THREE.Color(1, 1, 1), kind === 'nap' ? 0.12 : 0.05).multiplyScalar(lift),
        map: surf.shade,
        // a taller, loftier pile casts deeper relief
        normalMap: napTex, normalScale: new THREE.Vector2(...Array(2).fill(Math.min(1.3, 0.5 + 0.3 * (body.napMm || 1)))),
        roughness: 1, metalness: 0,
        sheen: kind === 'nap' ? 1 : 0.6, sheenRoughness: kind === 'nap' ? 0.5 : 0.7,
        sheenColor: y.color.clone().lerp(new THREE.Color(1, 1, 1), 0.45),
      });
      napMat.shadowSide = THREE.DoubleSide;
    }

    // The cut edge: the yarn mass seen end-on, a little darker and fully
    // matte; on a pile fabric it carries the same fuzz as the back.
    const edgeMat = new THREE.MeshPhysicalMaterial({
      color: y.color.clone().multiplyScalar(0.78), roughness: 1, metalness: 0,
      sheen: 1, sheenRoughness: 0.6, sheenColor: y.color.clone().lerp(new THREE.Color(1, 1, 1), 0.4),
      side: THREE.DoubleSide,
    });

    const front = new THREE.Mesh(geo.front, faceMat);
    const back = new THREE.Mesh(geo.back, backMat);
    const edge = new THREE.Mesh(geo.edge, edgeMat);
    if (this._shadows) {
      front.castShadow = true; front.receiveShadow = true;
      back.receiveShadow = true;
      edge.castShadow = true;
    }
    // The cloth moves under the simulation, so its bounds are not fixed.
    front.frustumCulled = back.frustumCulled = edge.frustumCulled = false;
    const macroGroup = new THREE.Group();
    macroGroup.add(front, back, edge);
    this._pivot.add(macroGroup);

    // The table: invisible except for the cloth's shadow on it, which is
    // what shows a lifted or folded cloth standing off the surface.
    let table = null;
    if (this._shadows) {
      table = new THREE.Mesh(
        new THREE.PlaneGeometry(S * cm * 4, S * cm * 4),
        new THREE.ShadowMaterial({ opacity: 0.22 }),
      );
      table.position.z = -(body.thicknessMm / 10) * cm * 0.5 - 0.02 * cm;
      table.receiveShadow = true;
      macroGroup.add(table);
    }

    const box = new THREE.Box3().setFromObject(macroGroup);
    this._macro = {
      group: macroGroup, front, back, edge, edgeMat, faceMat, backMat, napMat, napTex,
      cloth: geo, table, cm,
      napAlways: con.pile === 'loop',
      napLift: con.pile === 'loop' ? 1.45 : 1.6, napShade: this._napShade || null,
      melMat, melF: -1, rebake: bake.rebake || null,
      disposeTile: melMat ? () => { bake.release(); disposeTile(); } : null,
      targets: bake.targets, size: box.getSize(new THREE.Vector3()),
      viewW: 14 * cm,                            // default view: ~14 cm across
      fullW: 0.62 * S * cm * 2,                  // fully zoomed out: the whole piece
    };
    this._syncMacroBack();
  }

  // Camera distance at which `width` scene units span the viewport.
  _distForWidth(width) {
    const t = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    return width / (2 * t * (this.camera.aspect || 1.8));
  }

  _syncMacroBack() {
    const m = this._macro;
    if (!m) return;
    const finished = this._shrinkT == null || this._shrinkT >= 0.5;
    m.back.material = m.napMat && (m.napAlways || finished) ? m.napMat : m.backMat;
  }

  // Macro cloth when the camera is far, the loop model when it is close
  // enough that the model fills the view. A small hysteresis band stops the
  // two flickering while damping settles exactly on the threshold.
  _applyMode() {
    if (!this._macro || !this.controls) return;
    const d = this.controls.getDistance();
    // 0.62 of the cover distance: under the default tilt, the loop model's
    // far edge is still out of frame there, and the baked texture (48 px per
    // wale) is still sharper than the screen right up to the handover.
    const micro = this._mode === 'micro' ? d < this._fitDist * 0.66 : d < this._fitDist * 0.62;
    const mode = micro ? 'micro' : 'macro';
    if (mode === this._mode) return;
    this._mode = mode;
    this.group.visible = micro;
    this._macro.group.visible = !micro;
    this.camera.near = micro ? 0.1 : 1.0;
    this.camera.updateProjectionMatrix();
    if (this._shadows) this._fitShadow(micro ? this._size : this._macro.size);
  }

  // Fit the key light's shadow frustum to `size`, and move the (directional)
  // light far enough out along its own direction that nothing in the frustum
  // sits behind it — direction, and so the lighting, is unchanged.
  _fitShadow(size) {
    const k = this._key;
    if (!k || !this._keyDir) return;
    const r = Math.max(size.x, size.y) * 0.7;
    k.position.copy(this._keyDir).multiplyScalar(Math.max(10, r * 2.5));
    this._lightBaseZ.key = k.position.z;
    if (this._showingBack) k.position.z = -k.position.z;
    configureShadowCamera(k, size);
    k.shadow.normalBias = r * 0.002;
  }

  // Distance at which the patch COVERS the viewport (fills both axes, cropping
  // the longer one slightly) — vs the old "contain" fit that left big margins.
  _coverDistance(size) {
    const t = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const aspect = this.camera.aspect || 1.8;
    const distFillHeight = size.y / (2 * t);
    const distFillWidth  = size.x / (2 * t * aspect);
    return Math.min(distFillHeight, distFillWidth) * 0.98;
  }

  // Camera-distance LOD: near → stronger normal-map relief so the twist/fibre
  // reads when zoomed in; far → softer so it doesn't shimmer. Below the 'near'
  // tier, zooming further (down to controls.minDistance — see mount() above)
  // crosses into 'ultra': the material SWAPS to the bigger, finer normal map
  // built in yarn-material.js (individual staple/filament fibres, not just
  // the yarn's twist), not just a stronger scale on the same low-res map —
  // scaling alone has no new detail left to reveal.
  _applyLod() {
    const m = this._material;
    if (!m || !m.userData || !m.userData.baseNormalScale || !this.controls) return;
    const ratio = this.controls.getDistance() / (this._fitDist || 1);
    const tier = ratio < 0.28 ? 'ultra' : ratio < 0.6 ? 'near' : ratio > 1.3 ? 'far' : 'mid';
    if (tier === this._lodTier) return;            // only on tier transition
    this._lodTier = tier;
    const K = { far: 0.65, mid: 1.0, near: 1.4, ultra: 1.6 };
    m.userData.lodK = K[tier];
    const ns = m.userData.baseNormalScale * K[tier] * (m.userData.lookNormal || 1);
    m.normalScale.set(ns, ns);
    const wantNear = tier === 'ultra' || tier === 'near';
    const tex = wantNear ? m.userData.normalNear : m.userData.normalFar;
    const alb = wantNear ? m.userData.albedoNear : m.userData.albedoFar;
    if (tex && m.normalMap !== tex) { m.normalMap = tex; m.needsUpdate = true; }
    if (alb && m.map !== alb) { m.map = alb; m.needsUpdate = true; }
    if (this._hair) this._hair.mesh.visible = this._hairWanted();
  }

  // density multiplier from viewport — full on desktop, lighter on small/low-DPR
  _lodScale() {
    const w = (this.container && this.container.clientWidth) || 460;
    const dpr = window.devicePixelRatio || 1;
    if (w < 380 || dpr < 1) return 0.7;
    if (w < 520) return 0.85;
    return 1.0;
  }

  _addBacking(group, center, size, radius, box, pileReach) {
    const d = this.opts.dyed || { r: 120, g: 124, b: 134 };
    const sd = (this.opts.physics && typeof this.opts.physics.shadow_depth === 'number')
      ? this.opts.physics.shadow_depth : 0.1;
    const s = BACKING.shade * (1 - sd * 0.45);     // deeper cavities → darker body
    // transparent only so it can fade with view angle (_backingFade); it is
    // drawn after the opaque yarn and still depth-tested, so it never shows
    // through a loop in front of it.
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide, transparent: true });
    mat.color.setRGB((d.r / 255) * s, (d.g / 255) * s, (d.b / 255) * s, THREE.SRGBColorSpace);
    // Inset by an absolute stitch margin, not a % of the swatch: the loop
    // heads of the top course (and the selvedge loops) leave gaps up to a
    // course deep, and any plane edge inside those gaps reads as a flat slab.
    const geo = new THREE.PlaneGeometry(
      Math.max(size.x * 0.5, size.x - 2 * BACKING.insetX),
      Math.max(size.y * 0.5, size.y - 2 * BACKING.insetY),
    );
    const plane = new THREE.Mesh(geo, mat);
    // Sit strictly behind the DEEPEST actual geometry — the loop mesh AND
    // (critically) the full pile reach, not just a small multiple of the
    // face-yarn radius. Rib's mirrored purl loops, interlock's back bed, and
    // a brushed pile's fibre tips can all push well past that old fixed
    // plane / old radius-only margin — verified the backing was sitting IN
    // FRONT of most of the pile, so the "flip to back" view stared straight
    // into an opaque plane instead of the nap. box.min.z is the true measured
    // depth of the loop mesh; pileReach (0 when there's no pile) extends the
    // margin to clear the fibre tips too.
    const backZ = box ? Math.min(BACKING.z, box.min.z - radius * 1.5 - (pileReach || 0)) : BACKING.z;
    plane.position.set(center.x, center.y, backZ);
    if (this._shadows) plane.receiveShadow = true;   // loops drop contact shadows here
    group.add(plane);
    this._backing = { geo, mat, mesh: plane, baseShade: s };
    // setView('back') spins the WHOLE group 180° so the loop mesh (and any
    // pile, which is real fabric structure and should turn with it) shows
    // its other face — but this backing plane is a pure rendering
    // convenience, not fabric structure, and needs to stay on the world-far
    // side in BOTH states. Remembered here so setView can re-mirror just
    // this one child and cancel the group rotation's effect on it alone.
    this._backingCenter = center.clone();
    this._backingFrontZ = backZ;
  }

  // Pile sizing shared by _addBacking (needs the reach, to clear the backing
  // plane) and _addPile (needs the same numbers to actually build it) — one
  // source of truth so the two never drift apart.
  _pileParams(radius) {
    const con = this.opts.construction || {};
    if (!con.brush && con.pile !== 'loop') return null;
    const kind = con.pile === 'loop' ? 'loop' : 'brush';
    const isVelour = con.pile === 'velour';

    // The pile IS the loop/pile yarn, not the face yarn — size it off the
    // loop yarn's own count when the fabric record exposes one (3-thread
    // fleece/french terry both carry a real `yarn2_ne`); otherwise fall back
    // to the doc's measured face:loop diameter ratio (0.226mm / 0.165mm ≈
    // 1.37 for a 16s loop against a 30s face — advanced_fleece_fabrication_
    // visualization.md §1.1).
    const density = this.opts.density || {};
    // A raised, torn fibre reads as fluffier/thicker than a tightly-spun tube
    // of the same yarn — floor it a bit above yarnRadius()'s general tube
    // clamp (0.10) so a fine loop count never shrinks the pile to a sub-
    // legible sliver at swatch scale.
    const pileRadius = Math.max(0.14, this.opts.loopNe
      ? yarnRadius(this.opts.loopNe, this.opts.tf, density)
      : radius * 1.37);

    // Strand density scales with fabric weight — the same GSM-aware `scalar`
    // already computed for stitch density (heavier GSM → more raised fibre
    // mass). Velour is a denser sheared pile; loop/terry nap is sparser
    // (bigger, fewer loops read correctly at a swatch scale).
    const scalar = typeof density.scalar === 'number' ? density.scalar : 1;
    const scalarClamped = Math.max(0.7, Math.min(scalar, 1.6));
    // Raised nap density in strands/unit² — high enough to read as a dense
    // fuzzy mat rather than sparse specks once the pile.js instance cap was
    // lifted to match (see pile.js `count`).
    const baseDensity = kind === 'loop' ? 9.0 : (isVelour ? 26.0 : 16.0);
    const pileDensity = baseDensity * scalarClamped;
    // Velour is sheared short and dense; plain fleece nap is longer/looser.
    const lengthScale = isVelour ? 0.6 : 1.0;
    const zOffset = pileRadius * (kind === 'loop' ? 0.6 : 1.0);
    // Worst-case extra depth behind box.min.z: the bounds offset, the fibre's
    // own length (brush) or diameter (loop torus), plus the per-fibre base-
    // depth jitter pile.js now adds (up to radius*2.2).
    const maxReach = zOffset + (kind === 'loop' ? pileRadius * 2.2 : pileRadius * 4.2 * lengthScale) + pileRadius * 2.2;

    return { kind, isVelour, pileRadius, pileDensity, lengthScale, zOffset, maxReach };
  }

  // Protruding fibre ends on the yarn surface (hairiness.js). Hidden until
  // the camera is close enough to resolve them — at normal viewing distance
  // each hair is well under a pixel wide and would only shimmer.
  _addHairiness(group, radius) {
    const tubes = group.userData.tubes || [];
    const mat = this._material.clone();
    mat.vertexColors = false;      // instanced fibres have no colour attribute (see _addPile)
    mat.map = null;
    mat.normalMap = null;
    mat.color.lerp(new THREE.Color(1, 1, 1), 0.16);   // thin fibres catch light
    mat.roughness = Math.min(1, mat.roughness + 0.08);
    const maxMul = Math.max(1, this._finishLook.hair);   // peach / brushed raise more fibre
    const hair = buildHairiness(tubes, mat, {
      radius, fiberType: this.opts.fiberType || 'cotton', totalLength: group.userData.totalLength,
      maxMul,
      // A raised finish is mostly fibre; each hair is a tiny 24-triangle
      // tube, so the higher cap is cheap. Lighter on the low-power tier.
      maxCount: (this._shadows ? 14000 : 5000) * maxMul,
    });
    if (!hair) { mat.dispose(); return; }
    if (this._shadows) hair.mesh.castShadow = false;
    hair.mesh.visible = this._hairWanted();
    group.add(hair.mesh);
    this._hair = { mesh: hair.mesh, geometry: hair.geometry, material: mat, update: hair.update };
  }

  _hairWanted() {
    return (this._lodTier === 'near' || this._lodTier === 'ultra') &&
      !(this._material && this._material.wireframe);
  }

  // Brushed fleece back: a dense shell-textured nap on the fleecy floats
  // (nap.js). Registered as this._pile so the As-Knit / Finished toggle and
  // wireframe mode show and hide it exactly as before.
  _addNap(group, paths, anchors, pileParams) {
    const points = [];
    for (const p of paths) if (p.role === 'fleecy') for (const pt of p.points) points.push(pt);
    if (!points.length) return;
    this._napFibre = fibreGeometry();
    const nap = buildNap({
      points, anchors,
      yarnRadius: this._fleecyRadius,
      color: this._material.color,
      // The pile's real height above the knitted base (fabric-body.js), in
      // loop-model units (one wale = 10/wpc mm) — a 400 GSM fleece's nap is
      // ~2.3 mm, a light one under 1 mm.
      napLength: this._napUnits(pileParams),
      fibreGeometry: this._napFibre,
      shells: this._shadows ? 16 : 10,              // lighter on the low-power tier
    });
    group.add(nap.group);
    this._pile = { mesh: nap.group, geometry: this._napFibre, dispose: nap.dispose, setColor: nap.setColor };
  }

  _napUnits(pileParams) {
    const wpc = this.opts.density && this.opts.density.wpc;
    const fallback = this._fleecyRadius * 3.2 * pileParams.lengthScale;
    if (!(wpc > 0) || !this.body || !(this.body.napMm > 0)) return fallback;
    return Math.max(fallback * 0.6, Math.min(this.body.napMm * wpc / 10, this._fleecyRadius * 14));
  }

  _addPile(group, box, pileParams, floatAnchors) {
    if (!pileParams) return;
    const { kind, pileRadius, pileDensity, lengthScale, zOffset } = pileParams;
    const bounds = {
      minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y,
      z: box.min.z - zOffset,   // behind the fabric
    };
    // 3-thread fleece: root the nap at the real binding/fleecy yarn's float
    // positions (topology-builder.js `fleeceFloatAnchors`) instead of a
    // uniform random grid across the whole patch — real brushing raises the
    // float yarn that is actually there, not an independent decorative layer,
    // and a grid keyed purely off instance index tiled visibly once the old
    // instance cap was raised (the "rows of identical sprites" artefact).
    if (floatAnchors && floatAnchors.length) bounds.anchors = floatAnchors;
    // A raised, torn-fibre nap scatters light differently than the smooth
    // knit face — slightly lighter and softer (higher roughness/sheen) than
    // the flat dyed yarn, which is how a real brushed pile reads next to its
    // own base colour. Reusing the exact same material made the pile blend
    // into the backing instead of reading as a distinct fuzzy surface.
    const pileMat = this._material.clone();
    // The yarn material has vertexColors on (contact occlusion, fabric-mesh.js);
    // instanced pile fibres carry no colour attribute, and WebGL's default for
    // a missing attribute is black — every brushed fibre rendered black,
    // whatever the dye. Same for the yarn-surface tiles, which are UV-mapped
    // per yarn helix and mean nothing on a fibre cylinder.
    pileMat.vertexColors = false;
    pileMat.map = null;
    pileMat.normalMap = null;
    pileMat.color.lerp(new THREE.Color(1, 1, 1), 0.32);
    pileMat.roughness = Math.min(1, this._material.roughness + 0.12);
    if (typeof pileMat.sheen === 'number') pileMat.sheen = Math.min(1, pileMat.sheen + 0.15);
    this._pileMaterial = pileMat;

    const { mesh, geometry } = buildPile(kind, bounds, pileMat,
      { radius: pileRadius, density: pileDensity, lengthScale });
    if (this._shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);
    this._pile = { mesh, geometry };
  }

  // Technical grainline — the standard pattern-cutting marking (double-headed
  // arrow along the lengthwise/wale grain — constants.js's own "+y → … the
  // grain / wale direction" axis) showing straight-of-grain, same convention
  // used in the 2D view (fabric-visualizer.js `_drawGrainlineIndicator`) so
  // the two stay visually consistent.
  _addGrainline(group, box, size) {
    const color = 0xe11d48;
    // Just INSIDE the right edge, not outside it — the camera's "cover" fit
    // frames tightly to the fabric box (measured before this runs), so
    // anything placed beyond box.max.x sits outside the visible frustum and
    // never actually shows up. Real grainlines are marked directly on the
    // fabric/pattern piece anyway, so inside the edge is the correct place.
    const x = box.max.x - Math.max(size.x, size.y) * 0.09;
    const z = box.max.z + Math.max(size.x, size.y) * 0.02;   // proud of the loop tops
    const halfH = size.y * 0.42;
    const headLen = Math.max(halfH * 0.1, 0.3);
    const headWidth = headLen * 0.6;
    const origin = new THREE.Vector3(x, 0, z);
    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
    const a1 = new THREE.ArrowHelper(up, origin, halfH, color, headLen, headWidth);
    const a2 = new THREE.ArrowHelper(down, origin, halfH, color, headLen, headWidth);
    [a1, a2].forEach(a => { a.line.material.linewidth = 2; a.line.material.transparent = true; a.line.material.opacity = 0.9; });
    group.add(a1, a2);

    // "GRAIN" label — a small canvas sprite alongside the arrow (no font
    // loader dependency, matches the yarn-material.js canvas-texture pattern).
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const cctx = c.getContext('2d');
    cctx.translate(32, 128); cctx.rotate(-Math.PI / 2);
    cctx.font = "700 40px 'JetBrains Mono', monospace";
    cctx.fillStyle = '#e11d48';
    cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    cctx.fillText('GRAIN', 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(halfH * 0.16, halfH * 0.64, 1);
    sprite.position.set(x - headWidth * 1.8, 0, z);
    group.add(sprite);

    this._grainline = { a1, a2, sprite };
  }

  // The dyed shade (the visualizer's colour picker). Shown in the Finished
  // state; As-Knit shows the greige colour instead (see _applyStage).
  setColor(hex) {
    this._dyeHex = hex;
    this._applyStage(true);
  }

  // Apply the As-Knit or Finished state: colour, finish optics, dye effects,
  // hairiness. `force` re-applies even if the state has not changed.
  _applyStage(force) {
    const finished = this._shrinkT == null || this._shrinkT >= 0.5;
    if (!force && finished === this._stageFinished) return;
    this._stageFinished = finished;
    const look = finished ? this._finishLook : this._greigeLook;
    const hex = finished || !this._greigeHex ? this._dyeHex : this._greigeHex;
    const target = new THREE.Color(hex);
    const mel = this._melange ? melangeSplit(target) : null;

    this._paint(hex, mel);
    applyYarnLook(this._material, look);

    // Worn high points fade toward the undyed fibre showing through.
    const fadeCol = target.clone().lerp(new THREE.Color(this._rawHex), 0.55);
    for (const u of this._dyeUniforms) {
      u.uFade.value = look.fade;
      u.uFadeColor.value.copy(fadeCol);
      u.uChalk.value = look.chalk;
      u.uMel.value = mel ? 1 : 0;
      if (mel) { u.uMelF.value = mel.f; u.uMelLight.value.copy(mel.light); }
    }
    if (this._hair && this._hair.update) this._hair.update(look.hair, look.hairLen);

    const m = this._macro;
    if (m) {
      const b = this._material.userData.base;
      for (const mat of [m.faceMat, m.backMat]) {
        mat.roughness = Math.max(0.05, Math.min(1, b.roughness + look.rough));
        // From a distance a raised / sanded surface is mostly its sheen rim.
        mat.sheen = Math.max(0, Math.min(1, b.sheen + look.sheen * 1.4));
        mat.sheenRoughness = look.sheenRough != null ? look.sheenRough : b.sheenRoughness;
        mat.clearcoat = Math.max(0, Math.min(1, b.clearcoat + look.clearcoat));
        mat.normalScale.set(look.normal, look.normal);
        mat.sheenColor.copy(mel ? mel.dark : target).lerp(new THREE.Color(1, 1, 1), look.sheenTint);
        if (look.lift) mat.color.lerp(new THREE.Color(1, 1, 1), look.lift);
      }
      if (mel && m.rebake && Math.abs(mel.f - m.melF) > 0.004) {
        m.melMat.uniforms.uF.value = mel.f;
        m.rebake('mel', m.melMat);
        m.melF = mel.f;
      }
    }
  }

  // Set every material's colour from the shown shade (`hex`); a melange
  // splits the yarn and the macro cloth into its dark fibre colour (the light
  // fibres come from the dye shader) while everything else takes the mean.
  _paint(hex, mel) {
    if (this._material) {
      setYarnColorHex(this._material, hex);
      if (mel) this._material.color.copy(mel.dark);
    }
    if (this._backing) {
      const n = parseInt(String(hex).replace('#', ''), 16);
      const s = this._backing.baseShade;   // keeps the shadow-depth darkening
      this._backing.mat.color.setRGB(
        ((n >> 16) & 255) / 255 * s, ((n >> 8) & 255) / 255 * s, (n & 255) / 255 * s,
        THREE.SRGBColorSpace,
      );
    }
    // Pile has its own (lightened) material clone — keep it in sync with the
    // new dye colour instead of it staying stuck on whatever shade the swatch
    // was built with.
    if (this._pileMaterial) {
      setYarnColorHex(this._pileMaterial, hex);
      this._pileMaterial.color.lerp(new THREE.Color(1, 1, 1), 0.32);
    }
    const mean = new THREE.Color(hex);
    if (this._pile && this._pile.setColor) this._pile.setColor(mean);
    if (this._macro) {
      const m = this._macro;
      for (const mat of [m.faceMat, m.backMat]) {
        setYarnColorHex(mat, hex);
        if (mel) mat.color.copy(mel.dark);
      }
      m.edgeMat.color.copy(mean).multiplyScalar(0.78);
      m.edgeMat.sheenColor.copy(mean).lerp(new THREE.Color(1, 1, 1), 0.4);
      if (m.napMat) {
        m.napMat.color.copy(mean).lerp(new THREE.Color(1, 1, 1), m.napAlways ? 0.05 : 0.12).multiplyScalar(m.napLift);
        m.napMat.sheenColor.copy(mean).lerp(new THREE.Color(1, 1, 1), 0.45);
      }
    }
    if (this._hair) {
      this._hair.material.color.copy(mean).lerp(new THREE.Color(1, 1, 1), 0.16);
    }
  }

  // Lightbox / metamerism preview — re-tint the rig to a named illuminant
  // (see lighting.js LIGHT_PRESETS) without touching geometry or dye colour,
  // so the SAME rendered swatch can be compared under D65 / TL84 / A the way
  // a real AATCC/ISO lightbox compares a shade.
  setLightPreset(name) {
    this._lightPreset = name;
    applyLightPreset({ key: this._key, fill: this._fill, rim: this._rim, hemi: this._hemi }, name);
  }

  // Shrinkage preview: t=0 as-knit, t=1 fully finished (opts.shrinkage, the
  // engine's own quality_prediction.shrinkage %, anisotropic). Unlike the 2D
  // view — which re-derives wales/courses-per-cm and repaints, genuinely
  // denser — this scales the WHOLE loop group rather than rebuilding tube
  // geometry every frame (thousands of Catmull-Rom tubes is too costly to
  // regenerate 60×/sec). That's a real simplification: stitch COUNT stays
  // fixed and the swatch visibly shrinks toward the frame centre by the
  // correct anisotropic %, rather than the loops themselves repacking —
  // proportionally accurate, not a re-simulation of loop relaxation.
  previewShrink(t) {
    if (!this.group) return;
    this._shrinkT = t;
    const shr = this.opts && this.opts.shrinkage;
    if (shr) {
      const sx = 1 - (shr.width_pct / 100) * t;
      const sy = 1 - (shr.length_pct / 100) * t;
      this.group.scale.set(sx, sy, 1);
    }
    // Brushing/napping is a FINISHING step done AFTER knitting, not during
    // it — a real as-knit (greige) fabric off the machine shows the bare
    // loop structure and the binding/fleecy yarn's smooth float, with no
    // raised fibre yet; the pile only exists once brushed. The pile mesh
    // used to stay visible in BOTH states (same threshold the "Show:
    // As-Knit/Finished" button label already uses), which is exactly why
    // the two looked identical. Hide it below the finished half of the
    // animation instead of just scaling the frame.
    if (this._pile && this._pile.mesh) this._pile.mesh.visible = t >= 0.5;
    this._syncBacking();
    this._syncMacroBack();
    this._applyStage(false);
  }

  _syncBacking() {
    if (!this._backing || !this._backing.mesh) return;
    const wire = !!(this._material && this._material.wireframe);
    const napShown = this._backingYieldsToNap && this._pile && this._pile.mesh && this._pile.mesh.visible;
    const k = this._backingFade();
    this._backing.mat.opacity = k;
    this._backing.mesh.visible = !wire && !napShown && k > 0.01;
  }

  // The backing only exists to darken the gaps between loops seen roughly
  // face-on. Seen obliquely, the loops already overlap each other, and the
  // plane — sitting behind them — shows up as a dark board under the cloth.
  // Fade it out between ~45° and ~60° off the fabric normal.
  _backingFade() {
    if (!this.camera || !this.controls || !this._pivot) return 1;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this._pivot.quaternion);
    const v = this.camera.position.clone().sub(this.controls.target).normalize();
    const t = Math.min(1, Math.max(0, (Math.abs(n.dot(v)) - 0.5) / 0.22));
    return t * t * (3 - 2 * t);
  }

  // ROTATE THE FABRIC, not the camera. The camera moving to -z used to look
  // "through" the object from behind, but the opaque backing plane (added in
  // _addBacking, always offset toward -z so it sits behind the FRONT-facing
  // loops) is then the nearest surface to that camera — it occludes the loop
  // mesh entirely, so "Back" showed nothing but a flat colour panel for
  // every construction. Spinning the group 180° instead keeps the camera (and
  // the fixed studio lights) exactly where they were: whichever face rotates
  // to meet them is correctly in front of the backing and correctly lit, no
  // light-mirroring needed for this path (see _setLightSide's own doc — that
  // stays for the free-orbit case, where the CAMERA does move).
  setView(which) {
    if (!this._pivot) return;
    const back = which === 'back';
    this._pivot.rotation.y = back ? Math.PI : 0;
    // the table is under the cloth: seen from below it is not there
    if (this._macro && this._macro.table) this._macro.table.visible = !back;
    if (back && this._grab) this._endGrab();
    // Keep the backing plane on the world-far side (see _addBacking). The
    // group sits inside the pivot offset by -center, so a point at local
    // (x, z) lands at pivot-space (x - cx, z - cz), which the 180° turn maps
    // to world (cx - x, cz - z). Staying centred needs x = cx in BOTH states;
    // keeping the plane's front-view world depth (backZ - cz) needs
    // z = 2·cz - backZ when flipped. The old code mirrored x to -cx, which
    // put the plane a whole swatch-width off-screen in every Back view —
    // so every fabric's back read as see-through.
    if (this._backing && this._backing.mesh && this._backingCenter) {
      const c = this._backingCenter;
      this._backing.mesh.position.x = c.x;
      this._backing.mesh.position.z = back ? 2 * c.z - this._backingFrontZ : this._backingFrontZ;
    }
  }

  // Mirror the whole 3-point rig when the CAMERA ends up on the far side
  // (free orbit past the edge — see the controls 'change' listener in mount()),
  // so the side actually facing the camera always gets the key light. The
  // Front/Back buttons no longer move the camera (setView rotates the fabric
  // instead) and so no longer need this — the fixed lights already face
  // whichever side rotates toward them.
  _setLightSide(back) {
    if (this._showingBack === back) return;
    this._showingBack = back;
    const z = this._lightBaseZ;
    if (!z) return;
    const sign = back ? -1 : 1;
    if (this._key)  this._key.position.z  = z.key  * sign;
    if (this._fill) this._fill.position.z = z.fill * sign;
    if (this._rim)  this._rim.position.z  = z.rim  * sign;
  }

  resetView() {
    this.resetCloth();
    if (this.controls) this.controls.reset();
    this.setView('front');
    this._setLightSide(false);   // reset() always returns to the saved FRONT state
  }

  toggleWire() {
    if (!this._material) return false;
    this._material.wireframe = !this._material.wireframe;
    const on = this._material.wireframe;
    // "Loops" shows the yarn paths — those only exist in the loop model, so
    // from the macro view, move in to where it takes over.
    if (on && this._mode === 'macro' && this.controls) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, this._fitDist * 0.6);
      this.controls.update();
    }
    // hide the solid backing (and pile) so the loop paths are fully visible
    if (this._backing && this._backing.mesh) this._backing.mesh.visible = !on;
    // Restore to whatever as-knit/finished state previewShrink last set
    // (undefined — no shrink toggle on this fabric — defaults to shown),
    // not unconditionally true, or leaving wireframe mode would always
    // reveal the pile even while "As-Knit" is selected.
    if (this._pile && this._pile.mesh) {
      this._pile.mesh.visible = !on && (this._shrinkT == null || this._shrinkT >= 0.5);
    }
    if (this._hair) this._hair.mesh.visible = this._hairWanted();
    this._syncBacking();
    return on;
  }

  // High-resolution capture for tech-pack / sharing use — renders one frame at
  // `scale`× the on-screen drawing-buffer resolution (CSS size untouched, via
  // THREE's setSize(w,h,false)) and hands back a PNG data URL, then restores
  // the live view via the same resize() path used on every window resize.
  captureHiRes(scale = 3) {
    if (!this.renderer || !this.camera || !this.container) return null;
    const W = this.container.clientWidth || 460, H = VIEW_HEIGHT;
    this.renderer.setSize(W * scale, H * scale, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.resize();   // back to normal on-screen resolution + aspect
    return url;
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const W = this.container.clientWidth || 460;
    const H = VIEW_HEIGHT;
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    // keep the cloth filling the frame after a resize (re-cover the new aspect)
    if (this._size && this.controls) {
      const newFit = this._coverDistance(this._size);
      const dir = this.camera.position.clone().sub(this.controls.target);
      const len = dir.length() || 1;
      // Keep the viewer's current zoom (as a fraction of the fit distance)
      // instead of snapping back to the fit — the ResizeObserver fires once
      // right after mount, which used to silently discard the default framing.
      const ratio = len / (this._fitDist || len);
      dir.multiplyScalar((newFit * ratio) / len);
      this.camera.position.copy(this.controls.target).add(dir);
      this.controls.minDistance = Math.max(0.6, newFit * 0.12);
      this.controls.maxDistance = this._macro ? this._distForWidth(this._macro.fullW) : newFit * 2.2;
      this._fitDist = newFit;
      this.controls.update();
    }
  }

  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.controls) this.controls.dispose();
    if (this._envTarget) this._envTarget.dispose();
    if (this.group) {
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    if (this._backing) { this._backing.geo.dispose(); this._backing.mat.dispose(); }
    if (this._pile) { this._pile.geometry.dispose(); if (this._pile.dispose) this._pile.dispose(); }
    if (this._pileMaterial) this._pileMaterial.dispose();
    if (this._hair) this._hair.material.dispose();
    if (this._macro) {
      const m = this._macro;
      m.front.geometry.dispose(); m.back.geometry.dispose(); m.edge.geometry.dispose();
      [m.faceMat, m.backMat, m.edgeMat, m.napMat, m.napTex, m.napShade, m.melMat].forEach((x) => { if (x) x.dispose(); });
      if (m.disposeTile) m.disposeTile();
      m.cloth.dispose();
      if (m.table) { m.table.geometry.dispose(); m.table.material.dispose(); }
      m.targets.forEach((t) => t.dispose());
    }
    if (this._stretchUi) this._stretchUi.remove();
    if (this.renderer && this._onDown) {
      const el = this.renderer.domElement;
      el.removeEventListener('pointerdown', this._onDown, true);
      el.removeEventListener('pointermove', this._onMove);
      el.removeEventListener('pointerup', this._onUp);
      el.removeEventListener('pointercancel', this._onUp);
    }
    if (this._textures) this._textures.forEach((t) => t.dispose());
    if (this._material) this._material.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
}
