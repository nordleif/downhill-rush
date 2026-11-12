// Third-person chase camera: behind and above the rider, pulls back and widens
// with speed, banks a little in turns and stays out of the ground and trees.
import * as THREE from 'three';
import { surfaceAt, newSurf, obstaclesNear } from './course.js';
import { wrapPi, clamp } from './noise.js';

const S = newSurf(), near = [], tgt = new THREE.Vector3(), lk = new THREE.Vector3();

export class ChaseCam {
  constructor(cam) { this.cam = cam; this.yaw = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.ty = 0; this.roll = 0; this.fov = 62; this.shake = 0; this.t = 0; }
  snap(r) {
    this.yaw = r.yaw; this.ty = r.y;
    this.pos.set(r.x - Math.sin(r.yaw) * 5, r.y + 2.2, r.z + Math.cos(r.yaw) * 5);
    this.look.set(r.x, r.y + 1.1, r.z);
  }
  update(r, dt) {
    this.t += dt;
    const sp = r.speed;
    let want = r.yaw;
    if (sp > 2.5) want = r.ground && !r.crashed ? r.yaw + wrapPi(Math.atan2(r.vx, -r.vz) - r.yaw) * 0.5 : Math.atan2(r.vx, -r.vz);
    this.yaw += wrapPi(want - this.yaw) * Math.min(1, dt * (r.ground ? 4.2 : 2.2));
    this.ty += (r.y - this.ty) * Math.min(1, dt * (r.ground ? 11 : 4.5));
    const dist = 4.7 + sp * 0.12, h = 2.05 + sp * 0.03 + (r.ground ? 0 : 0.5);
    tgt.set(r.x - Math.sin(this.yaw) * dist, this.ty + h, r.z + Math.cos(this.yaw) * dist);
    for (const o of obstaclesNear(tgt.x, tgt.z, 3, near)) {
      if (o.rock) continue;
      const dx = tgt.x - o.x, dz = tgt.z - o.z, d = Math.hypot(dx, dz) || 1, min = 1.5 * o.sc + 0.4;
      if (d < min) { tgt.x = o.x + dx / d * min; tgt.z = o.z + dz / d * min; }
    }
    this.pos.lerp(tgt, Math.min(1, dt * 10));
    const gy = surfaceAt(this.pos.x, this.pos.z, 1e9, S).y + 1.35;
    if (this.pos.y < gy) this.pos.y = gy;
    lk.set(r.x + Math.sin(this.yaw) * 5, this.ty + 1.0 - (r.ground ? 0 : clamp(r.clear * 0.12, 0, 1.6)), r.z - Math.cos(this.yaw) * 5);
    this.look.lerp(lk, Math.min(1, dt * 12));
    const c = this.cam;
    c.position.copy(this.pos);
    if (this.shake > 0.001) {
      c.position.y += Math.sin(this.t * 71) * this.shake * 0.12; c.position.x += Math.sin(this.t * 53) * this.shake * 0.08;
      this.shake *= Math.exp(-7 * dt);
    }
    c.lookAt(this.look);
    this.roll += (-r.lean * 0.2 - this.roll) * Math.min(1, dt * 5);
    c.rotateZ(this.roll);
    const fov = 60 + clamp(sp / 20, 0, 1.25) * 15;
    this.fov += (fov - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(c.fov - this.fov) > 0.02) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}
