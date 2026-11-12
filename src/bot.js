// A simple autopilot that follows the trail centre line. It drives the test
// script and the demo ride behind the menu. It uses the same controls a player has.
import { trails, poseAt, locate } from './course.js';
import { wrapPi, clamp } from './noise.js';

export function makeBot(prefer = 'blue', opts = {}) {
  const P = {}, LO = {};
  const pick = t => t.next.find(i => trails[i].diff === prefer) ?? t.next.find(i => trails[i].diff === 'blue') ?? t.next[0];
  const route = [0];
  while (trails[route.at(-1)].next.length) route.push(pick(trails[route.at(-1)]));
  let cur = 0, cs = 0;
  const ahead = (d) => {
    let t = trails[cur], s = cs + d;
    while (s > t.len && t.next.length) { s -= t.len; t = trails[pick(t)]; }
    return poseAt(t, s, P);
  };
  const bot = (r, inp) => {
    let rt = r.trail, rs = r.s;
    if (r.ground && r.w < 0.5 && !r.deck) { locate(r.x, r.z, LO); rt = LO.trail; rs = LO.s; }
    if (!route.includes(rt)) { // on a neighbouring branch where they merge: carry on along our own
      const mine = route.find(i => trails[i].p0 === trails[rt].p0);
      if (mine != null) { rs = rs / trails[rt].len * trails[mine].len; rt = mine; }
    }
    if (route.includes(rt) && route.indexOf(rt) >= route.indexOf(cur)) { cur = rt; cs = rs; }
    const A = ahead(5 + r.speed * 0.5);
    inp.steer = r.ground ? clamp(wrapPi(Math.atan2(A.x - r.x, -(A.z - r.z)) - r.yaw) * 2.5, -1, 1) : 0;
    if (opts.digital) inp.steer = Math.abs(inp.steer) > 0.3 ? Math.sign(inp.steer) : 0; // like arrow keys
    // Fastest speed now that still lets the brakes make every corner ahead.
    let vsafe = opts.vmax || 30;
    for (let d = 4; d < 14 + r.speed * 2.6; d += 3) {
      const vc = Math.sqrt((opts.grip || 9) / Math.max(Math.abs(ahead(d).kap), 0.002));
      vsafe = Math.min(vsafe, Math.sqrt(vc * vc + 2 * 3.5 * Math.max(0, d - 8)));
    }
    inp.brake = r.speed > vsafe + 0.5 ? 1 : 0;
    inp.pedal = !inp.brake && r.speed < Math.min(vsafe - 1, opts.pedalTo ?? 14) ? 1 : 0;
    inp.pitch = 0; inp.jump = false; inp.trick = 0;
    if (opts.tricks && !r.ground && r.airT > 0.2 && r.airT < 0.3 && !r.trick && r.vy > 1) inp.trick = 1 + Math.floor(Math.random() * 4);
  };
  bot.reset = () => { cur = 0; cs = 0; };
  return bot;
}
