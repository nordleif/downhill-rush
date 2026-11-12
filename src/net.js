// Multiplayer transport. Rooms live on a small relay server (see server/);
// every browser simulates its own rider and shares its state 15 times a second.
const QS = new URLSearchParams(location.search);
const SAME = /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname);
export const SERVER = (QS.get('server') || (SAME ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : 'wss://downhill-rush.bo-29c.workers.dev')).replace(/\/$/, '');

const WORDS = ['pine', 'ridge', 'berm', 'creek', 'summit', 'gravel', 'fern', 'timber', 'eagle', 'rocky', 'maple', 'canyon'];
export const newRoomId = () => WORDS[Math.floor(Math.random() * WORDS.length)] + '-' + (10 + Math.floor(Math.random() * 90));
export const cleanRoom = s => (s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32);
export const roomLabel = id => id.toUpperCase().replace(/-/g, ' ');

export class Net {
  constructor(on) { this.on = on; this.ws = null; this.id = null; this.hostId = null; this.room = null; this.col = 0; this.peers = new Map(); this.live = false; }
  get host() { return this.live && this.id === this.hostId; }
  connect(room, name) {
    return new Promise((res, rej) => {
      let ws, done = false;
      const fail = r => { if (!done) { done = true; rej(r); } };
      try { ws = new WebSocket(SERVER + '/room/' + encodeURIComponent(room) + '?name=' + encodeURIComponent(name)); } catch { fail('net'); return; }
      const to = setTimeout(() => { fail('timeout'); try { ws.close(); } catch {} }, 8000);
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (!done) {
          if (m.t === 'hi') {
            done = true; clearTimeout(to);
            this.ws = ws; this.id = m.id; this.hostId = m.host; this.room = room; this.col = m.col; this.live = true;
            for (const p of m.peers) this.peers.set(p.id, p);
            res();
          } else if (m.t === 'full') fail('full');
          return;
        }
        if (m.t === 'join') this.peers.set(m.id, { id: m.id, name: m.name, col: m.col });
        else if (m.t === 'leave') this.peers.delete(m.id);
        else if (m.t === 'host') this.hostId = m.id;
        this.on(m);
      };
      ws.onerror = () => fail('net');
      ws.onclose = () => { clearTimeout(to); if (!done) fail('net'); else if (this.live) { this.live = false; this.on({ t: 'closed' }); } };
    });
  }
  send(m) { if (this.live && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.live = false; this.peers.clear(); try { this.ws && this.ws.close(); } catch {} this.ws = null; }
}
