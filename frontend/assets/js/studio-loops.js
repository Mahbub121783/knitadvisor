// KnitAdvisor · Fabric Studio — the loop view: every yarn of a few repeats of
// the drawn programme, one tube per course, coloured by the feeder that laid
// it. Close enough to read each knit, tuck and miss and to follow a yarn from
// needle to needle; the geometry is in studio-loop-geom.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './studio-loop-geom.js?v=20261106b';

const FEED_COLOURS = ['#1857C4', '#0f9d76', '#c2410c', '#7a4fc2', '#b8860b', '#0e7490', '#be185d', '#4d7c0f', '#9a3412', '#334155', '#0369a1', '#a16207'];
const ROLE_COLOURS = { ground: '#1857C4', face: '#1857C4', binder: '#7a4fc2', loop: '#c2410c' };
const ELASTANE = '#f5f5f4';

export function feedColour(spec, f) {
  if (spec.colourBy === 'role') return ROLE_COLOURS[(spec.feeds[f] || {}).role] || ROLE_COLOURS.ground;
  if (spec.colourBy === 'one') return spec.colour || '#3d5a80';
  return FEED_COLOURS[f % FEED_COLOURS.length];
}

export class LoopView {
  constructor(host, onHover) {
    this.host = host;
    this.onHover = onHover || (() => {});
    const w = host.clientWidth || 600, hh = host.clientHeight || 420;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, hh);
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, w / hh, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // drawn on demand, not every frame: the page stays light while you edit
    this.controls.addEventListener('change', () => this.redraw());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-4, 7, 10); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(5, -3, -9); this.scene.add(rim);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.meshes = [];
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._move = (e) => this._hover(e);
    this._leave = () => this.onHover(null);
    this.renderer.domElement.addEventListener('pointermove', this._move);
    this.renderer.domElement.addEventListener('pointerleave', this._leave);
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(host);
  }

  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderer.render(this.scene, this.camera); });
  }

  draw(spec) {
    this.spec = spec;
    this._clear();
    const geo = globalThis.KALoopGeom.buildLoopPaths(spec);
    this.geo = geo;
    const cx = (geo.wales - 1) / 2 + (spec.D && geo.bed === 'rib' ? 0.25 : 0), cy = (geo.rows - 1) * geo.h / 2 + 0.4 * geo.h;
    this.centre = new THREE.Vector3(cx, cy, 0);
    geo.courses.forEach((co) => {
      const r = (spec.radius && spec.radius[co.feed]) || 0.13;
      const v = co.points.map((p) => new THREE.Vector3(p.x - cx, p.y - cy, p.z));
      const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
      const tube = new THREE.TubeGeometry(curve, Math.max(48, v.length * 4), r, 8, false);
      const mat = new THREE.MeshStandardMaterial({ color: feedColour(spec, co.feed), roughness: 0.62, metalness: 0.02, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(tube, mat);
      mesh.userData = { course: co.course, feed: co.feed };
      this.group.add(mesh); this.meshes.push(mesh);
      if (spec.plated && spec.plated[co.feed]) {
        // the elastane is plated: it follows the ground yarn's path, one
        // yarn's width toward the technical back of whichever bed it is on
        const e = co.points.map((p, i) => new THREE.Vector3(p.x - cx, p.y - cy, p.z - co.side[i] * (r * 1.1)));
        const ec = new THREE.CatmullRomCurve3(e, false, 'centripetal', 0.5);
        const em = new THREE.Mesh(new THREE.TubeGeometry(ec, Math.max(48, e.length * 4), r * 0.42, 6, false),
          new THREE.MeshStandardMaterial({ color: ELASTANE, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 1 }));
        em.userData = { course: co.course, feed: co.feed, elastane: true };
        this.group.add(em); this.meshes.push(em);
      }
    });
    this.setStep(this._step == null ? null : this._step);
    this.highlight(this._hl == null ? null : this._hl);
    if (!this._viewed) this.view('angle');
    this.redraw();
    return geo;
  }

  view(name) {
    this._viewed = true;
    const g = this.geo; if (!g) return;
    // fit the swatch to whichever of width and height binds at this aspect
    const t = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    const d = 1.12 * Math.max(g.wales / (t * this.camera.aspect), (g.rows * (g.step || g.h) + g.h) / t);
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
    this.meshes.forEach((m) => { m.material.opacity = feed == null || m.userData.feed === feed ? 1 : 0.12; m.material.depthWrite = feed == null || m.userData.feed === feed; });
    this.redraw();
  }

  _hover(e) {
    if (!this.geo) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.meshes.filter((m) => m.visible && m.material.opacity > 0.5), false);
    if (!hits.length) return this.onHover(null);
    const hit = hits[0], co = this.geo.courses[hit.object.userData.course];
    const px = hit.point.x + this.centre.x, pz = hit.point.z;
    let best = null, bd = 1e9;
    co.stitches.forEach((s) => {
      const bedZ = s.bed === 'C' ? this.geo.zc : -this.geo.zc;
      const dd = Math.abs(s.x - px) + (this.geo.zc ? Math.abs(bedZ - pz) * 0.6 : 0);
      if (dd < bd) { bd = dd; best = s; }
    });
    this.onHover(best ? { ...best, elastane: !!hit.object.userData.elastane, clientX: e.clientX - r.left, clientY: e.clientY - r.top } : null);
  }

  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
    this.redraw();
  }

  _clear() {
    this.meshes.forEach((m) => { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); });
    this.meshes = [];
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this._move);
    this.renderer.domElement.removeEventListener('pointerleave', this._leave);
    this._clear(); this.controls.dispose(); this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
