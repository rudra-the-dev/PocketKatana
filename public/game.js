// Pure game logic. No DOM, no network, no audio: it only emits events through `ev`.
// Keeping it this way means the same module can later run on a server for online play.

export const W = 1600;
export const H = 900;
export const GROUND = 790;
export const S = 90;                  // one torso length, in arena pixels
export const BLADE = 380;             // the "2 m" sword
export const HIP_Y = GROUND - 1.9 * S;

const MARGIN = 140;
const MIN_GAP = 150;
const SLASH_SPEED = 2200;             // blade-tip px/s that counts as a slash
const SLASH_MS = 220;
const SLASH_COOLDOWN = 350;
const HIT_DAMAGE = 14;
const HIT_COOLDOWN = 600;
const HIT_RADIUS = 20;
const HEAD_RADIUS = 34;
const CLASH_RADIUS = 16;
const LOST_MS = 2500;                 // player out of frame this long -> pause
const STALE_MS = 1200;                 // no tracker data this long -> player is "off"
const READY_MS = 1500;
const STEP_MS = 900;
const ROUNDS_TO_WIN = 2;

// Indices into the 13 tracked points: 0 nose, 1/2 shoulders, 3/4 elbows, 5/6 wrists,
// 7/8 hips, 9/10 knees, 11/12 ankles.
export const BONES = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12]];
const REST = [0, -1.5, -.4, -1, .4, -1, -.5, -.5, .5, -.5, -.5, 0, .5, 0, -.2, 0, .2, 0, -.2, .95, .2, .95, -.2, 1.9, .2, 1.9];
const STEPS = ['3', '2', '1', 'FIGHT!'];
const SAY = ['Three', 'Two', 'One', 'Fight!'];

// ---------- geometry ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function ptSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

function segsCross(a, b, c, d) {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(
    ptSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
    ptSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    ptSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
    ptSeg(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

// Point along segment a-b that is closest to segment c-d (sampled).
function contactPoint(a, b, c, d) {
  let best = a, bd = Infinity;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const dd = ptSeg(x, y, c[0], c[1], d[0], d[1]);
    if (dd < bd) { bd = dd; best = [x, y]; }
  }
  return best;
}

// ---------- fighters ----------
function makeFighter(id) {
  const x = id === 1 ? 450 : 1150;
  return {
    id, on: false, seen: 0,
    tx: x, x, rel: REST.slice(),
    dirT: [id === 1 ? 1 : -1, -0.3], dirv: [id === 1 ? 1 : -1, -0.3], hand: 6,
    pts: [], base: [0, 0], tip: [0, 0], prevTip: null, speed: 0,
    slashUntil: 0, lastSlash: 0, hitCd: 0, flashUntil: 0,
    hp: 100, wins: 0, trail: [],
    color: id === 1 ? '#4aa3ff' : '#ff5a5a',
  };
}

export class Game {
  constructor(ev = {}) {
    this.ev = ev;
    this.f = [makeFighter(1), makeFighter(2)];
    this.sparks = [];
    this.cameraUp = false;
    this.now = 0;
    this.clashCd = 0;
    this.shakeUntil = 0;
    this.winner = 0;
    this.banner = '';
    this.sub = '';
    this.readySince = 0;
    this.lostSince = 0;
    this.cdIdx = -1;
    this.setState('waiting');
  }

  setState(s) {
    this.state = s;
    this.stateAt = this.now;
  }

  // d = { w: [{ p, on, x, pts[26], dir[2], sh }, ...] } as sent by the tracker page.
  ingest(d, now) {
    for (const w of (d && d.w) || []) {
      const f = this.f[(w.p | 0) - 1];
      if (!f) continue;
      f.on = !!w.on;
      if (!w.on || !Array.isArray(w.pts) || w.pts.length !== 26) continue;
      f.seen = now;
      f.tx = MARGIN + clamp(+w.x || 0, 0, 1) * (W - 2 * MARGIN);
      for (let i = 0; i < 26; i++) {
        const v = +w.pts[i];
        if (Number.isFinite(v)) f.rel[i] += (clamp(v, -6, 6) - f.rel[i]) * 0.7;
      }
      if (Array.isArray(w.dir) && Number.isFinite(+w.dir[0]) && Number.isFinite(+w.dir[1])) {
        f.dirT = [+w.dir[0], +w.dir[1]];
      }
      f.hand = w.sh === 5 ? 5 : 6;
    }
  }

  update(dt, now) {
    this.now = now;
    const [a, b] = this.f;
    for (const f of this.f) {
      if (!this.cameraUp || (f.on && now - f.seen > STALE_MS)) f.on = false;
    }
    for (const f of this.f) f.x += (f.tx - f.x) * Math.min(1, dt * 10);
    if (b.x - a.x < MIN_GAP) {
      const m = (a.x + b.x) / 2;
      a.x = m - MIN_GAP / 2;
      b.x = m + MIN_GAP / 2;
    }
    for (const f of this.f) this.geometry(f, dt, now);
    this.step(now);
    this.updateSparks(dt);
  }

  geometry(f, dt, now) {
    f.pts = [];
    for (let i = 0; i < 13; i++) f.pts.push([f.x + f.rel[2 * i] * S, HIP_Y + f.rel[2 * i + 1] * S]);
    const k = Math.min(1, dt * 18);
    f.dirv[0] += (f.dirT[0] - f.dirv[0]) * k;
    f.dirv[1] += (f.dirT[1] - f.dirv[1]) * k;
    const len = Math.hypot(f.dirv[0], f.dirv[1]) || 1;
    f.base = f.pts[f.hand];
    f.tip = [f.base[0] + (f.dirv[0] / len) * BLADE, f.base[1] + (f.dirv[1] / len) * BLADE];
    if (f.prevTip && dt > 0.0001) {
      const sp = Math.hypot(f.tip[0] - f.prevTip[0], f.tip[1] - f.prevTip[1]) / dt;
      f.speed += (Math.min(sp, 12000) - f.speed) * 0.5;
    }
    f.prevTip = f.tip;
    f.trail.push({ b: f.base.slice(), t: f.tip.slice(), at: now });
    while (f.trail.length && now - f.trail[0].at > 160) f.trail.shift();
  }

  // ---------- state machine ----------
  step(now) {
    const [a, b] = this.f;
    const both = a.on && b.on;

    switch (this.state) {
      case 'waiting': {
        this.banner = 'WAITING FOR PLAYERS';
        this.sub = this.cameraUp
          ? `Player 1 ${a.on ? 'ready' : 'not seen'}  |  Player 2 ${b.on ? 'ready' : 'not seen'}. Stand apart, one on each side, full body in view.`
          : 'Camera disconnected. Reconnect the camera page.';
        if (both) {
          if (!this.readySince) this.readySince = now;
          if (now - this.readySince > READY_MS) this.startCountdown(true);
        } else this.readySince = 0;
        break;
      }
      case 'countdown': {
        if (!both && this.lostFor(now) > LOST_MS) return this.pause();
        const idx = Math.floor((now - this.stateAt) / STEP_MS);
        if (idx !== this.cdIdx && idx < STEPS.length) {
          this.cdIdx = idx;
          this.banner = STEPS[idx];
          this.sub = '';
          this.ev.say && this.ev.say(SAY[idx]);
        }
        if (idx >= STEPS.length) { this.banner = ''; this.setState('fight'); }
        break;
      }
      case 'fight': {
        if (!both && this.lostFor(now) > LOST_MS) return this.pause();
        this.combat(now);
        break;
      }
      case 'paused': {
        this.banner = 'PAUSED';
        this.sub = this.cameraUp ? 'A player left the frame. Step back in to continue.' : 'Camera disconnected.';
        if (both) this.startCountdown(false);
        break;
      }
      case 'roundover': {
        this.banner = `PLAYER ${this.winner} WINS THE ROUND`;
        this.sub = `${a.wins} - ${b.wins}`;
        if (now - this.stateAt > 3500) this.startCountdown(true);
        break;
      }
      case 'matchover': {
        this.banner = `PLAYER ${this.winner} WINS THE MATCH`;
        this.sub = `${a.wins} - ${b.wins}`;
        if (now - this.stateAt > 5500) {
          a.wins = b.wins = 0;
          this.startCountdown(true);
        }
        break;
      }
    }
  }

  lostFor(now) {
    if (!this.lostSince) this.lostSince = now;
    return now - this.lostSince;
  }

  startCountdown(resetHp) {
    if (resetHp) for (const f of this.f) f.hp = 100;
    this.lostSince = 0;
    this.readySince = 0;
    this.cdIdx = -1;
    this.setState('countdown');
  }

  pause() {
    this.lostSince = 0;
    this.setState('paused');
  }

  // ---------- combat ----------
  combat(now) {
    const [a, b] = this.f;
    if (a.on && b.on) this.lostSince = 0;

    for (const f of this.f) {
      if (f.on && f.speed > SLASH_SPEED && now - f.lastSlash > SLASH_COOLDOWN) {
        f.lastSlash = now;
        f.slashUntil = now + SLASH_MS;
        this.ev.slash && this.ev.slash(f);
      }
    }
    if (!(a.on && b.on)) return;

    const aAct = now < a.slashUntil, bAct = now < b.slashUntil;
    if (now > this.clashCd && (aAct || bAct) && segDist(a.base, a.tip, b.base, b.tip) < CLASH_RADIUS) {
      const p = contactPoint(a.base, a.tip, b.base, b.tip);
      this.clashCd = now + 450;
      a.slashUntil = b.slashUntil = 0;
      a.hitCd = b.hitCd = now + 300;
      a.x -= 45; b.x += 45;
      this.shakeUntil = now + 180;
      this.spawnSparks(p[0], p[1], 28, '#ffe9a8');
      this.ev.clash && this.ev.clash(p[0], p[1]);
      return;
    }

    for (const [att, def] of [[a, b], [b, a]]) {
      if (now >= att.slashUntil || now < att.hitCd) continue;
      const p = this.bladeHits(att, def);
      if (!p) continue;
      def.hp = Math.max(0, def.hp - HIT_DAMAGE - (att.speed > 3500 ? 6 : 0));
      att.hitCd = now + HIT_COOLDOWN;
      def.flashUntil = now + 200;
      def.x += def.x > att.x ? 50 : -50;
      this.shakeUntil = now + 140;
      this.spawnSparks(p[0], p[1], 16, '#ff7a7a');
      this.ev.hit && this.ev.hit(def);
      if (def.hp <= 0) this.endRound(att);
      return;
    }
  }

  bladeHits(att, def) {
    const h = def.pts[0];
    if (ptSeg(h[0], h[1], att.base[0], att.base[1], att.tip[0], att.tip[1]) < HEAD_RADIUS) return h;
    for (const [i, j] of BONES) {
      if (segDist(att.base, att.tip, def.pts[i], def.pts[j]) < HIT_RADIUS) {
        return contactPoint(att.base, att.tip, def.pts[i], def.pts[j]);
      }
    }
    return null;
  }

  endRound(winner) {
    this.winner = winner.id;
    winner.wins++;
    this.ev.ko && this.ev.ko();
    const match = winner.wins >= ROUNDS_TO_WIN;
    this.ev.say && this.ev.say(match ? `Player ${winner.id} wins the match` : `Player ${winner.id} wins`);
    this.setState(match ? 'matchover' : 'roundover');
  }

  // ---------- particles ----------
  spawnSparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 150 + Math.random() * 650;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 150, life: 0.3 + Math.random() * 0.4, max: 0.7, color });
    }
  }

  updateSparks(dt) {
    for (const p of this.sparks) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
  }
}
