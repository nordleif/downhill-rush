// Builds the visible mountain from the course data: ground, trail strips,
// wooden features, forest, rocks, water, signs, gates, sky and lights.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  course, trails, surfaceAt, newSurf, poseAt, deckY, GULLIES, gullyX, baseNG, LAKE_Y, VALLEY_Z, rockiness, meadowAt, forestAt, DOWN, WORLD, STAIR_T,
} from './course.js';
import { fbm, mulberry, clamp, sm } from './noise.js';
import { pbr, tex } from './pbr.js';

const C = h => new THREE.Color(h);
export const DIFF_COLOR = { main: 0xf2a23a, green: 0x2fae55, blue: 0x2f7be0, black: 0x23262d, mega: 0xb01fd6 };
export const SKY = { fog: C(0xa9bccd) };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ ground
let CITY = false; // set when the world is built
// The ground colour holds blend weights, not a colour:
// r = grass over forest floor (or over paving in the city), g = bare rock,
// b = light and dark patches.
function groundColor(x, z, o, out) {
  const n = fbm(x / 30 + 3, z / 30, 2), n2 = fbm(x / 7, z / 7 + 9, 2), md = meadowAt(z);
  const grass = CITY ? sm(0.4, 0.6, md) : clamp(0.1 + 0.5 * sm(0.35, 0.75, n) + 0.8 * md - 0.5 * sm(0.45, 0.95, forestAt(x, z)) * (1 - md), 0, 1);
  return out.setRGB(grass, clamp(rockiness(x, z, o.gully) * 1.2, 0, 1), CITY ? 0.94 + 0.12 * n2 : 0.86 + 0.28 * n2);
}

// One material for the terrain and the trail strips. On the mountain: scanned
// forest floor, grass and rock mixed by the weights above, and packed dirt
// along the trail with a ragged edge. In the city: paving, park grass, and
// asphalt with a dashed centre line. Textures are laid out in world space so
// that the strips and the terrain match exactly.
function groundMat() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: tex(CITY ? 'pave.jpg' : 'floor.jpg'), normalMap: tex(CITY ? 'pave_n.jpg' : 'floor_n.jpg', { data: true }) });
  const u = { tGrass: { value: tex('grass.jpg') }, tDirt: { value: tex(CITY ? 'road.jpg' : 'dirt.jpg') }, tRock: { value: tex('rock.jpg') } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vW; varying vec2 vTr;\n' + sh.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\n vW = position; vTr = uv; vMapUv = position.xz * 0.21; vNormalMapUv = vMapUv;');
    sh.fragmentShader = 'varying vec3 vW; varying vec2 vTr; uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', `
        vec2 gu = vW.xz * 0.21;
        float macro = 0.62 + 1.9 * texture2D(tGrass, gu * 0.043).g;
        vec3 cF = texture2D(map, gu).rgb, cG = texture2D(tGrass, gu * 1.37).rgb, cR = texture2D(tRock, gu * 0.31).rgb, cD = texture2D(tDirt, gu * ${CITY ? '0.9' : '1.9'}).rgb;
        vec3 gc = ${CITY ? 'mix(cF * mix(1.0, macro, 0.25), cG * vec3(0.62, 0.8, 0.5) * macro, vColor.r)' : 'mix(cF * vec3(0.7, 0.74, 0.6), cG * vec3(0.62, 0.8, 0.5), vColor.r) * macro'};
        gc = mix(gc, cR * 0.8, vColor.g);
        float across = abs(vTr.x - 0.5) * 2.6;
        float rag = (cD.g - 0.12) * 2.2 + (texture2D(tDirt, gu * 0.23).g - 0.12) * 3.0;
        float tw = vTr.x < 0.0 ? 0.0 : 1.0 - smoothstep(${CITY ? '1.0, 1.06, across + rag * 0.02' : '0.7, 1.12, across + rag * 0.3'});
        ${CITY
    ? 'gc = mix(gc, cD * 0.9, tw); gc = mix(gc, vec3(0.62), tw * 0.85 * step(across, 0.055) * step(fract(vTr.y * 0.55), 0.45));'
    : 'gc = mix(gc, cD * vec3(1.12, 1.0, 0.86) * (1.0 + 0.3 * (1.0 - smoothstep(0.0, 0.6, across))), tw);'}
        diffuseColor.rgb = gc * vColor.b;`);
  };
  return m;
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
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(w * h * 2).fill(-1), 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  }
}

// A strip of exact ground along every trail. It carries berms, jump faces and
// cut banks at full detail, which the coarse terrain grid cannot.
function buildTrailStrips(scene, mat) {
  const o = newSurf(), col = new THREE.Color(), P = {};
  const U = 1.3; // the dirt can reach this many half widths to each side
  for (const t of trails) {
    const rows = [], shade = new Map();
    const onStairs = s => t.feats.some(f => f.type === 'stairs' && s > f.s0 - 0.4 && s < f.s1 + 0.4);
    for (let i = 0; i < t.n; i++) rows.push(t.s[i]);
    for (const f of t.feats) if (f.type === 'kicker') rows.push(f.s1 - 0.02, f.s1 + 0.02);
    for (const f of t.feats) if (f.type === 'stairs') for (let s = f.s0 + STAIR_T; s < f.s1 + 0.1; s += STAIR_T) { rows.push(s - 0.03, s + 0.03); shade.set(s - 0.03, 1.12); shade.set(s + 0.03, 0.45); } // one riser per step, dark at its foot
    rows.sort((a, b) => a - b);
    const NC = 15, pos = [], cl = [], uv = [], idx = [];
    rows.forEach((s, r) => {
      poseAt(t, s, P);
      const hw = P.hw, cx = Math.cos(P.th), cz = Math.sin(P.th), open = t.gw[P.i] < 0.6 || onStairs(s), dim = shade.get(s) ?? 1; // stairs are paved, not asphalt
      const lats = [-(hw + RIB), -(hw + 3.2), -(hw + 1.2), -hw * U, -hw, -(hw - 0.7), -hw * 0.4, 0, hw * 0.4, hw - 0.7, hw, hw * U, hw + 1.2, hw + 3.2, hw + RIB];
      for (let c = 0; c < NC; c++) {
        const x = P.x + cx * lats[c], z = P.z + cz * lats[c];
        surfaceAt(x, z, -1e9, o);
        pos.push(x, o.y - (c === 0 || c === NC - 1 ? 0.3 : 0), z);
        groundColor(x, z, o, col); cl.push(col.r, col.g, col.b * dim);
        uv.push(open ? -1 : 0.5 + 0.5 * lats[c] / (hw * U), s / 8);
        if (r && c) { const a = (r - 1) * NC + c - 1, b = a + 1, d = r * NC + c - 1, e = d + 1; idx.push(a, b, d, b, e, d); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
  const cF = C(0x1f3320), cF2 = C(0x3a5230), cR = C(0x6f6c66), cS = C(0xf2f4f8);
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
  scene.add(new THREE.Mesh(g, pbr({ vertexColors: true, roughness: 1 })));
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(5000, 1500).rotateX(-Math.PI / 2),
    pbr({ color: 0x1f3f4c, roughness: 0.06, metalness: 0.3 }));
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

const LOD_AT = 80; // beyond this the simple version of a tree is drawn

// Collects flat cards that carry a cut-out photo of a branch or a leaf.
function cards() {
  const pos = [], uv = [], nor = [], col = [], idx = [], n = new THREE.Vector3();
  return {
    // A card that leaves the point (0, y, 0) towards yaw. It starts at the angle
    // `up` above level and bends down by `droop` at every joint.
    add(y, yaw, len, wid, up, droop, segs, shade, r0 = 0.1, v0 = 0, v1 = 1) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), b = pos.length / 3;
      let d = r0, h = y, ang = up;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        if (i) { d += Math.cos(ang) * len / segs; h += Math.sin(ang) * len / segs; ang -= droop; }
        for (const s of [-1, 1]) {
          pos.push(cy * d - sy * s * wid / 2, h, sy * d + cy * s * wid / 2);
          uv.push(0.5 + 0.5 * s, v0 + (v1 - v0) * t);
          n.set(cy * 0.5 - sy * s * 0.35, 0.8, sy * 0.5 + cy * s * 0.35).normalize(); nor.push(n.x, n.y, n.z);
          const c = shade * (0.4 + 0.6 * t); col.push(c, c, c);
        }
        if (i) { const a = b + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); return g;
    },
  };
}
const leafMat = (file, o = {}) => new THREE.MeshStandardMaterial({ map: tex(file, { clamp: true }), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, ...o });

// Conifers: a bark trunk with dead stubs low down and drooping boughs above,
// so the trail runs between bare trunks under the crowns.
const TREES = [
  { h: 13, r: 2.5, y0: 3.6, tr: 0.3 },              // spruce
  { h: 16.5, r: 2.1, y0: 4.3, tr: 0.33 },           // tall narrow spruce
  { h: 15, r: 2.7, y0: 8.6, tr: 0.3, pine: true },  // pine with a high crown
  { h: 5.5, r: 1.5, y0: 0.7, tr: 0.13 },            // young spruce
  { h: 9, r: 0, y0: 7.5, tr: 0.26 },                // dead snag
];

function trunkGeo(k, hi) {
  const g = new THREE.CylinderGeometry(k.tr * (k.r ? 0.2 : 0.45), k.tr, k.h + 0.7, hi ? 9 : 5, hi ? 5 : 1, true).translate(0, k.h / 2 - 0.35, 0);
  const p = g.attributes.position, u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), f = 1 + 0.7 * Math.pow(clamp(1 - y / 0.9, 0, 1), 2); // roots flare out at the foot
    p.setXYZ(i, p.getX(i) * f, y, p.getZ(i) * f); u.setXY(i, u.getX(i) * 2, u.getY(i) * k.h / 2.4);
  }
  g.computeVertexNormals();
  if (!hi) return g;
  const parts = [g], rng = mulberry(17 + k.h * 10);
  for (let i = 0, n = k.r ? 7 : 14; i < n; i++) {
    const y = 1.4 + rng() * (k.y0 - 1.2), l = 0.4 + rng() * 0.8;
    parts.push(new THREE.CylinderGeometry(0.006, 0.03, l, 4, 1, true).translate(0, l / 2, 0).rotateZ(-1.2 - rng() * 0.5).rotateY(rng() * 6.28).translate(0, y, 0));
  }
  return mergeGeometries(parts);
}

function crownGeo(k, hi) {
  const f = cards(), step = hi ? 0.55 : 1.1, per = hi ? 4 : 3;
  let n = 0;
  for (let y = k.y0; y < k.h - 1; y += step) {
    const t = (y - k.y0) / (k.h - k.y0);
    const len = k.r * (k.pine ? 0.5 + 0.5 * Math.sin(t * 3.0 + 0.2) : (1 - 0.8 * t) * Math.min(1, 0.7 + 3 * t));
    for (let i = 0; i < per; i++, n++) {
      const l = len * (0.82 + 0.36 * ((n * 0.618) % 1));
      f.add(y + ((n * 0.37) % 1) * step * 0.7, n * 2.39996, l, l * (hi ? 1.05 : 1.4), (k.pine ? 0.45 : -0.1 + 0.6 * t), hi ? 0.26 : 0.1, hi ? 2 : 1, 0.7 + 0.3 * t);
    }
  }
  for (let i = 0; i < 3; i++) f.add(k.h - 1.5, i * 2.094, 1.6, 1.1, 1.5, 0, 1, 1, 0);
  return f.build();
}

function buildForest(scene, quality) {
  const bark = pbr({ map: tex('bark.jpg'), normalMap: tex('bark_n.jpg', { data: true }), roughness: 1 });
  const leaf = leafMat('bough.png', { color: 0xb9c4a6 });
  const rng = mulberry(7);
  const list = course.trees.filter(t => quality > 0 || t.near || rng() < 0.5);
  const at = (t, d) => { d.position.set(t.x, t.y, t.z); d.rotation.set((fbm(t.x, t.z, 1) - 0.5) * 0.09, t.x * 7.3 + t.z, (fbm(t.z, t.x, 1) - 0.5) * 0.09); d.scale.setScalar(t.sc); };
  const place = (t, d, col) => { at(t, d); const v = 0.72 + 0.4 * fbm(t.x / 3, t.z / 3, 1), w = fbm(t.z / 2, t.x / 2, 1); col.setRGB(v * (0.92 + 0.2 * w), v, v * (0.95 - 0.15 * w)); return true; };
  TREES.forEach((k, i) => {
    const mine = list.filter(t => t.kind === i), near = mine.filter(t => t.near), far = mine.filter(t => !t.near);
    const tone = i === 2 ? [1.15, 0.88, 0.72] : i === 4 ? [0.8, 0.8, 0.82] : [0.9, 0.86, 0.82];
    const wood = (t, d, col) => { at(t, d); const v = 0.8 + 0.3 * fbm(t.x / 2, t.z / 2, 1); col.setRGB(tone[0] * v, tone[1] * v, tone[2] * v); return true; };
    const stem = trunkGeo(k, false);
    instanced(scene, trunkGeo(k, true), bark, near, wood, { band: 80, maxDist: LOD_AT, cast: quality > 0, receive: true });
    instanced(scene, stem, bark, near, wood, { band: 80, minDist: LOD_AT });
    instanced(scene, stem, bark, far, wood);
    if (!k.r) return;
    const hi = crownGeo(k, true), lo = crownGeo(k, false);
    instanced(scene, hi, leaf, near, place, { band: 80, maxDist: LOD_AT, cast: quality > 0 });
    instanced(scene, lo, leaf, near, place, { band: 80, minDist: LOD_AT });
    instanced(scene, lo, leaf, far, place);
  });
}

// Boulders: a ball pushed in and out by noise at two sizes, with a scanned rock surface.
function buildRocks(scene) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3)), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 0.72 + 0.55 * fbm(x * 1.1 + 5, z * 1.1 + y * 0.9 + 3, 2) + 0.16 * fbm(x * 4 + 1, z * 4 + y * 3.1, 2);
    p.setXYZ(i, x * f, Math.max(-0.35, y * f * 0.8), z * f);
  }
  g.computeVertexNormals();
  const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 1.2);
  const mat = pbr({ map: tex('rock.jpg'), normalMap: tex('rock_n.jpg', { data: true }), roughness: 0.95 });
  instanced(scene, g, mat, course.rocks, (r, d, col) => {
    d.position.set(r.x, r.y + r.rr * 0.2, r.z); d.rotation.set(0, r.seed * 40, r.seed * 0.5 - 0.25);
    d.scale.set(r.rr * (0.95 + r.seed * 0.3), r.rr, r.rr * (1.1 - r.seed * 0.3));
    const v = 0.42 + r.seed * 0.3; col.setRGB(v, v * 0.98, v * 0.94); return true;
  }, { cast: true, receive: true });
}

// Undergrowth: grass tufts and ferns cut from scans.
function buildPlants(scene, quality) {
  const rng = mulberry(99), o = newSurf(), P = {}, grass = [], ferns = [];
  const tryAdd = (x, z, fernP) => {
    surfaceAt(x, z, -1e9, o);
    if (o.gully > 0.6 || o.w > 0.35 || rockiness(x, z, o.gully) > 0.4 || (CITY && meadowAt(z) < 0.5)) return;
    (rng() < fernP ? ferns : grass).push({ x, y: o.y, z, r: rng() });
  };
  const step = quality > 0 ? 0.55 : 1.4;
  for (const t of trails) for (let s = 2; s < t.len; s += step) {
    poseAt(t, s, P);
    const lat = (rng() < 0.5 ? -1 : 1) * (P.hw + 0.35 + rng() * rng() * 9);
    tryAdd(P.x + Math.cos(P.th) * lat, P.z + Math.sin(P.th) * lat, 0.3 * (1 - meadowAt(P.z)));
  }
  const B = course.bounds;
  for (let i = 0; i < (quality > 0 ? 6000 : 1800); i++) {
    const z = course.meadow[1] + rng() * (course.meadow[0] - course.meadow[1]), x = 30 + (rng() - 0.5) * 220;
    if (x > B.x0 && x < B.x1) tryAdd(x, z, 0.03);
  }
  const tuft = cards();
  for (let i = 0; i < 3; i++) tuft.add(-0.03, i * 1.047 + 1.57, 0.46, 0.8, 1.45, 0, 1, 1, i * 0.05 - 0.05, 0.53, 1);
  instanced(scene, tuft.build(), leafMat('tuft.png', { color: 0xc8cfae }), grass, (it, d, col) => {
    d.position.set(it.x, it.y, it.z); d.rotation.y = it.r * 6.28; d.scale.setScalar(0.7 + it.r * 1.0);
    col.setRGB(0.85 + it.r * 0.3, 0.9 + it.r * 0.15, 0.8); return true;
  }, { band: 60, maxDist: 120 });
  const fern = cards();
  for (let i = 0; i < 8; i++) fern.add(0, i * 0.785 + (i % 2) * 0.3, 0.8 + (i % 3) * 0.12, 0.26, 1.05 - (i % 2) * 0.25, 0.42, 3, 1, 0.02);
  instanced(scene, fern.build(), leafMat('frond.png', { color: 0xbfd0a0 }), ferns, (it, d, col) => {
    d.position.set(it.x, it.y - 0.02, it.z); d.rotation.y = it.r * 6.28; d.scale.setScalar(0.8 + it.r * 0.9);
    col.setRGB(0.8 + it.r * 0.25, 0.9, 0.75); return true;
  }, { band: 60, maxDist: 150 });
}

// ------------------------------------------------------------------ city
// Buildings are plain boxes with a drawn front: plaster from a scan, rows of
// windows, a door. A second drawing says how shiny each part is, so the glass
// mirrors the sky.
const BUILD = [
  { fl: 3, cols: 3 },   // house
  { fl: 5, cols: 5 },   // block
  { fl: 9, cols: 4 },   // tower
  { fl: 4, cols: 7 },   // wide block
  { fl: 1, cols: 1 },   // garage
];
const SUNK = 8; // how far a building reaches below its ground point, for slopes

function facade(kind, k, wall, shine) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), W = 512, rng = mulberry(50 + kind), gy = W * k.h / (k.h + SUNK), fh = gy / k.fl;
  if (shine) { g.fillStyle = '#e9e9e9'; g.fillRect(0, 0, W, W); }
  else {
    g.fillStyle = wall ? g.createPattern(wall, 'repeat') : '#b9b4aa'; g.fillRect(0, 0, W, W);
    g.fillStyle = 'rgba(255,255,255,0.38)'; g.fillRect(0, 0, W, gy);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, gy - fh * 0.08, W, W);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 7);
    if (k.fl > 1) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, gy - fh - 3, W, 5); }
  }
  for (let f = 0; f < k.fl; f++) for (let i = 0; i < k.cols; i++) {
    const cx = (i + 0.5) / k.cols * W, top = f * fh + fh * 0.2, r = rng();
    const door = f === k.fl - 1 && (k.fl === 1 || i === (k.cols >> 1));
    const ww = W / k.cols * (k.fl === 1 ? 0.8 : door ? 0.36 : 0.52), wh = door ? fh * 0.8 : fh * 0.56;
    if (shine) { g.fillStyle = door ? '#b0b0b0' : '#1c1c1c'; g.fillRect(cx - ww / 2, top, ww, wh); continue; }
    g.fillStyle = '#e4e0d6'; g.fillRect(cx - ww / 2 - 4, top - 4, ww + 8, wh + (door ? 4 : 8));
    if (door) { g.fillStyle = k.fl === 1 ? '#7d8288' : '#4a3628'; g.fillRect(cx - ww / 2, top, ww, wh); continue; }
    const gr = g.createLinearGradient(0, top, 0, top + wh);
    gr.addColorStop(0, r < 0.25 ? '#6d7377' : '#2b3742'); gr.addColorStop(1, r < 0.25 ? '#8a8d8c' : '#4b5c69');
    g.fillStyle = gr; g.fillRect(cx - ww / 2, top, ww, wh);
    g.fillStyle = '#e4e0d6'; g.fillRect(cx - 1.5, top, 3, wh); g.fillRect(cx - ww / 2, top + wh * 0.38, ww, 3);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - ww / 2 - 6, top + wh + 4, ww + 12, 4);
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
  if (!shine) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCity(scene, quality) {
  const KIND = course.buildKinds, PAL = [0xd8cdb8, 0xb5654a, 0xc9c4bb, 0x9fb0bd, 0xd2b56a, 0xe6e2da, 0xa8876a];
  const roof = pbr({ color: 0x505358, roughness: 0.95 });
  const sides = KIND.map((k, i) => pbr({ map: facade(i, { ...BUILD[i], h: k.h }, null, false), roughnessMap: facade(i, { ...BUILD[i], h: k.h }, null, true), roughness: 1 }));
  const wall = new Image();
  wall.onload = () => sides.forEach((m, i) => { m.map.dispose(); m.map = facade(i, { ...BUILD[i], h: KIND[i].h }, wall, false); m.needsUpdate = true; });
  wall.src = 'tex/wall.jpg';
  KIND.forEach((k, i) => {
    const geo = new THREE.BoxGeometry(k.hx * 2, k.h + SUNK, k.hz * 2).translate(0, (k.h + SUNK) / 2 - SUNK, 0), s = sides[i];
    instanced(scene, geo, [s, s, roof, roof, s, s], course.buildings.filter(b => b.kind === i), (b, d, col) => {
      d.position.set(b.x, b.y, b.z); col.setHex(PAL[Math.floor(b.tint * PAL.length)]); return true;
    }, { cast: quality > 0, receive: true });
  });
  const lamp = mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.08, 6.2, 6).translate(0, 2.9, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5).rotateZ(Math.PI / 2).translate(1.2, 5.95, 0),
    new THREE.BoxGeometry(0.6, 0.1, 0.24).translate(2.3, 5.9, 0),
  ]);
  instanced(scene, lamp, pbr({ color: 0x2b2e33, roughness: 0.5, metalness: 0.6 }), course.lamps, (l, d) => {
    d.position.set(l.x, l.y, l.z); d.rotation.y = -l.th + (l.side > 0 ? Math.PI : 0);
  }, { cast: quality > 0 });
}

// ------------------------------------------------------------------ wood
// Scanned boards. Ramps get worn yellow arrows painted on top.
function plankTex(chevrons) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#5a4a3a'; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, 512, 512);
    if (chevrons) {
      g.scale(2, 2); g.strokeStyle = 'rgba(226,188,60,0.72)'; g.lineWidth = 20; g.lineJoin = 'miter';
      for (const y of [215, 135, 55]) { g.beginPath(); g.moveTo(58, y + 30); g.lineTo(128, y - 22); g.lineTo(198, y + 30); g.stroke(); }
    }
    t.needsUpdate = true;
  };
  img.src = 'tex/planks.jpg';
  return t;
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
  quads(top, pbr({ map: plankTex(false), side: THREE.DoubleSide, roughness: 0.9 }), true, true);
  quads(topR, pbr({ map: plankTex(true), side: THREE.DoubleSide }), true, true);
  const dark = pbr({ color: 0x4a3a2c, side: THREE.DoubleSide });
  quads(side, dark, false, false); quads(rails, pbr({ color: 0x6b5540, side: THREE.DoubleSide }), false, true);
  instanced(scene, new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0), pbr({ color: 0x54422f }), posts, (p, d) => {
    d.position.set(p.x, p.y0, p.z); d.scale.set(p.r, p.y1 - p.y0, p.r);
  }, { cast: true });
}

// ------------------------------------------------------------------ signs and gates
const SYMBOL = { green: '●', blue: '■', black: '◆', mega: '★' };
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
  const wood = pbr({ color: 0x5e4a36 });
  const made = new Map();
  for (const a of course.arches) {
    const g = new THREE.Group(), w = a.hw + 1.1, key = a.kind + a.label + a.diff;
    if (!made.has(key)) made.set(key, bannerTex(a));
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 6.2, 7), wood); p.position.set(sx * w, 2.3, 0); p.castShadow = true; g.add(p);
    }
    const bm = pbr({ map: made.get(key) });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.25), bm); b.position.set(0, 4.55, 0.02); g.add(b);
    const b2 = b.clone(); b2.rotation.y = Math.PI; b2.position.z = -0.02; g.add(b2);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 0.16, 0.16), wood); beam.position.y = 5.25; g.add(beam);
    // pennants
    const cols = [0xc23b30, 0xd9a520, 0x2d7fb8, 0x3f9a4c], pg = [], n = Math.floor(w * 2 / 0.7);
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
  const wood = pbr({ color: 0x54422f });
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
    const b = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.14), [wood, wood, wood, wood, pbr({ map: t }), wood]);
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
  const mat = pbr();
  instanced(scene, new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.5, 0), mat, posts, (p, d, col) => { d.position.set(p.x, p.y, p.z); col.setHex(p.c); return true; });
  instanced(scene, new THREE.CylinderGeometry(0.09, 0.11, 1.25, 6).translate(0, 0.5, 0), pbr({ color: 0x5e4a36 }), fence, (p, d) => { d.position.copy(p); }, { cast: true });
  if (rail.length) {
    const pos = [], idx = [];
    rail.forEach((q, i) => { for (const v of q) pos.push(v.x, v.y, v.z); const b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, pbr({ color: 0x6b5540, side: THREE.DoubleSide })));
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
  instanced(scene, new THREE.CylinderGeometry(0.07, 0.1, 1, 5).rotateZ(Math.PI / 2), pbr({ color: CITY ? 0x77797c : 0x3f3122 }), items, (it, d) => {
    d.position.set(it.x, it.y + 0.02, it.z); d.rotation.y = -it.th; d.scale.set(it.l, 1, 1);
  });
}

// ------------------------------------------------------------------ water
export const waterSpots = []; // places that make water noise (falls)
let waterTex;
function buildWater(scene) {
  waterTex = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#5f8792'; g.fillRect(0, 0, w, h);
    const rng = mulberry(8);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.5})`; g.fillRect(rng() * w, rng() * h, 2 + rng() * 5, 10 + rng() * 40); }
  }, true);
  const mat = pbr({ map: waterTex, vertexColors: true, roughness: 0.12 });
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
// A physical sky model. It is also what lights the shaded side of everything.
function buildSky(scene, renderer, sunDir) {
  const sky = new Sky(); sky.scale.setScalar(8000);
  const u = sky.material.uniforms;
  u.turbidity.value = 1.8; u.rayleigh.value = 2.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.86;
  u.sunPosition.value.copy(sunDir);
  const env = new THREE.Scene(); env.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env).texture; pm.dispose();
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
  return sky;
}

// ------------------------------------------------------------------ assembly
export function buildWorld(scene, quality, renderer) {
  CITY = WORLD === 'city';
  scene.fog = new THREE.FogExp2(SKY.fog, 0.00042);
  const sunDir = new THREE.Vector3(0.5, 0.62, 0.38).normalize();
  const hemi = new THREE.HemisphereLight(0x9fb6d0, 0x5c5136, 0.65); // light bounced up from the ground
  const sun = new THREE.DirectionalLight(0xfff0dc, 6.4);
  scene.add(hemi, sun, sun.target);
  if (quality > 0) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = c.bottom = -55; c.right = c.top = 55; c.near = 10; c.far = 320;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.25;
  }
  const ground = groundMat();
  buildGround(scene, ground); buildTrailStrips(scene, ground); buildFar(scene);
  if (CITY) buildCity(scene, quality);
  buildDecks(scene); buildForest(scene, quality); buildRocks(scene); buildPlants(scene, quality);
  buildArches(scene); buildSigns(scene); buildMarkers(scene); buildRoots(scene); buildWater(scene);
  const sky = buildSky(scene, renderer, sunDir);
  scene.environmentIntensity = 1.05;
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
