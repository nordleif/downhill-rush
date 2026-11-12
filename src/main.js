// Game loop, race rules, HUD and multiplayer glue.
import * as THREE from 'three';
import { initCourse, course, trails, surfaceAt, newSurf, progressOf, poseAt } from './course.js';
import { newRider, stepRider, placeOn, respawn } from './physics.js';
import { buildWorld, DIFF_COLOR, waterSpots } from './world.js';
import { BikeModel, OUTFITS } from './bike.js';
import { ChaseCam } from './camera.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Particles } from './fx.js';
import { Score, timeBonus, medalFor, MEDALS } from './score.js';
import { BIKES, BAR_NAMES, NEUTRAL } from './bikes.js';
import { Net, newRoomId, cleanRoom, roomLabel } from './net.js';
import { makeBot } from './bot.js';
import { clamp, wrapPi } from './noise.js';

const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const touch = matchMedia('(pointer:coarse)').matches || QS.has('touch');
addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true });
const quality = QS.has('low') || (touch && !QS.has('high')) ? 0 : 1;
if (touch) document.body.classList.add('touch');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const hex = n => '#' + n.toString(16).padStart(6, '0');

// The world is fixed for the life of the page: changing it reloads.
const WORLDS = ['mountain', 'city'];
let worldId = QS.get('world');
if (!WORLDS.includes(worldId)) { try { worldId = localStorage.getItem('dr_world'); } catch {} }
if (!WORLDS.includes(worldId)) worldId = 'mountain';
try { localStorage.setItem('dr_world', worldId); } catch {}
function setWorld(w, room) {
  try { localStorage.setItem('dr_world', w); } catch {}
  const q = new URLSearchParams(location.search); q.set('world', w);
  if (room) { q.set('room', room); q.set('go', '1'); } else { q.delete('room'); q.delete('go'); }
  location.search = '?' + q;
}
initCourse(worldId);
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality ? 2 : 1.5));
renderer.shadowMap.enabled = quality > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.5;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9500);
const world = buildWorld(scene, quality, renderer);
const fx = new Particles(scene);
const cam = new ChaseCam(camera);
const input = new Input();
const sfx = new Sfx();
const S = newSurf(), P = {};

const me = { r: newRider(), model: null, score: new Score(), name: 'Rider', col: 0 };
const inp = { steer: 0, pedal: 0, brake: 0, pitch: 0, jump: false, trick: 0 };
const ev = [];
let bot = makeBot(QS.get('route') || 'blue', { tricks: true, pedalTo: 13 });

// state: menu (demo ride behind the menu), shop, gate, count, race, done
const G = { same: false, state: 'menu', paused: false, time: 0, count: 0, lastCount: 9, cp: 0, cpAt: null, prog: 0, cleanSince: true, doneT: 0, result: null, auto: QS.has('auto') };
const F = { corner: null, skinny: null, squeeze: false, trickHold: 0 };
const SLOTS = [[-1.1, 0], [1.1, 0], [-3.1, 0], [3.1, 0], [-1.1, -2.4], [1.1, -2.4], [-3.1, -2.4], [3.1, -2.4]];

// ------------------------------------------------------------------ multiplayer
const remotes = new Map();
const net = new Net(onNet);
let sendT = 0;

function labelSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 italic 34px "Arial Black","Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(240, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(10,20,35,0.7)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 14); g.fill();
  g.fillStyle = color; g.fillText(text, 128, 34, 220);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.9, 0.475, 1); s.renderOrder = 10; return s;
}
function addRemote(p) {
  if (remotes.has(p.id)) return;
  const model = new BikeModel(p.col, p.bike || 0), label = labelSprite(p.name, OUTFITS[p.col % OUTFITS.length].name);
  const R = { id: p.id, name: p.name, col: p.col, model, label, a: null, b: null, st: { x: 0, y: -999, z: 0, yaw: 0, pitch: 0, lean: 0, steer: 0, trick: 0, trickT: 0, crank: 0, wheel: 0, susp: 0, crashed: false, tum: 0, tumAx: 0, speed: 0, air: false, pedaling: false, groundY: null }, prog: 0, score: 0, fin: null };
  scene.add(model.root, model.blob, label); remotes.set(p.id, R);
}
function dropRemote(id) {
  const R = remotes.get(id); if (!R) return;
  scene.remove(R.model.root, R.model.blob, R.label); remotes.delete(id);
}
function onNet(m) {
  if (m.t === 'join') { addRemote(m); net.send({ t: 'bike', to: m.id, b: bikeIdx() }); if (net.host) net.send({ t: 'sync', to: m.id, same: G.same, world: worldId, racing: G.state === 'count' || G.state === 'race' || G.state === 'done' }); if (G.result) net.send({ t: 'fin', to: m.id, ...G.result }); }
  else if (m.t === 'leave') dropRemote(m.id);
  else if (m.t === 'closed') { leave(); $('err').textContent = 'Connection lost. Join again.'; }
  else if (m.t === 's') {
    const R = remotes.get(m.f); if (!R) return;
    R.a = R.b; R.b = { t: performance.now() / 1000, d: m.d }; R.prog = m.d[11]; R.score = m.d[12];
  }
  else if (m.t === 'go') { if (G.state === 'gate') startCountdown(); }
  else if (m.t === 'sync') {
    if (WORLDS.includes(m.world) && m.world !== worldId) { const room = net.room; net.close(); setWorld(m.world, room); return; }
    G.same = !!m.same; applyBike(); if (m.racing && G.state === 'gate') startCountdown();
  }
  else if (m.t === 'same') { G.same = !!m.v; applyBike(); }
  else if (m.t === 'bike') {
    const R = remotes.get(m.f), b = Math.floor(m.b) || 0;
    if (R && b >= 0 && b < BIKES.length) { scene.remove(R.model.root, R.model.blob); R.model = new BikeModel(R.col, b); scene.add(R.model.root, R.model.blob); }
  }
  else if (m.t === 'again') toGate();
  else if (m.t === 'fin') { const R = remotes.get(m.f); if (R) { R.fin = m; if (G.state === 'done') showResults(); } }
  roomUi();
}
function sendState() {
  const r = me.r, q = v => Math.round(v * 100) / 100;
  net.send({ t: 's', d: [q(r.x), q(r.y), q(r.z), q(r.yaw + r.spin), q(r.pitch + r.flip), q(r.lean), q(r.steer), r.trick, q(r.trickT),
    (r.ground ? 0 : 1) | (r.crashed ? 2 : 0) | (r.pedaling ? 4 : 0), q(r.speed), Math.round(G.prog), me.score.total, q(r.tum), q(r.tumAx)] });
}
function updateRemotes(dt, now) {
  for (const R of remotes.values()) {
    const b = R.b; if (!b) continue;
    const a = R.a || b, st = R.st, span = Math.max(0.03, b.t - a.t), u = clamp((now - 0.1 - a.t) / span, 0, 1.3);
    const L = i => a.d[i] + (b.d[i] - a.d[i]) * u;
    st.x = L(0); st.y = L(1); st.z = L(2); st.yaw = a.d[3] + wrapPi(b.d[3] - a.d[3]) * u; st.pitch = L(4); st.lean = L(5); st.steer = L(6);
    st.trick = b.d[7]; st.trickT = b.d[8]; st.air = !!(b.d[9] & 1); st.crashed = !!(b.d[9] & 2); st.pedaling = !!(b.d[9] & 4);
    st.speed = L(10); st.tum = L(13); st.tumAx = b.d[14];
    st.wheel += st.speed * dt / 0.36; if (st.pedaling) st.crank += (4 + st.speed * 0.5) * dt;
    st.groundY = surfaceAt(st.x, st.z, st.y + 0.5, S).y;
    R.model.update(st, dt);
    R.label.position.set(st.x, st.y + 2.45, st.z);
  }
}

// ------------------------------------------------------------------ race flow
function toGate() {
  const slot = net.live ? SLOTS[net.col % 8] : [0, 0];
  placeOn(me.r, 0, course.start.s + slot[1], slot[0]);
  me.r.locked = true; me.score.reset(); applyBike();
  Object.assign(G, { state: 'gate', paused: false, time: 0, cp: 0, cpAt: null, prog: 0, cleanSince: true, result: null });
  F.corner = F.skinny = null;
  for (const R of remotes.values()) R.fin = null;
  cam.snap(me.r); bot.reset();
  for (const id of ['menu', 'pause', 'results']) $(id).classList.remove('on');
  $('hud').classList.add('on'); $('touch').classList.add('on');
  hideTrick(); buildDots(); roomUi();
  if (!net.live) startCountdown();
}
function startCountdown() { G.state = 'count'; G.count = 3.4; G.lastCount = 9; roomUi(); }
function finish() {
  G.state = 'done'; G.doneT = 0;
  const tb = timeBonus(G.time), total = me.score.total + tb;
  G.result = { time: G.time, tricks: me.score.tricks, flow: me.score.flow, bonus: tb, total, best: me.score.best, crashes: me.score.crashes };
  let pb = null; try { pb = JSON.parse(localStorage.getItem('dr_pb')); } catch {}
  G.result.pb = !pb || total > pb.total; G.result.pbTime = !pb || G.time < pb.time;
  try { localStorage.setItem('dr_pb', JSON.stringify({ total: Math.max(total, pb ? pb.total : 0), time: Math.min(G.time, pb ? pb.time : 1e9) })); } catch {}
  G.result.old = pb;
  G.result.coins = total; shop.coins += total; saveShop();
  net.send({ t: 'fin', ...G.result });
  sfx.finish(); big('FINISH!', true);
  const r = me.r;
  for (let i = 0; i < 3; i++) fx.burst(r.x, r.y + 2 + i, r.z, 40, 9, [[1, 0.8, 0.2], [1, 0.3, 0.5], [0.2, 0.8, 1], [0.4, 0.9, 0.4]]);
}
function leave() {
  net.close(); for (const id of [...remotes.keys()]) dropRemote(id);
  history.replaceState(null, '', location.pathname);
  G.state = 'menu'; G.paused = false; G.same = false; me.r.bike = NEUTRAL; me.r.locked = false; placeOn(me.r, 0, course.start.s, 0, 4); bot.reset(); cam.snap(me.r);
  for (const id of ['pause', 'results']) $(id).classList.remove('on');
  $('hud').classList.remove('on'); $('touch').classList.remove('on'); $('menu').classList.add('on');
}

// ------------------------------------------------------------------ HUD
let trickTimer = 0;
function showTrick(names, pts, combo, hold, cls) {
  const el = $('trick');
  $('tname').textContent = names; $('tpts').textContent = pts; $('tcombo').textContent = combo;
  el.className = 'it sh on' + (cls ? ' ' + cls : '');
  if (hold) { void el.offsetWidth; el.classList.add('pop'); trickTimer = hold; } else trickTimer = 0.25;
}
function hideTrick() { $('trick').classList.remove('on'); trickTimer = 0; }
function flowPop(text, pts) {
  if (pts) { me.score.addFlow(pts); sfx.flow(); }
  const d = document.createElement('div'); d.textContent = pts ? `${text} +${pts}` : text;
  $('flow').appendChild(d); setTimeout(() => d.remove(), 1900);
  while ($('flow').children.length > 4) $('flow').firstChild.remove();
}
function big(text, small) {
  const el = $('big'); el.textContent = text; el.className = 'it sh' + (small ? ' sm' : ''); void el.offsetWidth; el.classList.add('on');
}
function buildDots() {
  const n = course.checkpoints.length; let h = '';
  for (let i = 0; i < n; i++) h += (i ? `<u class="${i <= G.cp ? 'ok' : ''}"></u>` : '') + `<i class="${i < G.cp ? 'ok' : i === G.cp ? 'now' : ''}"></i>`;
  $('dots').innerHTML = h; $('cpt').textContent = `CHECKPOINT ${G.cp}/${n}`;
}
function roomUi() {
  const on = net.live && G.state === 'gate';
  $('room').classList.toggle('on', on);
  $('pcopy').style.display = net.live ? '' : 'none'; $('prestart').style.display = net.live ? 'none' : '';
  if (!net.live) return;
  $('rcode').textContent = roomLabel(net.room);
  $('rlist').innerHTML = [`<span style="color:${OUTFITS[net.col % 8].name}">${esc(me.name)}</span>`].concat([...remotes.values()].map(R => `<span style="color:${OUTFITS[R.col % 8].name}">${esc(R.name)}</span>`)).join('');
  $('rsamec').checked = G.same; $('rsamec').disabled = !net.host;
  $('rstart').style.display = net.host ? '' : 'none'; $('rwait').style.display = net.host ? 'none' : '';
  if (G.state === 'done') showResults();
}
function showResults() {
  const R = G.result, m = medalFor(R.total);
  $('results').classList.add('on'); $('big').classList.remove('on'); hideTrick();
  $('medal').style.display = m ? '' : 'none';
  if (m) { $('medal').style.background = m.color; $('medal').textContent = m.name.toUpperCase(); }
  $('pbl').textContent = R.pb ? 'NEW PERSONAL BEST' : R.old ? `Best ${R.old.total.toLocaleString('en-US')} pts, ${fmt(R.old.time)}` : '';
  const n = v => v.toLocaleString('en-US');
  $('stats').innerHTML = `<span>Time</span><b>${fmt(R.time)}</b><span>Tricks</span><b>${n(R.tricks)}</b><span>Flow</span><b>${n(R.flow)}</b><span>Time bonus</span><b>${n(R.bonus)}</b><span class="t">Total</span><b class="t">${n(R.total)}</b><span>Best combo</span><b>${n(R.best)}</b><span>Crashes</span><b>${R.crashes}</b><span>Coins</span><b>+${n(R.coins)}</b>`;
  $('rshop').style.display = net.live ? 'none' : '';
  if (net.live) {
    const rows = [{ name: me.name, me: true, ...R }].concat([...remotes.values()].map(q => q.fin ? { name: q.name, ...q.fin } : { name: q.name, time: null }));
    rows.sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9));
    $('table').innerHTML = rows.map((q, i) => `<tr class="${q.me ? 'me' : ''}"><td>${q.time != null ? i + 1 : ''}</td><td>${esc(q.name)}</td><td>${q.time != null ? fmt(q.time) : 'Riding'}</td><td>${q.time != null ? n(q.total) + ' pts' : ''}</td></tr>`).join('');
    $('again').textContent = 'Race Again'; $('again').style.display = net.host ? '' : 'none';
    $('rhost').textContent = net.host ? '' : 'Waiting for host';
  } else { $('table').innerHTML = ''; $('again').textContent = 'Ride Again'; $('again').style.display = ''; $('rhost').textContent = ''; }
}

const mapCtx = $('map').getContext('2d');
const MAPC = { main: '#f4dcae', green: '#35d267', blue: '#4f9bff', black: '#15171c', mega: '#c53cf0' };
function drawMap() {
  const g = mapCtx, W = 300, sc = 1.55, r = me.r, yaw = cam.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw), R2 = 125 * 125;
  g.clearRect(0, 0, W, W); g.save(); g.beginPath(); g.arc(150, 150, 147, 0, 7); g.clip();
  g.lineCap = g.lineJoin = 'round';
  const tx = (x, z) => 150 + ((x - r.x) * cs + (z - r.z) * sn) * sc, ty = (x, z) => 172 - ((x - r.x) * sn - (z - r.z) * cs) * sc;
  for (const pass of [0, 1]) for (const t of trails) {
    g.strokeStyle = pass ? MAPC[t.diff] : 'rgba(255,255,255,0.85)'; g.lineWidth = pass ? 7 : 11;
    if (!pass && t.diff !== 'black') continue;
    let open = false; g.beginPath();
    for (let i = 0; i < t.n; i += 3) {
      const dx = t.x[i] - r.x, dz = t.z[i] - r.z;
      if (dx * dx + dz * dz > R2) { open = false; continue; }
      const X = tx(t.x[i], t.z[i]), Y = ty(t.x[i], t.z[i]);
      if (open) g.lineTo(X, Y); else { g.moveTo(X, Y); open = true; }
    }
    g.stroke();
  }
  for (const a of course.arches) {
    if (a.kind === 'route' || (a.x - r.x) ** 2 + (a.z - r.z) ** 2 > R2) continue;
    g.fillStyle = a.kind === 'finish' ? '#ff4a4a' : '#ffd23c'; g.beginPath(); g.arc(tx(a.x, a.z), ty(a.x, a.z), 7, 0, 7); g.fill();
  }
  for (const q of remotes.values()) {
    if ((q.st.x - r.x) ** 2 + (q.st.z - r.z) ** 2 > R2) continue;
    g.fillStyle = OUTFITS[q.col % 8].name; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.arc(tx(q.st.x, q.st.z), ty(q.st.x, q.st.z), 8, 0, 7); g.fill(); g.stroke();
  }
  g.translate(150, 172); g.rotate(wrapPi(r.yaw + r.spin - yaw));
  g.fillStyle = '#fff'; g.strokeStyle = '#0a1423'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

const hudC = {};
const setText = (id, v) => { if (hudC[id] !== v) { hudC[id] = v; $(id).textContent = v; } };
function updateHud(dt) {
  const r = me.r, kmh = Math.round(r.speed * 3.6);
  setText('kmh', kmh); setText('clock', fmt(G.time)); setText('pts', me.score.total.toLocaleString('en-US')); setText('wal', shop.coins.toLocaleString('en-US'));
  const arc = Math.round(clamp(kmh / 85, 0, 1) * 283);
  if (hudC.arc !== arc) { hudC.arc = arc; $('arc').setAttribute('stroke-dasharray', `${arc} 400`); $('arc').setAttribute('stroke', kmh > 62 ? '#ff7a3a' : '#35d9f0'); }
  $('lines').style.opacity = G.paused ? 0 : clamp((kmh - 48) / 40, 0, 0.55);
  // position and board
  const all = [{ name: me.name, prog: G.prog, fin: G.result ? G.result.time : null, me: true }];
  for (const q of remotes.values()) all.push({ name: q.name, prog: q.prog, fin: q.fin ? q.fin.time : null });
  all.sort((a, b) => (a.fin ?? 1e9) - (b.fin ?? 1e9) || b.prog - a.prog);
  setText('posn', all.findIndex(a => a.me) + 1); setText('posof', '/' + all.length);
  const bh = all.length > 1 ? all.map((a, i) => `<div class="${a.me ? 'me' : ''}"><b>${i + 1}</b><span>${esc(a.name)}</span></div>`).join('') : '';
  if (hudC.board !== bh) { hudC.board = bh; $('board').innerHTML = bh; }
  $('pos').style.display = all.length > 1 ? '' : 'none';
  // trick popup
  if (!r.ground && !r.crashed && r.airT > 0.25) {
    const list = me.score.list(r.spin, r.flip);
    if (list.length) { const v = me.score.value(list); showTrick(list.map(i => i.name).join(' + '), v.pts.toLocaleString('en-US'), v.mult > 1 ? 'COMBO ×' + v.mult : '', 0); }
  }
  if (trickTimer > 0) { trickTimer -= dt; if (trickTimer <= 0) hideTrick(); }
  // fork prompt
  const t = trails[r.trail], f = t.next.length > 1 && r.s > t.len - 80 ? course.forks.find(q => q.from === r.trail) : null;
  const key = f ? f.from : -1;
  if (hudC.route !== key) {
    hudC.route = key;
    $('route').classList.toggle('on', !!f);
    if (f) $('route').innerHTML = f.options.map(o => `<div style="background:${hex(DIFF_COLOR[o.diff])}">${o.dir < 0 ? '◀ ' : ''}${o.level}${o.dir > 0 ? ' ▶' : ''}<small>${esc(o.name)}</small></div>`).join('');
  }
  drawMap();
}

// ------------------------------------------------------------------ simulation
function handleEvents() {
  const r = me.r, live = G.state === 'race';
  for (const e of ev) {
    if (e.t === 'air') { me.score.airStart(); if (e.hop) sfx.hop(); }
    else if (e.t === 'trickStart') sfx.trick();
    else if (e.t === 'trick') { if (live) me.score.addTrick(e.id); }
    else if (e.t === 'thud') { sfx.land(e.impact, r.surf === 2); if (r.surf !== 2) fx.dust(r.x, r.y, r.z, 4, 2); }
    else if (e.t === 'land') {
      sfx.land(e.impact, r.surf === 2); cam.shake = Math.min(1, e.impact / 12);
      if (r.surf !== 2) fx.dust(r.x, r.y, r.z, 10 + Math.round(e.impact), 3 + e.impact * 0.25);
      if (!live) continue;
      const res = me.score.land(e.q, e.spins, e.flips, e.airT, G.time);
      if (res) {
        showTrick(res.names.join(' + '), res.pts.toLocaleString('en-US') + ' POINTS', res.mult > 1 ? 'COMBO ×' + res.mult : '', 2.4, e.q === 0 ? 'bad' : '');
        sfx.bank(res.mult);
        if (e.q === 2) { big('PERFECT LANDING!', true); fx.burst(r.x, r.y + 0.5, r.z, 24, 6, [[1, 0.85, 0.25], [1, 1, 1], [0.3, 0.9, 1]]); }
        else if (e.q === 0) flowPop('Sketchy landing');
        if (res.chain > 1) flowPop('Jump chain ×' + res.chain, 100 * (res.chain - 1));
      } else if (e.airT > 0.9) flowPop('Air ' + e.airT.toFixed(1) + ' s', Math.round(e.airT * 10) * 10);
      else if (e.q === 2 && e.airT > 0.5) flowPop('Clean landing', 30);
    }
    else if (e.t === 'crash') {
      const lost = me.score.list(r.spin, r.flip).length;
      me.score.crash(); G.cleanSince = false; F.corner = F.skinny = null; F.squeeze = false; sfx.crash(); cam.shake = 1;
      fx.dust(r.x, r.y, r.z, 22, 6);
      if (live) showTrick('CRASH', lost ? 'COMBO LOST' : '', '', 1.5, 'bad');
    }
  }
  ev.length = 0;
}

function trackRace(dt) {
  const r = me.r;
  if (!r.crashed && (r.w > 0.5 || r.deck)) {
    const p = progressOf(r.trail, r.s);
    if (p > G.prog && p - G.prog < 260) G.prog = p;
  }
  const cp = course.checkpoints[G.cp];
  if (cp && G.prog >= cp.p) {
    G.cp++; G.cpAt = { t: r.trail, s: r.s }; buildDots(); sfx.checkpoint(); big('CHECKPOINT ' + G.cp, true);
    if (G.cleanSince) flowPop('Clean section', 250);
    G.cleanSince = true;
  }
  if (G.prog >= course.finishP) { finish(); return; }
  // Flow: holding speed through a corner, riding a whole skinny.
  if (r.ground && !r.crashed) {
    if (Math.abs(r.kap) > 0.04 && r.w > 0.6) { F.corner = F.corner || { t: 0, min: 99 }; F.corner.t += dt; F.corner.min = Math.min(F.corner.min, r.speed); }
    else if (F.corner) { if (F.corner.t > 0.9 && F.corner.min > 9.5) flowPop('Carve', 50 + Math.round(F.corner.min - 9.5) * 10); F.corner = null; }
    const dk = r.deck && r.deck.type === 'skinny' ? r.deck : null;
    if (dk && !F.skinny) F.skinny = { dk, ok: r.s < dk.s0 + 5 };
    else if (F.skinny && !dk) { if (F.skinny.ok && r.s >= F.skinny.dk.s1 - 2) flowPop('Skinny', F.skinny.dk.hw < 0.7 ? 800 : 300); F.skinny = null; }
    if (r.zone === 3) F.squeeze = true;
    else if (F.squeeze) { F.squeeze = false; flowPop('Squeeze', 600); }
  }
}

function effects(dt) {
  const r = me.r;
  if (r.ground && !r.crashed && r.speed > 4 && r.surf !== 2) {
    const n = (r.speed / 22 + r.slide * 0.5 + r.braking * 0.8) * dt * 30 * (r.surf === 0 ? 0.3 : 1);
    if (Math.random() < n) {
      const bx = r.x - Math.sin(r.yaw) * 0.6, bz = r.z + Math.cos(r.yaw) * 0.6, c = worldId === 'city' ? [0.5, 0.5, 0.5] : r.surf === 0 ? [0.42, 0.48, 0.34] : [0.5, 0.44, 0.36];
      fx.emit(bx, r.y + 0.1, bz, (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5, 0.7 + Math.random() * 0.5, 0.35 + r.slide * 0.1, 3, c[0], c[1], c[2], worldId === 'city' ? 0.12 : 0.25, -0.4, 2);
    }
  }
  // Drifting leaves in the forest and mist at the waterfalls.
  if (worldId !== 'city' && Math.random() < dt * 5) {
    const a = cam.yaw + (Math.random() - 0.5) * 1.6, d = 8 + Math.random() * 25, x = camera.position.x + Math.sin(a) * d, z = camera.position.z - Math.cos(a) * d;
    const c = Math.random() < 0.5 ? [0.95, 0.8, 0.25] : [0.55, 0.85, 0.3];
    fx.emit(x, camera.position.y + 2 + Math.random() * 5, z, (Math.random() - 0.5) * 2, -0.8, (Math.random() - 0.5) * 2, 4, 0.13, 0, c[0], c[1], c[2], 0.9, 0.15, 0.3);
  }
  let wd = 1e9;
  for (const w of waterSpots) {
    const d = Math.hypot(w.x - r.x, w.z - r.z); wd = Math.min(wd, d);
    if (d < 140 && Math.random() < dt * 40) fx.emit(w.x + (Math.random() - 0.5) * 4, w.y + Math.random() * 2, w.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 1.6, 1.2, 2.5, 1, 1, 1, 0.35, 0.5, 0.6);
  }
  return wd;
}

// ------------------------------------------------------------------ bike shop
// Coins and owned bikes live in this browser only.
const shop = { coins: 0, owned: ['rusty'], bike: 'rusty' };
try { const s = JSON.parse(localStorage.getItem('dr_shop')); if (s && Array.isArray(s.owned)) Object.assign(shop, s); } catch {}
const saveShop = () => { try { localStorage.setItem('dr_shop', JSON.stringify(shop)); } catch {} };
const bikeIdx = () => Math.max(0, BIKES.findIndex(b => b.id === shop.bike));
const hasGold = () => { try { return JSON.parse(localStorage.getItem('dr_pb')).total >= MEDALS[0].min; } catch { return false; } };
function setMyModel() {
  scene.remove(me.model.root, me.model.blob); me.model = new BikeModel(me.col, bikeIdx()); scene.add(me.model.root, me.model.blob);
}
// The stats that count: the rider's own bike, or the starter bike for all when the host says so.
function applyBike() {
  const st = net.live && G.same ? NEUTRAL : BIKES[bikeIdx()].stats;
  me.r.bike = st; me.score.mult = st.points;
}
const show = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, 1, 0.1, 60), model: null, i: 0, t: 0 };
{
  show.scene.background = new THREE.Color(0x1a2028); show.scene.environment = scene.environment; show.scene.environmentIntensity = 1.3;
  const key = new THREE.DirectionalLight(0xfff2e0, 5); key.position.set(3, 5, 4);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c343f, roughness: 0.6 }));
  show.scene.add(key, new THREE.HemisphereLight(0xbfd0e6, 0x30343c, 1.2), floor);
  show.cam.position.set(0, 1.25, 4.3); show.cam.lookAt(0, 0.62, 0);
}
function showBike(i) {
  const n = BIKES.length, b = BIKES[show.i = (i + n) % n], owned = shop.owned.includes(b.id);
  if (show.model) show.scene.remove(show.model.root);
  show.model = new BikeModel(me.col, show.i); show.model.rider.visible = false; show.scene.add(show.model.root);
  $('coins').textContent = shop.coins.toLocaleString('en-US') + ' coins';
  $('sname').textContent = b.name;
  $('sbars').innerHTML = BAR_NAMES.map((nm, k) => `<span>${nm}</span><div>${[1, 2, 3, 4, 5].map(v => `<i class="${v <= b.bars[k] ? 'on' : ''}"></i>`).join('')}</div>`).join('');
  const locked = b.gold && !hasGold();
  $('snote').textContent = !owned && locked ? 'Needs a gold medal.' : '';
  $('sbuy').textContent = owned ? (shop.bike === b.id ? 'Riding' : 'Ride') : 'Buy ' + b.price.toLocaleString('en-US');
  $('sbuy').disabled = owned ? shop.bike === b.id : locked || shop.coins < b.price;
}
function openShop() {
  G.state = 'shop'; $('menu').classList.remove('on'); $('shop').classList.add('on'); showBike(bikeIdx());
}
function closeShop() { G.state = 'menu'; $('shop').classList.remove('on'); $('menu').classList.add('on'); }
function buyOrRide() {
  const b = BIKES[show.i];
  if (!shop.owned.includes(b.id)) {
    if (shop.coins < b.price || (b.gold && !hasGold())) return;
    shop.coins -= b.price; shop.owned.push(b.id); sfx.init(); sfx.finish();
  }
  shop.bike = b.id; saveShop(); setMyModel(); showBike(show.i);
}

let last = performance.now();
function frame(now) {
requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tick(dt, now);
}
function tick(dt, now) {
  const r = me.r;
  if (G.state === 'shop') {
    input.events.length = 0; show.t += dt;
    show.model.update({ x: 0, y: 0, z: 0, yaw: show.t * 0.6, pitch: 0, lean: 0, steer: 0.25, trick: 0, trickT: 0, crank: 0.6, wheel: 0, susp: 0, crashed: false, tum: 0, tumAx: 0, speed: 0, air: false, pedaling: false, groundY: null }, dt);
    renderer.render(show.scene, show.cam); return;
  }
  for (const e of input.events) {
    if (e === 'mute') toggleMute();
    else if (e === 'pause' && G.state !== 'menu') togglePause();
    else if (e === 'restart' && G.state === 'race' && !G.paused) { const a = G.cpAt || course.start; placeOn(r, a.t, a.s, 0, G.cpAt ? 5 : 0); me.score.items = []; G.cleanSince = false; cam.snap(r); }
    else if (e === 'enter' && G.state === 'done' && $('results').classList.contains('on') && $('again').style.display !== 'none') $('again').click();
  }
  input.events.length = 0;
  input.poll(inp);
  const frozen = G.paused && !net.live;
  if (!frozen) {
    if (G.state === 'menu' || (G.auto && G.state === 'race')) bot(r, inp);
    if (G.state === 'gate') r.locked = true;
    if (G.state === 'count') {
      G.count -= dt; const c = Math.ceil(G.count);
      if (c !== G.lastCount && c > 0 && c <= 3) { G.lastCount = c; big(String(c)); sfx.count(false); }
      if (G.count <= 0) { G.state = 'race'; G.time = 0; r.locked = false; big('GO!'); sfx.count(true); }
    }
    if (G.state === 'done') { inp.steer = 0; inp.pedal = 0; inp.brake = 1; inp.jump = false; inp.trick = 0; inp.pitch = 0; G.doneT += dt; if (G.doneT > 1.6 && !$('results').classList.contains('on')) showResults(); }
    if (G.state === 'race') G.time += dt;
    const n = Math.ceil(dt * 120), h = dt / n;
    for (let i = 0; i < n; i++) { stepRider(r, inp, h, ev); inp.jump = false; inp.trick = 0; }
    handleEvents();
    if (G.state === 'race') trackRace(dt);
    if (G.state === 'menu' && progressOf(r.trail, r.s) >= course.finishP) { placeOn(r, 0, course.start.s, 0, 4); bot.reset(); cam.snap(r); }
    const wd = effects(dt);
    sfx.update(dt, r, wd, G.state !== 'menu');
    me.model.update({
      x: r.x, y: r.y, z: r.z, yaw: r.yaw + r.spin, pitch: r.pitch + r.flip, lean: r.lean, steer: r.steer, trick: r.trick, trickT: r.trickT,
      crank: r.crank, wheel: r.wheel, susp: r.susp, crashed: r.crashed, tum: r.tum, tumAx: r.tumAx, speed: r.speed, air: !r.ground, pedaling: r.pedaling > 0,
      groundY: surfaceAt(r.x, r.z, r.y + 0.5, S).y,
    }, dt);
    cam.update(r, dt);
    fx.update(dt, camera, renderer.domElement.height);
  }
  if (net.live) {
    updateRemotes(dt, now / 1000);
    sendT -= dt; if (sendT <= 0) { sendT = 1 / 15; sendState(); }
  }
  world.update(frozen ? 0 : dt, cam.look, camera.position);
  if (G.state !== 'menu') updateHud(dt);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ menus
function togglePause() {
  if (G.state === 'done' && $('results').classList.contains('on')) return;
  G.paused = !G.paused; $('pause').classList.toggle('on', G.paused);
}
function toggleMute() { sfx.setMuted(!sfx.muted); $('pmute').textContent = sfx.muted ? 'Sound On' : 'Sound Off'; }
function myName() {
  const n = $('name').value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12) || 'Rider';
  try { localStorage.setItem('dr_name', n); } catch {}
  return n;
}
let joining = false;
async function join(room) {
  if (joining) return; joining = true; $('err').textContent = '';
  sfx.init(); me.name = myName();
  try {
    await net.connect(room, me.name);
    for (const p of net.peers.values()) addRemote(p);
    me.col = net.col; setMyModel(); net.send({ t: 'bike', b: bikeIdx() });
    history.replaceState(null, '', '?room=' + room + '&world=' + worldId);
    toGate();
  } catch (e) {
    $('err').textContent = e === 'full' ? 'Room is full. Try another room.' : 'Could not connect. Check the connection and try again.';
  }
  joining = false;
}
const link = () => location.origin + location.pathname + '?room=' + net.room + '&world=' + worldId;
function copyLink(btn) {
  const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(link()).then(done, () => prompt('Link', link())); else prompt('Link', link());
}
try { $('name').value = localStorage.getItem('dr_name') || ''; } catch {}
$('solo').onclick = () => { sfx.init(); me.name = myName(); toGate(); };
$('create').onclick = () => join(newRoomId());
$('join').onclick = () => { const c = cleanRoom($('code').value); if (c) join(c); else $('err').textContent = 'Enter a room code.'; };
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
$('rstart').onclick = () => { net.send({ t: 'go' }); startCountdown(); };
$('rcopy').onclick = e => copyLink(e.target); $('pcopy').onclick = e => copyLink(e.target);
$('rsamec').onchange = e => { if (!net.host) return; G.same = e.target.checked; net.send({ t: 'same', v: G.same }); applyBike(); };
$('shopb').onclick = openShop; $('sback').onclick = closeShop; $('sbuy').onclick = buyOrRide;
$('sprev').onclick = () => showBike(show.i - 1); $('snext').onclick = () => showBike(show.i + 1);
$('rshop').onclick = () => { leave(); openShop(); };
addEventListener('keydown', e => { if (G.state !== 'shop') return; if (e.key === 'ArrowLeft') showBike(show.i - 1); else if (e.key === 'ArrowRight') showBike(show.i + 1); else if (e.key === 'Escape') closeShop(); });
for (const w of WORLDS) { const b = $('w' + w); if (w === worldId) b.classList.remove('b3'); b.onclick = () => { if (w !== worldId) setWorld(w); }; }
$('resume').onclick = togglePause;
$('prestart').onclick = () => { togglePause(); toGate(); };
$('pmute').onclick = toggleMute;
$('leave').onclick = leave; $('rleave').onclick = leave;
$('again').onclick = () => { if (net.live) net.send({ t: 'again' }); toGate(); };
const preRoom = cleanRoom(QS.get('room'));
if (preRoom) { $('code').value = preRoom; $('solo').style.display = 'none'; $('create').style.display = 'none'; }

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  show.cam.aspect = camera.aspect; show.cam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
me.model = new BikeModel(0, bikeIdx()); scene.add(me.model.root, me.model.blob);
placeOn(me.r, 0, course.start.s, 0, 4); cam.snap(me.r);
if (QS.has('debug')) window.__dr = { G, me, shop, net, remotes, cam, course, trails, placeOn, input, inp, toGate, scene, renderer, camera, run(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) tick(dt, performance.now()); } };
if (preRoom && QS.has('go')) join(preRoom);
requestAnimationFrame(frame);
