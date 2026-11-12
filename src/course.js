// The mountain: trail layout, terrain height, wooden features, trees and rocks.
// Pure data and math (no three.js) so the same code drives physics, rendering,
// the headless test bot and every multiplayer client.
//
// Conventions: x is right, z is negative downhill, y is up. A heading th of 0
// points downhill (-z); positive th turns right. Forward = (sin th, -cos th).
import { fbm, mulberry, clamp, sm } from './noise.js';

export const RAD = Math.PI / 180;
export const DOWN = 0.34;          // average fall-line slope of the mountain
const ZB = -2330;           // below this the mountain levels out into the valley
const GMIN = 0.045, GMAX = 0.62; // trail grade limits
const KBANK = 4.5;          // berm tilt per unit of curvature
export const LAKE_Y = DOWN * (ZB - 130) - 3;
export const VALLEY_Z = ZB;

// Ravines that run down the fall line. Trails crossing them get bridges.
export const GULLIES = [
  { x: 128, amp: 8, f: 0.006, ph: 0.4, w: 6.5, d: 10, z0: -380, falls: [-452, -1122] },
  { x: -72, amp: 7, f: 0.007, ph: 2.1, w: 6.5, d: 10, z0: -1580, falls: [-1822] },
];
export const gullyX = (g, z) => g.x + g.amp * Math.sin(z * g.f + g.ph) + 3 * Math.sin(z * 0.031 + g.ph * 3);
export function gullyFloorDepth(g, z) {
  if (z > g.z0) return 0;
  let d = g.d * sm(0, 70, g.z0 - z);
  for (const f of g.falls) d += 5 * sm(0, 2.5, f - z) * (1 - sm(110, 240, f - z));
  return d;
}
export function gullyDepth(x, z) {
  let m = 0;
  for (const g of GULLIES) {
    const t = Math.abs(x - gullyX(g, z)) / g.w;
    if (t < 1.6) { const d = gullyFloorDepth(g, z) * (1 - sm(0.4, 1.6, t)); if (d > m) m = d; }
  }
  return m;
}

// The mountain falls in steps: long steep pitches broken by short benches.
const STEP = 190, BENCH = 0.3, BENCH_G = 0.05, NST = 512;
const stepTab = new Float64Array(NST + 1);
{
  const steep = (DOWN - BENCH * BENCH_G) / (1 - BENCH);
  for (let i = 0; i < NST; i++) {
    const q = (i + 0.5) / NST, b = sm(0, 0.07, q) * (1 - sm(BENCH, BENCH + 0.07, q));
    stepTab[i + 1] = stepTab[i] - (steep + (BENCH_G - steep) * b - DOWN) * STEP / NST;
  }
  const res = stepTab[NST];
  for (let i = 0; i <= NST; i++) stepTab[i] -= res * i / NST;
}
const stepWarp = (x, z) => 0.5 * fbm(x / 260 + 7.1, z / 420 + 2.3, 2);
const STEP_PH = 0.96 - (-16 / STEP + stepWarp(0, 16));
function stepOff(x, z) {
  const u = -z / STEP + stepWarp(x, z) + STEP_PH, f = (u - Math.floor(u)) * NST, i = f | 0;
  return (stepTab[i] + (stepTab[i + 1] - stepTab[i]) * (f - i)) * sm(ZB - 60, ZB + 160, z);
}

// Large-scale mountain shape without ravines. Trail heights follow this.
export function baseNG(x, z) {
  const ze = z > ZB ? z : ZB - 130 * (1 - Math.exp((z - ZB) / 130));
  let y = DOWN * ze;
  y += stepOff(x, z);
  y += 16 * (fbm(x / 230 + 3.3, z / 310 + 1.7, 3) - 0.5);
  const ax = Math.abs(x - 30) - 300;
  if (ax > 0) y += 0.0006 * ax * ax / (1 + ax / 900);
  const zf = ZB - 900 - z;           // a far range on the other side of the valley
  if (zf > 0) y += 0.00035 * zf * zf / (1 + zf / 700);
  return y;
}
const bump = (x, z) => 1.5 * (fbm(x / 22, z / 22, 3) - 0.5) + 0.3 * (fbm(x / 5 + 40, z / 5, 2) - 0.5);

// ---------------------------------------------------------------- path builder
class Path {
  constructor(name, diff, pose, hw) {
    this.name = name; this.diff = diff;
    this.x = [pose.x]; this.z = [pose.z]; this.th = [pose.th];
    this.cw = hw; this.cg = GMIN;
    this.hw = [hw]; this.gm = [GMIN]; this.len = 0; this.marks = [];
  }
  get pose() { const i = this.x.length - 1; return { x: this.x[i], z: this.z[i], th: this.th[i] }; }
  _p(x, z, th) {
    const i = this.x.length - 1;
    this.len += Math.hypot(x - this.x[i], z - this.z[i]);
    this.x.push(x); this.z.push(z); this.th.push(th); this.hw.push(this.cw); this.gm.push(this.cg);
  }
  go(len) {
    const n = Math.max(1, Math.round(len)), d = len / n; let { x, z, th } = this.pose;
    for (let i = 0; i < n; i++) { x += Math.sin(th) * d; z -= Math.cos(th) * d; this._p(x, z, th); }
    return this;
  }
  // Turn by deg (positive = right) on a circle of radius r.
  arc(deg, r) {
    const a = deg * RAD, L = Math.abs(a) * r, n = Math.max(2, Math.round(L)), d = L / n, da = a / n;
    let { x, z, th } = this.pose;
    for (let i = 0; i < n; i++) { th += da / 2; x += Math.sin(th) * d; z -= Math.cos(th) * d; th += da / 2; this._p(x, z, th); }
    return this;
  }
  // Smooth connector to an absolute pose (used to rejoin branches).
  to(pose, k = 1.1) {
    const a = this.pose, D = Math.hypot(pose.x - a.x, pose.z - a.z) * k;
    const ax = Math.sin(a.th) * D, az = -Math.cos(a.th) * D, bx = Math.sin(pose.th) * D, bz = -Math.cos(pose.th) * D;
    const n = Math.max(4, Math.round(D * 1.1)); let pth = a.th;
    for (let i = 1; i <= n; i++) {
      const u = i / n, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -d00, d11 = 3 * u2 - 2 * u;
      const x = h00 * a.x + h10 * ax + h01 * pose.x + h11 * bx, z = h00 * a.z + h10 * az + h01 * pose.z + h11 * bz;
      const dx = d00 * a.x + d10 * ax + d01 * pose.x + d11 * bx, dz = d00 * a.z + d10 * az + d01 * pose.z + d11 * bz;
      let th = Math.atan2(dx, -dz);
      while (th - pth > Math.PI) th -= 2 * Math.PI;
      while (th - pth < -Math.PI) th += 2 * Math.PI;
      pth = th; this._p(x, z, th);
    }
    return this;
  }
  w(h) { this.cw = h; return this; }
  grade(g) { this.cg = g; return this; }
  mark(type, o = {}) { this.marks.push({ type, s: this.len, ...o }); return this; }
  // Dirt shapes (part of the ground).
  kicker(h, len = 6) { return this.mark('kicker', { h, len }).go(len); }
  table(h, lu = 5, top = 4, ld = 6) { return this.mark('table', { h, lu, top, ld, len: lu + top + ld }).go(lu + top + ld); }
  roller(h = 0.6, len = 8) { return this.mark('roller', { h, len }).go(len); }
  // Wooden shapes (platforms above the ground).
  ramp(h, len = 7, hw = 1.7) { return this.mark('ramp', { h, len, hw }).go(len); }
  skinny(len, h = 1.2, hw = 0.8) { return this.mark('skinny', { h, len, hw }).go(len); }
  drop(len = 12, hw = 1.8) { return this.mark('drop', { len, hw }).go(len); }
  rough(len, kind) { return this.mark('rough', { len, kind }).go(len); }
  cp() { return this.mark('cp'); }
}

function smoothArr(a, r) {
  const n = a.length, o = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { s += a[j]; c++; }
    o[i] = s / c;
  }
  return o;
}

const WOOD_HW = { main: 2.1, green: 2.4, blue: 1.7, black: 1.2 };

function finalize(P, y0, g0 = 0.1) {
  const n = P.x.length;
  const t = {
    name: P.name, diff: P.diff, n, x: P.x, z: P.z, th: P.th, hw: smoothArr(P.hw, 4),
    s: new Array(n), y: new Array(n), kap: null, bk: new Array(n), gw: new Array(n).fill(1),
    fi: new Array(n).fill(-1), di: new Array(n).fill(-1), rg: new Array(n).fill(0),
    feats: [], decks: [], zones: [], cps: [], next: [], finish: -1, p0: 0, p1: 0,
  };
  t.s[0] = 0;
  for (let i = 1; i < n; i++) t.s[i] = t.s[i - 1] + Math.hypot(t.x[i] - t.x[i - 1], t.z[i] - t.z[i - 1]);
  t.len = t.s[n - 1];
  const k = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    k[i] = (t.th[b] - t.th[a]) / Math.max(1e-6, t.s[b] - t.s[a]);
  }
  t.kap = smoothArr(k, 5);
  const bankK = P.diff === 'green' ? KBANK * 0.7 : KBANK;
  for (let i = 0; i < n; i++) t.bk[i] = clamp(-t.kap[i] * bankK, -0.36, 0.36) * sm(0, 14, t.s[i]) * sm(0, 14, t.len - t.s[i]);
  // Height profile: follow the mountain, always descending.
  const raw = smoothArr(t.x.map((x, i) => baseNG(x, t.z[i])), 7);
  // The grade chases the terrain but changes gently, so the trail has no kinks
  // that would throw a rider into the air by accident.
  t.y[0] = y0;
  let g = g0;
  for (let i = 1; i < n; i++) {
    const ds = t.s[i] - t.s[i - 1];
    const want = (raw[i - 1] - raw[i]) / ds + 0.07 * (t.y[i - 1] - raw[i - 1]);
    g = clamp(clamp(want, g - 0.024 * ds, g + 0.024 * ds), P.gm[i], GMAX);
    t.y[i] = t.y[i - 1] - g * ds;
  }
  t.g1 = g;
  for (const m of P.marks) {
    const s0 = m.s, s1 = m.s + (m.len || 0);
    switch (m.type) {
      case 'kicker': case 'table': case 'roller': t.feats.push({ ...m, s0, s1 }); break;
      case 'ramp': t.decks.push({ type: 'ramp', s0, s1, hw: m.hw, h: m.h, rails: false }); break;
      case 'skinny': t.decks.push({ type: 'skinny', s0, s1, hw: m.hw, h: m.h, rails: false }); break;
      case 'drop': t.decks.push({ type: 'flat', s0, s1, hw: m.hw, rails: false, y0: 0 }); break;
      case 'start': t.decks.push({ type: 'bridge', s0, s1, hw: m.hw, rails: true, arch: 0, start: true }); break;
      case 'rough': t.zones.push({ s0, s1, kind: m.kind }); break;
      case 'cp': t.cps.push(s0); break;
      case 'finish': t.finish = s0; break;
    }
  }
  // Ravine crossings become bridges; the ground gives way underneath.
  t.spans = [];
  for (let i = 0; i < n; i++) {
    if (gullyDepth(t.x[i], t.z[i]) < 1.2) continue;
    let j = i; while (j + 1 < n && gullyDepth(t.x[j + 1], t.z[j + 1]) >= 1.2) j++;
    const sp = { s0: t.s[i] - 2, s1: t.s[j] + 2 };
    t.spans.push(sp);
    t.decks.push({ type: 'bridge', s0: sp.s0 - 3.5, s1: sp.s1 + 3.5, hw: WOOD_HW[P.diff], rails: P.diff !== 'black', arch: 0.25 });
    i = j;
  }
  for (let i = 0; i < n; i++) {
    const s = t.s[i];
    for (const sp of t.spans) t.gw[i] = Math.min(t.gw[i], clamp(Math.max(sp.s0 - s, s - sp.s1) / 2.5, 0, 1));
    t.feats.forEach((f, q) => { if (s >= f.s0 - 1.5 && s <= f.s1 + 1.5) t.fi[i] = q; });
    t.decks.forEach((d, q) => { if (s >= d.s0 - 1.5 && s <= d.s1 + 1.5 && (t.di[i] < 0 || (s >= d.s0 && s <= d.s1))) t.di[i] = q; });
    for (const zn of t.zones) if (s >= zn.s0 && s <= zn.s1) t.rg[i] = zn.kind === 'rock' ? 1 : 2;
  }
  return t;
}

// Height of a dirt feature above the plain trail.
function dirtOff(f, s) {
  if (s < f.s0 || s > f.s1) return 0;
  const x = s - f.s0, L = f.s1 - f.s0;
  if (f.type === 'kicker') return f.h * Math.pow(x / L, 1.7);
  if (f.type === 'roller') return f.h * 0.5 * (1 - Math.cos(2 * Math.PI * x / L));
  if (x < f.lu) return f.h * Math.pow(x / f.lu, 1.5);
  if (x < f.lu + f.top) return f.h;
  return f.h * (1 - sm(0, 1, (x - f.lu - f.top) / f.ld));
}
// Top of a wooden deck at trail distance s, where ty is the trail height there.
export function deckY(dk, s, ty) {
  const u = clamp((s - dk.s0) / (dk.s1 - dk.s0), 0, 1), lip = 0.1 * sm(0, 1.6, s - dk.s0);
  if (dk.type === 'bridge') return ty + lip * sm(0, 1.6, dk.s1 - s) + dk.arch * Math.sin(Math.PI * u);
  if (dk.type === 'ramp') return ty + lip + dk.h * Math.pow(u, 1.6);
  if (dk.type === 'skinny') return ty + lip * sm(0, 1.6, dk.s1 - s) + dk.h * sm(0, 1, Math.min(1, (s - dk.s0) / 5, (dk.s1 - s) / 5));
  return dk.y0 + lip - 0.02 * (s - dk.s0);
}

// ---------------------------------------------------------------- the course
export const trails = [];
export const course = {
  forks: [], checkpoints: [], arches: [], signs: [], trees: [], rocks: [],
  finishP: 0, finish: null, start: null, meadow: [0, 0], bounds: null,
};

const W = { main: 2.3, green: 2.8, blue: 2.0, black: 1.5 };

function layout() {
  const add = (P, y0, g0) => { const t = finalize(P, y0, g0); t.idx = trails.length; trails.push(t); return t; };
  const endPose = t => ({ x: t.x[t.n - 1], z: t.z[t.n - 1], th: t.th[t.n - 1] });
  const endY = t => t.y[t.n - 1];
  let p = 0;
  const main = (t) => { t.p0 = p; p += t.len; t.p1 = p; return t; };
  // Build a set of branches from the end of `from`. The first one is the
  // reference line; the others are steered back onto its end pose.
  const fork = (from, defs) => {
    const a = endPose(from), y0 = endY(from), out = [];
    let ref = null;
    for (const d of defs) {
      const P = new Path(d.name, d.diff, a, W[d.diff]);
      d.build(P);
      if (ref) P.to(endPose(ref), d.k || 1.1);
      const t = add(P, y0, from.g1);
      if (!ref) ref = t;
      out.push(t);
    }
    const yM = Math.min(...out.map(endY));
    for (const t of out) {
      const dy = endY(t) - yM;
      for (let i = 0; i < t.n; i++) t.y[i] -= dy * sm(0.25 * t.len, t.len, t.s[i]);
      t.p0 = p; t.p1 = p + ref.len;
      t.cps.push(t.len * 0.5);
      from.next.push(t.idx);
    }
    p += ref.len;
    course.forks.push({ from: from.idx, branches: out.map(t => t.idx) });
    return out;
  };
  const cont = (branches, name, build) => {
    const P = new Path(name, 'main', endPose(branches[0]), W.main);
    build(P);
    const t = main(add(P, endY(branches[0]), branches[0].g1));
    for (const b of branches) b.next.push(t.idx);
    return t;
  };

  // 1. Summit Run: flowing S-curves, a first small jump, two switchbacks.
  let P = new Path('Summit Run', 'main', { x: 0, z: 16, th: 0 }, W.main);
  P.grade(0).mark('start', { len: 16, hw: 4.6 }).go(16).grade(GMIN)
    .go(30).arc(30, 45).arc(-60, 40).arc(60, 40).arc(-30, 45)
    .go(14).kicker(0.9, 5).go(26)
    .arc(70, 26).go(40).arc(-140, 13).go(55).arc(140, 13).go(30).arc(-70, 28)
    .go(16).roller().roller().roller().go(10).cp().go(30);
  const m1 = main(add(P, baseNG(0, 16), 0));

  const f1 = fork(m1, [
    { name: 'Meadow Way', diff: 'green', build: P => P
      .arc(-45, 40).go(60).arc(90, 45).go(8).table(0.7, 5, 4, 6).go(8)
      .arc(-90, 45).go(18).roller(0.5).roller(0.5).go(11).arc(45, 40).go(25) },
    { name: 'Timber Line', diff: 'blue', build: P => P
      .arc(50, 30).go(10).kicker(1.2, 6).go(24).arc(25, 30).go(45)
      .arc(-150, 12.5).go(50).arc(75, 22)
      .go(12).table(1.1, 5, 5, 6).go(16).skinny(24, 1.1, 0.9).go(10) },
  ]);

  // 2. Pine Flow: roots, a rock garden, tighter berms.
  const m2 = cont(f1, 'Pine Flow', P => P
    .go(25).arc(-50, 30).go(10).rough(30, 'roots').go(5).arc(110, 20)
    .go(15).table(1.0, 5, 5, 6).go(19).arc(-125, 15)
    .go(12).rough(34, 'rock').go(10).arc(135, 14).go(30).arc(-70, 28)
    .go(14).kicker(1.3, 6).go(30).cp().go(30));

  const f2 = fork(m2, [
    { name: 'Sawmill', diff: 'blue', build: P => P
      .go(30).kicker(1.4, 6).go(52).arc(60, 22).go(30).arc(-120, 14)
      .go(20).ramp(1.5, 7, 1.7).go(33).arc(120, 14).go(30).arc(-60, 22)
      .go(12).table(1.3, 6, 5, 7).go(22).arc(-40, 30).arc(80, 30).arc(-40, 30)
      .skinny(20, 1.2, 0.9).go(31) },
    { name: 'Fern Loop', diff: 'green', build: P => P
      .arc(-60, 35).go(85).arc(120, 24).go(12).roller(0.5).roller(0.5).go(12)
      .arc(-120, 24).go(50).arc(110, 26).go(10) },
    { name: 'Widowmaker', diff: 'black', build: P => P
      .arc(55, 24).go(192).arc(-55, 20)
      .go(14).ramp(2.4, 8, 1.8).go(72).drop(12, 1.7).go(50)
      .arc(-60, 18).go(98).arc(60, 18).kicker(1.7, 6).go(4) },
  ]);

  // 3. Valley View: open meadow, big sweepers, a three-jump rhythm line.
  const m3 = cont(f2, 'Valley View', P => P
    .go(20).arc(-70, 40).go(25).arc(140, 30).go(30).arc(-70, 40)
    .go(14).table(1.2, 5, 5, 7).go(16).table(1.3, 5, 5, 7).go(16).table(1.4, 5, 5, 7).go(20)
    .cp().go(25));

  const f3 = fork(m3, [
    { name: 'Creekside', diff: 'blue', build: P => P
      .arc(-60, 26).go(20).kicker(1.3, 6).go(112).arc(120, 14).go(70).arc(-60, 24)
      .go(10).ramp(1.6, 7, 1.7).go(35).arc(40, 30).arc(-40, 30).go(20) },
    { name: 'Cliffhanger', diff: 'black', build: P => P
      .arc(50, 24).go(22).arc(-50, 22)
      .go(10).ramp(2.6, 8, 1.8).go(64).skinny(26, 1.6, 0.75).go(14).drop(12, 1.7).go(30)
      .arc(-55, 20).go(14).kicker(1.8, 6).go(30) },
  ]);

  // 4. Final Sprint.
  const m4 = cont(f3, 'Final Sprint', P => P
    .w(2.8).go(30).arc(-25, 60).arc(50, 60).arc(-25, 60)
    .go(20).kicker(1.6, 7).go(60).mark('finish').grade(0.01).go(75));
  course.finishP = m4.p0 + m4.finish;
  course.finish = { t: m4.idx, s: m4.finish };
  course.start = { t: 0, s: 9 };
  course.meadow = [m3.z[0] + 10, m3.z[m3.n - 1] - 20];

  for (const t of trails) for (const d of t.decks) if (d.type === 'flat') d.y0 = yAt(t, d.s0);
}

// ---------------------------------------------------------------- queries
const CELL = 8, RINF = 18, KW = 4096;
const grid = new Map();
const key = (cx, cz) => (cx + 2048) * KW + (cz + 2048);
const CC = 24, cgrid = new Map();

function buildGrids() {
  for (const t of trails) {
    for (let i = 0; i < t.n - 1; i++) {
      const x0 = Math.floor((Math.min(t.x[i], t.x[i + 1]) - RINF) / CELL), x1 = Math.floor((Math.max(t.x[i], t.x[i + 1]) + RINF) / CELL);
      const z0 = Math.floor((Math.min(t.z[i], t.z[i + 1]) - RINF) / CELL), z1 = Math.floor((Math.max(t.z[i], t.z[i + 1]) + RINF) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(t.idx << 16 | i);
      }
      if (i % 2 === 0) {
        const k = key(Math.floor(t.x[i] / CC), Math.floor(t.z[i] / CC));
        let a = cgrid.get(k); if (!a) cgrid.set(k, a = []); a.push(t.idx << 16 | i);
      }
    }
  }
}

export function yAt(t, s) { return poseAt(t, s, _po).y; }
const _po = {};
// Trail centre line at distance s.
export function poseAt(t, s, o) {
  s = clamp(s, 0, t.len);
  let lo = 0, hi = t.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.s[m] <= s) lo = m; else hi = m; }
  const u = (s - t.s[lo]) / Math.max(1e-6, t.s[hi] - t.s[lo]);
  o.x = t.x[lo] + (t.x[hi] - t.x[lo]) * u; o.z = t.z[lo] + (t.z[hi] - t.z[lo]) * u;
  o.y = t.y[lo] + (t.y[hi] - t.y[lo]) * u; o.th = t.th[lo] + (t.th[hi] - t.th[lo]) * u;
  o.hw = t.hw[lo] + (t.hw[hi] - t.hw[lo]) * u; o.i = lo; o.kap = t.kap[lo];
  return o;
}

const NP = 24, pid = new Int32Array(NP), pd2 = new Float64Array(NP), pe = new Int32Array(NP), pu = new Float64Array(NP);

export const newSurf = () => ({ y: 0, ground: 0, surf: 0, w: 0, trail: -1, i: 0, s: 0, lat: 0, hw: 0, th: 0, kap: 0, rough: 0, gully: 0, dist: 1e9, cov: 1e9, deck: null });

// Everything about the ground at (x, z). yRef is the height of whoever asks:
// wooden decks only count when you are above them, so you can pass underneath.
// surf: 0 grass, 1 dirt, 2 wood, 3 rocks/roots.
export function surfaceAt(x, z, yRef, o) {
  const bng = baseNG(x, z), gd = gullyDepth(x, z);
  let wmax = 0, sw = 0, sh = 0, best = 1e9, cov = 1e9, dY = -1e9, np = 0, gw = 1;
  o.trail = -1; o.deck = null; o.rough = 0; o.kap = 0;
  const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (cell) {
    for (let c = 0; c < cell.length; c++) {
      const e = cell[c], t = trails[e >>> 16], i = e & 65535;
      const ax = t.x[i], az = t.z[i], bx = t.x[i + 1] - ax, bz = t.z[i + 1] - az;
      const ur = ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), u = ur < 0 ? 0 : ur > 1 ? 1 : ur;
      const px = ax + bx * u - x, pz = az + bz * u - z, d2 = px * px + pz * pz;
      if (d2 > RINF * RINF) continue;
      if (!((i === 0 && ur < 0) || (i === t.n - 2 && ur > 1))) {
        const c2 = Math.sqrt(d2) - t.hw[i]; if (c2 < cov) cov = c2;
      }
      const id = (e >>> 16) * 64 + (i >> 5);
      let k = 0; while (k < np && pid[k] !== id) k++;
      if (k === np) { if (np === NP) continue; np++; pid[k] = id; pd2[k] = 1e9; }
      if (d2 < pd2[k]) { pd2[k] = d2; pe[k] = e; pu[k] = ur; }
    }
    for (let k = 0; k < np; k++) {
      // ue may run past the segment ends: heights are extrapolated there so that
      // neighbouring pieces of one trail agree where they overlap.
      const e = pe[k], t = trails[e >>> 16], i = e & 65535, d = Math.sqrt(pd2[k]);
      const bx = t.x[i + 1] - t.x[i], bz = t.z[i + 1] - t.z[i], L = Math.hypot(bx, bz);
      const ue = clamp(pu[k], -RINF / L, 1 + RINF / L), u = clamp(ue, 0, 1);
      const lat = ((x - t.x[i]) * -bz + (z - t.z[i]) * bx) / L, al = Math.abs(lat);
      const hw = t.hw[i] + (t.hw[i + 1] - t.hw[i]) * u, s = t.s[i] + (t.s[i + 1] - t.s[i]) * ue;
      const ty0 = t.y[i] + (t.y[i + 1] - t.y[i]) * ue;
      let ty = ty0 + (t.bk[i] + (t.bk[i + 1] - t.bk[i]) * u) * clamp(lat, -hw - 1.5, hw + 1.5);
      const fi = t.fi[i] >= 0 ? t.fi[i] : t.fi[i + 1];
      if (fi >= 0) ty += dirtOff(t.feats[fi], s) * (1 - sm(hw - 0.2, hw + 1.3, d));
      const w = 1 - sm(hw, hw + 4 + 0.7 * Math.min(10, Math.abs(ty - bng)), d);
      if (w > 0) { const q = w * w / ((0.3 + d * d) * (0.3 + d * d)); sw += q; sh += q * ty; if (w > wmax) wmax = w; }
      if (d - hw < best) {
        best = d - hw; o.trail = e >>> 16; o.i = i; o.s = s; o.lat = lat; o.hw = hw; o.th = t.th[i]; o.kap = t.kap[i]; o.rough = t.rg[i];
        gw = t.gw[i] + (t.gw[i + 1] - t.gw[i]) * u;
      }
      // Decks are only taken from the piece the point really lies on.
      for (let q = 0; q < 2 && Math.abs(ue - u) * L < 1; q++) {
        const di = t.di[i + q]; if (di < 0 || (q && di === t.di[i])) continue;
        const dk = t.decks[di];
        if (s < dk.s0 || s > dk.s1 || al > dk.hw + (dk.rails ? 0.8 : 0)) continue;
        const dy = deckY(dk, s, ty0);
        if (yRef >= dy - 0.8 && dy > dY) { dY = dy; o.deck = dk; o.dlat = lat; o.dth = t.th[i]; o.dtrail = e >>> 16; o.ds = s; }
      }
    }
  }
  const nat = bng - gd + bump(x, z) * (1 - wmax);
  let h = nat;
  if (wmax > 0) h += (sh / sw - h) * wmax;
  // Under a bridge the trail's fill is taken away again and the ravine opens up.
  if (gw < 1) { h = Math.min(h, nat) * (1 - gw) + h * gw; wmax *= gw; }
  o.w = wmax; o.ground = h; o.gully = gd; o.dist = best; o.cov = cov;
  if (o.deck && dY > h) { o.y = dY; o.surf = 2; }
  else { o.deck = null; o.y = h; o.surf = wmax > 0.6 ? (o.rough ? 3 : 1) : 0; }
  return o;
}

// Nearest trail point to (x, z), however far away.
export function locate(x, z, o) {
  let bd = 1e18, be = -1;
  const cx = Math.floor(x / CC), cz = Math.floor(z / CC);
  for (let r = 1; r <= 6 && be < 0; r += 2) {
    for (let a = cx - r; a <= cx + r; a++) for (let b = cz - r; b <= cz + r; b++) {
      const cell = cgrid.get(key(a, b)); if (!cell) continue;
      for (const e of cell) {
        const t = trails[e >>> 16], i = e & 65535, d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
        if (d < bd) { bd = d; be = e; }
      }
    }
  }
  if (be < 0) {
    for (const t of trails) for (let i = 0; i < t.n; i += 4) {
      const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2; if (d < bd) { bd = d; be = t.idx << 16 | i; }
    }
  }
  const t = trails[be >>> 16], i = be & 65535;
  o.trail = t.idx; o.i = i; o.s = t.s[i]; o.dist = Math.sqrt(bd); o.th = t.th[i];
  o.lat = (x - t.x[i]) * Math.cos(t.th[i]) + (z - t.z[i]) * Math.sin(t.th[i]);
  return o;
}

export const progressOf = (ti, s) => { const t = trails[ti]; return t.p0 + (t.p1 - t.p0) * clamp(s / t.len, 0, 1); };

// ---------------------------------------------------------------- obstacles
const OC = 6, ogrid = new Map();
function addObstacle(o) {
  const k = key(Math.floor(o.x / OC), Math.floor(o.z / OC));
  let a = ogrid.get(k); if (!a) ogrid.set(k, a = []); a.push(o);
}
// Tree trunk or boulder touching a rider at (x, y, z), or null.
export function hitObstacle(x, y, z) {
  const cx = Math.floor(x / OC), cz = Math.floor(z / OC);
  for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) {
    const cell = ogrid.get(key(a, b)); if (!cell) continue;
    for (const o of cell) {
      const dx = x - o.x, dz = z - o.z, r = o.r + 0.3;
      if (dx * dx + dz * dz < r * r && y < o.top) return o;
    }
  }
  return null;
}
export function obstaclesNear(x, z, r, out) {
  out.length = 0;
  const x0 = Math.floor((x - r) / OC), x1 = Math.floor((x + r) / OC), z0 = Math.floor((z - r) / OC), z1 = Math.floor((z + r) / OC);
  for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const c = ogrid.get(key(a, b)); if (c) for (const o of c) out.push(o); }
  return out;
}

export const forestAt = (x, z) => 0.25 + 0.75 * sm(0.32, 0.5, fbm(x / 80 + 5, z / 80, 2));
export const rockiness = (x, z, gd) => sm(0.6, 2.6, gd);
export const meadowAt = z => sm(course.meadow[0] + 40, course.meadow[0] - 20, z) * sm(course.meadow[1] - 40, course.meadow[1] + 20, z);

function scatter() {
  const rng = mulberry(20261112), o = newSurf(), L = {};
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const t of trails) for (let i = 0; i < t.n; i += 8) { x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]); z0 = Math.min(z0, t.z[i]); z1 = Math.max(z1, t.z[i]); }
  course.bounds = { x0: x0 - 190, x1: x1 + 190, z0: z0 - 260, z1: z1 + 120 };
  const B = course.bounds, C = 6.5;
  for (let cz = Math.floor(B.z0 / C); cz < B.z1 / C; cz++) for (let cx = Math.floor(B.x0 / C); cx < B.x1 / C; cx++) {
    const x = (cx + rng()) * C, z = (cz + rng()) * C, r1 = rng(), r2 = rng(), r3 = rng();
    surfaceAt(x, z, -1e9, o);
    let d = o.dist;
    if (o.trail < 0) d = locate(x, z, L).dist - 4;
    if (d < 2.7 || o.gully > 1.2) continue;
    if (course.signs.some(g => (g.x - x) ** 2 + (g.z - z) ** 2 < 64)) continue; // keep the fork signs in view
    const forest = forestAt(x, z);
    // Thick forest right up to the trail, thinner far away where nobody looks.
    let p = d < 28 ? 0.2 + 0.72 * forest : d < 60 ? 0.55 * forest : d < 150 ? 0.22 : 0.1;
    p *= 1 - 0.85 * meadowAt(z);
    if (rockiness(x, z, o.gully) > 0.5) p *= 0.15;
    if (r1 > p) continue;
    const sc = (d < 28 ? 1.05 + r2 * 0.85 : 0.8 + r2 * 0.9) * (d > 60 ? 1.35 : 1);
    const tr = { x, z, y: o.y - 0.15, sc, kind: r3 < 0.6 ? 0 : r3 < 0.9 ? 1 : 2, r: 0.3 * sc, top: o.y + 7 * sc, near: d < 60 };
    course.trees.push(tr);
    if (d < 45) addObstacle(tr);
  }
  // Boulders beside the trail, and inside rock gardens.
  const P = {};
  for (const t of trails) {
    for (let s = 20 + rng() * 10; s < t.len - 10; s += 5) {
      poseAt(t, s, P);
      const garden = t.rg[P.i] === 1;
      if (!garden && rng() > 0.3) continue;
      const side = rng() < 0.5 ? -1 : 1, r = garden ? 0.4 + rng() * 0.45 : 0.5 + rng() * 1.2;
      const lat = side * (garden ? P.hw - 0.7 + rng() * 2.6 : P.hw + 2.4 + r + rng() * 5);
      const x = P.x + Math.cos(P.th) * lat, z = P.z + Math.sin(P.th) * lat;
      surfaceAt(x, z, -1e9, o);
      if (o.gully > 0.5 || (!garden && o.w > 0.1) || t.di[P.i] >= 0 || t.fi[P.i] >= 0) continue;
      const rk = { x, z, y: o.y, r: r * 0.8, rr: r, top: o.y + r * 0.9, rock: true, seed: rng() };
      course.rocks.push(rk); addObstacle(rk);
    }
  }
}

function furnish() {
  const P = {};
  const arch = (t, s, kind, label, diff) => {
    poseAt(t, s, P);
    course.arches.push({ x: P.x, z: P.z, y: P.y, th: P.th, hw: P.hw, kind, label, diff, t: t.idx, s });
  };
  arch(trails[0], 15, 'start', 'START', 'main');
  const cps = [];
  for (const t of trails) for (const s of t.cps) cps.push({ t: t.idx, s, p: progressOf(t.idx, s) });
  cps.sort((a, b) => a.p - b.p);
  for (const c of cps) {
    let cp = course.checkpoints.find(q => Math.abs(q.p - c.p) < 1);
    if (!cp) course.checkpoints.push(cp = { p: c.p, gates: [] });
    cp.gates.push({ t: c.t, s: c.s });
  }
  course.checkpoints.forEach((cp, i) => { cp.n = i + 1; for (const g of cp.gates) arch(trails[g.t], g.s, 'cp', 'CHECKPOINT ' + (i + 1), 'main'); });
  arch(trails[course.finish.t], course.finish.s, 'finish', 'FINISH', 'main');
  const LEVEL = { green: 'EASY', blue: 'INTERMEDIATE', black: 'EXPERT' };
  for (const f of course.forks) {
    const m = trails[f.from];
    f.options = f.branches.map(b => {
      const t = trails[b], j = Math.min(t.n - 1, 22), dth = t.th[j] - t.th[0];
      return { trail: b, diff: t.diff, name: t.name, level: LEVEL[t.diff], dir: dth < -0.15 ? -1 : dth > 0.15 ? 1 : 0 };
    }).sort((a, b) => a.dir - b.dir);
    f.p = m.p1;
    poseAt(m, m.len - 46, P);
    const lat = P.hw + 2.6;
    course.signs.push({ x: P.x + Math.cos(P.th) * lat, z: P.z + Math.sin(P.th) * lat, th: P.th, options: f.options });
    for (const b of f.branches) arch(trails[b], 17, 'route', LEVEL[trails[b].diff], trails[b].diff);
  }
}

let ready = false;
export function initCourse() {
  if (ready) return course;
  ready = true;
  layout(); buildGrids(); furnish(); scatter();
  const o = newSurf();
  for (const a of course.arches) a.y = surfaceAt(a.x, a.z, 1e9, o).y;
  for (const s of course.signs) s.y = surfaceAt(s.x, s.z, -1e9, o).y;
  return course;
}
