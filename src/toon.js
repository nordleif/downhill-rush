// The look shared by the world and the riders: smooth, softly lit shapes with a
// warm glow along their edges, like moulded clay toys.
import * as THREE from 'three';

export const toon = (o = {}) => {
  const m = new THREE.MeshLambertMaterial(o);
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight += vec3(1.0, 0.92, 0.78) * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5) * 0.3;\n#include <opaque_fragment>');
  };
  return m;
};
