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

import { buildYarnPaths } from './topology-builder.js?v=20260608d';
import { createYarnMaterial, setYarnColorHex } from './yarn-material.js?v=20260608d';
import { buildFabricMesh, yarnRadius } from './fabric-mesh.js?v=20260608d';
import { addStudioLighting } from './lighting.js?v=20260608d';
import { buildPile } from './pile.js?v=20260608d';
import { BACKING, PATCH } from './constants.js?v=20260608d';

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText =
      'width:100%;height:380px;display:block;border-radius:12px;cursor:grab;';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    addStudioLighting(scene);

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    this._buildFabric();

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
    });
    this._material = material;
    this._textures = textures;

    // LOD: thin the patch on small viewports / low-DPR devices so weak GPUs
    // stay smooth (camera zoom still reveals detail).
    const lod = this._lodScale();
    const { paths } = buildYarnPaths({
      construction: this.opts.construction,
      sample: this.opts.sample,
      wales: Math.round((this.opts.construction.base === 'warp' ? PATCH.wales : PATCH.wales) * lod),
      courses: Math.round(PATCH.courses * lod),
    });

    const radius = yarnRadius(this.opts.countNe, this.opts.tf);
    const group = buildFabricMesh(paths, material, { radius, radialSegments: 7 });
    this.group = group;

    // measure the loops, then add an opaque backing so the swatch has body and
    // the valleys / eyelets read as dark shadow instead of see-through gaps.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._addBacking(group, center, size, radius);
    this._addPile(group, box, radius);

    this.scene.add(group);

    // centre on the loops + fit to frame
    group.position.sub(center);
    const maxDim = Math.max(size.x, size.y);
    this._fitDist = (maxDim / (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2))) * 0.78;
  }

  // density multiplier from viewport — full on desktop, lighter on small/low-DPR
  _lodScale() {
    const w = (this.container && this.container.clientWidth) || 460;
    const dpr = window.devicePixelRatio || 1;
    if (w < 380 || dpr < 1) return 0.7;
    if (w < 520) return 0.85;
    return 1.0;
  }

  _addBacking(group, center, size, radius) {
    const d = this.opts.dyed || { r: 120, g: 124, b: 134 };
    const sd = (this.opts.physics && typeof this.opts.physics.shadow_depth === 'number')
      ? this.opts.physics.shadow_depth : 0.1;
    const s = BACKING.shade * (1 - sd * 0.45);     // deeper cavities → darker body
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    mat.color.setRGB((d.r / 255) * s, (d.g / 255) * s, (d.b / 255) * s, THREE.SRGBColorSpace);
    const geo = new THREE.PlaneGeometry(size.x * BACKING.pad, size.y * BACKING.pad);
    const plane = new THREE.Mesh(geo, mat);
    plane.position.set(center.x, center.y, BACKING.z);
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
