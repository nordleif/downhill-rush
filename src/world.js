// Builds the visible mountain from the course data: ground, trail strips,
// wooden features, forest, rocks, water, signs, gates, sky and lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  course, trails, surfaceAt, newSurf, poseAt, deckY, GULLIES, gullyX, baseNG, LAKE_Y, VALLEY_Z, rockiness, meadowAt, forestAt, DOWN,
} from './course.js';
import { fbm, mulberry, clamp, sm } from './noise.js';
import { toon } from './toon.js';

const C = h => new THREE.Color(h);
export const DIFF_COLOR = { main: 0xf2a23a, green: 0x2fae55, blue: 0x2f7be0, black: 0x23262d };
export const SKY = { top: C(0x3d9cf2), horizon: C(0xffe8f0), fog: C(0xd3e6fa) };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ ground
const cGrassA = C(0x86d943), cGrassB = C(0x55b83e), cMeadow = C(0xc0e84c), cDirt = C(0xf0b46e), cDirtDark = C(0x9a6238), cFloor = C(0x35883e);
const cRock = C(0x9499a6), cRockDark = C(0x646a78), cRough = C(0x9c958c), cShore = C(0x8fb66a);
const tmpC = new THREE.Color();
function groundColor(x, z, o, out) {
  const n = fbm(x / 30 + 3, z / 30, 2), n2 = fbm(x / 7, z / 7 + 9, 2);
  out.copy(cGrassB).lerp(cGrassA, sm(0.3, 0.7, n));
  out.lerp(cMeadow, clamp(meadowAt(z) * 0.7 * n2 + 0.12 * n2, 0, 1));
  // Shady forest floor under the trees.
  out.lerp(cFloor, 0.6 * sm(0.45, 0.95, forestAt(x, z)) * (1 - meadowAt(z)));
  const rk = rockiness(x, z, o.gully);
  if (rk > 0) out.lerp(tmpC.copy(cRockDark).lerp(cRock, n2), rk);
  out.multiplyScalar(0.95 + 0.1 * n2);
  // The trail is a clean ribbon of dirt with a dark rim, like a drawn line.
  if (o.w > 0.05 && o.dist < 0.7) {
    tmpC.copy(cDirt).multiplyScalar(0.96 + 0.08 * n2).lerp(cDirtDark, sm(-0.75, 0.15, o.dist));
    if (o.rough) tmpC.lerp(cRough, 0.5);
    out.lerp(tmpC, (1 - sm(0.2, 0.55, o.dist)) * sm(0.3, 0.8, o.w));
  }
  return out;
}

const RIB = 6; // how far the detailed trail strip reaches beyond the trail edge

function buildGround(scene, mat) {
  const B = course.bounds, G = 4, o = newSurf(), col = new THREE.Color();
  const nx = Math.ceil((B.x1 - B.x0) / G) + 1, nz = Math.ceil((B.z1 - B.z0) / G) + 1;
  const H = new Float32Array(nx * nz), IN = new Uint8Array(nx * nz), COL = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = B.x0 + i * G, z = B.z0 + j * G, k = j * nx + i;
    surfaceAt(x, z, -1e9, o);
    const inside = o.cov < RIB - 0.3;
    IN[k] = inside ? 1 : 0;
    H[k] = o.y - (inside ? 1.1 * sm(RIB - 0.3, RIB - 2, o.cov) : 0);
    groundColor(x, z, o, col); COL[k * 3] = col.r; COL[k * 3 + 1] = col.g; COL[k * 3 + 2] = col.b;
  }
  const CH = 32;
  for (let cj = 0; cj < nz - 1; cj += CH) for (let ci = 0; ci < nx - 1; ci += CH) {
    const w = Math.min(CH, nx - 1 - ci) + 1, h = Math.min(CH, nz - 1 - cj) + 1;
    const pos = new Float32Array(w * h * 3), cl = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), idx = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gi = ci + i, gj = cj + j, k = gj * nx + gi, q = (j * w + i) * 3;
      pos[q] = B.x0 + gi * G; pos[q + 1] = H[k]; pos[q + 2] = B.z0 + gj * G;
      cl[q] = COL[k * 3]; cl[q + 1] = COL[k * 3 + 1]; cl[q + 2] = COL[k * 3 + 2];
      const hl = H[gj * nx + Math.max(0, gi - 1)], hr = H[gj * nx + Math.min(nx - 1, gi + 1)];
      const hd = H[Math.max(0, gj - 1) * nx + gi], hu = H[Math.min(nz - 1, gj + 1) * nx + gi];
      const n = new THREE.Vector3(hl - hr, 2 * G, hd - hu).normalize();
      nor[q] = n.x; nor[q + 1] = n.y; nor[q + 2] = n.z;
      if (i < w - 1 && j < h - 1) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        const ka = k, kb = k + 1, kc = k + nx, kd = kc + 1;
        if (!(IN[ka] && IN[kc] && IN[kb])) idx.push(a, c, b);
        if (!(IN[kb] && IN[kc] && IN[kd])) idx.push(b, c, d);
      }
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  }
}

// A strip of exact ground along every trail. It carries berms, jump faces and
// cut banks at full detail, which the coarse terrain grid cannot.
function buildTrailStrips(scene, mat) {
  const o = newSurf(), col = new THREE.Color(), P = {};
  for (const t of trails) {
    const rows = [];
    for (let i = 0; i < t.n; i++) rows.push(t.s[i]);
    for (const f of t.feats) if (f.type === 'kicker') rows.push(f.s1 - 0.02, f.s1 + 0.02);
    rows.sort((a, b) => a - b);
    const NC = 15, pos = [], cl = [], idx = [];
    rows.forEach((s, r) => {
      poseAt(t, s, P);
      const hw = P.hw, cx = Math.cos(P.th), cz = Math.sin(P.th);
      const lats = [-(hw + RIB), -(hw + 3.2), -(hw + 1.2), -(hw + 0.55), -(hw + 0.15), -(hw - 0.7), -hw * 0.4, 0, hw * 0.4, hw - 0.7, hw + 0.15, hw + 0.55, hw + 1.2, hw + 3.2, hw + RIB];
      for (let c = 0; c < NC; c++) {
        const x = P.x + cx * lats[c], z = P.z + cz * lats[c];
        surfaceAt(x, z, -1e9, o);
        pos.push(x, o.y - (c === 0 || c === NC - 1 ? 0.3 : 0), z);
        groundColor(x, z, o, col); cl.push(col.r, col.g, col.b);
        if (r && c) { const a = (r - 1) * NC + c - 1, b = a + 1, d = r * NC + c - 1, e = d + 1; idx.push(a, b, d, b, e, d); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // Split long trails so that the parts out of view can be culled.
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  }
}

function buildFar(scene) {
  const B = course.bounds, G = 80, x0 = -3200, x1 = 3200, z0 = VALLEY_Z - 3600, z1 = 1500;
  const nx = Math.round((x1 - x0) / G) + 1, nz = Math.round((z1 - z0) / G) + 1;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx - 1, nz - 1); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, cl = new Float32Array(p.count * 3), col = new THREE.Color();
  const cF = C(0x3f9c4c), cF2 = C(0x6cc054), cR = C(0x9a9ccc), cS = C(0xffffff);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2;
    const n = fbm(x / 500, z / 500, 4);
    const ridge = Math.max(0, Math.abs(x - 30) - 560) * 0.4 + Math.max(0, VALLEY_Z - 1300 - z) * 0.45 + Math.max(0, z - 300) * 0.3;
    let y = baseNG(x, z) + ridge * (n - 0.3) * 1.5;
    const inside = x > B.x0 + 30 && x < B.x1 - 30 && z > B.z0 + 30 && z < B.z1 - 30;
    if (inside) y -= 45;
    p.setXYZ(i, x, y, z);
    const rel = y - DOWN * Math.max(z, VALLEY_Z - 130);
    col.copy(cF).lerp(cF2, fbm(x / 160, z / 160, 2));
    col.lerp(cR, sm(300, 380, rel + n * 160)); col.lerp(cS, sm(600, 660, rel + n * 220));
    cl[i * 3] = col.r; cl[i * 3 + 1] = col.g; cl[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cl, 3)); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(5000, 1500).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x3fa9e6, emissive: 0x0e3f66 }));
  lake.position.set(0, LAKE_Y, VALLEY_Z - 620); scene.add(lake);
}

// ------------------------------------------------------------------ instancing helper
// Instanced meshes split into bands down the mountain so far ones are culled.
const lod = []; // small things that are hidden when far away
function instanced(scene, geo, mat, items, set, opts = {}) {
  const band = opts.band || 160, groups = new Map(), d = new THREE.Object3D(), col = new THREE.Color();
  for (const it of items) { const k = Math.floor(it.z / band); let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(it); }
  for (const arr of groups.values()) {
    const m = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((it, i) => {
      d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
      const c = set(it, d, col); d.updateMatrix(); m.setMatrixAt(i, d.matrix); if (c) m.setColorAt(i, col);
    });
    m.castShadow = !!opts.cast; m.receiveShadow = !!opts.receive;
    m.computeBoundingSphere(); scene.add(m);
    const far = opts.minDist || 0;
    if (opts.maxDist || far) lod.push({ m, c: m.boundingSphere.center, r: m.boundingSphere.radius + (opts.maxDist || far), far: far > 0 });
  }
}

function paint(g, hex, hex2) {
  const p = g.attributes.position, a = C(hex), b = C(hex2 ?? hex), c = new THREE.Color(), cl = new Float32Array(p.count * 3);
  g.computeBoundingBox(); const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
  for (let i = 0; i < p.count; i++) { c.copy(a).lerp(b, (p.getY(i) - y0) / Math.max(1e-6, y1 - y0)); cl[i * 3] = c.r; cl[i * 3 + 1] = c.g; cl[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  return g;
}
const prep = g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };

// A shape turned around the y axis. Points run bottom to top so it faces outwards.
const lathe = (pts, seg) => prep(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg));
const LOD_AT = 115; // beyond this the simple version of a tree is drawn

function buildForest(scene, quality) {
  const mat = toon({ vertexColors: true, side: THREE.DoubleSide });
  // One drooping tier of a fir: a soft bell with a rounded rim.
  const tier = (r, y, h, hi) => hi
    ? lathe([[r * 0.25, y + h * 0.12], [r * 0.82, y + h * 0.01], [r, y + h * 0.1], [r * 0.9, y + h * 0.24], [r * 0.52, y + h * 0.62], [r * 0.2, y + h * 0.9], [0.001, y + h]], 12)
    : lathe([[r * 0.95, y + h * 0.05], [r * 0.5, y + h * 0.6], [0.001, y + h]], 6);
  // A tall bare trunk with the branches high up, so the trail runs under the trees.
  const fir = (r, h, tiers, dark, light, hi) => {
    const parts = [paint(prep(new THREE.CylinderGeometry(0.2, 0.44, h * 0.5, hi ? 9 : 5, 1, true).translate(0, h * 0.25, 0)), 0x6a4630, 0x9a6c43)];
    if (hi) parts.push(paint(lathe([[0.75, 0], [0.5, 0.25], [0.42, 0.7]], 9), 0x5c3c28, 0x6a4630)); // flared foot
    const n = hi ? tiers : 2, hh = h * (hi ? 0.3 : 0.4), y0 = h * 0.36, step = (h - y0 - hh) / (n - 1);
    for (let i = 0; i < n; i++) parts.push(paint(tier(r * (1 - i / n * 0.6), y0 + i * step, hh, hi), dark, light));
    return mergeGeometries(parts);
  };
  const leafy = hi => {
    const blob = (r, x, y, z) => prep(hi ? new THREE.SphereGeometry(r, 12, 9) : new THREE.IcosahedronGeometry(r, 1)).translate(x, y, z);
    const parts = [
      paint(prep(new THREE.CylinderGeometry(0.17, 0.32, 3, hi ? 9 : 5, 1, true).translate(0, 1.5, 0)), 0x7a5a3c, 0x9a744c),
      paint(blob(1.9, 0, 4.2, 0), 0x4fa83a, 0x9fe04e), paint(blob(1.4, 1.15, 5.1, 0.4), 0x5fb83e, 0xb4ea58),
    ];
    if (hi) parts.push(paint(blob(1.3, -0.95, 5, -0.5), 0x4fa83a, 0xa6e250), paint(blob(1.15, 0.1, 6, -0.2), 0x6cc444, 0xc2f060));
    return mergeGeometries(parts);
  };
  const make = hi => [fir(2.4, 9.5, 3, 0x1a6a3c, 0x5cc04e, hi), fir(1.9, 11.5, 4, 0x136042, 0x44aa5a, hi), leafy(hi)];
  const hiG = make(true), loG = make(false);
  const rng = mulberry(7);
  const list = course.trees.filter(t => quality > 0 || t.near || rng() < 0.5);
  const place = (t, d, col) => {
    d.position.set(t.x, t.y, t.z); d.rotation.y = t.x * 7.3 + t.z; d.scale.setScalar(t.sc);
    const v = 0.86 + 0.26 * fbm(t.x / 3, t.z / 3, 1), w = fbm(t.z / 2, t.x / 2, 1); col.setRGB(v * (0.9 + 0.2 * w), v, v * (1.02 - 0.22 * w)); return true;
  };
  for (let k = 0; k < 3; k++) {
    const near = list.filter(t => t.kind === k && t.near);
    instanced(scene, hiG[k], mat, near, place, { band: 80, maxDist: LOD_AT, cast: quality > 0 });
    instanced(scene, loG[k], mat, near, place, { band: 80, minDist: LOD_AT });
    instanced(scene, loG[k], mat, list.filter(t => t.kind === k && !t.near), place);
  }
}

// Smooth pebble shapes: a sphere pushed in and out by gentle noise.
function buildRocks(scene) {
  const g = new THREE.SphereGeometry(1, 14, 10), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 0.8 + 0.5 * fbm(x * 0.9 + 5, z * 0.9 + y * 0.7 + 3, 2);
    p.setXYZ(i, x * f, Math.max(-0.35, y * f * 0.78), z * f);
  }
  g.computeVertexNormals(); g.deleteAttribute('uv');
  paint(g, 0x7f86a0, 0xc9cede);
  instanced(scene, g, toon({ vertexColors: true }), course.rocks, (r, d, col) => {
    d.position.set(r.x, r.y + r.rr * 0.2, r.z); d.rotation.set(0, r.seed * 40, r.seed * 0.5 - 0.25);
    d.scale.set(r.rr * (0.95 + r.seed * 0.3), r.rr, r.rr * (1.1 - r.seed * 0.3));
    const v = 0.9 + r.seed * 0.2; col.setRGB(v, v, v); return true;
  }, { cast: true, receive: true });
}

function buildPlants(scene, quality) {
  const rng = mulberry(99), o = newSurf(), P = {}, tufts = [], flowers = [], bushes = [];
  const FC = [0xffffff, 0xffd84a, 0xff7ab8, 0xb58cff, 0xff9a3c, 0xfff2a8];
  const tryAdd = (x, z, flowerP) => {
    surfaceAt(x, z, -1e9, o);
    if (o.gully > 0.6 || o.w > 0.35 || rockiness(x, z, o.gully) > 0.4) return;
    const it = { x, y: o.y, z, r: rng() };
    const q = rng();
    if (q < flowerP) { it.c = FC[Math.floor(rng() * FC.length)]; flowers.push(it); }
    else if (q < flowerP + 0.14) bushes.push(it);
    else tufts.push(it);
  };
  const step = quality > 0 ? 0.8 : 1.6;
  for (const t of trails) for (let s = 2; s < t.len; s += step) {
    poseAt(t, s, P);
    const lat = (rng() < 0.5 ? -1 : 1) * (P.hw + 0.5 + rng() * rng() * 9);
    tryAdd(P.x + Math.cos(P.th) * lat, P.z + Math.sin(P.th) * lat, 0.3 + 0.3 * meadowAt(P.z));
  }
  const B = course.bounds;
  for (let i = 0; i < (quality > 0 ? 5000 : 1800); i++) {
    const z = course.meadow[1] + rng() * (course.meadow[0] - course.meadow[1]), x = 30 + (rng() - 0.5) * 220;
    if (x > B.x0 && x < B.x1) tryAdd(x, z, 0.55);
  }
  const mat = toon({ vertexColors: true, side: THREE.DoubleSide });
  // Fat curved leaves instead of spikes.
  const blade = (rot, lean) => paint(lathe([[0.05, 0], [0.085, 0.2], [0.06, 0.42], [0.001, 0.6]], 5).rotateZ(lean).rotateY(rot), 0x3f9a3a, 0xa6e452);
  instanced(scene, mergeGeometries([blade(0, 0.35), blade(2.1, -0.4), blade(4.2, 0.25)]), mat, tufts, (it, d, col) => {
    d.position.set(it.x, it.y - 0.03, it.z); d.rotation.y = it.r * 6.28; d.scale.setScalar(0.8 + it.r * 1.1);
    col.setRGB(0.85 + it.r * 0.3, 0.95, 0.8); return true;
  }, { band: 60, maxDist: 150 });
  // Daisy: a stalk, a round middle and a ring of petals in the flower colour.
  const fparts = [
    paint(prep(new THREE.CylinderGeometry(0.018, 0.024, 0.36, 5, 1, true).translate(0, 0.18, 0)), 0x2f8a2f),
    paint(prep(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.7, 1).translate(0, 0.4, 0)), 0xffc21a),
  ];
  for (let i = 0; i < 5; i++) fparts.push(paint(prep(new THREE.SphereGeometry(0.07, 7, 5).scale(1, 0.35, 0.62).translate(0.1, 0.385, 0).rotateY(i * Math.PI * 0.4)), 0xffffff));
  const fg = mergeGeometries(fparts);
  instanced(scene, fg, mat, flowers, (it, d, col) => {
    d.position.set(it.x, it.y - 0.02, it.z); d.rotation.set((it.r - 0.5) * 0.5, it.r * 6.28, 0); d.scale.setScalar(1 + it.r * 0.9);
    col.setHex(it.c); return true;
  }, { band: 60, maxDist: 170 });
  const bush = mergeGeometries([
    paint(prep(new THREE.SphereGeometry(0.55, 10, 7).scale(1, 0.8, 1).translate(0, 0.32, 0)), 0x2f8a3c, 0x86d44c),
    paint(prep(new THREE.SphereGeometry(0.4, 9, 6).translate(0.42, 0.3, 0.12)), 0x2f8a3c, 0x7acb48),
    paint(prep(new THREE.SphereGeometry(0.36, 9, 6).translate(-0.36, 0.26, -0.2)), 0x2a8038, 0x74c646),
  ]);
  instanced(scene, bush, mat, bushes, (it, d, col) => {
    d.position.set(it.x, it.y, it.z); d.rotation.y = it.r * 6.28; d.scale.setScalar(0.8 + it.r * 1.0);
    col.setRGB(0.9, 0.9 + it.r * 0.2, 0.85); return true;
  }, { band: 60, maxDist: 260 });
}

// ------------------------------------------------------------------ wood
function plankTex(chevrons) {
  return canvasTex(256, 256, (g, w, h) => {
    const rng = mulberry(chevrons ? 5 : 6);
    for (let i = 0; i < 8; i++) {
      const v = 150 + rng() * 50;
      g.fillStyle = `rgb(${v + 40},${v - 8},${v - 62})`; g.fillRect(0, i * 32, w, 32);
      g.fillStyle = 'rgba(70,40,15,0.55)'; g.fillRect(0, i * 32, w, 2.5);
      g.fillStyle = 'rgba(90,55,25,0.18)';
      for (let k = 0; k < 14; k++) g.fillRect(rng() * w, i * 32 + 4 + rng() * 24, 20 + rng() * 60, 1.2);
      g.fillStyle = 'rgba(60,35,15,0.7)';
      g.beginPath(); g.arc(18, i * 32 + 16, 2.2, 0, 7); g.arc(w - 18, i * 32 + 16, 2.2, 0, 7); g.fill();
    }
    if (chevrons) {
      g.strokeStyle = 'rgba(255,214,60,0.92)'; g.lineWidth = 20; g.lineJoin = 'miter';
      for (const y of [215, 135, 55]) { g.beginPath(); g.moveTo(58, y + 30); g.lineTo(128, y - 22); g.lineTo(198, y + 30); g.stroke(); }
    }
  }, true);
}

function buildDecks(scene) {
  const top = [], topR = [], side = [], posts = [], rails = [];
  const o = newSurf(), P = {};
  const strip = (arr, a, b, uv) => arr.push({ a, b, uv });
  for (const t of trails) for (const dk of t.decks) {
    const L = dk.s1 - dk.s0, n = Math.max(2, Math.ceil(L / 0.75));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = dk.s0 + L * i / n;
      poseAt(t, s, P);
      const y = deckY(dk, s, P.y), cx = Math.cos(P.th), cz = Math.sin(P.th);
      const l = new THREE.Vector3(P.x - cx * dk.hw, y, P.z - cz * dk.hw), r = new THREE.Vector3(P.x + cx * dk.hw, y, P.z + cz * dk.hw);
      const cur = { l, r, v: dk.type === 'ramp' ? i / n : s / 2.2, s };
      if (prev) {
        (dk.type === 'ramp' ? topR : top).push([prev.l, prev.r, cur.l, cur.r, prev.v, cur.v]);
        const dn = new THREE.Vector3(0, -0.28, 0);
        side.push([prev.l.clone().add(dn), prev.l, cur.l.clone().add(dn), cur.l], [prev.r, prev.r.clone().add(dn), cur.r, cur.r.clone().add(dn)]);
        if (dk.rails) for (const e of ['l', 'r']) for (const hgt of [0.55, 1.0]) {
          const u = new THREE.Vector3(0, hgt, 0), w = new THREE.Vector3(0, hgt + 0.12, 0);
          rails.push([prev[e].clone().add(u), prev[e].clone().add(w), cur[e].clone().add(u), cur[e].clone().add(w)]);
        }
      }
      if (i === n && dk.type !== 'bridge' && dk.type !== 'skinny') { // closing face under a lip
        const dn = new THREE.Vector3(0, -0.28, 0); side.push([l.clone().add(dn), l, r.clone().add(dn), r]);
      }
      if (i % 4 === 0 || i === n) for (const e of [l, r]) {
        const gy = surfaceAt(e.x, e.z, -1e9, o).y;
        if (y - gy > 0.35) posts.push({ x: e.x, z: e.z, y0: gy - 0.4, y1: y - 0.05, r: 0.11 });
        if (dk.rails) posts.push({ x: e.x, z: e.z, y0: y - 0.1, y1: y + 1.12, r: 0.07 });
      }
      prev = cur;
    }
  }
  const quads = (list, mat, uv, cast) => {
    if (!list.length) return;
    const pos = [], uvs = [], idx = [];
    list.forEach((q, i) => {
      for (let k = 0; k < 4; k++) pos.push(q[k].x, q[k].y, q[k].z);
      if (uv) uvs.push(0, q[4], 1, q[4], 0, q[5], 1, q[5]); else uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      const b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; scene.add(m);
  };
  quads(top, toon({ map: plankTex(false), side: THREE.DoubleSide }), true, true);
  quads(topR, toon({ map: plankTex(true), side: THREE.DoubleSide }), true, true);
  const dark = toon({ color: 0x8a5a33, side: THREE.DoubleSide });
  quads(side, dark, false, false); quads(rails, toon({ color: 0xa8713f, side: THREE.DoubleSide }), false, true);
  instanced(scene, new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0), toon({ color: 0x7d5433 }), posts, (p, d) => {
    d.position.set(p.x, p.y0, p.z); d.scale.set(p.r, p.y1 - p.y0, p.r);
  }, { cast: true });
}

// ------------------------------------------------------------------ signs and gates
const SYMBOL = { green: '●', blue: '■', black: '◆' };
const FONT = '900 italic 64px "Arial Black", "Segoe UI", Impact, sans-serif';

function bannerTex(a) {
  return canvasTex(1024, 192, (g, w, h) => {
    if (a.kind === 'finish') {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 32; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32); }
      g.fillStyle = '#e8312f'; g.fillRect(262, 28, 500, 136);
    } else {
      g.fillStyle = '#' + C(a.kind === 'route' ? DIFF_COLOR[a.diff] : a.kind === 'start' ? 0x1fa64a : 0xf08a24).getHexString(); g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.16)'; for (let x = -200; x < w; x += 90) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 120, 0); g.lineTo(x + 160, 0); g.lineTo(x + 40, h); g.fill(); }
    }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = FONT.replace('64px', '112px'); g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.35)';
    const txt = a.kind === 'route' ? SYMBOL[a.diff] + ' ' + a.label : a.label;
    g.strokeText(txt, w / 2, h / 2 + 6, w - 60); g.fillText(txt, w / 2, h / 2 + 6, w - 60);
  });
}

function buildArches(scene) {
  const wood = toon({ color: 0x8a5d38 });
  const tex = new Map();
  for (const a of course.arches) {
    const g = new THREE.Group(), w = a.hw + 1.1, key = a.kind + a.label + a.diff;
    if (!tex.has(key)) tex.set(key, bannerTex(a));
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 6.2, 7), wood); p.position.set(sx * w, 2.3, 0); p.castShadow = true; g.add(p);
    }
    const bm = toon({ map: tex.get(key) });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.25), bm); b.position.set(0, 4.55, 0.02); g.add(b);
    const b2 = b.clone(); b2.rotation.y = Math.PI; b2.position.z = -0.02; g.add(b2);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 0.16, 0.16), wood); beam.position.y = 5.25; g.add(beam);
    // pennants
    const cols = [0xff5a4a, 0xffc93a, 0x35b7ff, 0x5bd66a], pg = [], n = Math.floor(w * 2 / 0.7);
    for (let i = 0; i < n; i++) {
      const x = -w + 0.35 + i * 0.7, t = paint(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([x - 0.28, 3.9, 0, x + 0.28, 3.9, 0, x, 3.35, 0], 3)), cols[i % 4]);
      pg.push(t);
    }
    const pen = new THREE.Mesh(mergeGeometries(pg), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); g.add(pen);
    g.position.set(a.x, a.y - 0.4, a.z); g.rotation.y = -a.th; scene.add(g);
    if (a.kind === 'finish') {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(a.hw * 2, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: canvasTex(256, 64, (c) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 32, y * 32, 32, 32); } }),
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      line.position.set(0, 0.5, 0); g.add(line);
    }
  }
}

function buildSigns(scene) {
  const wood = toon({ color: 0x7d5433 });
  const ARROW = { '-1': '←', 0: '↑', 1: '→' };
  for (const s of course.signs) {
    const n = s.options.length, H = 1.15 * n + 0.2, W = 5.2;
    const t = canvasTex(1024, 224 * n + 40, (g, w, h) => {
      g.fillStyle = '#6b4526'; g.fillRect(0, 0, w, h);
      s.options.forEach((op, i) => {
        const y = 20 + i * 224;
        g.fillStyle = '#' + C(DIFF_COLOR[op.diff]).getHexString();
        g.beginPath(); g.roundRect(20, y + 8, w - 40, 208, 28); g.fill();
        g.fillStyle = '#fff'; g.textBaseline = 'middle';
        g.font = FONT.replace('64px', '150px'); g.textAlign = 'center';
        g.fillText(ARROW[op.dir], op.dir > 0 ? w - 120 : 120, y + 112);
        g.textAlign = op.dir > 0 ? 'right' : 'left';
        const tx = op.dir > 0 ? w - 230 : 230;
        g.font = FONT.replace('64px', '92px'); g.fillText(SYMBOL[op.diff] + ' ' + op.level, tx, y + 76, w - 280);
        g.font = FONT.replace('64px', '58px').replace('900 italic', '700'); g.fillStyle = 'rgba(255,255,255,0.88)';
        g.fillText(op.name, tx, y + 162, w - 280);
      });
    });
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.14), [wood, wood, wood, wood, toon({ map: t }), wood]);
    b.position.y = 2.2 + H / 2; b.castShadow = true; g.add(b);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 3 + H, 7), wood); p.position.set(sx * (W / 2 - 0.4), (2.6 + H) / 2, -0.16); p.castShadow = true; g.add(p); }
    g.position.set(s.x, s.y - 0.3, s.z); g.rotation.y = -s.th - 0.35; scene.add(g);
  }
}

// Small coloured posts along the branch trails and fences outside tight corners.
function buildMarkers(scene) {
  const posts = [], fence = [], rail = [], o = newSurf(), P = {};
  for (const t of trails) {
    if (t.diff !== 'main') for (let s = 26; s < t.len - 10; s += 32) {
      poseAt(t, s, P);
      for (const sd of [-1, 1]) { const lat = sd * (P.hw + 0.9), x = P.x + Math.cos(P.th) * lat, z = P.z + Math.sin(P.th) * lat; surfaceAt(x, z, -1e9, o); if (o.gully < 0.5) posts.push({ x, z, y: o.y, c: DIFF_COLOR[t.diff] }); }
    }
    let prev = null;
    for (let s = 4; s < t.len - 4; s += 2.2) {
      poseAt(t, s, P);
      if (Math.abs(P.kap) < 0.045 || t.di[P.i] >= 0) { prev = null; continue; }
      const lat = -Math.sign(P.kap) * (P.hw + 2.0), x = P.x + Math.cos(P.th) * lat, z = P.z + Math.sin(P.th) * lat;
      surfaceAt(x, z, -1e9, o);
      const v = new THREE.Vector3(x, o.y, z);
      fence.push(v);
      if (prev) for (const h of [0.45, 0.85]) rail.push([prev.clone().setY(prev.y + h), prev.clone().setY(prev.y + h + 0.13), v.clone().setY(v.y + h), v.clone().setY(v.y + h + 0.13)]);
      prev = v;
    }
  }
  const mat = toon();
  instanced(scene, new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.5, 0), mat, posts, (p, d, col) => { d.position.set(p.x, p.y, p.z); col.setHex(p.c); return true; });
  instanced(scene, new THREE.CylinderGeometry(0.09, 0.11, 1.25, 6).translate(0, 0.5, 0), toon({ color: 0x8a5d38 }), fence, (p, d) => { d.position.copy(p); }, { cast: true });
  if (rail.length) {
    const pos = [], idx = [];
    rail.forEach((q, i) => { for (const v of q) pos.push(v.x, v.y, v.z); const b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, toon({ color: 0xa8713f, side: THREE.DoubleSide })));
  }
}

// Roots across the trail in root sections.
function buildRoots(scene) {
  const items = [], rng = mulberry(41), P = {}, o = newSurf();
  for (const t of trails) for (const zn of t.zones) if (zn.kind === 'roots') for (let s = zn.s0 + 1; s < zn.s1; s += 1.3) {
    poseAt(t, s, P);
    const lat = (rng() - 0.5) * P.hw * 1.2, x = P.x + Math.cos(P.th) * lat, z = P.z + Math.sin(P.th) * lat;
    items.push({ x, z, y: surfaceAt(x, z, -1e9, o).y, th: P.th + (rng() - 0.5) * 0.9, l: 1.4 + rng() * 2.6, r: rng() });
  }
  instanced(scene, new THREE.CylinderGeometry(0.07, 0.1, 1, 5).rotateZ(Math.PI / 2), toon({ color: 0x6b4a2f }), items, (it, d) => {
    d.position.set(it.x, it.y + 0.02, it.z); d.rotation.y = -it.th; d.scale.set(it.l, 1, 1);
  });
}

// ------------------------------------------------------------------ water
export const waterSpots = []; // places that make water noise (falls)
let waterTex;
function buildWater(scene) {
  waterTex = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#58bdf2'; g.fillRect(0, 0, w, h);
    const rng = mulberry(8);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.5})`; g.fillRect(rng() * w, rng() * h, 2 + rng() * 5, 10 + rng() * 40); }
  }, true);
  const mat = toon({ map: waterTex, vertexColors: true, emissive: 0x0b3350 });
  const o = newSurf();
  for (const g of GULLIES) {
    const pos = [], uv = [], cl = [], idx = [];
    let k = 0, py = null;
    for (let z = g.z0 - 25; z > VALLEY_Z - 420; z -= 1.5) {
      const x = gullyX(g, z), y = surfaceAt(x, z, -1e9, o).y + 0.35;
      if (y < LAKE_Y) break;
      const steep = py != null ? clamp((py - y) / 1.5 - 0.5, 0, 1) : 0; py = y;
      const dx = gullyX(g, z - 1) - x, len = Math.hypot(dx, 1), nx = 1 / len, nz = dx / len, hw = 2.3;
      pos.push(x - nx * hw, y, z + nz * hw, x + nx * hw, y, z - nz * hw);
      uv.push(0, -z / 9, 1, -z / 9);
      const c = 0.8 + steep * 0.9; cl.push(c, c, c, c, c, c);
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      k++;
    }
    for (const f of g.falls) waterSpots.push({ x: gullyX(g, f), z: f - 2, y: surfaceAt(gullyX(g, f), f - 3, -1e9, o).y });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, mat));
  }
}

// ------------------------------------------------------------------ sky
function buildSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY.top }, hor: { value: SKY.horizon }, sun: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 d; uniform vec3 top; uniform vec3 hor; uniform vec3 sun;
      void main(){ float h = clamp(d.y*1.5+0.05,0.0,1.0); vec3 c = mix(hor, top, pow(h,0.8));
      float s = max(dot(normalize(d), sun),0.0); c += vec3(1.0,0.85,0.55)*(pow(s,350.0)*1.5 + pow(s,8.0)*0.22);
      gl_FragColor = vec4(c,1.0); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const rng = mulberry(12), parts = [];
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, r = 1800 + rng() * 2600, cx = Math.cos(a) * r, cz = VALLEY_Z / 2 + Math.sin(a) * r, cy = 520 + rng() * 500, s = 90 + rng() * 120;
    for (let k = 0; k < 6; k++) parts.push(new THREE.IcosahedronGeometry(s * (0.5 + rng() * 0.6), 3).scale(1.5, 0.62, 1).translate(cx + (rng() - 0.5) * s * 3.4, cy + (rng() - 0.3) * s * 0.4, cz + (rng() - 0.5) * s * 1.6));
  }
  scene.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc9cfe6, fog: false })));
  return sky;
}

// ------------------------------------------------------------------ assembly
export function buildWorld(scene, quality) {
  scene.fog = new THREE.Fog(SKY.fog, 300, 9000);
  const sunDir = new THREE.Vector3(0.45, 0.72, 0.35).normalize();
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x9ccf6a, 1.75);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.3);
  scene.add(hemi, sun, sun.target);
  if (quality > 0) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = c.bottom = -55; c.right = c.top = 55; c.near = 10; c.far = 320;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  }
  const detail = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const rng = mulberry(2);
    for (let i = 0; i < 900; i++) { const v = 240 + rng() * 15; g.fillStyle = `rgba(${v},${v},${v},0.7)`; g.beginPath(); g.arc(rng() * w, rng() * h, 1 + rng() * 4, 0, 7); g.fill(); }
  }, true);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // World-space detail texture so that strips and terrain match exactly.
  groundMat.map = detail;
  groundMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = position.xz * 0.16;');
  };
  buildGround(scene, groundMat); buildTrailStrips(scene, groundMat); buildFar(scene);
  buildDecks(scene); buildForest(scene, quality); buildRocks(scene); buildPlants(scene, quality);
  buildArches(scene); buildSigns(scene); buildMarkers(scene); buildRoots(scene); buildWater(scene);
  const sky = buildSky(scene);
  sky.material.uniforms.sun.value.copy(sunDir);
  return {
    // Keep the sky and the shadow box centred on the camera.
    update(dt, focus, camPos) {
      sky.position.copy(camPos);
      sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 150);
      waterTex.offset.y -= dt * 0.9;
      for (const l of lod) l.m.visible = (l.c.distanceToSquared(camPos) < l.r * l.r) !== l.far;
    },
  };
}
