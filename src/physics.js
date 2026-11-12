// Arcade bike physics. The rider is a point that follows the ground while it
// can and flies on a ballistic arc when the ground falls away, so jumps come
// from speed and ramp shape alone. Nothing here steers the bike for the player.
import { surfaceAt, newSurf, locate, poseAt, trails, hitObstacle } from './course.js';
import { clamp, wrapPi } from './noise.js';
import { NEUTRAL } from './bikes.js';

export const G = 11;
const PI2 = Math.PI * 2;
const HOP = 5.2, SPIN_RATE = 5.6, FLIP_RATE = 6.6;

export const TRICKS = [null,
  { id: 1, name: 'Whip', pts: 300, dur: 0.7 },
  { id: 2, name: 'Tabletop', pts: 350, dur: 0.75 },
  { id: 3, name: 'Barspin', pts: 400, dur: 0.65 },
  { id: 4, name: 'No-Hander', pts: 500, dur: 0.8 },
  { id: 5, name: 'Superman', pts: 800, dur: 1.0 },
];

export function newRider() {
  return {
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, speed: 0,
    ground: true, airT: 0, steer: 0, locked: false,
    spin: 0, spinV: 0, flip: 0, flipV: 0, spinDir: 1, flipDir: 1,
    trick: 0, trickT: 0,
    crashed: false, crashT: 0, tum: 0, tumV: 0, tumAx: 0,
    pitch: 0, lean: 0, susp: 0, suspV: 0, crank: 0, wheel: 0,
    surf: 1, w: 1, trail: 0, s: 0, lat: 0, kap: 0, deck: null, slide: 0, braking: 0, pedaling: 0,
    safeT: 0, safeS: 9, clear: 0, stuck: 0, zone: 0,
    bike: NEUTRAL, // stats of the bike being ridden, see bikes.js
  };
}

const S = newSurf(), S2 = newSurf(), S3 = newSurf(), L = {}, PO = {};
const hAt = (x, z, yRef) => surfaceAt(x, z, yRef, S3).y;

export function placeOn(r, ti, s, lat = 0, speed = 0) {
  const t = trails[ti];
  poseAt(t, clamp(s, 1, t.len - 1), PO);
  r.x = PO.x + Math.cos(PO.th) * lat; r.z = PO.z + Math.sin(PO.th) * lat; r.yaw = PO.th;
  r.y = surfaceAt(r.x, r.z, 1e9, S).y;
  r.vx = Math.sin(PO.th) * speed; r.vz = -Math.cos(PO.th) * speed; r.vy = 0; r.speed = speed;
  r.ground = true; r.airT = 0; r.spin = r.flip = r.spinV = r.flipV = 0; r.trick = 0; r.trickT = 0;
  r.crashed = false; r.crashT = 0; r.steer = 0; r.lean = 0; r.pitch = 0; r.tum = 0; r.susp = 0; r.suspV = 0;
  r.trail = ti; r.s = s; r.safeT = ti; r.safeS = s;
}

function crash(r, ev, why) {
  if (r.crashed) return;
  r.crashed = true; r.crashT = 0; r.ground = false; r.trick = 0; r.trickT = 0;
  r.vx *= 0.55; r.vz *= 0.55; r.vy = Math.max(r.vy * 0.3, 2.5);
  r.tumV = 7 + Math.random() * 4; r.tumAx = Math.random() * 2 - 1;
  ev.push({ t: 'crash', why });
}

// Put the rider back on the trail close to where things went wrong.
export function respawn(r, ev) {
  let ti = r.safeT, s = r.safeS;
  locate(r.x, r.z, L);
  if (L.dist < 30) { ti = L.trail; s = L.s; }
  const t = trails[ti];
  // Never drop someone on a ramp, a lip or the middle of a bridge.
  for (let k = 0; k < 4; k++) {
    for (const f of t.feats) if (s > f.s0 - 14 && s < f.s1 + 2) s = f.s1 + 5;
    for (const d of t.decks) if (!d.start && s > d.s0 - 14 && s < d.s1 + 2) s = d.s1 + 5;
  }
  placeOn(r, ti, Math.min(s, t.len - 2), 0, 6);
  ev.push({ t: 'respawn' });
}

function crashStep(r, dt, ev) {
  r.crashT += dt; r.vy -= G * dt;
  let nx = r.x + r.vx * dt, nz = r.z + r.vz * dt, ny = r.y + r.vy * dt;
  surfaceAt(nx, nz, r.y + 0.3, S2);
  if (S2.y - ny > 0.9) { nx = r.x; nz = r.z; r.vx *= -0.2; r.vz *= -0.2; surfaceAt(nx, nz, r.y + 0.3, S2); }
  if (ny <= S2.y) {
    ny = S2.y; r.vy = r.vy < -3 ? -r.vy * 0.3 : 0;
    const k = Math.exp(-3.5 * dt); r.vx *= k; r.vz *= k; r.tumV *= Math.exp(-2.5 * dt);
  }
  r.x = nx; r.y = ny; r.z = nz; r.tum += r.tumV * dt; r.speed = Math.hypot(r.vx, r.vz);
  if (r.crashT > 1.7) respawn(r, ev);
}

function groundStep(r, inp, dt, ev) {
  const yR = r.y + 0.4, e = 0.45;
  const hx = (hAt(r.x + e, r.z, yR) - hAt(r.x - e, r.z, yR)) / (2 * e);
  const hz = (hAt(r.x, r.z + e, yR) - hAt(r.x, r.z - e, yR)) / (2 * e);
  surfaceAt(r.x, r.z, yR, S);
  let fx = Math.sin(r.yaw), fz = -Math.cos(r.yaw);
  const f0 = r.vx * fx + r.vz * fz;
  const sr0 = clamp(hx * -fz + hz * fx, -1, 1);
  // Steering: turn rate is limited by grip, berms add grip on the inside.
  const off = 1 - S.w, wood = S.surf === 2;
  const bankIn = -sr0 * Math.sign(r.steer);
  const B = r.bike;
  const amax = (wood ? 12 : 12 - 4 * off) * B.grip + G * clamp(bankIn, -0.2, 0.5) * 1.3;
  const wmax = Math.min(2.4, amax / Math.max(f0, 1)) * Math.max(0.3, Math.min(1, f0 / 2));
  r.yaw += r.steer * wmax * dt;
  fx = Math.sin(r.yaw); fz = -Math.cos(r.yaw);
  const rx = -fz, rz = fx;
  let f = r.vx * fx + r.vz * fz, l = r.vx * rx + r.vz * rz;
  const sf = clamp(hx * fx + hz * fz, -1.2, 1.2), sr = clamp(hx * rx + hz * rz, -1, 1);
  let a = -G * sf / Math.sqrt(1 + sf * sf);
  const roll = wood ? 0.2 : 0.25 + 1.9 * off + (S.rough ? 0.45 : 0);
  a -= roll * Math.min(1, f / 0.3) + (0.0068 * B.drag + 0.012 * (wood ? 0 : off)) * f * f;
  r.pedaling = 0;
  if (inp.pedal > 0) { a += (3.4 * B.pedal + 1.6 * clamp(1 - f / 5, 0, 1)) * clamp(1 - (f - 6) / (13 * B.pedal), 0, 1) * inp.pedal; r.pedaling = inp.pedal; }
  r.braking = inp.brake;
  if (inp.brake > 0) a -= 10 * inp.brake;
  f += a * dt; if (f < 0) f = 0;
  l += -G * sr * 0.3 * dt;
  l *= Math.exp(-(inp.brake > 0.5 && Math.abs(r.steer) > 0.4 ? 3 : 9) * dt);
  r.slide = Math.abs(l);
  r.vx = fx * f + rx * l; r.vz = fz * f + rz * l;
  const leanT = clamp(Math.atan(f * r.steer * wmax / G) * 0.95, -0.62, 0.62);
  r.lean += (leanT - r.lean) * Math.min(1, 9 * dt);
  r.pitch += (Math.atan(sf) - r.pitch) * Math.min(1, 14 * dt);

  let nx = r.x + r.vx * dt, nz = r.z + r.vz * dt;
  surfaceAt(nx, nz, yR, S2);
  // Bridge rails keep you on the deck.
  if (S2.deck && S2.deck.rails && Math.abs(S2.dlat) > S2.deck.hw - 0.35) {
    const sg = Math.sign(S2.dlat), ex = Math.abs(S2.dlat) - (S2.deck.hw - 0.35), cx = Math.cos(S2.dth), cz = Math.sin(S2.dth);
    nx -= sg * ex * cx; nz -= sg * ex * cz;
    const vr = r.vx * cx + r.vz * cz;
    if (vr * sg > 0) { r.vx -= vr * cx; r.vz -= vr * cz; r.vx *= 0.985; r.vz *= 0.985; }
    surfaceAt(nx, nz, yR, S2);
  }
  const hd = Math.hypot(nx - r.x, nz - r.z), sp = Math.hypot(r.vx, r.vz);
  if (S2.y - r.y > 0.5 + 1.3 * hd) { // ran into a wall
    if (sp > 6) crash(r, ev, 'wall');
    else { r.vx = r.vz = 0; r.stuck += dt; if (r.stuck > 2.5) { r.stuck = 0; respawn(r, ev); } }
    return;
  }
  r.stuck = 0;
  // Vertical speed comes from the slope over the last half metre, not from one
  // frame, so small steps and ripples in the ground do not kick the bike up.
  let vyG = clamp((S2.y - r.y) / dt, -30, 30);
  // On stairs the reach is two whole treads, which gives the slope of the flight.
  const back = S2.zone === 4 ? 1.6 : 0.5;
  if (sp > 1) vyG = clamp((S2.y - hAt(nx - r.vx / sp * back, nz - r.vz / sp * back, yR)) / back * sp, -30, 30);
  const vyB = r.vy - G * dt, yb = r.y + vyB * dt;
  r.x = nx; r.z = nz;
  if (inp.jump) { r.y = Math.max(S2.y, yb); r.vy = Math.max(vyG, 0) * 0.6 + HOP; takeoff(r, ev, true); }
  else if (yb > S2.y + (S2.zone === 4 ? 0.3 : 0.06)) { r.y = yb; r.vy = vyB; takeoff(r, ev, false); } // wheels stay down on stairs
  else if (yb > S2.y) { r.y = yb; r.vy = vyB; } // wheels unweighted, still in control
  else { r.y = S2.y; r.vy = vyG; }
  // Remember where we are for progress, flow and respawns.
  r.surf = S2.surf; r.w = S2.w; r.kap = S2.kap; r.deck = S2.deck; r.zone = S2.zone;
  if (S2.trail >= 0 && (S2.w > 0.5 || S2.deck)) {
    r.trail = S2.trail; r.s = S2.s; r.lat = S2.lat;
    if (sp > 3) { r.safeT = S2.trail; r.safeS = S2.s; }
  }
  if (S2.rough && S2.w > 0.6) r.suspV += (Math.random() - 0.5) * sp * 1.6;
  else if (off > 0.5) r.suspV += (Math.random() - 0.5) * sp * 0.6;
  if (S2.gully > 5 && !S2.deck && S2.w < 0.3) crash(r, ev, 'ravine');
}

function takeoff(r, ev, hop) {
  r.ground = false; r.airT = 0; r.spin = r.flip = r.spinV = r.flipV = 0;
  ev.push({ t: 'air', hop });
}

function airStep(r, inp, dt, ev) {
  r.airT += dt; r.vy -= G * dt;
  const k = Math.exp(-0.05 * dt); r.vx *= k; r.vz *= k;
  const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt, ny = r.y + r.vy * dt;
  if (r.airT > 0.14) {
    // Spins and flips follow the stick, then level themselves out when you let go.
    const sIn = inp.steer, fIn = inp.pitch;
    if (Math.abs(sIn) > 0.2) { r.spinV += (sIn * SPIN_RATE * r.bike.air - r.spinV) * Math.min(1, 10 * dt); r.spinDir = Math.sign(sIn); }
    else r.spinV = assist(r.spin, r.spinDir, 5.5);
    if (Math.abs(fIn) > 0.2) { r.flipV += (fIn * FLIP_RATE * r.bike.air - r.flipV) * Math.min(1, 10 * dt); r.flipDir = Math.sign(fIn); }
    else r.flipV = assist(r.flip, r.flipDir, 6);
    r.spin += r.spinV * dt; r.flip += r.flipV * dt;
  } else {
    // Just left the ground: a short moment where steering still works.
    r.yaw += r.steer * 0.6 * dt;
  }
  r.lean *= Math.exp(-4 * dt);
  const vh = Math.hypot(r.vx, r.vz);
  r.pitch += (clamp(Math.atan2(r.vy, Math.max(vh, 3)) * 0.55, -0.6, 0.6) - r.pitch) * Math.min(1, 3 * dt);
  surfaceAt(nx, nz, r.y, S2);
  r.clear = ny - S2.y;
  if (ny > S2.y) { r.x = nx; r.y = ny; r.z = nz; return; }
  if (S2.y - ny > 1.0) { r.x = nx; r.z = nz; r.y = ny; crash(r, ev, 'wall'); return; }
  land(r, nx, nz, ev);
}

// Angular velocity that rotates an angle to the nearest full turn.
function assist(a, dir, rate) {
  const n = a / PI2, fl = Math.floor(n), fr = n - fl;
  const target = (fr < 0.3 ? fl : fr > 0.7 ? fl + 1 : dir > 0 ? fl + 1 : fl) * PI2;
  return clamp((target - a) * 8, -rate, rate);
}

function land(r, nx, nz, ev) {
  const vh = Math.hypot(r.vx, r.vz);
  let dx = Math.sin(r.yaw), dz = -Math.cos(r.yaw);
  if (vh > 0.5) { dx = r.vx / vh; dz = r.vz / vh; }
  const yR = S2.y + 0.4, e = 0.5;
  const m = clamp((hAt(nx + dx * e, nz + dz * e, yR) - hAt(nx - dx * e, nz - dz * e, yR)) / (2 * e), -1.5, 1.5);
  const impact = -(r.vy - m * vh) / Math.sqrt(1 + m * m);
  let vh2 = Math.max((vh + r.vy * m) / (1 + m * m), vh * 0.5);
  const sp = r.spin / PI2, fl = r.flip / PI2;
  const spinErr = Math.abs(sp - Math.round(sp)) * 360, flipErr = Math.abs(fl - Math.round(fl)) * 360;
  const big = r.airT > 0.3, tough = r.bike.tough;
  r.x = nx; r.z = nz; r.y = S2.y;
  if (S2.gully > 5 && !S2.deck && S2.w < 0.3) { crash(r, ev, 'ravine'); return; }
  if (big) {
    const busy = r.trick && r.trickT > 0.1 && r.trickT < 0.88;
    if (flipErr > 55 || spinErr > 60 || busy || impact > 18 * tough) {
      crash(r, ev, busy ? 'trick' : impact > 18 * tough ? 'impact' : 'rotation'); return;
    }
    if (r.trick) { ev.push({ t: 'trick', id: r.trick }); r.trick = 0; r.trickT = 0; }
    const q = flipErr > 35 || spinErr > 38 || impact > 13.5 * tough ? 0 : (flipErr < 14 && spinErr < 16 && impact < 8 * tough) ? 2 : 1;
    if (impact > 12 * tough) vh2 *= 0.88;
    ev.push({ t: 'land', q, impact, airT: r.airT, spins: Math.round(sp), flips: Math.round(fl) });
    r.yaw = Math.atan2(dx, -dz) + (sp - Math.round(sp)) * PI2 * 0.5;
  } else {
    r.yaw += r.spin; r.trick = 0; r.trickT = 0;
    if (impact > 3) ev.push({ t: 'thud', impact });
  }
  r.vx = dx * vh2; r.vz = dz * vh2; r.vy = m * vh2;
  r.ground = true; r.spin = r.flip = r.spinV = r.flipV = 0;
  r.suspV -= Math.min(impact, 16) * 0.75;
  r.surf = S2.surf; r.deck = S2.deck;
}

// inp: steer -1..1, pedal 0..1, brake 0..1, pitch -1..1 (+ = pull back),
// jump (one-shot), trick (one-shot id). Events are appended to ev.
export function stepRider(r, inp, dt, ev) {
  if (r.crashed) { crashStep(r, dt, ev); return; }
  const st = clamp(inp.steer, -1, 1);
  const back = Math.abs(st) < Math.abs(r.steer) || st * r.steer < 0;
  r.steer += clamp(st - r.steer, -(back ? 7 : 3.6) * dt, (back ? 7 : 3.6) * dt);
  if (r.locked) {
    r.vx = r.vz = r.vy = 0; r.speed = 0; r.y = surfaceAt(r.x, r.z, r.y + 1, S).y; r.ground = true;
    r.lean *= 0.9; return;
  }
  if (r.ground) groundStep(r, inp, dt, ev); else airStep(r, inp, dt, ev);
  if (r.crashed) return;
  const ob = hitObstacle(r.x, r.y, r.z);
  if (ob) {
    const dx = r.x - ob.x, dz = r.z - ob.z, d = Math.hypot(dx, dz) || 1, sp = Math.hypot(r.vx, r.vz);
    r.x = ob.x + dx / d * (ob.r + 0.32); r.z = ob.z + dz / d * (ob.r + 0.32);
    if (sp > 5.5 * r.bike.tough) { crash(r, ev, ob.rock ? 'rock' : 'tree'); r.vx = dx / d * 2; r.vz = dz / d * 2; return; }
    r.vx *= 0.4; r.vz *= 0.4;
  }
  if (!r.ground && inp.trick && !r.trick && r.airT > 0.08) { r.trick = inp.trick; r.trickT = 0; ev.push({ t: 'trickStart', id: inp.trick }); }
  if (r.trick) {
    r.trickT += dt / TRICKS[r.trick].dur;
    if (r.trickT >= 1) { ev.push({ t: 'trick', id: r.trick }); r.trick = 0; r.trickT = 0; }
  }
  r.suspV += (-150 * r.susp - 15 * r.suspV) * dt; r.susp = clamp(r.susp + r.suspV * dt, -0.22, 0.12);
  r.speed = Math.hypot(r.vx, r.vz);
  r.wheel += r.speed * dt / 0.36;
  if (r.pedaling && r.ground) r.crank += (4 + r.speed * 0.5) * dt;
  r.yaw = wrapPi(r.yaw);
}
