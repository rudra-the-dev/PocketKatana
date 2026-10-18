// All sounds are synthesized with Web Audio, so there are no asset files to host.
let ac = null;
let out = null;
let noiseBuf = null;

// Must be called from a user gesture (the Join button) or browsers keep audio muted.
export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    out = ac.createGain();
    out.gain.value = 0.8;
    const comp = ac.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state !== 'running') ac.resume();
}

function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(t, dur, type, f0, f1, peak) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  env(g, t, 0.02, peak, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.1);
}

function tone(t, type, f0, f1, dur, peak) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  env(g, t, 0.005, peak, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function whoosh() {
  if (!ac) return;
  noise(ac.currentTime, 0.25, 'bandpass', 500, 2600, 0.5);
}

export function clang() {
  if (!ac) return;
  const t = ac.currentTime;
  [1180, 1760, 2790, 3950].forEach((f, i) => {
    tone(t, 'triangle', f * (1 + Math.random() * 0.02), f * 0.98, 0.5 - i * 0.08, 0.28 / (i + 1));
  });
  noise(t, 0.08, 'highpass', 3000, 6000, 0.5);
}

export function hit() {
  if (!ac) return;
  const t = ac.currentTime;
  tone(t, 'sine', 180, 45, 0.25, 0.9);
  noise(t, 0.12, 'lowpass', 2000, 300, 0.6);
}

export function ko() {
  if (!ac) return;
  const t = ac.currentTime;
  tone(t, 'sine', 120, 30, 0.8, 1);
  noise(t, 0.4, 'lowpass', 1500, 200, 0.6);
}

export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1;
    u.pitch = 0.8;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* speech is optional */ }
}
