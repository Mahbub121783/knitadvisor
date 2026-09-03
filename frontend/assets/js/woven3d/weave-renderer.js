// KnitAdvisor · woven3d — WebGL renderer / lifecycle for a plain/twill/satin
// weave patch.
//
// Deliberately mirrors knit3d/knit-renderer.js's public API (mount/setView/
// resetView/toggleWire/setLightPreset/captureHiRes/resize/dispose) so the
// visualizer's tab/toolbar code can treat a woven and a knit 3-D view almost
// identically — and reuses that module's generic, non-knit-specific pieces
// outright (buildFabricMesh's tube builder, createYarnMaterial's PBR twist
// shading, the studio lighting rig, the analytic drape field) rather than
// duplicating them. Only the topology (weave-mesh.js) is genuinely new: one
// weave family, unlike knit's several.
//
// opts (from woven-visualizer.js):
//   { warpColor, weftColor, warpFiberType, weftFiberType, warpTwist, weftTwist,
//     warpNe, weftNe, endsPerInch, picksPerInch, grid, repeatEnds, repeatPicks }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { buildWeavePaths } from './weave-mesh.js?v=20260903a';
import { createYarnMaterial } from '../knit3d/yarn-material.js?v=20260608g';
import { buildFabricMesh, yarnDiameterMm } from '../knit3d/fabric-mesh.js?v=20260608g';
import { addStudioLighting, configureShadowCamera, applyLightPreset, DEFAULT_LIGHT_PRESET } from '../knit3d/lighting.js?v=20260608g';
import { applyDrape } from '../knit3d/drape.js?v=20260608g';

const VIEW_HEIGHT = 380;

export class Woven3D {
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
    this._key = lights.key; this._fill = lights.fill; this._rim = lights.rim; this._hemi = lights.hemi;
    this._lightBaseZ = { key: this._key.position.z, fill: this._fill.position.z, rim: this._rim.position.z };
    this._showingBack = false;
    this._lightPreset = DEFAULT_LIGHT_PRESET;

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    this._buildFabric();
    if (this._shadows) configureShadowCamera(this._key, this._size);

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

    controls.addEventListener('change', () => { this._setLightSide(this.camera.position.z < 0); });

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

  _lodScale() {
    const w = (this.container && this.container.clientWidth) || 460;
    const dpr = window.devicePixelRatio || 1;
    if (w < 380 || dpr < 1) return 0.7;
    if (w < 520) return 0.85;
    return 1.0;
  }

  _buildFabric() {
    const o = this.opts;
    const warpNe = o.warpNe || 20, weftNe = o.weftNe || 20;
    const epi = o.endsPerInch || 60, ppi = o.picksPerInch || 50;
    const repeatEnds = Math.max(1, o.repeatEnds || 1);
    const repeatPicks = Math.max(1, o.repeatPicks || 1);

    // Scene units = mm, so density (sett) and yarn diameter share one scale —
    // the same "real physical units, not an arbitrary grid" principle knit3d
    // uses (constants.js's PITCH_X/PITCH_Y in stitch units; here, real mm).
    const pitchEndMm = 25.4 / epi;
    const pitchPickMm = 25.4 / ppi;
    const warpDiaMm = yarnDiameterMm(warpNe) * (o.warpFibreScale || 1);
    const weftDiaMm = yarnDiameterMm(weftNe) * (o.weftFibreScale || 1);
    // How far a thread rises/dips at a crossing: half the combined diameter,
    // the geometric minimum for the two threads to actually clear each other.
    const amp = (warpDiaMm + weftDiaMm) * 0.30;

    const lod = this._lodScale();
    const snap = (target, repeat) => Math.max(repeat, Math.round(target / repeat) * repeat);
    let ends = snap(Math.round(22 * lod), repeatEnds);
    let picks = snap(Math.round(20 * lod), repeatPicks);
    const CAP = 900;
    if (ends * picks > CAP) {
      const k = Math.sqrt(CAP / (ends * picks));
      ends = snap(Math.max(repeatEnds, Math.round(ends * k)), repeatEnds);
      picks = snap(Math.max(repeatPicks, Math.round(picks * k)), repeatPicks);
    }

    const { warpPaths, weftPaths } = buildWeavePaths({
      grid: o.grid, repeatEnds, repeatPicks, ends, picks,
      pitch: { end: pitchEndMm, pick: pitchPickMm },
      amplitude: amp,
    });

    // Analytic drape (knit3d/drape.js — generic over any {points} array, not
    // knit-specific): both yarn families deform together so the cloth reads
    // as one continuous surface, not two independently-bulging grids.
    const drapeAmount = 0.4;
    applyDrape(warpPaths, { amount: drapeAmount });
    applyDrape(weftPaths, { amount: drapeAmount });

    const warpMat = createYarnMaterial({
      dyed: o.warpColor, fiberType: o.warpFiberType || o.fiberType, twist: o.warpTwist,
    }).material;
    const weftMat = createYarnMaterial({
      dyed: o.weftColor, fiberType: o.weftFiberType || o.fiberType, twist: o.weftTwist,
    }).material;
    this._warpMat = warpMat;
    this._weftMat = weftMat;

    const group = new THREE.Group();
    const warpGroup = buildFabricMesh(warpPaths, warpMat,
      { radius: warpDiaMm / 2, radialSegments: 6, shadows: this._shadows, fiberType: o.warpFiberType || o.fiberType });
    const weftGroup = buildFabricMesh(weftPaths, weftMat,
      { radius: weftDiaMm / 2, radialSegments: 6, shadows: this._shadows, fiberType: o.weftFiberType || o.fiberType });
    group.add(warpGroup);
    group.add(weftGroup);
    this.group = group;

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._addBacking(group, center, size, Math.max(warpDiaMm, weftDiaMm) / 2, box);

    this.scene.add(group);
    group.position.sub(center);
    this._size = size;
    this._fitDist = this._coverDistance(size);
  }

  _coverDistance(size) {
    const t = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const aspect = this.camera.aspect || 1.8;
    const distFillHeight = size.y / (2 * t);
    const distFillWidth = size.x / (2 * t * aspect);
    return Math.min(distFillHeight, distFillWidth) * 0.98;
  }

  // A neutral backing plane behind both yarn families — mainly a shadow
  // receiver, and it keeps an open-sett (low EPI/PPI) weave from reading as
  // threads floating in empty space at the gaps between them.
  _addBacking(group, center, size, radius, box) {
    const w = this.opts.warpColor || { r: 200, g: 190, b: 170 };
    const f = this.opts.weftColor || w;
    const avg = { r: (w.r + f.r) / 2, g: (w.g + f.g) / 2, b: (w.b + f.b) / 2 };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    mat.color.setRGB((avg.r / 255) * 0.55, (avg.g / 255) * 0.55, (avg.b / 255) * 0.55, THREE.SRGBColorSpace);
    const geo = new THREE.PlaneGeometry(size.x * 1.15, size.y * 1.15);
    const plane = new THREE.Mesh(geo, mat);
    const backZ = box ? box.min.z - radius * 1.6 : -radius * 3;
    plane.position.set(center.x, center.y, backZ);
    if (this._shadows) plane.receiveShadow = true;
    group.add(plane);
    this._backing = { geo, mat, mesh: plane };
  }

  setLightPreset(name) {
    this._lightPreset = name;
    applyLightPreset({ key: this._key, fill: this._fill, rim: this._rim, hemi: this._hemi }, name);
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

  _setLightSide(back) {
    if (this._showingBack === back) return;
    this._showingBack = back;
    const z = this._lightBaseZ;
    if (!z) return;
    const sign = back ? -1 : 1;
    if (this._key) this._key.position.z = z.key * sign;
    if (this._fill) this._fill.position.z = z.fill * sign;
    if (this._rim) this._rim.position.z = z.rim * sign;
  }

  resetView() {
    if (this.controls) this.controls.reset();
    this._setLightSide(false);
  }

  toggleWire() {
    if (!this._warpMat || !this._weftMat) return false;
    const on = !this._warpMat.wireframe;
    this._warpMat.wireframe = on;
    this._weftMat.wireframe = on;
    if (this._backing && this._backing.mesh) this._backing.mesh.visible = !on;
    return on;
  }

  captureHiRes(scale = 3) {
    if (!this.renderer || !this.camera || !this.container) return null;
    const W = this.container.clientWidth || 460, H = VIEW_HEIGHT;
    this.renderer.setSize(W * scale, H * scale, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.resize();
    return url;
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const W = this.container.clientWidth || 460;
    const H = VIEW_HEIGHT;
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
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
    if (this._warpMat) this._warpMat.dispose();
    if (this._weftMat) this._weftMat.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
}
