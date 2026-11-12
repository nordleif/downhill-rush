// Draws a top-down map of the course to scripts/out/map-*.png for layout work.
// Run: npm run map
import fs from 'node:fs';
import zlib from 'node:zlib';
import { initCourse, trails, course, gullyDepth } from '../src/course.js';

initCourse();
const B = course.bounds, SC = 0.8, PARTS = 3;
const W = Math.ceil((B.x1 - B.x0) * SC), H = Math.ceil((B.z1 - B.z0) * SC);
const px = new Uint8Array(W * H * 3).fill(0);
const set = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
const dot = (wx, wz, r, c) => { const X = (wx - B.x0) * SC, Y = (B.z1 - wz) * SC; for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) set(X + a, Y + b, c); };

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const wx = B.x0 + x / SC, wz = B.z1 - y / SC, g = gullyDepth(wx, wz);
  set(x, y, g > 1 ? [40, 90, 200] : (Math.round(wz / 100) * 100 === Math.round(wz) || Math.round(wx / 100) * 100 === Math.round(wx)) ? [70, 95, 70] : [50, 80, 50]);
}
for (const t of course.trees) dot(t.x, t.z, 0, [30, 55, 30]);
const COL = { main: [230, 200, 150], green: [80, 230, 90], blue: [90, 160, 255], black: [20, 20, 20], mega: [200, 60, 240] };
for (const t of trails) {
  for (let i = 0; i < t.n; i++) {
    let c = COL[t.diff];
    if (t.fi[i] >= 0) c = [255, 120, 0];
    if (t.di[i] >= 0) c = [150, 90, 40];
    if (t.rg[i]) c = [160, 160, 170];
    dot(t.x[i], t.z[i], Math.max(1, Math.round(t.hw[i] * SC * 0.6)), c);
  }
}
for (const a of course.arches) dot(a.x, a.z, 3, a.kind === 'cp' ? [255, 255, 0] : a.kind === 'route' ? [255, 0, 255] : [255, 0, 0]);
for (const s of course.signs) dot(s.x, s.z, 3, [255, 255, 255]);

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]), o = Buffer.alloc(8 + b.length); o.writeUInt32BE(data.length, 0); b.copy(o, 4); o.writeUInt32BE(crc(b), 4 + b.length); return o; };
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const ph = Math.ceil(H / PARTS);
for (let p = 0; p < PARTS; p++) {
  const h = Math.min(ph, H - p * ph), raw = Buffer.alloc(h * (W * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, (p * ph + y) * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(new URL(`./out/map-${p}.png`, import.meta.url), png);
}
console.log('wrote', PARTS, 'maps', W, 'x', ph, ' z of part tops:', [...Array(PARTS)].map((_, p) => (B.z1 - p * ph / SC).toFixed(0)).join(', '));
