# Pocket Katana

Camera-tracked 1v1 stickman sword duel. One device runs the camera (`/start`), another shows the arena (`/display`). They pair with a 4-digit code.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # game-logic tests
```

Open `http://localhost:3000/start` in one tab and `/display` in another, enter the code.

**Phones need HTTPS for the camera.** `http://192.168.x.x` will not work on a phone. Either deploy (below) or tunnel your local server: `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.

## Deploy (Render)

Push this folder to GitHub, create a Render Web Service from the repo (it reads `render.yaml`), and open the `https://` URL. Render terminates TLS, and `server.js` forces HTTPS in production.

## Files

| File | Job |
| --- | --- |
| `server.js` | Static files, room codes, pairing, relays camera state to the display |
| `public/start.html` | Camera page: MediaPipe pose + hands, player identity, sends state |
| `public/display.html`, `display.js` | Arena page: join form, rendering, sound events |
| `public/game.js` | Pure game logic (slash, clash, hit, rounds). No DOM, so it can move to a server later |
| `public/audio.js` | Synthesized sounds and announcer |
| `public/net.js` | Reconnecting WebSocket |
| `test/game.test.js` | Headless logic test |

## Tuning (all in `public/game.js`)

- `SLASH_SPEED`: blade-tip speed that counts as a slash. Lower = easier slashes.
- `HIT_DAMAGE`, `HIT_RADIUS`, `CLASH_RADIUS`: how forgiving hits and clashes are.
- `BLADE`: sword length in arena pixels.

## Before a public launch

- Self-host the two MediaPipe model files (`POSE_MODEL`, `HAND_MODEL` in `start.html`) instead of using Google's bucket.
- Test on a mid-range Android and an iPhone, with two people fighting, in normal room lighting.
- Add analytics for fps and tracking-lost events so you can see which devices struggle.
