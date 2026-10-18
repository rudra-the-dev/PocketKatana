// Run with: npm test   (no dependencies, uses node:assert)
import assert from 'node:assert/strict';
import { Game, segDist } from '../public/game.js';

// geometry
assert.equal(segDist([0, 0], [10, 10], [0, 10], [10, 0]), 0, 'crossing segments have distance 0');
assert.ok(segDist([0, 0], [10, 0], [0, 5], [10, 5]) === 5, 'parallel segments');

const events = { slash: 0, clash: 0, hit: 0, ko: 0, said: [] };
const game = new Game({
  slash: () => events.slash++,
  clash: () => events.clash++,
  hit: () => events.hit++,
  ko: () => events.ko++,
  say: (t) => events.said.push(t),
});
game.cameraUp = true;

const REST = [0, -1.5, -.4, -1, .4, -1, -.5, -.5, .5, -.5, -.5, 0, .5, 0, -.2, 0, .2, 0, -.2, .95, .2, .95, -.2, 1.9, .2, 1.9];
let t = 0;
const DT = 1 / 60;

// Feed both players, optionally overriding sword wrist offset and direction.
function feed(p1 = {}, p2 = {}) {
  const mk = (id, x, o) => {
    const pts = REST.slice();
    if (o.wrist) { pts[12] = o.wrist[0]; pts[13] = o.wrist[1]; } // right wrist (index 6)
    return { p: id, on: true, x, pts, dir: o.dir || [id === 1 ? 1 : -1, 0], sh: 6 };
  };
  game.ingest({ w: [mk(1, 0.3, p1), mk(2, 0.7, p2)] }, t * 1000);
}
function run(seconds, p1, p2) {
  for (let i = 0; i < seconds / DT; i++) { t += DT; feed(p1 ? p1(i) : {}, p2 ? p2(i) : {}); game.update(DT, t * 1000); }
}

// 1) waiting -> countdown -> fight
run(0.5);
assert.equal(game.state, 'waiting');
run(2);
assert.equal(game.state, 'countdown', 'both players detected -> countdown');
run(4);
assert.equal(game.state, 'fight', 'countdown finishes');
assert.deepEqual(events.said.slice(0, 4), ['Three', 'Two', 'One', 'Fight!']);

// 2) a fast swing into the opponent's body registers a slash and a hit
run(1.2, (i) => ({ dir: [Math.cos(i * 0.5), Math.sin(i * 0.5)] }), null); // spin the P1 blade very fast
assert.ok(events.slash > 0, 'fast blade motion counts as a slash');

// 3) force a clash: blades overlapping while P1 is slashing
game.f[0].slashUntil = t * 1000 + 200;
game.f[0].base = [800, 500]; game.f[0].tip = [900, 400];
game.f[1].base = [800, 400]; game.f[1].tip = [900, 500];
const clashesBefore = events.clash; // spinning blades above may already have clashed
game.clashCd = 0;
game.combat(t * 1000);
assert.equal(events.clash, clashesBefore + 1, 'crossing blades while slashing triggers a clash');
assert.ok(game.sparks.length > 0, 'clash spawns sparks');

// 4) KO ends the round
game.f[1].hp = 1;
game.f[0].slashUntil = t * 1000 + 200;
game.f[0].hitCd = 0;
game.f[0].base = [game.f[1].pts[0][0] - 40, game.f[1].pts[0][1]];
game.f[0].tip = [game.f[1].pts[0][0] + 40, game.f[1].pts[0][1]];
game.f[1].base = [0, 0]; game.f[1].tip = [1, 1];
game.clashCd = t * 1000 + 1000;
game.combat(t * 1000);
assert.equal(game.state, 'roundover', 'hp 0 ends the round');
assert.equal(game.f[0].wins, 1);
assert.equal(events.ko, 1);

// 5) losing a player pauses the game
game.startCountdown(true);
run(4);
assert.equal(game.state, 'fight');
for (let i = 0; i < 4 / DT; i++) { t += DT; game.ingest({ w: [{ p: 1, on: false }, { p: 2, on: false }] }, t * 1000); game.update(DT, t * 1000); }
assert.equal(game.state, 'paused', 'players leaving the frame pauses the match');

console.log('game logic: all tests passed');
