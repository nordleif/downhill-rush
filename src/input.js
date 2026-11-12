// Keyboard, touch and gamepad input merged into one control state.
import { clamp } from './noise.js';

export class Input {
  constructor() {
    this.keys = new Set(); this.jump = false; this.trick = 0; this.events = [];
    this.touch = { steer: 0, y: 0, brake: 0, id: -1, x0: 0, y0: 0 };
    this.pad = { jump: false, trick: 0, start: false };
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jump = true;
      const d = /^(?:Digit|Numpad)([1-5])$/.exec(e.code); if (d) this.trick = +d[1];
      if (e.code === 'KeyR') this.events.push('restart');
      if (e.code === 'Escape' || e.code === 'KeyP') this.events.push('pause');
      if (e.code === 'KeyM') this.events.push('mute');
      if (e.code === 'Enter') this.events.push('enter');
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.bindTouch();
  }
  bindTouch() {
    const stick = document.getElementById('stick'), knob = document.getElementById('knob'), zone = document.getElementById('tzone');
    if (!stick) return;
    const T = this.touch, R = 60;
    const move = t => {
      const dx = clamp((t.clientX - T.x0) / R, -1, 1), dy = clamp((t.clientY - T.y0) / R, -1, 1);
      T.steer = dx; T.y = -dy; knob.style.transform = `translate(${dx * R}px,${dy * R}px)`;
    };
    zone.addEventListener('touchstart', e => {
      e.preventDefault(); const t = e.changedTouches[0]; if (T.id >= 0) return;
      T.id = t.identifier; T.x0 = t.clientX; T.y0 = t.clientY;
      stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.style.opacity = 1; move(t);
    }, { passive: false });
    zone.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === T.id) move(t); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === T.id) { T.id = -1; T.steer = T.y = 0; stick.style.opacity = 0; } };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
    for (const b of document.querySelectorAll('#touch [data-act]')) {
      const act = b.dataset.act;
      b.addEventListener('touchstart', e => {
        e.preventDefault(); b.classList.add('on');
        if (act === 'jump') this.jump = true; else if (act === 'brake') T.brake = 1; else if (act === 'pause') this.events.push('pause'); else this.trick = +act;
      }, { passive: false });
      const up = e => { e.preventDefault(); b.classList.remove('on'); if (act === 'brake') T.brake = 0; };
      b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    }
  }
  // Fills out with the control state for this frame. Jump and trick fire once.
  poll(out) {
    const k = this.keys, T = this.touch;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = k.has('KeyW') || k.has('ArrowUp'), down = k.has('KeyS') || k.has('ArrowDown');
    let pedal = up ? 1 : 0, brake = down || k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0, pitch = (down ? 1 : 0) - (up ? 1 : 0);
    if (T.id >= 0 || T.brake) {
      steer += T.steer; pitch += Math.abs(T.y) > 0.35 ? -T.y : 0;
      if (T.y > 0.3) pedal = 1;
      if (T.y < -0.45 || T.brake) brake = 1;
    }
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = i => gp.buttons[i] ? gp.buttons[i].value : 0;
      if (Math.abs(ax) > 0.12) steer += ax;
      if (Math.abs(ay) > 0.3) pitch += ay;
      pedal = Math.max(pedal, b(7)); brake = Math.max(brake, b(6));
      const j = b(0) > 0.5; if (j && !this.pad.jump) this.jump = true; this.pad.jump = j;
      const t = b(2) > 0.5 ? 1 : b(3) > 0.5 ? 2 : b(1) > 0.5 ? 3 : b(4) > 0.5 ? 4 : b(5) > 0.5 ? 5 : 0;
      if (t && !this.pad.trick) this.trick = t; this.pad.trick = t;
      const s = b(9) > 0.5; if (s && !this.pad.start) this.events.push('pause'); this.pad.start = s;
    }
    out.steer = clamp(steer, -1, 1); out.pedal = pedal; out.brake = brake; out.pitch = clamp(pitch, -1, 1);
    out.jump = this.jump; out.trick = this.trick; this.jump = false; this.trick = 0;
    return out;
  }
}
