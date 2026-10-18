import { Game, W, H, GROUND, BONES } from './game.js';
import * as audio from './audio.js';
import { Net } from './net.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const gate = document.getElementById('gate');
const form = document.getElementById('join');
const input = document.getElementById('code');
const errEl = document.getElementById('err');

// ---------- game + audio ----------
const game = new Game({
  slash: () => audio.whoosh(),
  clash: () => audio.clang(),
  hit: () => audio.hit(),
  ko: () => audio.ko(),
  say: (t) => audio.speak(t),
});

// ---------- networking ----------
let code = null;
let lastBanner = null;

const net = new Net(onMessage);
net.onOpen = () => { if (code) net.send({ type: 'join', code }); };

function showGate(msg) {
  gate.hidden = false;
  errEl.textContent = msg || '';
}

function onMessage(m) {
  switch (m.type) {
    case 'joined': gate.hidden = true; break;
    case 'ready': game.cameraUp = true; break;
    case 'peer_left': game.cameraUp = false; break;
    case 'closed':
      code = null;
      game.cameraUp = false;
      showGate('That session ended. Start a new one on the camera device.');
      break;
    case 'error':
      code = null;
      showGate(m.message);
      break;
    case 'state': game.ingest(m.d, performance.now()); break;
  }
}

const qs = new URLSearchParams(location.search).get('code');
if (qs && /^\d{4}$/.test(qs)) input.value = qs;
input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = input.value.trim();
  if (!/^\d{4}$/.test(c)) return showGate('Enter the 4-digit code.');
  audio.unlock(); // user gesture: lets sound and speech play
  errEl.textContent = 'Connecting...';
  code = c;
  if (!net.ws) net.connect();
  else net.send({ type: 'join', code });
});

// ---------- rendering ----------
let scale = 1, offX = 0, offY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  scale = Math.min(canvas.width / W, canvas.height / H);
  offX = (canvas.width - W * scale) / 2;
  offY = (canvas.height - H * scale) / 2;
}
addEventListener('resize', resize);
resize();

addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
canvas.addEventListener('dblclick', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
}

// Static background is drawn once to an offscreen canvas.
const bg = document.createElement('canvas');
bg.width = W; bg.height = H;
(function drawBackground() {
  const g = bg.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#0b1026');
  sky.addColorStop(1, '#3a1d4a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f4f1ff'; g.beginPath(); g.arc(1180, 230, 90, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(11,16,38,.15)'; g.beginPath(); g.arc(1210, 205, 80, 0, Math.PI * 2); g.fill();
  const ridge = (y, amp, color, seed) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 40) g.lineTo(x, y - Math.abs(Math.sin(x * 0.004 + seed)) * amp - Math.sin(x * 0.013 + seed) * amp * 0.2);
    g.lineTo(W, GROUND); g.closePath(); g.fill();
  };
  ridge(640, 220, '#1a1a45', 1);
  ridge(700, 150, '#120f33', 4);
  g.fillStyle = '#1b1220'; g.fillRect(0, GROUND, W, H - GROUND);
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2;
  for (let x = -200; x < W + 200; x += 110) { g.beginPath(); g.moveTo(W / 2 + (x - W / 2) * 0.55, GROUND); g.lineTo(x, H); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(0, GROUND); g.lineTo(W, GROUND); g.stroke();
})();

function drawFighter(f, now) {
  if (!f.pts.length) return;
  const col = now < f.flashUntil ? '#ffffff' : f.color;
  ctx.globalAlpha = f.on ? 1 : 0.35;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(f.x, GROUND + 6, 70, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [i, j] of BONES) { ctx.moveTo(f.pts[i][0], f.pts[i][1]); ctx.lineTo(f.pts[j][0], f.pts[j][1]); }
  const sx = (f.pts[1][0] + f.pts[2][0]) / 2, sy = (f.pts[1][1] + f.pts[2][1]) / 2;
  ctx.moveTo(f.pts[0][0], f.pts[0][1] + 24); ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(f.pts[0][0], f.pts[0][1], 24, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBlade(f, now) {
  if (!f.pts.length) return;
  const active = now < f.slashUntil;
  // motion trail: the swept area of recent blade positions
  for (let i = 1; i < f.trail.length; i++) {
    const p = f.trail[i - 1], q = f.trail[i];
    const age = 1 - (now - q.at) / 160;
    ctx.globalAlpha = Math.max(0, age) * (active ? 0.55 : 0.18);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(p.b[0], p.b[1]); ctx.lineTo(p.t[0], p.t[1]); ctx.lineTo(q.t[0], q.t[1]); ctx.lineTo(q.b[0], q.b[1]);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = f.on ? 1 : 0.35;
  ctx.lineCap = 'round';
  ctx.shadowColor = f.color; ctx.shadowBlur = active ? 36 : 20;
  ctx.strokeStyle = f.color; ctx.lineWidth = 13;
  ctx.beginPath(); ctx.moveTo(f.base[0], f.base[1]); ctx.lineTo(f.tip[0], f.tip[1]); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(f.base[0], f.base[1]); ctx.lineTo(f.tip[0], f.tip[1]); ctx.stroke();
  // guard (tsuba)
  const dx = f.tip[0] - f.base[0], dy = f.tip[1] - f.base[1], l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, gx = f.base[0] + ux * 45, gy = f.base[1] + uy * 45;
  ctx.strokeStyle = '#d9b45a'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(gx - uy * 16, gy + ux * 16); ctx.lineTo(gx + uy * 16, gy - ux * 16); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHud() {
  const bar = (x, y, w, hp, color, rtl) => {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x, y, w, 26);
    ctx.fillStyle = color;
    const fw = w * hp / 100;
    ctx.fillRect(rtl ? x + w - fw : x, y, fw, 26);
    ctx.strokeStyle = '#e9edff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, 26);
  };
  const [a, b] = game.f;
  bar(60, 40, 640, a.hp, a.color, false);
  bar(900, 40, 640, b.hp, b.color, true);
  ctx.font = '700 26px system-ui, sans-serif'; ctx.fillStyle = '#e9edff';
  ctx.textAlign = 'left'; ctx.fillText('PLAYER 1', 60, 100);
  ctx.textAlign = 'right'; ctx.fillText('PLAYER 2', 1540, 100);
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = a.wins > i ? a.color : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(190 + i * 30, 94, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.wins > i ? b.color : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(1410 - i * 30, 94, 9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = 'center'; ctx.font = '500 20px system-ui, sans-serif'; ctx.fillStyle = 'rgba(233,237,255,.55)';
  ctx.fillText(`Room ${code || ''}   |   F or double-click: fullscreen`, W / 2, H - 22);
}

function drawBanner() {
  if (!game.banner) return;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const big = game.banner.length <= 6;
  ctx.font = `900 ${big ? 190 : 84}px Impact, "Arial Narrow Bold", sans-serif`;
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(5,8,24,.85)';
  ctx.strokeText(game.banner, W / 2, 400);
  ctx.fillStyle = '#e9edff'; ctx.fillText(game.banner, W / 2, 400);
  if (game.sub) {
    ctx.font = '500 32px system-ui, sans-serif'; ctx.fillStyle = '#cdd4ff';
    ctx.fillText(game.sub, W / 2, 470);
  }
}

function render(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sh = now < game.shakeUntil ? 8 : 0;
  ctx.setTransform(scale, 0, 0, scale, offX + (Math.random() - .5) * sh * scale, offY + (Math.random() - .5) * sh * scale);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.drawImage(bg, 0, 0);
  for (const f of game.f) drawFighter(f, now);
  for (const f of game.f) drawBlade(f, now);
  for (const p of game.sparks) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
  drawHud();
  drawBanner();
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt, now);
  if (game.banner !== lastBanner) {          // mirror the banner on the camera device
    lastBanner = game.banner;
    net.send({ type: 'status', text: game.banner || 'FIGHT' });
  }
  render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
