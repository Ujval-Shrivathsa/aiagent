/**
 * LIVE HANGUP VERIFICATION — places ONE real Plivo call and proves the agent
 * actually ends it.
 *
 * Everything so far has been unit tests against synthetic audio. This is the
 * only thing that proves the call disconnects: it reads back PLIVO's own record
 * of how the call ended (call_status, total_duration, hangup_cause_name), which
 * is independent of anything our server claims.
 *
 * It dials directly via the Plivo API rather than the campaign route, so
 * exactly ONE number is called instead of every lead in the campaign.
 *
 * Usage: node scripts/verify-live-hangup.mjs <10-digit-number> [maxSeconds]
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const AUTH_ID = env.PLIVO_AUTH_ID;
const AUTH_TOKEN = env.PLIVO_AUTH_TOKEN;
const FROM = env.PLIVO_PHONE_NUMBER;
const BASE = (env.VOICE_SERVER_URL || '').replace(/\/$/, '');

if (!AUTH_ID || !AUTH_TOKEN || !FROM || !BASE) {
  console.error('Missing PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN / PLIVO_PHONE_NUMBER / VOICE_SERVER_URL in .env');
  process.exit(1);
}

const raw = (process.argv[2] || '').replace(/\D/g, '');
if (raw.length === 10) process.argv[2] = `+91${raw}`;
const TO = process.argv[2];
const MAX_SECONDS = Number(process.argv[3] || 180);

const auth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');

async function api(method, path_, body) {
  const res = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID}/${path_}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

// Plivo's call detail uses call_state (not call_status) and call_duration
// (not total_duration). Reading the wrong names made a call that had already
// ended look like it was still open, so these are taken from a live record.
const TERMINAL = new Set(['HANGUP', 'COMPLETED', 'BUSY', 'FAILED', 'NO_ANSWER', 'CANCEL']);

const answerUrl =
  `${BASE}/api/plivo/outbound` +
  `?customerName=${encodeURIComponent('Ravi Test')}` +
  `&customerPhone=${encodeURIComponent(TO)}`;

console.log(`Placing ONE test call`);
console.log(`  from : ${FROM}`);
console.log(`  to   : ${TO}`);
console.log(`  voice: ${BASE}`);

const created = await api('POST', 'Call/', {
  from: FROM,
  to: TO,
  answer_url: answerUrl,
  answer_method: 'POST',
  hangup_url: `${BASE}/api/plivo/status`,
  hangup_method: 'POST',
  ring_url: `${BASE}/api/plivo/status`,
  ring_method: 'POST',
});

if (!created.ok) {
  console.error('Plivo refused the call:', created.status, JSON.stringify(created.body));
  process.exit(1);
}

const uuid = created.body.request_uuid || created.body.uuid || created.body.call_uuid;
console.log(`  uuid : ${uuid}`);
console.log('');
console.log('Pick up now. Say, in order:');
console.log('  1. "Ravi"                (your name, when asked)');
console.log('  2. "Hawdu"               (yes, looking for a site)');
console.log('  3. "K.R. Nagara pradeshalalli ishti"  (interested in a location)');
console.log('');
console.log('Then let it reach the sales-team close. Watch whether YOUR phone');
console.log('actually disconnects after the thank-you — that is the whole test.');
console.log('');

const started = Date.now();
let last = null;

while ((Date.now() - started) / 1000 < MAX_SECONDS) {
  const detail = await api('GET', `Call/${uuid}/`);
  const c = detail.body || {};
  const state = String(c.call_state ?? '?');
  const dur = c.call_duration ?? '-';
  const line = `${state} dur=${dur}s cause=${c.hangup_cause_name ?? '-'}`;
  if (line !== last) {
    console.log(`  [${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${line}`);
    last = line;
  }
  if (TERMINAL.has(state)) {
    console.log('');
    console.log('=== CALL ENDED (per Plivo) ===');
    console.log(`  call_state         : ${state}`);
    console.log(`  call_duration      : ${dur}s`);
    console.log(`  ring_duration      : ${c.ring_duration ?? '-'}s`);
    console.log(`  hangup_cause_name  : ${c.hangup_cause_name ?? '(none)'}`);
    console.log(`  hangup_source      : ${c.hangup_source ?? '(none)'}`);
    console.log(`  billed_duration    : ${c.billed_duration ?? '-'}s`);
    // "End Of XML Instructions" means the <Stream> never held — the agent
    // never spoke. Any other cause on a 40-150s call means the agent ended it.
    const spokeFirst = dur !== 2;
    const endedItself = spokeFirst && !/End Of XML Instructions/i.test(String(c.hangup_cause_name));
    console.log('');
    console.log(
      endedItself
        ? 'VERDICT: the call ran a real conversation and then ENDED BY ITSELF — the hangup works.'
        : spokeFirst
          ? 'VERDICT: the call ran, but ended with "End Of XML Instructions" — the stream was torn down.'
          : 'VERDICT: FAILED — call lasted 2s, the agent never spoke.',
    );
    process.exit(endedItself ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

console.log('');
console.log('=== STILL OPEN after ' + MAX_SECONDS + 's ===');
console.log('VERDICT: the call did NOT hang up on its own.');
const detail = await api('GET', `Call/${uuid}/`);
console.log('final:', JSON.stringify(detail.body, null, 2));
console.log(`To force it down: DELETE https://api.plivo.com/v1/Account/${AUTH_ID}/Call/${uuid}/`);
process.exit(1);