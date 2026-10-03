/**
 * HANGUP MECHANISM PROBE — finds HOW a Plivo call can actually be ended.
 *
 * Two real calls, both to a number the owner explicitly authorised, and both
 * agent-free so nothing in our own engine can influence the result.
 *
 *   PROBE A — "reference": the answer_url IS the <Hangup/> endpoint. Plivo
 *     answers, executes the XML, ends the leg. This tells us what
 *     hangup_source Plivo reports when PLIVO ends the call. That value was
 *     unknown, which is why the live test's "Callee" could not be interpreted:
 *     it may mean "the API hangup never fired" OR "Plivo reports its own API
 *     hangup as Callee on an outbound leg".
 *
 *   PROBE B — "production path": answer_url is the real agent endpoint, and
 *     after the call is answered we POST {aleg_url} exactly as
 *     hangupCallLegViaPlivoApi() does. If the leg does not die we escalate to
 *     the other documented spellings (aleg_method, then DELETE) so the probe
 *     also DISCOVERS which mechanism actually works, instead of only
 *     confirming or denying one guess.
 *
 * Usage: node scripts/probe-hangup-api.mjs <number> [secondsPerProbe]
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

let TO = (process.argv[2] || '').replace(/\D/g, '');
if (TO.length === 10) TO = `+91${TO}`;
const PER_PROBE_SECONDS = Number(process.argv[3] || 45);

const auth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');

async function api(method, path_, body) {
  const res = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID}/${path_}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hangupXmlUrl = `${BASE}/api/plivo/hangup`;

async function placeCall(answerUrl) {
  const created = await api('POST', 'Call/', {
    from: FROM,
    to: TO,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: `${BASE}/api/plivo/status`,
    hangup_method: 'POST',
  });
  if (!created.ok) throw new Error(`Plivo refused the call: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.request_uuid || created.body.uuid || created.body.call_uuid;
}

async function readCdr(uuid) {
  const detail = await api('GET', `Call/${uuid}/`);
  return detail.body || {};
}

/** Wait until the CDR shows the call was answered (or the budget runs out). */
async function waitForAnswer(uuid, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const c = await readCdr(uuid);
    if (c.answer_time) return c;
    if (c.end_time) return c;
    await sleep(1500);
  }
  return await readCdr(uuid);
}

/** Poll the CDR until it records an end_time, or the budget runs out. */
async function waitForEnd(uuid, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const c = await readCdr(uuid);
    if (c.end_time) return c;
    await sleep(1500);
  }
  return await readCdr(uuid);
}

function report(label, cdr, note) {
  console.log('');
  console.log(`=== ${label} ===`);
  console.log(`  answer_time      : ${cdr.answer_time ?? '-'}`);
  console.log(`  end_time         : ${cdr.end_time ?? '-'}`);
  console.log(`  call_duration    : ${cdr.call_duration ?? '-'}s`);
  console.log(`  hangup_source    : ${cdr.hangup_source ?? '-'}`);
  console.log(`  hangup_cause     : ${cdr.hangup_cause_code ?? '-'} ${cdr.hangup_cause_name ?? '-'}`);
  if (note) console.log(`  note             : ${note}`);
  return Boolean(cdr.end_time);
}

const results = {};

// ---------------------------------------------------------------------------
// PROBE A — reference value: Plivo ends the call itself.
// ---------------------------------------------------------------------------
console.log(`PROBE A: answer_url = the <Hangup/> endpoint itself.`);
console.log(`  to : ${TO}`);
const uuidA = await placeCall(hangupXmlUrl);
console.log(`  uuid: ${uuidA}`);
console.log(`  (your phone will ring very briefly)`);
const cdrA = await waitForEnd(uuidA, PER_PROBE_SECONDS);
results.reference = cdrA.end_time ? cdrA.hangup_source : '(call never ended)';
report('PROBE A — Plivo ends the call', cdrA, 'this is the hangup_source Plivo reports for ITS OWN hangup');

// ---------------------------------------------------------------------------
// PROBE B — the production path, with escalation to discover what works.
// ---------------------------------------------------------------------------
console.log('');
console.log(`PROBE B: real agent answer_url, then a mid-call Hangup API call.`);
console.log(`  to : ${TO}`);
const agentUrl = `${BASE}/api/plivo/outbound?customerName=Probe&customerPhone=${encodeURIComponent(TO)}`;
const uuidB = await placeCall(agentUrl);
console.log(`  uuid: ${uuidB}`);
console.log(`  (answer if it rings; you do not need to say anything)`);
const answered = await waitForAnswer(uuidB, PER_PROBE_SECONDS);
if (!answered.answer_time) {
  console.log('  call was never answered — cannot test a mid-call hangup.');
} else {
  // Answered. Give the agent a moment, then try the production hangup exactly
  // as hangupCallLegViaPlivoApi() does.
  await sleep(8000);

  const attempts = [
    {
      name: 'POST {aleg_url}',
      run: async () => {
        const r = await api('POST', `Call/${uuidB}/`, { aleg_url: hangupXmlUrl });
        console.log(`  [${r.name}] status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        return r;
      },
    },
  ];

  let ended = false;
  let usedMechanism = null;
  for (const attempt of attempts) {
    if (ended) break;
    console.log('');
    console.log(`  trying ${attempt.name} ...`);
    await attempt.run();
    const cdr = await waitForEnd(uuidB, 12);
    if (cdr.end_time) {
      ended = true;
      usedMechanism = attempt.name;
      break;
    }
    console.log(`  ...still open after ${attempt.name}`);
  }

  if (!ended) {
    // Escalate: the other spellings Plivo accepts, so the probe DISCOVERS the
    // mechanism rather than just confirming one guess.
    const escalations = [
      {
        name: 'POST {aleg_url, aleg_method:GET}',
        run: () => api('POST', `Call/${uuidB}/`, { aleg_url: hangupXmlUrl, aleg_method: 'GET' }),
      },
      { name: 'DELETE /Call/{uuid}/', run: () => api('DELETE', `Call/${uuidB}/`) },
    ];
    for (const esc of escalations) {
      if (ended) break;
      console.log(`  escalating to ${esc.name} ...`);
      const r = await esc.run();
      console.log(`  [${esc.name}] status=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      const cdr = await waitForEnd(uuidB, 12);
      if (cdr.end_time) {
        ended = true;
        usedMechanism = esc.name;
        break;
      }
      console.log(`  ...still open after ${esc.name}`);
    }
  }

  const cdrB = await readCdr(uuidB);
  results.midcall = cdrB.end_time ? cdrB.hangup_source : '(call never ended)';
  results.mechanism = usedMechanism || '(none of them worked)';
  report('PROBE B — mid-call API hangup', cdrB, `mechanism that worked: ${results.mechanism}`);
}

console.log('');
console.log('=== SUMMARY ===');
console.log(`  hangup_source when PLIVO ends the call : ${results.reference}`);
console.log(`  hangup_source after a mid-call API hangup: ${results.midcall}`);
console.log(`  mechanism that actually ends the leg   : ${results.mechanism}`);
console.log('');
if (results.midcall && results.midcall !== '(call never ended)') {
  console.log('The agent\'s pass condition should therefore be:');
  console.log(`  hangup_source === "${results.midcall}"   (NOT "Callee")`);
}
process.exit(0);