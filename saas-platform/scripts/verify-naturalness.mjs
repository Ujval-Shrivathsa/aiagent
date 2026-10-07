/**
 * INTEGRATION verification for the conversational-naturalness layer.
 *
 * The unit suite proves each helper in isolation. This script proves the pieces
 * still agree with each other when they are wired the way the ENGINE wires them,
 * across several SIMULATED calls — which is the closest thing to a live call an
 * agent can run, because the engine itself needs a WebSocket and a handset.
 *
 * What it proves:
 *   1. CROSS-CALL variation is real. Two different callers do not both open with
 *      the same beat. (This is the bug the unit tests could not see: a fresh
 *      no-repeat guard always returns element 0, so the set varied the repair
 *      and never the first thing the caller hears.)
 *   2. WITHIN a call, no phrase is ever repeated while the pool lasts.
 *   3. Every phrase that could reach a caller passes the SAFETY gate — most
 *      importantly, none of them trips hasThanksClosing, which is the engine's
 *      end-of-call trigger.
 *   4. The beat CARRIES THE NAME with the right honorific.
 *   5. Pinned business content is untouched: substitute the beat out of two
 *      nudges and the remainder must be byte-identical.
 *   6. The tone layer only ever shortens or simplifies — never grants a claim,
 *      never licences warmth, never reintroduces energy mirroring.
 *   7. Telemetry counts a whole simulated call correctly and carries no
 *      personal data.
 *
 * Run: npx tsx scripts/verify-naturalness.mjs
 *
 * It MUST run under tsx, not plain node: conversation-naturalness.ts imports its
 * siblings bundle-style (`./kannada-script`, no extension), which is what Next
 * and tsconfig resolve and what Node's native type stripping does not. Plain
 * `node` fails with ERR_MODULE_NOT_FOUND — that is a runner problem, not a
 * finding, and changing the import to add `.ts` would break the app build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const nat = await load('src/voice/conversation-naturalness.ts');
const kn = await load('src/voice/kannada-script.ts');
const tel = await load('src/voice/call-telemetry.ts');

/**
 * One simulated call. Mirrors `nextAckWord()` in logic.ts exactly: a fresh
 * no-repeat guard, the pool rotated by this call's opaque id, one phrase drawn
 * per beat.
 */
function simulateCall(callUuid, beats) {
  const callId = tel.opaqueCallId(callUuid);
  let guard = nat.createRecentSpoken(4);
  const spoken = [];
  for (let i = 0; i < beats; i += 1) {
    const pool = nat.acknowledgementPoolFor(nat.acknowledgementSeed(callId));
    const chosen = nat.pickUnspoken(guard, (v) => v, pool);
    guard = chosen.guard;
    spoken.push(chosen.pick);
  }
  return { callId, spoken };
}

const CALLS = [
  '5f1d0a11-1111-4a11-8a11-000000000001',
  '5f1d0a11-2222-4a22-8a22-000000000002',
  '5f1d0a11-3333-4a33-8a33-000000000003',
  '5f1d0a11-4444-4a44-8a44-000000000004',
  '5f1d0a11-5555-4a55-8a55-000000000005',
];

console.log('=== 1. CROSS-CALL: two callers must not open with the same beat ===');
{
  const sims = CALLS.map((u) => simulateCall(u, 3));
  // Referred to by index so this report never leaks a call identifier.
  sims.forEach((s, i) => console.log(`  call ${i + 1}: ${s.spoken.join(' → ')}`));
  const openings = new Set(sims.map((s) => s.spoken[0]));
  check(
    'the opening beat differs across calls',
    openings.size >= 2,
    `${openings.size} distinct openings across ${sims.length} calls`,
  );
  check(
    'the opening beat is reproducible for the same call',
    simulateCall(CALLS[0], 3).spoken[0] === sims[0].spoken[0],
    'same call id must give the same beat — a live call has to be reproducible',
  );
}

console.log('\n=== 2. WITHIN A CALL: no phrase repeated while the pool lasts ===');
{
  const poolSize = nat.ACK_VARIANTS_KN.length;
  for (const uuid of CALLS) {
    const { spoken } = simulateCall(uuid, poolSize);
    check(
      `${poolSize} beats, ${new Set(spoken).size} distinct`,
      new Set(spoken).size === poolSize,
      spoken.join(' → '),
    );
  }
}

console.log('\n=== 3. SAFETY: no phrase can ever end the call by accident ===');
{
  const unsafe = [];
  for (const v of nat.ACK_VARIANTS_KN) {
    if (kn.hasThanksClosing(v.text)) unsafe.push(`${v.text} (trips hasThanksClosing)`);
    if (!nat.isSafeAcknowledgement(v.text)) unsafe.push(`${v.text} (fails isSafeAcknowledgement)`);
    if (v.text.split(/\s+/).length > nat.ACK_MAX_WORDS) unsafe.push(`${v.text} (too long)`);
  }
  check(
    `all ${nat.ACK_VARIANTS_KN.length} phrases are short and thanks-free`,
    unsafe.length === 0,
    unsafe.join('; '),
  );
  // The guard must actually be load-bearing: prove it rejects the real threat.
  check(
    'the gate rejects the real end-of-call word',
    !nat.isSafeAcknowledgement('ಧನ್ಯವಾದ ಸರ್') && kn.hasThanksClosing('ಧನ್ಯವಾದ'),
    'ಧನ್ಯವಾದ must never be usable as an acknowledgement',
  );
  check(
    "the owner's default is still the landing spot",
    nat.DEFAULT_ACK_WORD_KN === 'ಸರ್ತಿ' && nat.ACK_VARIANTS_KN[0].text === 'ಸರ್ತಿ',
  );
  check(
    'the rollback switch pins the original single word',
    nat.chooseAcknowledgement({ kind: 'recognition', legacyOnly: true }) === 'ಸರ್ತಿ' &&
      nat.chooseAcknowledgement({ variantIndex: 3, legacyOnly: true }) === 'ಸರ್ತಿ',
  );
}

console.log('\n=== 4. The beat carries the name, with the right honorific ===');
{
  const sir = nat.acknowledgementWithName('ಸರ್ತಿ', 'Ravi');
  const maam = nat.acknowledgementWithName('ಸರ್ತಿ', 'Lakshmi');
  check('a male name gets ಸರ್', sir.endsWith(kn.HONORIFIC_SIR_KN), sir);
  check('a female name gets ಮಾಮ್', maam.endsWith(kn.HONORIFIC_MAAM_KN), maam);
  check(
    'with no name it still says something, never an empty beat',
    nat.acknowledgementWithName('ಸರ್ತಿ', null).trim().length > 'ಸರ್ತಿ'.length,
  );
  check(
    'the whole named beat stays a beat, not a sentence',
    [sir, maam].every((s) => s.split(/\s+/).length <= nat.ACK_MAX_WORDS + 1),
    sir,
  );
}

console.log('\n=== 5. Pinned business content survives a different beat ===');
{
  const ackA = nat.ACK_VARIANTS_KN[0].text;
  const ackB = nat.ACK_VARIANTS_KN[2].text;
  const a = kn.buildOutboundProjectsNudge('Ravi', kn.HONORIFIC_SIR_KN, ackA);
  const b = kn.buildOutboundProjectsNudge('Ravi', kn.HONORIFIC_SIR_KN, ackB);
  const strip = (msg, ack) => msg.replaceAll(ack, 'THE-BEAT');
  check('the two beats really do differ', a !== b);
  check(
    'everything except the beat is byte-identical',
    strip(a, ackA) === strip(b, ackB),
    'the areas substance, the interest question, the honorific and both bans must not move',
  );
  check(
    'the default path still pins the owner word',
    kn.buildOutboundProjectsNudge('Ravi', kn.HONORIFIC_SIR_KN).includes(`"${ackA}"`),
  );
}

console.log('\n=== 6. Tone strategy may shorten, never escalate ===');
{
  const signals = [
    'busy',
    'annoyed',
    'confused',
    'short_answer',
    'long_answer',
    'hesitant',
    'interested',
    'uninterested',
  ];
  const problems = [];
  for (const s of signals) {
    const d = nat.buildToneDirective(s);
    if (!d.startsWith('SYSTEM (internal):')) problems.push(`${s}: not a private directive`);
    if (/thank/i.test(d)) problems.push(`${s}: mentions thanks — that word ends the call`);
    if (/you may (offer|quote|discount|negotiate|promise)/i.test(d)) {
      problems.push(`${s}: licenses a new claim`);
    }
    if (/(?:be|sound|get|become)\s+(?:warmer|brighter|more engaged)/i.test(d) && s !== 'interested') {
      problems.push(`${s}: grants warmth it should not`);
    }
    if (/vary your rhythm|if the caller sounds (tired|pleased)/i.test(d)) {
      problems.push(`${s}: reintroduces energy mirroring`);
    }
  }
  check(`all ${signals.length} directives are private, claim-free and non-mirroring`, problems.length === 0, problems.join('; '));
  check('a neutral caller gets no extra prompt noise', nat.buildToneDirective('neutral') === '');
  check(
    'a caller declining is never merely "confused"',
    nat.detectCallerSignal('not interested, what is the rate anyway') === 'uninterested',
    'a decline must close the call, not trigger a re-explanation',
  );
}

console.log('\n=== 7. Telemetry counts a whole call and carries no personal data ===');
{
  let t = tel.createCallTelemetry(tel.opaqueCallId(CALLS[0]), 0);
  t = tel.recordCallerSpeechEnd(t, 1_000, 800);
  t = tel.recordRepair(t);
  t = tel.recordBargeIn(t, 120);
  t = tel.recordBargeIn(t, 90);
  t = tel.recordSilenceCheck(t);
  t = tel.recordLateReplyRescue(t);
  t = tel.recordAgentTurn(t, 400, 2_000);
  t = tel.recordEnd(t, 'thank_you_close', 30_000);
  const s = tel.summarize(t);
  check('one caller turn counted', s.callerTurns === 1);
  check('speech duration summed, not lost', s.callerSpeechMs === 800);
  check('both repairs and rescues are visible', s.repairs === 1 && s.lateRepliesRescued === 1);
  check('barge-in yield is measured', s.bargeIns === 2 && s.bargeInYieldMs.p50 === 90, `p50=${s.bargeInYieldMs.p50} p95=${s.bargeInYieldMs.p95}`);
  check('the end reason is recorded', s.endReason === 'thank_you_close' && s.durationMs === 30_000);

  const banned = ['name', 'phone', 'transcript', 'text', 'uuid', 'number', 'address'];
  const leaked = Object.keys(s).filter((k) => banned.some((b) => k.toLowerCase().includes(b)));
  check('no key could carry personal data', leaked.length === 0, leaked.join(', '));
  const payload = JSON.stringify(s);
  check(
    'the raw call UUID never appears in the payload',
    !payload.includes(CALLS[0]) && !payload.includes('5f1d0a11'),
  );
}

console.log('\n=== 8. A session restart does not lose what the caller already said ===');
{
  const mem = await load('src/voice/call-memory.ts');
  // Mid-call state: they said yes, gave a name, and asked about Hunsur.
  let m = mem.createCallMemory();
  m = mem.rememberCallerLine(m, 'ಹೌದು, ಸೈಟ್ ನೋಡ್ತಿದ್ದೀನಿ');
  m = mem.setKnownCaller(m, { name: 'ರವಿ', honorific: 'ಸರ್' });
  m = mem.rememberCallerLine(m, 'ಹುಣಸೂರು ಕಡೆ ನೋಡ್ತಿದ್ದೀನಿ');
  m = mem.rememberAgentLine(m, 'ನಿಮ್ಮ ಹೆಸರು ಏನು?');
  m = mem.setCallStep(m, 'projects');
  const recall = mem.buildRecallContext(m);
  check("the caller's own words survive the restart", recall.includes('ಹುಣಸೂರು'));
  check(
    'the name is carried and never asked for again',
    recall.includes('ರವಿ ಸರ್') && recall.includes('never ask for the name again'),
  );
  check(
    "the agent's own last line is carried so it cannot be said twice",
    recall.includes('ನಿಮ್ಮ ಹೆಸರು ಏನು?'),
  );
  check(
    'an internal directive can never be laundered into the conversation',
    mem.rememberCallerLine(mem.createCallMemory(), 'SYSTEM (internal): do x').callerLines.length === 0,
  );
  check(
    'nothing remembered means nothing injected',
    mem.buildRecallContext(mem.createCallMemory()) === '',
  );

  // The unit suite proves the block; only the source proves the ENGINE calls it.
  const logic = fs.readFileSync(path.join(root, 'src/voice/logic.ts'), 'utf8');
  check(
    'logic.ts remembers every caller transcript',
    logic.includes('callMemory = rememberCallerLine(callMemory, userText);'),
  );
  check(
    "logic.ts remembers the agent's own spoken line",
    logic.includes('callMemory = rememberAgentLine(callMemory, spoken);'),
  );
  check(
    'logic.ts injects the recall into a FRESH session on reconnect',
    /injectSilentContext\(recall, 'RECALL'\)/.test(logic),
  );
  check(
    'the recall is only injected when there is something to recall',
    /const recall = buildRecallContext\(callMemory\);\s*\n\s*if \(recall\) \{/.test(logic),
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
