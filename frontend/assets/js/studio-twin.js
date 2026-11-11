// KnitAdvisor · Fabric Studio — the yarn view: the drawn knit as interlocked yarn, its shape solved by the
// yarn model (backend engine/domain/yarn-twin.js) inside the cell the Studio predicted. One continuous tube
// per course, real loop threading, lit with image-based light, twist and a fine fibre halo.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './view-guard.js?v=20261111b';

/** A soft studio environment built in code: a gradient dome and three softboxes, prefiltered for PBR reflections. */
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color('#dfe6f0') }, bottom: { value: new THREE.Color('#8b8f98') } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.6, 0.8, h)), 1.0); }',
  }));
  scene.add(dome);
  const box = (w, h, x, y, z, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(30, 22, -22, 24, 26, 6); box(18, 30, 30, 8, 14, 3.2); box(40, 8, 0, -10, -35, 2);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  return rt.texture;
}

/** Diagonal fibre-wrap texture used as a bump map along the tube: the twist of a spun yarn. */
function twistTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 64);
  for (let i = -64; i < 128; i += 8) {
    const grad = g.createLinearGradient(i, 0, i + 6, 0);
    grad.addColorStop(0, '#808080'); grad.addColorStop(0.5, '#e6e6e6'); grad.addColorStop(1, '#808080');
    g.save(); g.translate(0, 0); g.transform(1, 0, 0.35, 1, 0, 0);       // slant: fibres lie across the yarn at the twist angle
    g.fillStyle = grad; g.fillRect(i, 0, 6, 64); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export class TwinView {
  constructor(host) {
    this.host = host;
    const w = host.clientWidth || 640, h = host.clientHeight || 440;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 800);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.redraw());
    // the wheel scrolls the page past the view; Ctrl/⌘ + wheel, a pinch, or a click first zooms it
    this._unguard = window.KAViewGuard ? window.KAViewGuard.wheel(this.renderer.domElement, this.controls) : null;
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-6, 9, 12); this.scene.add(key);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.twist = twistTexture();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(host);
  }

  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderer.render(this.scene, this.camera); });
  }

  _clear() {
    while (this.group.children.length) {
      const o = this.group.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
  }

  /**
   * @param tw  the /api/studio/twin answer (supported)
   * @param o   { colour, repsY }
   */
  draw(tw, o = {}) {
    this._clear();
    const { Lx, Ly } = tw.cell, n = tw.nodes.length;
    const repsX = Math.max(2, Math.round(9 / Math.max(1, tw.wales.length))), repsY = o.repsY || 6;
    const colour = new THREE.Color(o.colour || '#3d5a80');
    const mat = new THREE.MeshPhysicalMaterial({
      color: colour, roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: colour.clone().lerp(new THREE.Color('#ffffff'), 0.55),
      bumpMap: this.twist, bumpScale: 0.9, envMapIntensity: 0.85,
    });
    const hairPts = [];
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let iy = 0; iy < repsY; iy++) {
      const pts = [];
      for (let ix = 0; ix < repsX; ix++) for (let k = 0; k < n; k++) pts.push(new THREE.Vector3(tw.nodes[k][0] + ix * Lx, tw.nodes[k][1] + iy * Ly, tw.nodes[k][2]));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, pts.length * 2, 0.5, 10, false);
      const uv = geo.attributes.uv;                                          // repeat the twist along the yarn: one turn about every 3.2 yarn diameters of length
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (pts.length * 0.5 / 3.2) * 0.5, uv.getY(i));
      this.group.add(new THREE.Mesh(geo, mat));
      // the halo: short fibre ends standing out of the yarn, a few per diameter of length
      for (let k = 0; k < pts.length - 1; k += 1) {
        for (let h = 0; h < 2; h++) {
          const p = curve.getPointAt((k + rnd()) / (pts.length - 1)), t = curve.getTangentAt(Math.min(0.999, (k + 0.5) / (pts.length - 1)));
          const ang = rnd() * Math.PI * 2, nx = Math.cos(ang), nz = Math.sin(ang);
          const out = new THREE.Vector3(nx, rnd() * 2 - 1, nz).normalize();
          const a = p.clone().addScaledVector(out, 0.46), len = 0.35 + rnd() * 0.7;
          const b = a.clone().addScaledVector(out, len * 0.7).addScaledVector(t, (rnd() - 0.5) * len * 1.4);
          hairPts.push(a, b);
        }
      }
    }
    const hairGeo = new THREE.BufferGeometry().setFromPoints(hairPts);
    this.group.add(new THREE.LineSegments(hairGeo, new THREE.LineBasicMaterial({ color: colour.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0.32 })));
    // centre and frame
    const cx = (repsX * Lx) / 2, cy = (repsY * Ly) / 2;
    this.centre = new THREE.Vector3(cx, cy, 0);
    this.span = Math.max(repsX * Lx, repsY * Ly);
    this.group.position.set(-cx, -cy, 0);
    this.centre.set(0, 0, 0);
    this.view('angle');
  }

  view(name) {
    const D = this.span * 1.65;
    const p = ({ face: [0, 0, D], back: [0, 0, -D], edge: [D, 0, 0], angle: [D * 0.35, D * 0.3, D * 0.9] })[name] || [0, 0, D];
    this.camera.position.set(p[0], p[1], p[2]);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0); this.controls.update();
    this.redraw();
  }

  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.redraw();
  }

  dispose() { if (this._unguard) this._unguard(); this._ro.disconnect(); this._clear(); this.renderer.dispose(); this.host.innerHTML = ''; }
}
