// All sound is synthesised with the Web Audio API, so there are no files to load.
import { clamp } from './noise.js';

export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.hub = 0; this.plank = 0; this.bird = 2; }
  // Must be called from a user gesture.
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = (type, f, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(this.master); s.start();
      return { f: fl, g };
    };
    this.wind = loop('bandpass', 500, 0.6); this.roll = loop('lowpass', 260, 0.7); this.skid = loop('highpass', 2400, 0.5);
    this.water = loop('bandpass', 1100, 0.4); this.forest = loop('bandpass', 3200, 0.3);
    this.forest.g.gain.value = 0.012;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  burst(dur, vol, type, f, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  count(go) { if (go) { this.tone(880, 0.5, 'square', 0.14); this.tone(1320, 0.5, 'square', 0.08); } else this.tone(440, 0.18, 'square', 0.12); }
  hop() { this.burst(0.18, 0.12, 'bandpass', 900); }
  land(impact, wood) { this.tone(wood ? 130 : 90, 0.22, 'sine', clamp(impact / 22, 0.1, 0.5), 0.5); this.burst(0.2, clamp(impact / 40, 0.05, 0.3), 'lowpass', wood ? 900 : 500); }
  trick() { this.tone(660, 0.1, 'triangle', 0.14); this.tone(990, 0.12, 'triangle', 0.12, 0, 0.06); }
  bank(n) { [523, 659, 784, 1047, 1319].slice(0, 2 + Math.min(3, n)).forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, 0, i * 0.07)); }
  flow() { this.tone(1175, 0.12, 'sine', 0.08); }
  crash() { this.burst(0.5, 0.45, 'lowpass', 700); this.tone(140, 0.4, 'sawtooth', 0.2, 0.3); }
  checkpoint() { this.tone(784, 0.14, 'square', 0.1); this.tone(1175, 0.3, 'square', 0.1, 0, 0.12); }
  finish() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'square', 0.11, 0, i * 0.13)); }
  chirp() {
    const base = 2600 + Math.random() * 2400, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(base * (0.9 + Math.random() * 0.3), 0.07, 'sine', 0.03, 1.25, i * (0.09 + Math.random() * 0.04));
  }
  // r: rider state, waterDist: metres to the nearest waterfall.
  update(dt, r, waterDist, active) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, sp = active ? r.speed : 0, gnd = active && r.ground && !r.crashed;
    const set = (n, v) => n.g.gain.setTargetAtTime(v, t, 0.08);
    set(this.wind, clamp(sp / 24, 0, 1) ** 1.6 * 0.42 + 0.015); this.wind.f.frequency.setTargetAtTime(350 + sp * 45, t, 0.1);
    const wood = r.surf === 2, rough = r.surf === 3 || r.surf === 0;
    set(this.roll, gnd ? clamp(sp / 18, 0, 1) * (rough ? 0.55 : 0.32) : 0); this.roll.f.frequency.setTargetAtTime((wood ? 520 : 200) + sp * (rough ? 28 : 14), t, 0.1);
    set(this.skid, gnd ? clamp(r.braking * sp / 14 + r.slide / 5, 0, 1) * 0.16 : 0);
    set(this.water, clamp(1 - waterDist / 90, 0, 1) ** 2 * 0.3);
    if (gnd && wood) { this.plank += sp * dt; if (this.plank > 0.75) { this.plank = 0; this.tone(150 + Math.random() * 60, 0.05, 'triangle', 0.1, 0.6); } }
    if (active && !r.pedaling && sp > 1.5) { // freewheel clicks
      this.hub += dt * Math.min(34, sp * 2.4);
      if (this.hub > 1) { this.hub = 0; this.burst(0.012, 0.035, 'highpass', 4200); }
    }
    this.bird -= dt; if (this.bird < 0) { this.bird = 1.5 + Math.random() * 5; this.chirp(); }
  }
}
