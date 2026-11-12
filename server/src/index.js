// Room relay for Downhill Rush.
// One Durable Object per room. It tracks who is connected, hands out start
// slots, picks the host (who starts and restarts races) and forwards messages.
// It keeps no game state: every browser simulates its own rider.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 8;
const MAX_MSG = 4096;

export class Room extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const live = this.sockets();

    if (live.length >= MAX_PLAYERS) {
      server.accept();
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!live.length) await this.ctx.storage.deleteAll();
    const seq = ((await this.ctx.storage.get('seq')) || 0) + 1;
    await this.ctx.storage.put('seq', seq);

    const used = new Set(live.map(ws => ws.deserializeAttachment().col));
    let col = 0;
    while (used.has(col) && col < MAX_PLAYERS) col++;
    const name = (url.searchParams.get('name') || 'Rider').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12) || 'Rider';
    const me = { id: 'p' + seq, name, col, joined: seq };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);

    const peers = live.map(ws => {
      const a = ws.deserializeAttachment();
      return { id: a.id, name: a.name, col: a.col };
    });
    const host = await this.pickHost();
    server.send(JSON.stringify({ t: 'hi', id: me.id, host, peers, col }));
    this.broadcast({ t: 'join', id: me.id, name, col }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    // These are the server's own messages; players may not forge them.
    if (['hi', 'join', 'leave', 'host', 'full'].includes(m.t)) return;
    const me = ws.deserializeAttachment();
    m.f = me.id;
    const out = JSON.stringify(m);
    if (m.to) {
      for (const s of this.sockets()) if (s.deserializeAttachment().id === m.to) { s.send(out); break; }
    } else {
      for (const s of this.sockets()) if (s !== ws) s.send(out);
    }
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const me = ws.deserializeAttachment();
    if (!me) return;
    try { ws.close(1000, 'bye'); } catch {}
    this.broadcast({ t: 'leave', id: me.id }, ws);
    if (!this.sockets(ws).length) { await this.ctx.storage.deleteAll(); return; }
    await this.pickHost(ws);
  }

  sockets(except) {
    return this.ctx.getWebSockets().filter(s => s !== except && s.readyState === 1 && s.deserializeAttachment());
  }

  broadcast(msg, except) {
    const out = JSON.stringify(msg);
    for (const s of this.sockets(except)) s.send(out);
  }

  // Host = the player who has been in the room longest.
  async pickHost(except) {
    const all = this.sockets(except).map(s => s.deserializeAttachment()).sort((a, b) => a.joined - b.joined);
    if (!all.length) return null;
    const cur = await this.ctx.storage.get('host');
    const next = all.some(a => a.id === cur) ? cur : all[0].id;
    if (next !== cur) {
      await this.ctx.storage.put('host', next);
      if (cur) this.broadcast({ t: 'host', id: next });
    }
    return next;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([a-z0-9-]{1,32})$/i);
    if (!m) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(m[1].toLowerCase())).fetch(req);
  },
};
