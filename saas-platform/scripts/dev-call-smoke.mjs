/**
 * DEV-ONLY smoke test — simulates a Plivo media-stream call against the local
 * dev server WITHOUT touching the database (no customerPhone param).
 *
 * AUDIO DISCRIMINATION SCENARIO (speech-first pipeline validation):
 *   0.0-2s   silence (agent speaks the opening)
 *   2-6s     FAN/AC hum: steady 120Hz sine, LOW crest — must NEVER fire VAD
 *   6-10s    WHITE-NOISE bursts (keyboard/static-like): HIGH crest, flat
 *            spectrum — must NEVER fire VAD (the old rms≈5000 bug)
 *   10-11s   quiet speech-level burst — MODERATE crest, speech-shaped:
 *            this SHOULD fire VAD (the quiet-caller path)
 *   11-13.5s silence (agent may reply to the quiet burst; line stays open)
 *   13.5-15s SHORT speech burst (short-answer profile, e.g. "ಹೌದು")
 *   15-24s   silence (quiet-caller reprompt may fire; call must NOT end)
 *
 * PASS criteria:
 *   - line stays open the full run, ≥2 audio bursts back
 *     (opening + at least one reply/reprompt)
 *   - server log shows NO "[VAD] Customer speech START" during the fan and
 *     white-noise phases, and AT LEAST ONE START during the speech phases.
 *
 * Run: node scripts/dev-call-smoke.mjs
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL || 'ws://localhost:3000/media-stream';
const RUN_MS = Number(process.env.SMOKE_RUN_MS || 24_000);

// --- mu-law helpers -------------------------------------------------------
function pcmToMuLaw(sample) {
  const BIAS = 0x84, CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  let mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}
const silenceByte = pcmToMuLaw(0);

// 160 samples = 20ms @ 8kHz
function fanFrame(tSec) {
  // Steady 120Hz hum + mild harmonic — the classic AC/fan signature.
  const buf = Buffer.alloc(160);
  for (let i = 0; i < 160; i++) {
    const t = tSec + i / 8000;
    const v = 2400 * Math.sin(2 * Math.PI * 120 * t) + 700 * Math.sin(2 * Math.PI * 240 * t);
    buf[i] = pcmToMuLaw(Math.round(v));
  }
  return buf.toString('base64');
}
function whiteNoiseFrame() {
  const buf = Buffer.alloc(160);
  for (let i = 0; i < 160; i++) {
    buf[i] = pcmToMuLaw(Math.round((Math.random() * 2 - 1) * 9000));
  }
  return buf.toString('base64');
}
function speechBurstFrame(tSec, opts = {}) {
  // Speech-shaped: 180Hz glottal harmonics + formant-ish partials, periodic
  // consonant-like spikes (high crest), and syllable envelope (on/off). The
  // envelope makes it look like short bursts of speech, not steady tone.
  const amp = opts.amp ?? 3000;
  const buf = Buffer.alloc(160);
  for (let i = 0; i < 160; i++) {
    const t = tSec + i / 8000;
    const syllable = Math.sin(2 * Math.PI * 3.2 * t) > -0.15 ? 1 : 0.25;
    const spike = i % 53 < 7 ? 2.2 : 1;
    const v =
      amp * syllable * spike *
      (Math.sin(2 * Math.PI * 180 * t) +
        0.55 * Math.sin(2 * Math.PI * 700 * t) +
        0.35 * Math.sin(2 * Math.PI * 1300 * t) +
        0.12 * (Math.random() * 2 - 1));
    buf[i] = pcmToMuLaw(Math.round(v));
  }
  return buf.toString('base64');
}
function frame(payload) {
  return payload;
}

const ws = new WebSocket(URL);
let audioOutEvents = 0;
let audioOutBytes = 0;
let closedByServer = false;
let firstAudioAt = 0;

ws.on('open', () => {
  console.log('[SMOKE] connected');
  ws.send(JSON.stringify({
    event: 'start',
    start: { streamSid: 'SMOKE123', callId: 'smoke-call-1', customParameters: {} },
  }));
  const t0 = Date.now();
  const timer = setInterval(() => {
    const t = Date.now() - t0;
    let payload;
    if (t < 2000) payload = null; // silence
    else if (t < 6000) payload = fanFrame(t / 1000);
    else if (t < 10000) payload = whiteNoiseFrame();
    else if (t < 11000) payload = speechBurstFrame(t / 1000, { amp: 2200 }); // quiet speech
    else if (t < 13500) payload = null; // silence
    else if (t < 15000) payload = speechBurstFrame(t / 1000, { amp: 3200 }); // short reply
    else payload = null;
    ws.send(JSON.stringify({
      event: 'media',
      media: { payload: payload ?? Buffer.from(Buffer.alloc(160, silenceByte)).toString('base64'), timestamp: String(t) },
    }));
    if (t >= RUN_MS) {
      clearInterval(timer);
      finish();
    }
  }, 20);
});

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.event === 'playAudio' && msg.media?.payload) {
    audioOutEvents++;
    audioOutBytes += Buffer.from(msg.media.payload, 'base64').length;
    if (!firstAudioAt) firstAudioAt = Date.now();
  }
});

ws.on('close', (code) => {
  if (!finished) {
    closedByServer = true;
    finish(code);
  }
});

ws.on('error', (e) => {
  console.error('[SMOKE] ws error:', e.message);
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  try { ws.close(); } catch { /* already closed */ }
  console.log('--- SMOKE RESULT ---');
  console.log(`serverClosedEarly=${closedByServer}${code != null ? ` code=${code}` : ''}`);
  console.log(`audioOutEvents=${audioOutEvents} audioOutBytes=${audioOutBytes}`);
  // PASS = line stayed open the whole run AND the agent streamed real audio
  // (opening ~5s + replies/reprompts ⇒ well over 30KB of mu-law payload).
  const pass = !closedByServer && audioOutBytes > 30_000;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 1);
}
