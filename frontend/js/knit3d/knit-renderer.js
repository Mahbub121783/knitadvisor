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
    controls.addEventListener('change', () => this._applyLod());

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

    const baseCourses = con.type === 'interlock' ? 30 : 40;
    let courses = Math.max(12, Math.round(baseCourses * lod * density.scalar));
    let wales = Math.max(14, Math.round(courses * pitchY * aspect * ribComp));
    // performance cap — keep total stitches bounded; shrink loops, not the count
    const CAP = 3200;
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
    this._addBacking(group, center, size, radius, box);
    this._addPile(group, box, radius);

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

  _addBacking(group, center, size, radius, box) {
    const d = this.opts.dyed || { r: 120, g: 124, b: 134 };
    const sd = (this.opts.physics && typeof this.opts.physics.shadow_depth === 'number')
      ? this.opts.physics.shadow_depth : 0.1;
    const s = BACKING.shade * (1 - sd * 0.45);     // deeper cavities → darker body
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    mat.color.setRGB((d.r / 255) * s, (d.g / 255) * s, (d.b / 255) * s, THREE.SRGBColorSpace);
    const geo = new THREE.PlaneGeometry(size.x * BACKING.pad, size.y * BACKING.pad);
    const plane = new THREE.Mesh(geo, mat);
    // Sit strictly behind the DEEPEST actual loop geometry, not the fixed
    // single-bed BACKING.z constant. Rib's mirrored purl loops (zBase =
    // -RIB_DEPTH, then the loop's own local depth profile mirrored on top)
    // and interlock's back bed both push well past that old fixed plane —
    // verified every purl control point landed BEHIND it, so the back/
    // "down" side of a rib never actually rendered, fully occluded by this
    // plane. box.min.z is the true measured depth of this fabric's mesh, so
    // this generalizes to any construction without per-type constants.
    const backZ = box ? Math.min(BACKING.z, box.min.z - radius * 1.5) : BACKING.z;
    plane.position.set(center.x, center.y, backZ);
    if (this._shadows) plane.receiveShadow = true;   // loops drop contact shadows here
    group.add(plane);
    this._backing = { geo, mat, mesh: plane, baseShade: s };
  }

  _addPile(group, box, radius) {
    const con = this.opts.construction || {};
    if (!con.brush && con.pile !== 'loop') return;
    const kind = con.pile === 'loop' ? 'loop' : 'brush';
    const bounds = {
      minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y,
      z: box.min.z - radius * (kind === 'loop' ? 0.6 : 1.0),   // behind the fabric
    };
    const { mesh, geometry } = buildPile(kind, bounds, this._material, { radius });
    if (this._shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);
    this._pile = { mesh, geometry };
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
  }

  setView(which) {
    if (!this.camera || !this.controls) return;
    const d = this._fitDist || 30;
    this.camera.position.set(0, 0, which === 'back' ? -d : d);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  resetView() {
    if (this.controls) this.controls.reset();
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
