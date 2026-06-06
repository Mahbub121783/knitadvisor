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

// Yarn TWIST texture — diagonal helical grooves around the tube so the yarn
// reads as spun-and-twisted (S/Z) with fibre fuzz, not a smooth plastic pipe.
// Used as a bump map; UV u runs along the yarn, v around it, so diagonal bands
// + repeat give a helix (the twist).
function twistTexture(fiber, synthetic, zTwist) {
  const w = 96, h = 96;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  const dir = zTwist ? 1 : -1;
  const step = 7;
  // twist grooves (dark) + ridges (light)
  for (let i = -h; i < w + h; i += step) {
    ctx.strokeStyle = '#5f5f5f'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + dir * h, h); ctx.stroke();
    ctx.strokeStyle = '#a6a6a6'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(i + dir * 2.6, 0); ctx.lineTo(i + dir * (h + 2.6), h); ctx.stroke();
  }
  // fibre fuzz speckle (cotton/viscose) so the surface isn't a clean tube
  if (!synthetic) {
    for (let k = 0; k < 2600; k++) {
      const v = 100 + (Math.random() * 56 | 0);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1.2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(7, 2);     // 7 twists per loop-length, wraps twice around
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;   // filmic so PBR colour looks natural
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'width:100%;height:380px;display:block;border-radius:12px;cursor:grab;';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    this.camera = camera;

    // Soft studio lighting (intensities tuned for ACES tone mapping) so the dye
    // reads as true colour and the yarn looks lit, not flat.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4f5a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xeef2ff, 0.8);
    fill.position.set(4, -1, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, 2, -5);     // back rim so the purl side reads when flipped
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

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
    const synthetic = fiber === 'polyester' || fiber === 'nylon';
    const rough = synthetic ? 0.42 : fiber === 'modal' || fiber === 'viscose' ? 0.62 : 0.84;

    const col = new THREE.Color().setRGB(d.r / 255, d.g / 255, d.b / 255, THREE.SRGBColorSpace);
    const mat = new THREE.MeshPhysicalMaterial({
      color: col,
      roughness: rough,
      metalness: 0.0,
      // sheen = the soft fuzzy cloth fibre halo (cotton high, synthetic low)
      sheen: synthetic ? 0.35 : 1.0,
      sheenRoughness: synthetic ? 0.45 : 0.9,
      sheenColor: col.clone().lerp(new THREE.Color(1, 1, 1), 0.55),
      // anisotropic specular so highlights run ALONG the twisted yarn
      anisotropy: synthetic ? 0.7 : 0.35,
      anisotropyRotation: 0,
      // a touch of clearcoat gives polyester its sporty sheen
      clearcoat: synthetic ? 0.3 : 0.0,
      clearcoatRoughness: 0.55,
    });
    const tw = twistTexture(fiber, synthetic, true);
    mat.bumpMap = tw;
    mat.bumpScale = synthetic ? 0.008 : 0.02;
    this._twistTex = tw;
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
    geo.computeTangents();          // required for anisotropic specular along the yarn
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
//
//  • RIB  — alternating wales sit on the front bed (+z, knit ridge) and the
//    back bed (−z, rotated → its purl heads recede into the valley). The wale
//    pitch draws in so the knit ridges stand proud, giving real corrugation.
//    Reversible: the back view shows the same ridge/valley pattern, offset.
//  • INTERLOCK — two full all-knit jerseys locked face-to-face: a front bed
//    (knit facing +z) and an ALIGNED back bed (knit facing −z) pushed well
//    behind so it never pokes through. Both faces read as a fine, stable
//    all-knit fabric (the defining trait of interlock).
function scene_addLoops(group, geo, mat, con, sample, wales, courses) {
  const dummy = new THREE.Object3D();
  const rep = con.ribRepeat || 1;
  const RIB_DEPTH = 0.40;       // front/back bed separation for rib ridges
  const xPitch = con.type === 'rib' ? PITCH_X * 0.78 : PITCH_X;  // rib draws in

  const addLayer = (xOffset, zBase, flip) => {
    const mesh = new THREE.InstancedMesh(geo, mat, wales * courses);
    let i = 0;
    for (let c = 0; c < courses; c++) {
      for (let w = 0; w < wales; w++) {
        const tok = sample(w, c);
        dummy.position.set(w * xPitch + xOffset, c * PITCH_Y, zBase);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        if (con.type === 'rib') {
          const knitCol = (((w % (rep * 2)) + rep * 2) % (rep * 2)) < rep;
          dummy.position.z = zBase + (knitCol ? RIB_DEPTH : -RIB_DEPTH);
          if (!knitCol) dummy.rotation.y = Math.PI;      // purl wale recedes, shows its back
        }
        if (tok === 'tuck' || tok === 'miss') {
          dummy.scale.y = 1.4;                           // held / elongated loop
          dummy.position.z -= 0.05;
          dummy.position.y += PITCH_Y * 0.18;
        }
        if (flip) dummy.rotation.y += Math.PI;           // back bed faces −z
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  };

  if (con.type === 'interlock') {
    addLayer(0, 0.30, false);     // front bed — knit faces the viewer
    addLayer(0, -0.30, true);     // back bed — aligned, knit faces away, hidden behind
  } else {
    addLayer(0, 0, false);
  }
}
