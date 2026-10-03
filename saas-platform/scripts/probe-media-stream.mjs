/**
 * Does Render's /media-stream accept the Plivo websocket at all?
 *
 * The live call ended 2s after answer with hangup cause "End Of XML
 * Instructions", which is what Plivo reports when the <Stream> instruction
 * finishes immediately — i.e. the websocket never held. This isolates that
 * from everything else by connecting exactly as Plivo would.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const env = {};
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 1) continue;
  const k = line.slice(0, i).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || v.startsWith("'")) v = v.slice(1, -1);
  env[k] = v;
}
const BASE = (env.VOICE_SERVER_URL || '').replace(/\/$/, '');
const url = `${BASE.replace(/^http/, 'ws')}/media-stream?isOutbound=true&customerName=Probe&customerPhone=%2B919000000000`;

console.log(`connecting: ${url}`);
const ws = new WebSocket(url);
let gotStart = false;
const timer = setTimeout(() => {
  console.log('TIMEOUT: no start event in 20s');
  ws.close();
  process.exit(1);
}, 20000);

ws.on('open', () => {
  console.log('OPEN — websocket accepted');
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
      extra_headers: 'isOutbound=true;customerName=Probe;customerPhone=%2B919000000000',
    }),
  );
});

ws.on('message', (d) => {
  const s = String(d);
  if (!gotStart) {
    gotStart = true;
    clearTimeout(timer);
    console.log('SERVER RESPONDED — the <Stream> instruction would hold.');
    console.log(`  first message: ${s.slice(0, 160)}`);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => {
  clearTimeout(timer);
  console.log('WEBSOCKET ERROR:', e.message);
  process.exit(1);
});

ws.on('close', (code, r) => {
  if (gotStart) return;
  clearTimeout(timer);
  console.log(`CLOSED early code=${code} reason=${r?.toString()}`);
  process.exit(1);
});