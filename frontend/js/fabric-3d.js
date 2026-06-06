// KnitAdvisor — True 3D fabric renderer (WebGL / Three.js)
// Builds a real knit patch from 3-D yarn-tube loops so front/back and the
// over/under intermesh are intrinsic to the geometry. Lazy-imported by
// fabric-visualizer.js only when the 3D tab is opened.
//
// opts (from FabricVisualizer._faceOpts):
//   { dyed:{r,g,b}, construction:{type,ribRepeat,...}, countNe, tf,
//     fiberType, sheen, sample(w,c) -> 'knit'|'purl'|'tuck'|'miss' }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PITCH_X = 1.0;     // wale spacing (loop is ~unit sized)
const PITCH_Y = 0.80;    // course spacing (loops overlap vertically → dense cloth)

// One stockinette needle-loop centreline. Head arches forward (+z); the legs
// dip back (−z) and the feet splay beyond the cell so neighbours interlock.
// Technical FACE faces +z: the two legs (the knit "V") come toward the viewer,
// while the head arch recedes to −z. The loop above's feet pass behind this
// loop's head → real over/under. (Back view then shows the purl head bumps.)
function loopCurve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.62, -0.58,  0.16),  // left foot, forward
    new THREE.Vector3(-0.52, -0.22,  0.20),  // left leg, forward (the visible V)
    new THREE.Vector3(-0.40,  0.12,  0.06),
    new THREE.Vector3(-0.26,  0.46, -0.16),  // rising, receding to the head
    new THREE.Vector3( 0.00,  0.64, -0.28),  // head arch, back
    new THREE.Vector3( 0.26,  0.46, -0.16),
    new THREE.Vector3( 0.40,  0.12,  0.06),
    new THREE.Vector3( 0.52, -0.22,  0.20),  // right leg, forward
    new THREE.Vector3( 0.62, -0.58,  0.16),  // right foot, forward
  ], false, 'catmullrom', 0.5);
}

// Small procedural fibre-noise bump texture so yarn isn't a smooth plastic tube.
function fibreBump() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 5000; i++) {
    const v = 96 + Math.random() * 64 | 0;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}

export class Fabric3D {
  constructor() {
    this._raf = null;
    this._ro = null;
    this._disposed = false;
  }

  mount(container, opts) {
    this.container = container;
    this.opts = opts || {};
    const W = container.clientWidth || 460;
    const H = 380;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.domElement.style.cssText = 'width:100%;height:380px;display:block;border-radius:12px;cursor:grab;';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    // Lighting — soft studio so the dye reads as colour, not flat fill.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(4, -2, 3);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    this._buildFabric();

    // position the camera to the front BEFORE creating controls so OrbitControls
    // saves the front view as its reset state.
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

  _yarnRadius() {
    const ne = this.opts.countNe || 30;
    const tf = typeof this.opts.tf === 'number' ? this.opts.tf : 14;
    let r = 0.235 + (30 - ne) * 0.0028;      // finer yarn → a bit thinner
    r *= 1 + (tf - 14) * 0.010;               // tighter → fuller coverage
    return Math.max(0.18, Math.min(r, 0.34));
  }

  _material() {
    const d = this.opts.dyed || { r: 120, g: 124, b: 134 };
    const fiber = this.opts.fiberType || 'cotton';
    const rough = fiber === 'polyester' || fiber === 'nylon' ? 0.45
      : fiber === 'modal' || fiber === 'viscose' ? 0.72 : 0.92;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.r / 255, d.g / 255, d.b / 255),
      roughness: rough,
      metalness: 0.0,
    });
    if (fiber === 'cotton' || fiber === 'modal' || fiber === 'viscose') {
      mat.bumpMap = fibreBump();
      mat.bumpScale = 0.015;
    }
    this._mat = mat;
    return mat;
  }

  _buildFabric() {
    const con = this.opts.construction || { type: 'jersey' };
    const sample = typeof this.opts.sample === 'function' ? this.opts.sample : () => 'knit';
    const wales = con.type === 'interlock' ? 15 : 16;
    const courses = 18;
    const radius = this._yarnRadius();

    const geo = new THREE.TubeGeometry(loopCurve(), 48, radius, 10, false);
    const mat = this._material();

    const group = new THREE.Group();
    this.group = group;
    scene_addLoops.call(this, group, geo, mat, con, sample, wales, courses);
    this.scene.add(group);

    // centre + fit
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y);
    this._fitDist = (maxDim / (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2))) * 0.80;
  }

  setColor(hex) {
    if (!this._mat) return;
    this._mat.color.set(hex);
  }

  setView(which) {
    if (!this.camera || !this.controls) return;
    const d = this._fitDist || 30;
    if (which === 'back') this.camera.position.set(0, 0, -d);
    else this.camera.position.set(0, 0, d);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  resetView() {
    if (!this.controls) return;
    this.controls.reset();   // restores the saved front view
  }

  toggleWire() {
    if (!this._mat) return;
    this._mat.wireframe = !this._mat.wireframe;
    return this._mat.wireframe;
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const W = this.container.clientWidth || 460;
    const H = 380;
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.bumpMap) o.material.bumpMap.dispose();
          o.material.dispose();
        }
      });
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode)
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

// Place the loop instances for a construction. Separated to keep mount() lean.
function scene_addLoops(group, geo, mat, con, sample, wales, courses) {
  const dummy = new THREE.Object3D();
  const rep = con.ribRepeat || 1;

  // helper to add one instanced layer with a placement callback
  const addLayer = (xOffset, zBase, purlFlip) => {
    const mesh = new THREE.InstancedMesh(geo, mat, wales * courses);
    let i = 0;
    for (let c = 0; c < courses; c++) {
      for (let w = 0; w < wales; w++) {
        const tok = sample(w, c);
        dummy.position.set(w * PITCH_X + xOffset, c * PITCH_Y, zBase);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        if (con.type === 'rib') {
          const knitCol = (((w % (rep * 2)) + rep * 2) % (rep * 2)) < rep;
          dummy.position.z = knitCol ? 0.14 : -0.14;
          if (!knitCol) dummy.rotation.y = Math.PI;      // purl wale shows its back
        }
        if (tok === 'tuck' || tok === 'miss') {
          dummy.scale.y = 1.4;                           // held / elongated loop
          dummy.position.z -= 0.05;
          dummy.position.y += PITCH_Y * 0.18;
        }
        if (purlFlip) dummy.rotation.y = Math.PI;
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  };

  if (con.type === 'interlock') {
    addLayer(0, 0.16, false);                 // front bed
    addLayer(PITCH_X * 0.5, -0.16, true);     // back bed, half-pitch, flipped
  } else {
    addLayer(0, 0, false);
  }
}
