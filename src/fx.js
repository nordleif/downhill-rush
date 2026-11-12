// Soft round particles: dust, landing puffs, leaves, mist and confetti.
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 700) {
    this.max = max; this.n = 0; this.next = 0;
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 4); this.s = new Float32Array(max);
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1e9);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float aSize; attribute vec4 aCol; varying vec4 vCol; uniform float scale; void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * scale / max(0.1,-mv.z); }',
      fragmentShader: 'varying vec4 vCol; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vCol.rgb, vCol.a * smoothstep(0.5, 0.15, d)); }',
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav = 0, drag = 1.5) {
    const i = this.next; this.next = (i + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.life[i] = life; this.age[i] = 0; this.a0[i] = a; this.s0[i] = size; this.grow[i] = grow; this.grav[i] = grav; this.drag[i] = drag; this.s[i] = size;
  }
  update(dt, cam, h) {
    this.mat.uniforms.scale.value = h / (2 * Math.tan(cam.fov * Math.PI / 360));
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { if (this.s[i]) { this.s[i] = 0; this.c[i * 4 + 3] = 0; } continue; }
      this.age[i] += dt; const t = this.age[i] / this.life[i], k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 2] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.s[i] = this.s0[i] * (1 + this.grow[i] * t); this.c[i * 4 + 3] = this.a0[i] * (1 - t) * Math.min(1, t * 8);
    }
    const g = this.geo.attributes; g.position.needsUpdate = g.aCol.needsUpdate = g.aSize.needsUpdate = true;
  }
  dust(x, y, z, n, sp, col = [0.78, 0.6, 0.4], a = 0.5) {
    for (let i = 0; i < n; i++) this.emit(x + (Math.random() - 0.5) * 0.5, y + 0.1, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * sp, 0.4 + Math.random() * sp * 0.5, (Math.random() - 0.5) * sp, 0.6 + Math.random() * 0.7, 0.5 + Math.random() * 0.5, 2.5, col[0], col[1], col[2], a, -0.3, 2);
  }
  burst(x, y, z, n, sp, cols) {
    for (let i = 0; i < n; i++) {
      const c = cols[i % cols.length], a = Math.random() * 6.28, u = Math.random();
      this.emit(x, y, z, Math.cos(a) * sp * u, 2 + Math.random() * sp, Math.sin(a) * sp * u, 0.8 + Math.random() * 0.8, 0.22, 0, c[0], c[1], c[2], 1, 7, 0.8);
    }
  }
}
