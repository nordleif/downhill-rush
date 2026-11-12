// The bikes in the shop. `stats` scale the physics (1 = the starter bike),
// `bars` are what the shop shows (1 to 5), `look` shapes the model.
export const NEUTRAL = { pedal: 1, drag: 1, grip: 1, air: 1, tough: 1, points: 1 };

export const BIKES = [
  {
    id: 'rusty', name: 'Rusty', price: 0, stats: NEUTRAL, bars: [1, 1, 1, 1],
    look: { frame: 0x7a4a2e, rough: 0.9, metal: 0.1, fat: 0.8, tyre: 0.028, forkFat: 0.8, fork: 0x6a6d72, rim: 0x6a6d72 },
  },
  {
    id: 'fox', name: 'Trail Fox', price: 5000, stats: { pedal: 1.08, drag: 0.97, grip: 1.06, air: 1.03, tough: 1.05, points: 1 }, bars: [2, 2, 1, 2],
    look: { frame: 0xd9541e, rough: 0.4, metal: 0.3, fat: 1, tyre: 0.034, forkFat: 1, fork: 0x18191c, rim: 0x1c1d20 },
  },
  {
    id: 'enduro', name: 'Enduro', price: 15000, stats: { pedal: 1.1, drag: 0.95, grip: 1.1, air: 1.05, tough: 1.25, points: 1 }, bars: [2, 3, 2, 4],
    look: { frame: 0x4f6b3a, rough: 0.5, metal: 0.3, fat: 1.15, tyre: 0.038, forkFat: 1.15, fork: 0x18191c, rim: 0x1c1d20 },
  },
  {
    id: 'slope', name: 'Slopestyle', price: 30000, stats: { pedal: 1.1, drag: 0.96, grip: 1.08, air: 1.3, tough: 1.15, points: 1.25 }, bars: [2, 3, 5, 3],
    look: { frame: 0xe8c21a, rough: 0.3, metal: 0.3, fat: 1.05, tyre: 0.032, forkFat: 1, fork: 0xf0f0f0, rim: 0x2a6fd0 },
  },
  {
    id: 'dh', name: 'Downhill Pro', price: 60000, stats: { pedal: 1.2, drag: 0.88, grip: 1.16, air: 1.1, tough: 1.35, points: 1 }, bars: [4, 4, 3, 5],
    look: { frame: 0xc41f1f, rough: 0.3, metal: 0.4, fat: 1.3, tyre: 0.043, forkFat: 1.3, fork: 0x18191c, rim: 0x1c1d20, dual: true },
  },
  {
    id: 'beast', name: 'Carbon Beast', price: 120000, gold: true, stats: { pedal: 1.25, drag: 0.85, grip: 1.2, air: 1.3, tough: 1.4, points: 1.25 }, bars: [5, 5, 5, 5],
    look: { frame: 0x121316, rough: 0.22, metal: 0.2, fat: 1.4, tyre: 0.043, forkFat: 1.3, fork: 0xd9a520, rim: 0xd9a520, dual: true },
  },
];
export const BAR_NAMES = ['Speed', 'Grip', 'Air', 'Toughness'];
