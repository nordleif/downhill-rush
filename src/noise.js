// Seeded random numbers and value noise. Everything in the world is derived from
// these so that every player in a room builds exactly the same mountain.

export function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, o = 3) {
  let s = 0, a = 0.5, t = 0;
  for (let i = 0; i < o; i++) {
    s += a * vnoise(x, z); t += a;
    x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5;
  }
  return s / t;
}

export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep that also works with a > b (falling edge).
export const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
