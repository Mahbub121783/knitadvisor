// KnitAdvisor · knit3d — studio lighting.
//
// A soft 3-point + hemisphere rig tuned for ACES tone mapping so the dye reads
// as true colour and the yarn looks lit (not flat). A back rim light lets the
// purl / technical-back side read when the swatch is flipped.

import * as THREE from 'three';

export function addStudioLighting(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4f5a, 1.5));

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3, 5, 6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xeef2ff, 0.8);
  fill.position.set(4, -1, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(0, 2, -5);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
}
