// Cartoon shading shared by the world and the riders: smooth shapes lit in
// three flat steps instead of a soft gradient.
import * as THREE from 'three';

const ramp = new THREE.DataTexture(new Uint8Array([95, 95, 195, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;

export const toon = (o = {}) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...o });
