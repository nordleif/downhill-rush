// Trick scoring. Points are only banked by landing; a crash throws the
// current combo away. Repeating a trick makes it worth less.
import { TRICKS } from './physics.js';

const ROT = {
  spin: n => ({ key: 'spin', name: n * 360 + ' Spin', pts: 600 * n * (1 + 0.25 * (n - 1)) }),
  back: n => ({ key: 'back', name: (n > 1 ? ['', '', 'Double ', 'Triple '][Math.min(n, 3)] : '') + 'Backflip', pts: 1000 * n * (1 + 0.3 * (n - 1)) }),
  front: n => ({ key: 'front', name: (n > 1 ? ['', '', 'Double ', 'Triple '][Math.min(n, 3)] : '') + 'Frontflip', pts: 1200 * n * (1 + 0.3 * (n - 1)) }),
};
const PI2 = Math.PI * 2;

export class Score {
  constructor() { this.reset(); }
  reset() { this.tricks = 0; this.flow = 0; this.best = 0; this.crashes = 0; this.uses = {}; this.items = []; this.chain = 0; this.lastLand = -99; }
  get total() { return this.tricks + this.flow; }
  stale(key) { return Math.max(0.25, Math.pow(0.8, this.uses[key] || 0)); }
  airStart() { this.items = []; }
  addTrick(id) { const t = TRICKS[id]; this.items.push({ key: 't' + id, name: t.name, pts: t.pts }); }
  // Tricks so far in this jump, counting rotations that are (nearly) complete.
  list(spin, flip) {
    const out = [], ns = Math.floor(Math.abs(spin) / PI2 + 0.15), nf = Math.floor(Math.abs(flip) / PI2 + 0.15);
    if (nf) out.push((flip > 0 ? ROT.back : ROT.front)(nf));
    if (ns) out.push(ROT.spin(ns));
    return out.concat(this.items);
  }
  value(list) {
    let sum = 0;
    for (const it of list) sum += it.pts * this.stale(it.key);
    return { pts: Math.round(sum * Math.max(1, list.length) / 10) * 10, mult: list.length };
  }
  // q: 0 sketchy, 1 clean, 2 perfect. Returns what was banked, or null.
  land(q, spins, flips, airT, now) {
    const list = [];
    if (flips) list.push((flips > 0 ? ROT.back : ROT.front)(Math.abs(flips)));
    if (spins) list.push(ROT.spin(Math.abs(spins)));
    list.push(...this.items); this.items = [];
    if (!list.length) return null;
    const v = this.value(list);
    let pts = v.pts * [0.6, 1, 1.25][q] + (q === 2 ? 200 : q === 1 ? 100 : 0);
    if (airT > 1.2) pts += Math.round((airT - 1.2) * 40) * 10;
    pts = Math.round(pts / 10) * 10;
    for (const it of list) this.uses[it.key] = (this.uses[it.key] || 0) + 1;
    this.tricks += pts; this.best = Math.max(this.best, pts);
    this.chain = now - this.lastLand < 14 ? this.chain + 1 : 1; this.lastLand = now;
    return { names: list.map(i => i.name), pts, mult: v.mult, q, chain: this.chain };
  }
  crash() { this.items = []; this.crashes++; this.chain = 0; }
  addFlow(pts) { this.flow += pts; }
}

export const PAR_TIME = 270;
export const timeBonus = t => Math.max(0, Math.round((PAR_TIME - t) * 4) * 10);
export const MEDALS = [{ name: 'Gold', min: 25000, color: '#ffcf3a' }, { name: 'Silver', min: 12000, color: '#d5dbe6' }, { name: 'Bronze', min: 3000, color: '#e09a5a' }];
export const medalFor = total => MEDALS.find(m => total >= m.min) || null;
