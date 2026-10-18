import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

const MAX_ROOMS = 2000;
const CAMERA_GRACE_MS = 30_000;      // keep a room alive this long if the camera drops
const ROOM_MAX_AGE_MS = 4 * 3600_000;
const JOIN_FAIL_LIMIT = 10;          // wrong-code attempts per IP per minute
const MAX_STATE_BACKLOG = 128 * 1024; // skip frames if the display is this far behind

// ---------- HTTP ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  // Phone cameras only work over HTTPS, so force it in production.
  if (PROD && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=()',
  });
  next();
});

const pub = path.join(__dirname, 'public');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/start', (_req, res) => res.sendFile(path.join(pub, 'start.html')));
app.get('/display', (_req, res) => res.sendFile(path.join(pub, 'display.html')));
app.use(express.static(pub, { maxAge: PROD ? '1h' : 0 }));

const server = http.createServer(app);

// ---------- Rooms ----------
// room = { camera: ws|null, display: ws|null, token, created, cleanup: Timeout|null }
const rooms = new Map();
const failures = new Map(); // ip -> { n, resetAt }

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function newCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function isBlocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() > f.resetAt) { failures.delete(ip); return false; }
  return f.n >= JOIN_FAIL_LIMIT;
}

function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() > f.resetAt) failures.set(ip, { n: 1, resetAt: Date.now() + 60_000 });
  else f.n++;
}

function closeRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.cleanup);
  send(room.display, { type: 'closed', reason });
  send(room.camera, { type: 'closed', reason });
  rooms.delete(code);
}

function detach(ws) {
  const room = rooms.get(ws.code);
  if (!room) return;
  if (ws.role === 'camera' && room.camera === ws) {
    room.camera = null;
    send(room.display, { type: 'peer_left' });
    room.cleanup = setTimeout(() => closeRoom(ws.code, 'camera_gone'), CAMERA_GRACE_MS);
  } else if (ws.role === 'display' && room.display === ws) {
    room.display = null;
    send(room.camera, { type: 'peer_left' });
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  ws.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  ws.role = null;
  ws.code = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;

    switch (m.type) {
      case 'create': {
        if (ws.role) return;
        if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', message: 'Server is full, try again soon' });
        const code = newCode();
        if (!code) return send(ws, { type: 'error', message: 'Could not allocate a room' });
        const token = crypto.randomBytes(16).toString('hex');
        rooms.set(code, { camera: ws, display: null, token, created: Date.now(), cleanup: null });
        ws.role = 'camera';
        ws.code = code;
        send(ws, { type: 'code', code, token });
        break;
      }

      case 'resume': { // camera reconnecting after a dropped socket
        if (ws.role) return;
        if (isBlocked(ws.ip)) return send(ws, { type: 'error', message: 'Too many attempts, wait a minute' });
        const room = rooms.get(String(m.code));
        if (!room || room.token !== m.token) {
          recordFailure(ws.ip);
          return send(ws, { type: 'error', message: 'expired' });
        }
        clearTimeout(room.cleanup);
        room.cleanup = null;
        if (room.camera && room.camera !== ws) room.camera.close();
        room.camera = ws;
        ws.role = 'camera';
        ws.code = String(m.code);
        send(ws, { type: 'code', code: ws.code, token: room.token });
        if (room.display) {
          send(room.camera, { type: 'ready' });
          send(room.display, { type: 'ready' });
        }
        break;
      }

      case 'join': { // display
        if (ws.role) return;
        if (isBlocked(ws.ip)) return send(ws, { type: 'error', message: 'Too many attempts, wait a minute' });
        const code = String(m.code || '');
        const room = /^\d{4}$/.test(code) ? rooms.get(code) : null;
        if (!room || !room.camera) {
          recordFailure(ws.ip);
          return send(ws, { type: 'error', message: 'No room with that code. Check the code on the camera device.' });
        }
        if (room.display && room.display.readyState === 1) {
          return send(ws, { type: 'error', message: 'That room already has a display.' });
        }
        room.display = ws;
        ws.role = 'display';
        ws.code = code;
        send(ws, { type: 'joined' });
        send(room.camera, { type: 'ready' });
        send(room.display, { type: 'ready' });
        break;
      }

      case 'state': { // camera -> display
        if (ws.role !== 'camera') return;
        const room = rooms.get(ws.code);
        const d = room && room.display;
        if (!d || d.readyState !== 1 || d.bufferedAmount > MAX_STATE_BACKLOG) return;
        d.send(JSON.stringify({ type: 'state', d: m.d }));
        break;
      }

      case 'status': { // display -> camera (banner text shown on the phone)
        if (ws.role !== 'display') return;
        const room = rooms.get(ws.code);
        send(room && room.camera, { type: 'status', text: String(m.text || '').slice(0, 80) });
        break;
      }
    }
  });

  ws.on('close', () => detach(ws));
});

// Drop dead sockets and old rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.created > ROOM_MAX_AGE_MS) closeRoom(code, 'expired');
  }
}, 15_000).unref();

server.listen(PORT, () => console.log(`Pocket Katana running on :${PORT}`));

const shutdown = () => {
  for (const code of [...rooms.keys()]) closeRoom(code, 'server_restart');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
