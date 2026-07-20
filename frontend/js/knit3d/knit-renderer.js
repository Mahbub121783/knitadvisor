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

import { buildYarnPaths } from './topology-builder.js?v=20260608g';
import { createYarnMaterial, setYarnColorHex } from './yarn-material.js?v=20260608g';
import { buildFabricMesh, yarnRadius } from './fabric-mesh.js?v=20260608g';
import { addStudioLighting, configureShadowCamera } from './lighting.js?v=20260608g';
import { buildPile } from './pile.js?v=20260608g';
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (this._shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    renderer.domElement.style.cssText =
      'width:100%;height:380px;display:block;border-radius:12px;cursor:grab;';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const lights = addStudioLighting(scene, this._shadows);
    this._key = lights.key;
    this._fill = lights.fill;
    this._rim = lights.rim;
    // authored ("front") Z positions — setView('back') mirrors these across
    // the fabric so whichever side faces the camera gets the strong key light
    // instead of the rim's leftover intensity aimed the wrong way.
    this._lightBaseZ = { key: this._key.position.z, fill: this._fill.position.z, rim: this._rim.position.z };
    this._showingBack = false;

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    this._buildFabric();
    if (this._shadows) configureShadowCamera(this._key, this._size);

    // front view BEFORE OrbitControls so it becomes the saved reset state
    camera.position.set(0, 0, this._fitDist);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.85;
    controls.minDistance = this._fitDist * 0.35;
    controls.maxDistance = this._fitDist * 2.2;
    controls.target.set(0, 0, 0);
    controls.update();
    controls.saveState();
    this.controls = controls;

    // real camera-distance LOD: boost fibre relief up close, soften far away
    // (cheap material-tier swap — only touched on tier transitions)
    this._lodK = 1;
    controls.addEventListener('change', () => {
      this._applyLod();
      // Free-orbiting (not just the Front/Back buttons) can carry the camera
      // past the fabric's edge into "looking at the back" territory — re-side
      // the lights off the camera's ACTUAL hemisphere, not just button state,
      // so a manual drag-around never lands on the same near-black view the
      // Back button used to produce.
      this._setLightSide(this.camera.position.z < 0);
    });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);

    const tick = () => {
      if (this._disposed) return;
      controls.update();
      renderer.render(scene, camera);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  _buildFabric() {
    const { material, textures } = createYarnMaterial({
      dyed: this.opts.dyed,
      fiberType: this.opts.fiberType,
      physics: this.opts.physics,
      twist: this.opts.twist,
    });
    this._material = material;
    this._textures = textures;

    // Size the patch to the viewport so the cloth FILLS the frame (no floating
    // square): build it landscape to match the canvas aspect, denser on big
    // screens, lighter on small/low-DPR devices (LOD) so weak GPUs stay smooth.
    // Real stitch density (GSM·gauge·loop-length) drives loop height + how many
    // stitches to show, so a tight 350gsm reads denser than a loose 150gsm.
    const con = this.opts.construction || {};
    const density = this.opts.density || { aspect: 1.22, scalar: 1, wpc: 9, tex: 20 };
    const aspect = this.camera.aspect || 1.8;
    const lod = this._lodScale();
    const beds = con.type === 'interlock' ? 2 : 1;

    // effective course spacing (loop height): taller when loose (low cpc/wpc)
    const ribComp = con.type === 'rib' ? 1 / RIB_PITCH_SCALE : 1;
    const pitchY = PITCH_Y * (1 / Math.max(0.6, Math.min(density.aspect, 1.6)));

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
    const baseCourses = con.type === 'interlock' ? 12 : 16;
    let courses = Math.max(10, Math.round(baseCourses * lod * density.scalar));
    let wales = Math.max(12, Math.round(courses * pitchY * aspect * ribComp));
    // performance cap — keep total stitches bounded; shrink loops, not the count
    const CAP = 900;
    if (wales * courses * beds > CAP) {
      const k = Math.sqrt(CAP / (wales * courses * beds));
      courses = Math.max(12, Math.round(courses * k));
      wales = Math.max(14, Math.round(wales * k));
    }

    const { paths } = buildYarnPaths({
      construction: con, sample: this.opts.sample, sampleBack: this.opts.sampleBack,
      wales, courses, pitchY,
    });

    // analytic drape — gentle curve + wrinkles so it reads as real cloth, not a
    // flat card. Heavier / denser / double-bed fabrics drape less.
    const doubleBed = con.type === 'interlock' || con.type === 'rib';
    const drapeAmount = Math.max(0.2, Math.min(
      0.72 - (density.scalar - 1) * 0.35 - (doubleBed ? 0.15 : 0), 0.75));
    applyDrape(paths, { amount: drapeAmount });

    const radius = yarnRadius(this.opts.countNe, this.opts.tf, density);
    const group = buildFabricMesh(paths, material, {
      radius, radialSegments: 6, shadows: this._shadows,
      fiberType: this.opts.fiberType,
    });
    this.group = group;

    // measure the loops, then add an opaque backing so the swatch has body and
    // the valleys / eyelets read as dark shadow instead of see-through gaps.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Compute the pile's sizing ONCE — the backing plane must sit behind the
    // pile's full reach (fibres can extend well past the bare loop mesh), or
    // the "flip to back" view stares straight into an opaque backing instead
    // of the brushed nap (previously the backing only cleared the plain loop
    // geometry, so it silently occluded most/all of the pile from behind).
    const pileParams = this._pileParams(radius);
    this._addBacking(group, center, size, radius, box, pileParams ? pileParams.maxReach : 0);
    this._addPile(group, box, pileParams);
    this._addGrainline(group, box, size);

    this.scene.add(group);

    // centre on the loops + fit so the fabric COVERS the frame (fills edge-to-edge)
    group.position.sub(center);
    this._size = size;
    this._fitDist = this._coverDistance(size);
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

  // Camera-distance LOD (material tier): near → stronger normal-map relief so
  // the twist/fibre reads when zoomed in; far → softer so it doesn't shimmer.
  _applyLod() {
    const m = this._material;
    if (!m || !m.userData || !m.userData.baseNormalScale || !this.controls) return;
    const ratio = this.controls.getDistance() / (this._fitDist || 1);
    const k = ratio < 0.6 ? 1.4 : ratio > 1.3 ? 0.65 : 1.0;
    if (k === this._lodK) return;                 // only on tier transition
    this._lodK = k;
    const ns = m.userData.baseNormalScale * k;
    m.normalScale.set(ns, ns);
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
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    mat.color.setRGB((d.r / 255) * s, (d.g / 255) * s, (d.b / 255) * s, THREE.SRGBColorSpace);
    const geo = new THREE.PlaneGeometry(size.x * BACKING.pad, size.y * BACKING.pad);
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

  _addPile(group, box, pileParams) {
    if (!pileParams) return;
    const { kind, pileRadius, pileDensity, lengthScale, zOffset } = pileParams;
    const bounds = {
      minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y,
      z: box.min.z - zOffset,   // behind the fabric
    };
    // A raised, torn-fibre nap scatters light differently than the smooth
    // knit face — slightly lighter and softer (higher roughness/sheen) than
    // the flat dyed yarn, which is how a real brushed pile reads next to its
    // own base colour. Reusing the exact same material made the pile blend
    // into the backing instead of reading as a distinct fuzzy surface.
    const pileMat = this._material.clone();
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

  setColor(hex) {
    if (this._material) setYarnColorHex(this._material, hex);
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
  }

  setView(which) {
    if (!this.camera || !this.controls) return;
    const d = this._fitDist || 30;
    const back = which === 'back';
    this.camera.position.set(0, 0, back ? -d : d);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this._setLightSide(back);
  }

  // Mirror the whole 3-point rig across the fabric when the swatch is
  // flipped, so the side actually facing the camera always gets the key
  // light (not whatever happened to be aimed at it from the OTHER side).
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
    if (this.controls) this.controls.reset();
    this._setLightSide(false);   // reset() always returns to the saved FRONT state
  }

  toggleWire() {
    if (!this._material) return false;
    this._material.wireframe = !this._material.wireframe;
    const on = this._material.wireframe;
    // hide the solid backing (and pile) so the loop paths are fully visible
    if (this._backing && this._backing.mesh) this._backing.mesh.visible = !on;
    if (this._pile && this._pile.mesh) this._pile.mesh.visible = !on;
    return on;
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
      dir.multiplyScalar(newFit / len);
      this.camera.position.copy(this.controls.target).add(dir);
      this.controls.minDistance = newFit * 0.35;
      this.controls.maxDistance = newFit * 2.2;
      this._fitDist = newFit;
      this.controls.update();
    }
  }

  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.group) {
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    if (this._backing) { this._backing.geo.dispose(); this._backing.mat.dispose(); }
    if (this._pile) this._pile.geometry.dispose();
    if (this._textures) this._textures.forEach((t) => t.dispose());
    if (this._material) this._material.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
}
