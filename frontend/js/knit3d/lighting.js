// KnitAdvisor · knit3d — studio lighting.
//
// A soft 3-point + hemisphere rig tuned for ACES tone mapping so the dye reads
// as true colour and the yarn looks lit (not flat). A back rim light lets the
// purl / technical-back side read when the swatch is flipped.

import * as THREE from 'three';

// Returns the key light so the renderer can configure its shadow frustum once
// the fabric box is measured.
export function addStudioLighting(scene, withShadow) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4f5a, 1.5));

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3, 5, 6);
  if (withShadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0006;
  }
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xeef2ff, 0.8);
  fill.position.set(4, -1, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(0, 2, -5);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  return { key };
}

// Size the key light's orthographic shadow camera to cover the patch box.
export function configureShadowCamera(key, size) {
  if (!key || !key.shadow) return;
  const r = Math.max(size.x, size.y) * 0.7;
  const cam = key.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.5; cam.far = r * 6;
  cam.updateProjectionMatrix();
}
