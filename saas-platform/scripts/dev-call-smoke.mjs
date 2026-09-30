/**
 * DEV-ONLY smoke test — simulates a Plivo media-stream call against the local
 * dev server WITHOUT touching the database (no customerPhone param).
 *
 * Scenario timeline:
 *   0.0s  connect + start event
 *   0-2s  silence (agent should speak the opening)
 *   2-3.2s "speech" burst (noise — local VAD should fire USER_SPEAKING)
 *   3.2-9s silence (agent should reply / stay quiet, keep listening)
 *   9-10s "speech" burst
 *   10-24s LONG silence (quiet-caller reprompt may fire; call must NOT end)
 *
 * PASS criteria: server keeps the WS open for the full run and sends >=2
 * audio bursts back (opening + at least one reply/reprompt).
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

function frame(kind) {
  // 160 samples = 20ms @ 8kHz
  const buf = Buffer.alloc(160);
  for (let i = 0; i < 160; i++) {
    buf[i] = kind === 'speech' ? pcmToMuLaw(Math.round((Math.random() * 2 - 1) * 9000)) : silenceByte;
  }
  return buf.toString('base64');
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
    const speaking =
      (t >= 2000 && t < 3200) || (t >= 9000 && t < 10000);
    ws.send(JSON.stringify({
      event: 'media',
      media: { payload: frame(speaking ? 'speech' : 'silence'), timestamp: String(t) },
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
