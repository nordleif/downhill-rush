// Headless test rider. Rides every route down the mountain with the real
// physics and reports times, crashes and jumps. Run: npm run sim
import { initCourse, trails, course, surfaceAt, newSurf, poseAt, progressOf, locate } from '../src/course.js';
import { newRider, stepRider, placeOn } from '../src/physics.js';
import { makeBot } from '../src/bot.js';

initCourse();
const verbose = process.argv.includes('-v');
const P = {}, S = newSurf(), LO = {};

console.log('trails:');
for (const t of trails) {
  let cut = 0, kmax = 0, gmax = 0;
  for (let i = 1; i < t.n; i++) {
    kmax = Math.max(kmax, Math.abs(t.kap[i]));
    gmax = Math.max(gmax, (t.y[i - 1] - t.y[i]) / (t.s[i] - t.s[i - 1]));
  }
  console.log(`  ${t.idx} ${t.name.padEnd(13)} ${t.diff.padEnd(5)} len ${t.len.toFixed(0).padStart(4)}  drop ${(t.y[0] - t.y[t.n - 1]).toFixed(0).padStart(3)}  minR ${(1 / kmax).toFixed(1)}  maxGrade ${gmax.toFixed(2)}  end (${t.x[t.n - 1].toFixed(0)}, ${t.z[t.n - 1].toFixed(0)})  bridges ${t.spans.map(s => (s.s1 - s.s0).toFixed(0)).join(',')}`);
}
console.log('finish p', course.finishP.toFixed(0), 'checkpoints', course.checkpoints.map(c => c.p.toFixed(0)).join(' '), 'trees', course.trees.length, 'rocks', course.rocks.length);

function ride(name, prefer, opts = {}) {
  const r = newRider(), ev = [], inp = { steer: 0, pedal: 0, brake: 0, pitch: 0, jump: false, trick: 0 };
  const bot = makeBot(prefer, opts);
  placeOn(r, 0, course.start.s);
  const dt = 1 / 120; let time = 0, crashes = 0, vmax = 0, airs = [], prog = 0, vsum = 0, n = 0;
  const log = [];
  while (time < 600) {
    bot(r, inp);
    stepRider(r, inp, dt, ev);
    time += dt; vmax = Math.max(vmax, r.speed); vsum += r.speed; n++;
    for (const e of ev) {
      if (e.t === 'crash') { crashes++; log.push(`crash(${e.why}) on ${trails[r.trail].name} s=${r.s.toFixed(0)} t=${time.toFixed(0)}`); }
      if (e.t === 'land') { airs.push(e.airT); if (verbose) log.push(`land ${trails[r.trail].name} s=${r.s.toFixed(0)} air ${e.airT.toFixed(2)}s impact ${e.impact.toFixed(1)} q${e.q} v=${(r.speed * 3.6).toFixed(0)}`); }
    }
    ev.length = 0;
    prog = Math.max(prog, progressOf(r.trail, r.s));
    if (prog >= course.finishP) break;
  }
  console.log(`${name.padEnd(6)} time ${(time / 60 | 0)}:${(time % 60).toFixed(1).padStart(4, '0')}  avg ${(vsum / n * 3.6).toFixed(0)} km/h  max ${(vmax * 3.6).toFixed(0)} km/h  crashes ${crashes}  jumps ${airs.length} (longest ${Math.max(0, ...airs).toFixed(2)}s)  ${prog >= course.finishP ? 'FINISHED' : 'DNF at p=' + prog.toFixed(0)}`);
  for (const l of log) console.log('   ' + l);
}

ride('green', 'green');
ride('blue', 'blue');
ride('black', 'black');
ride('coast', 'green', { pedalTo: 0, grip: 7 });
ride('tricks', 'black', { tricks: true, pedalTo: 13 });
ride('keys', 'blue', { digital: true });
ride('keysB', 'black', { digital: true });
ride('fast', 'black', { pedalTo: 30, grip: 12 });
