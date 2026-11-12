// The look shared by the world and the riders: physically based surfaces,
// matte unless told otherwise, and photo textures loaded from docs/tex.
import * as THREE from 'three';

export const pbr = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });

const loader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
// data: not a colour image (normal map). clamp: do not tile.
export function tex(name, o = {}) {
  const t = loader.load('tex/' + name);
  t.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (!o.clamp) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  return t;
}
