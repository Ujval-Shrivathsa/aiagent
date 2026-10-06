/**
 * LOCAL OPENING VERIFICATION — no phone call.
 *
 * Connects to the LOCAL dev server's /media-stream exactly as Plivo would, so
 * the real production greeting path runs: setupGemini -> getOutboundGreetingInstruction
 * -> Gemini speaks. The model's transcript is written by the server as
 * `[LANG] AI transcript ...` in server-dev.log — that line is the proof of what
 * Priya actually SAYS first on the live flow.
 *
 * Nothing is dialled: customerPhone is a dummy number and no Plivo API is used.
 *
 * Run: npx tsx scripts/probe-local-opening.mjs
 * Then: grep "LANG\] AI transcript" server-dev.log
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const HOLD_MS = 30_000;

const env = {};
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 1) continue;
  const k = line.slice(0, i).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}

const url =
  'ws://localhost:3000/media-stream?isOutbound=true&customerName=LocalOpeningProbe' +
  '&customerPhone=%2B919000000000';

console.log(`connecting: ${url}`);
const ws = new WebSocket(url);
let frames = 0;
let opened = false;

const done = (code) => {
  console.log(`\nframes received from server: ${frames}`);
  console.log(
    `PROBE VERDICT: ${opened ? 'websocket accepted — live greeting path exercised' : 'websocket REJECTED'}`,
  );
  process.exit(code);
};

const timer = setTimeout(() => {
  console.log('hold time elapsed — closing cleanly');
  try { ws.close(); } catch {}
  done(opened ? 0 : 1);
}, HOLD_MS);

ws.on('open', () => {
  opened = true;
  console.log('OPEN — websocket accepted by the local media-stream');
  // Exactly the frame Plivo sends first.
  ws.send(
    JSON.stringify({
      event: 'start',
      start: {
        callId: '11111111-2222-3333-4444-555555555555',
        streamId: '66666666-7777-8888-9999-000000000000',
        accountId: env.PLIVO_AUTH_ID || 'MA000000000000',
        tracks: ['inbound'],
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
      },
      extra_headers: 'isOutbound=true;customerName=LocalOpeningProbe;customerPhone=%2B919000000000',
    }),
  );
  console.log('start frame sent — waiting for the model to speak the opening');
});

ws.on('message', (d) => {
  frames += 1;
  const s = String(d);
  if (frames <= 3) console.log(`frame ${frames}: ${s.slice(0, 140)}`);
});

ws.on('error', (e) => {
  clearTimeout(timer);
  console.log('WEBSOCKET ERROR:', e.message);
  done(1);
});

ws.on('close', (code, r) => {
  clearTimeout(timer);
  console.log(`closed code=${code} reason=${r ? String(r) : ''}`);
  done(opened ? 0 : 1);
});
