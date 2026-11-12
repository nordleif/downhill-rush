// The rider and the bike at real proportions, posed every frame.
// Limbs are solved from joint positions, so each trick is just a set of
// targets for hands, feet, hips and chest.
import * as THREE from 'three';
import { clamp, sm } from './noise.js';
import { pbr } from './pbr.js';
import { BIKES } from './bikes.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export const OUTFITS = [
  { jersey: 0xff7a1a, helmet: 0xffffff, frame: 0x12b5c9, pack: 0x3b4252, name: '#ff8a2a' },
  { jersey: 0x19b8a6, helmet: 0xffd23c, frame: 0xff4f7b, pack: 0x30405a, name: '#2fd6c2' },
  { jersey: 0xf2d02c, helmet: 0xff5aa0, frame: 0x7a4cff, pack: 0x2f9e8f, name: '#ffe24a' },
  { jersey: 0xe0403a, helmet: 0x2a2f3a, frame: 0xff9a1a, pack: 0x4a4f5c, name: '#ff6259' },
  { jersey: 0x7a5cff, helmet: 0x7af0ff, frame: 0x3ddc6a, pack: 0x39304f, name: '#9a84ff' },
  { jersey: 0x3ddc6a, helmet: 0xff8a2a, frame: 0x2f7be0, pack: 0x2f4f3a, name: '#5ee886' },
  { jersey: 0xff5aa0, helmet: 0x8cff6a, frame: 0xffd23c, pack: 0x5a2f4a, name: '#ff7ab8' },
  { jersey: 0x2f7be0, helmet: 0xff4f4f, frame: 0xf2f2f2, pack: 0x1f3358, name: '#5a9cff' },
];

const mat = (c, o = {}) => pbr({ color: c, ...o });
const ball = (r, m, sx = 1, sy = 1, sz = 1) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m); b.scale.set(sx, sy, sz); b.castShadow = true; return b; };

function tube(a, b, r, m) {
  const d = b.clone().sub(a), g = new THREE.CapsuleGeometry(r, d.length(), 4, 10);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  return mesh;
}

// Knobbly tyre, dark rim and thin spokes.
function wheel(mTire, mRim, ty) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.371 - ty, ty, 10, 36), mTire); tire.rotation.y = Math.PI / 2; g.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.298, 0.013, 6, 36), mRim); rim.rotation.y = Math.PI / 2; g.add(rim);
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.59, 4), mRim); s.rotation.x = i * Math.PI / 8; g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), mRim); hub.rotation.z = Math.PI / 2; g.add(hub);
  return g;
}

// A limb segment that is stretched between two joints each frame.
class Bone {
  constructor(parent, r, m, r2 = r) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, 1, 14, 1, true), m); this.mesh.castShadow = true; parent.add(this.mesh);
  }
  set(a, b) {
    _d.subVectors(b, a); const l = _d.length() || 1e-3;
    this.mesh.position.copy(a).addScaledVector(_d, 0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(l));
    this.mesh.scale.set(1, l, 1);
  }
}
const _d = V(), _m = V(), _p = V(), _q = V();

// Middle joint of a two-bone limb from a to b, bending towards hint.
function elbow(a, b, l1, l2, hint, out) {
  _d.subVectors(b, a); let d = _d.length();
  const max = (l1 + l2) * 0.999; if (d > max) d = max;
  _d.normalize();
  const a1 = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
  _p.copy(hint).addScaledVector(_d, -hint.dot(_d)).normalize();
  return out.copy(a).addScaledVector(_d, a1).addScaledVector(_p, h);
}

export class BikeModel {
  constructor(outfit, bike = 0) {
    const o = OUTFITS[outfit % OUTFITS.length], K = BIKES[bike % BIKES.length].look, ft = K.fat;
    this.root = new THREE.Group();           // position + heading
    this.pitchG = new THREE.Group(); this.pitchG.position.y = 0.9; this.root.add(this.pitchG);
    this.body = new THREE.Group(); this.body.position.y = -0.9; this.pitchG.add(this.body); // lean about the tyres
    this.bike = new THREE.Group(); this.body.add(this.bike);
    const mFrame = mat(K.frame, { roughness: K.rough, metalness: K.metal }), mDark = mat(0x17181b, { roughness: 0.6 }), mTire = mat(0x101012, { roughness: 1 }), mRim = mat(K.rim, { roughness: 0.4, metalness: 0.6 }), mFork = mat(K.fork, { roughness: 0.3, metalness: 0.7 });
    const B = this.bike, add = m => { m.castShadow = true; B.add(m); return m; };
    const bb = V(0, 0.34, 0.1), seatTop = V(0, 0.9, 0.3), headT = V(0, 0.98, -0.4), headB = V(0, 0.82, -0.45), rearAx = V(0, 0.36, 0.6);
    add(tube(bb, seatTop, 0.024 * ft, mFrame)); add(tube(bb, headB, 0.036 * ft, mFrame)); add(tube(V(0, 0.8, 0.26), headT, 0.028 * ft, mFrame));
    add(tube(headB, headT, 0.034 * ft, mFrame));
    for (const sx of [-1, 1]) { add(tube(bb, V(sx * 0.08, 0.36, 0.6), 0.016 * ft, mFrame)); add(tube(V(0, 0.74, 0.27), V(sx * 0.08, 0.36, 0.6), 0.013 * ft, mFrame)); }
    add(tube(V(0, 0.56, 0.18), V(0, 0.72, 0.02), 0.022, mat(0xd9a520, { roughness: 0.4, metalness: 0.5 }))); // shock
    const seat = add(ball(1, mDark, 0.07, 0.03, 0.14)); seat.position.set(0, 0.94, 0.33);
    this.rear = wheel(mTire, mRim, K.tyre); this.rear.position.copy(rearAx); B.add(this.rear);
    // Steering assembly: fork, front wheel and bars turn around the head tube.
    this.steerG = new THREE.Group(); this.steerG.position.copy(headT); B.add(this.steerG);
    this.steerAxis = headT.clone().sub(headB).normalize();
    const S = this.steerG, sadd = m => { m.castShadow = true; S.add(m); return m; };
    const fa = V(0, 0.36, -0.6).sub(headT);
    for (const sx of [-1, 1]) sadd(tube(V(sx * 0.085, -0.14, -0.04), V(sx * 0.085, fa.y, fa.z), 0.021 * K.forkFat, mFork));
    // Downhill forks run all the way up to a second crown under the bars.
    if (K.dual) { for (const sx of [-1, 1]) sadd(tube(V(sx * 0.085, -0.14, -0.04), V(sx * 0.085, 0.05, -0.012), 0.019, mFork)); sadd(tube(V(-0.1, 0.05, -0.012), V(0.1, 0.05, -0.012), 0.022, mFork)); }
    sadd(tube(V(-0.1, -0.14, -0.04), V(0.1, -0.14, -0.04), 0.024, mFork));
    sadd(tube(V(0, 0, 0), V(0, 0.08, -0.02), 0.022, mDark));
    sadd(tube(V(-0.39, 0.1, 0), V(0.39, 0.1, 0), 0.014, mDark));
    for (const sx of [-1, 1]) sadd(tube(V(sx * 0.29, 0.1, 0), V(sx * 0.41, 0.1, 0), 0.019, mDark));
    this.front = wheel(mTire, mRim, K.tyre); this.front.position.copy(fa); S.add(this.front);
    this.gripL = V(-0.35, 0.1, 0); this.gripR = V(0.35, 0.1, 0);
    // Cranks and pedals.
    this.crankG = new THREE.Group(); this.crankG.position.copy(bb); B.add(this.crankG);
    for (const sx of [-1, 1]) {
      const c = tube(V(sx * 0.07, 0, 0), V(sx * 0.07, 0, -sx * 0.17), 0.014, mFork); this.crankG.add(c);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.09), mDark); p.position.set(sx * 0.14, 0, -sx * 0.17); this.crankG.add(p);
    }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.02, 16), mDark); ring.rotation.z = Math.PI / 2; ring.position.x = 0.05; this.crankG.add(ring);
    this.pedL = V(-0.14, 0, 0.17); this.pedR = V(0.14, 0, -0.17);

    // Rider in a full-face helmet, goggles, gloves, knee pads and a pack.
    const R = this.rider = new THREE.Group(); this.body.add(R);
    const mJ = mat(o.jersey, { roughness: 0.95 }), mShort = mat(0x1d1f24, { roughness: 0.95 }), mSkin = mat(0xc4906c, { roughness: 0.7 }), mGlove = mat(0x18191c), mShoe = mat(0x1b1c1f), mPad = mat(0x141518), mHel = mat(o.helmet, { roughness: 0.25 });
    this.torso = new Bone(R, 0.135, mJ, 0.165);
    this.chestM = ball(0.17, mJ, 1.2, 0.85, 0.85); R.add(this.chestM);
    this.hipM = ball(0.145, mShort, 1.15, 0.9, 1); R.add(this.hipM);
    this.headG = new THREE.Group(); this.headG.scale.setScalar(0.6); R.add(this.headG);
    const face = ball(0.215, mSkin); face.position.set(0, -0.045, -0.035); this.headG.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.275, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(o.helmet, { side: THREE.DoubleSide, roughness: 0.25 }));
    helmet.scale.set(1, 1, 1.1); helmet.rotation.x = 0.12; helmet.castShadow = true; this.headG.add(helmet);
    const peak = ball(0.17, mHel, 1.1, 0.16, 1); peak.position.set(0, 0.035, -0.3); peak.rotation.x = 0.2; this.headG.add(peak);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.262, 0.035, 8, 20, Math.PI), mJ); stripe.rotation.set(0.12, Math.PI / 2, 0); stripe.scale.set(1.1, 1, 1); this.headG.add(stripe);
    const gog = ball(1, mPad, 0.2, 0.075, 0.07); gog.position.set(0, -0.03, -0.215); this.headG.add(gog);
    for (const sx of [-1, 1]) { const lens = ball(1, mat(0x30383c, { roughness: 0.1, metalness: 0.8 }), 0.075, 0.05, 0.03); lens.position.set(sx * 0.085, -0.03, -0.265); this.headG.add(lens); }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.028, 8, 22), mPad); strap.rotation.x = Math.PI / 2; strap.position.y = -0.03; this.headG.add(strap);
    const chin = ball(0.16, mHel, 1.05, 0.55, 1.05); chin.position.set(0, -0.15, -0.13); this.headG.add(chin);
    const neck = ball(0.1, mSkin, 1, 1.4, 1); neck.position.set(0, -0.26, 0.05); this.headG.add(neck);
    this.pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.16, 6, 14), mat(o.pack, { roughness: 0.95 })); this.pack.scale.set(1.2, 1, 0.6); this.pack.castShadow = true; R.add(this.pack);
    this.arms = [0, 1].map(() => ({ up: new Bone(R, 0.048, mJ, 0.058), lo: new Bone(R, 0.036, mJ, 0.046), hand: ball(0.055, mGlove), pad: ball(0.05, mJ), sh: ball(0.07, mJ) }));
    this.legs = [0, 1].map(() => ({
      up: new Bone(R, 0.07, mShort, 0.088), lo: new Bone(R, 0.045, mSkin, 0.06), pad: ball(0.072, mPad),
      foot: new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.17, 5, 12).rotateX(Math.PI / 2).scale(1.05, 0.85, 1), mShoe),
    }));
    for (const a of this.arms) R.add(a.hand, a.pad, a.sh);
    for (const l of this.legs) { l.foot.castShadow = true; R.add(l.foot, l.pad); }
    // Soft shadow blob on the ground below, also shows where you will land.
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false }));
    this.t = { hip: V(), chest: V(), head: V(), hL: V(), hR: V(), fL: V(), fR: V(), kL: V(), kR: V(), eL: V(), eR: V(), sL: V(), sR: V(), lL: V(), lR: V() };
    this.pose = { whip: 0, table: 0, bar: 0, noh: 0, sup: 0, crash: 0 };
    this.time = Math.random() * 10;
  }

  // st: x,y,z, yaw (with spin), pitch (with flip), lean, steer, trick, trickT,
  // crank, wheel, susp, crashed, tum, tumAx, speed, air, pedaling, groundY
  update(st, dt) {
    this.time += dt;
    const P = this.pose, T = this.t;
    const e = st.trick ? sm(0, 0.28, st.trickT) * (1 - sm(0.72, 1, st.trickT)) : 0;
    const k = Math.min(1, dt * 18);
    P.whip += ((st.trick === 1 ? e : 0) - P.whip) * k; P.table += ((st.trick === 2 ? e : 0) - P.table) * k;
    P.noh += ((st.trick === 4 ? e : 0) - P.noh) * k; P.sup += ((st.trick === 5 ? e : 0) - P.sup) * k;
    P.bar = st.trick === 3 ? st.trickT : 0;
    P.crash += ((st.crashed ? 1 : 0) - P.crash) * Math.min(1, dt * 10);
    this.root.position.set(st.x, st.y - 0.9 * (1 - Math.cos(st.pitch)) * (st.air ? 0 : 1), st.z);
    this.root.rotation.y = -st.yaw;
    if (st.crashed) { this.pitchG.rotation.set(st.tum, 0, st.tum * 0.6 * st.tumAx); this.body.rotation.z = 0; }
    else { this.pitchG.rotation.set(st.pitch, 0, 0); this.body.rotation.z = -st.lean; }
    // Bike relative to rider: whip swings the rear out, tabletop lays it flat.
    const B = this.bike, sgn = 1;
    B.rotation.set(0, 0, 0); B.position.set(0, st.susp * 0.5, 0);
    if (P.whip > 0.001 || P.table > 0.001) {
      const piv = _q.set(0, 0.95, -0.35);
      B.rotation.set(-0.25 * P.table, sgn * (1.15 * P.whip + 0.45 * P.table), sgn * (0.45 * P.whip + 1.25 * P.table), 'YXZ');
      _m.copy(piv).applyEuler(B.rotation); B.position.add(piv).sub(_m);
    }
    const barSpin = P.bar > 0 ? sm(0.08, 0.92, P.bar) * Math.PI * 2 : 0;
    this.steerG.quaternion.setFromAxisAngle(this.steerAxis, -st.steer * 0.42 - barSpin);
    this.rear.rotation.x = -st.wheel; this.front.rotation.x = -st.wheel;
    this.crankG.rotation.x = -st.crank;
    B.updateMatrix(); this.steerG.updateMatrix(); this.crankG.updateMatrix();
    const inB = (v, g, out) => { out.copy(v).applyMatrix4(g.matrix); return g === B ? out : out.applyMatrix4(B.matrix); };
    inB(this.gripL, this.steerG, T.hL); inB(this.gripR, this.steerG, T.hR);
    inB(this.pedL, this.crankG, T.fL); inB(this.pedR, this.crankG, T.fR);
    T.fL.y += 0.07; T.fR.y += 0.07;
    // Neutral attack position, lower when the suspension is loaded.
    const sq = clamp(-st.susp * 2.2, -0.1, 0.4), sit = st.pedaling && !st.air ? 0.06 : 0;
    const bob = st.pedaling && !st.air ? Math.sin(st.crank * 2) * 0.015 : 0;
    T.hip.set(st.lean * -0.06, 1.12 - sq * 0.22 - sit + bob, 0.3);
    T.chest.set(0, 1.5 - sq * 0.24 - sit * 0.5, -0.02);
    T.head.set(0, 1.76 - sq * 0.24, -0.17);
    if (st.air && !st.trick) { T.hip.y += 0.05; T.hip.z += 0.06; }
    // Tricks.
    if (P.whip > 0.001) { T.hip.x += 0.1 * P.whip; T.hip.z -= 0.05 * P.whip; }
    if (P.table > 0.001) { T.hip.y -= 0.12 * P.table; T.hip.x -= 0.14 * P.table; T.chest.y -= 0.1 * P.table; T.head.y -= 0.08 * P.table; }
    if (P.bar > 0) {
      const h = sm(0.02, 0.18, P.bar) * (1 - sm(0.82, 0.98, P.bar));
      T.hL.lerp(_m.set(-0.3, 1.36, -0.12), h); T.hR.lerp(_m.set(0.3, 1.36, -0.12), h);
      T.chest.y += 0.06 * h; T.chest.z += 0.07 * h;
    }
    if (P.noh > 0.001) {
      T.hL.lerp(_m.set(-0.86, 1.95, 0.12), P.noh); T.hR.lerp(_m.set(0.86, 1.95, 0.12), P.noh);
      T.chest.set(0, 1.5 + 0.1 * P.noh, -0.02 + 0.2 * P.noh); T.head.set(0, 1.76 + 0.12 * P.noh, -0.17 + 0.24 * P.noh);
      T.hip.z += 0.05 * P.noh;
    }
    if (P.sup > 0.001) {
      const s = P.sup;
      T.hip.lerp(_m.set(0, 1.42, 0.92), s); T.chest.lerp(_m.set(0, 1.3, 0.36), s); T.head.lerp(_m.set(0, 1.38, 0.02), s);
      T.fL.lerp(_m.set(-0.2, 1.5, 1.9), s); T.fR.lerp(_m.set(0.2, 1.38, 1.9), s);
    }
    if (P.crash > 0.001) {
      const c = P.crash, w = this.time * 9;
      T.hL.lerp(_m.set(-0.8 + 0.2 * Math.sin(w), 1.7 + 0.3 * Math.cos(w * 1.3), -0.1), c); T.hR.lerp(_m.set(0.8, 1.6 + 0.3 * Math.sin(w * 1.1), 0.2 * Math.cos(w)), c);
      T.fL.lerp(_m.set(-0.4, 0.5 + 0.2 * Math.sin(w * 1.2), 0.9), c); T.fR.lerp(_m.set(0.45, 0.6 + 0.2 * Math.cos(w), 0.7), c);
      T.hip.y += 0.25 * c; T.chest.y += 0.3 * c; T.head.y += 0.3 * c;
    }
    // Solve the body from the targets.
    _d.subVectors(T.chest, T.hip).normalize();
    this.torso.set(T.hip, T.chest); this.hipM.position.copy(T.hip); this.chestM.position.copy(T.chest);
    this.headG.position.copy(T.head);
    this.headG.rotation.set(-0.15 - 1.0 * P.sup + 0.3 * P.noh - sq * 0.3, -st.steer * 0.35, 0);
    this.pack.position.copy(T.hip).lerp(T.chest, 0.62);
    this.pack.quaternion.setFromUnitVectors(UP, _d);
    this.pack.translateZ(0.15);
    const side = _m.set(1, 0, 0);
    T.sL.copy(T.chest).addScaledVector(side, -0.19); T.sR.copy(T.chest).addScaledVector(side, 0.19);
    T.lL.copy(T.hip).addScaledVector(side, -0.12); T.lR.copy(T.hip).addScaledVector(side, 0.12);
    const eh = _q.set(0, -0.35 + P.noh, 0.6 - P.noh * 0.4);
    for (let i = 0; i < 2; i++) {
      const sx = i ? 1 : -1, a = this.arms[i], s = i ? T.sR : T.sL, h = i ? T.hR : T.hL, el = i ? T.eR : T.eL;
      eh.x = sx * 0.9; elbow(s, h, 0.34, 0.34, eh, el);
      a.up.set(s, el); a.lo.set(el, h); a.hand.position.copy(h); a.pad.position.copy(el); a.sh.position.copy(s);
      const l = this.legs[i], hp = i ? T.lR : T.lL, f = i ? T.fR : T.fL, kn = i ? T.kR : T.kL;
      elbow(hp, f, 0.48, 0.5, _p.set(sx * 0.25, 0.5 - P.sup, -1 + P.sup * 0.8), kn);
      l.up.set(hp, kn); l.lo.set(kn, f); l.pad.position.copy(kn);
      l.foot.position.copy(f); l.foot.position.y -= 0.03;
      l.foot.rotation.set(P.sup * 1.2, 0, 0);
    }
    if (st.groundY != null) {
      const hgt = Math.max(0, st.y - st.groundY);
      this.blob.position.set(st.x, st.groundY + 0.06, st.z);
      this.blob.material.opacity = 0.2 * clamp(1 - hgt / 14, 0.25, 1);
      this.blob.scale.setScalar(1 + hgt * 0.07);
    }
  }
}
