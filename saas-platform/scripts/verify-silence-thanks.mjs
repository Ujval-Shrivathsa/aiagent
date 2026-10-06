/**
 * Walks the REAL silence ladder and the REAL post-thanks decision with a
 * simulated clock, and prints what the caller would experience. No call is
 * placed and no number is dialled — this is the timing contract the owner
 * asked for, checked against the code that runs on a live call.
 *
 *   Requested: after the agent stops speaking, ask "are you on the line" at 5s
 *   and again 5s later, then end the call. End the call 1 second after the
 *   thank-you, having said the thank-you IN FULL.
 *
 * Run: npx tsx scripts/verify-silence-thanks.mjs
 *
 * Exits non-zero when either verdict is FAIL. It did not always: the verdicts
 * were printed and the process still exited 0, so a broken silence ladder read
 * as a green result to any human or CI that chained on the exit status.
 */
import {
  armOutboundSilenceCheck,
  tickOutboundSilence,
  resetOutboundSilence,
  SILENCE_CHECKS_MAX,
  SILENCE_CHECK_AFTER_MS,
  SILENCE_CHECK_REPEAT_AFTER_MS,
  SILENCE_CLOSE_AFTER_CHECK_MS,
  SILENCE_CHECK_LINE_KN,
  postThanksHangupAction,
  OUTBOUND_THANKS_AUDIO_SETTLE_MS,
  OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS,
  OUTBOUND_END_AFTER_THANKS_MS,
} from '../src/voice/kannada-script.ts';

const CHECK_LINE_MS = 3_000; // how long the check line takes to speak
const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;

// A verdict that does not change the exit code is a verdict nothing can act on.
let verdictFailures = 0;
const verdict = (ok, text) => {
  console.log(`\n  VERDICT: ${ok ? 'PASS' : 'FAIL'} — ${text}`);
  if (!ok) verdictFailures += 1;
};

// ---------------------------------------------------------------------------
// 1. The silence ladder. The agent's turn ends at t=0; the engine re-arms the
//    ladder after EVERY agent turn, including the check lines' own turns.
// ---------------------------------------------------------------------------
console.log('=== the caller goes quiet after the agent stops speaking ===');
console.log(`check line: "${SILENCE_CHECK_LINE_KN}"`);
console.log(
  `windows: first check ${sec(SILENCE_CHECK_AFTER_MS)}, repeat ${sec(
    SILENCE_CHECK_REPEAT_AFTER_MS,
  )}, then end ${sec(SILENCE_CLOSE_AFTER_CHECK_MS)} (max ${SILENCE_CHECKS_MAX} checks)\n`,
);

let state = armOutboundSilenceCheck(0);
let checks = 0;
const events = [];

for (let step = 0; step < 12; step++) {
  const fireAt = state.deadline;
  if (fireAt == null) break;
  // The engine's scheduler fires at the deadline; nudge just past it.
  const tick = tickOutboundSilence(state, fireAt + 20);
  if (tick.action === 'none') break;
  state = tick.state;
  if (tick.action === 'speak_check') {
    checks++;
    events.push({ t: fireAt, kind: 'check', n: checks });
    // The check line's own turn takes ~3s to speak, and only then does the
    // engine re-arm the ladder with the count carried through.
    state = armOutboundSilenceCheck(fireAt + CHECK_LINE_MS, state.checksSpoken);
  } else {
    events.push({ t: fireAt, kind: 'close' });
    break;
  }
}

for (const e of events) {
  const what =
    e.kind === 'check'
      ? `SAYS: "${SILENCE_CHECK_LINE_KN}"  (check #${e.n})`
      : 'SAYS: goodbye line, then the call ENDS';
  console.log(`  t=${sec(e.t).padStart(5)}  ${what}`);
}

const checkTimes = events.filter((e) => e.kind === 'check').map((e) => e.t);
const closeTime = events.find((e) => e.kind === 'close')?.t ?? null;
console.log(`\n  checks said: ${checkTimes.length} (expected ${SILENCE_CHECKS_MAX})`);
console.log(`  first check at ${sec(checkTimes[0] ?? 0)}, second at ${sec(checkTimes[1] ?? 0)}`);
console.log(`  call ends at ${closeTime != null ? sec(closeTime) : '?'} of silence`);
console.log(
  '  note: the second check is 5s AFTER the first one has finished speaking, so she\n' +
    '        never starts the second check over the top of the one still playing',
);

const ok =
  checkTimes.length === SILENCE_CHECKS_MAX &&
  checkTimes[0] >= SILENCE_CHECK_AFTER_MS - 100 &&
  checkTimes[0] <= SILENCE_CHECK_AFTER_MS + 200 &&
  checkTimes[1] - checkTimes[0] >= SILENCE_CHECK_REPEAT_AFTER_MS &&
  closeTime != null &&
  closeTime - checkTimes[1] >= SILENCE_CLOSE_AFTER_CHECK_MS;
verdict(ok, 'two checks, then a goodbye, then the line ends');

// Caller speech resets everything: a later quiet spell gets both checks again.
const reset = resetOutboundSilence();
const refired = tickOutboundSilence(armOutboundSilenceCheck(60_000), 65_100);
console.log(
  `  after the caller speaks: reason=${reset.reason} checksSpoken=${reset.checksSpoken}; ` +
    `a later quiet spell checks again -> ${refired.action}`,
);

// ---------------------------------------------------------------------------
// 2. The thank-you: 1 second AFTER the audio has finished.
//    Streams a realistic 20ms-chunk thank-you and asks the real decision
//    function at every step, exactly the way the engine does.
// ---------------------------------------------------------------------------
console.log('\n=== the thank-you is played in full, then the call ends 1s later ===');
const CHUNK_MS = 20;
const CHUNKS = 150; // ~3s of speech
let playbackEndsAt = 0;
let lastAudioAt = 0;
let clock = 0;
let hungUpAt = null;
const waitDeadline = clock + OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS;

for (let i = 0; i < CHUNKS; i++) {
  playbackEndsAt = Math.max(clock, playbackEndsAt) + CHUNK_MS;
  lastAudioAt = clock;
  clock += CHUNK_MS;
  const d = postThanksHangupAction({ playbackEndsAt, lastAudioAt, now: clock, waitDeadline });
  if (d.action === 'hangup') {
    hungUpAt = clock + d.retryInMs;
    break;
  }
}

if (hungUpAt === null) {
  // Stream finished; the engine keeps re-checking until the audio settles.
  for (let extra = 0; extra < 200 && hungUpAt === null; extra++) {
    const d = postThanksHangupAction({ playbackEndsAt, lastAudioAt, now: clock, waitDeadline });
    if (d.action === 'hangup') hungUpAt = clock + d.retryInMs;
    else clock += d.retryInMs;
  }
}

console.log(`  thank-you audio: ${CHUNKS} x ${CHUNK_MS}ms = ${sec(CHUNKS * CHUNK_MS)} of speech`);
console.log(`  last audio chunk arrived at t=${sec(lastAudioAt)}`);
console.log(`  settle window before the 1s clock may start: ${OUTBOUND_THANKS_AUDIO_SETTLE_MS}ms`);
console.log(`  call ends at t=${sec(hungUpAt ?? 0)} (the 1s the owner asked for = ${OUTBOUND_END_AFTER_THANKS_MS}ms)`);
const afterAudio = (hungUpAt ?? 0) - lastAudioAt;
console.log(`  time from the end of the audio to hanging up: ${afterAudio}ms`);
const thanksOk = hungUpAt !== null && afterAudio >= OUTBOUND_END_AFTER_THANKS_MS;
verdict(thanksOk, 'the whole thank-you played, then a full second, then the line dropped');

// Safety: a stream that never settles must not hold the call open forever.
const stuck = postThanksHangupAction({
  playbackEndsAt: 0,
  lastAudioAt: 0,
  now: OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS + 1,
  waitDeadline: OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS,
});
console.log(
  `  safety: audio that never arrives is capped at ${OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS}ms -> ${stuck.action}`,
);
const noAudioYet = postThanksHangupAction({
  playbackEndsAt: 0,
  lastAudioAt: 0,
  now: 10,
  waitDeadline: 10_000,
});
console.log(`  safety: with no audio at all it waits, it never hangs up -> ${noAudioYet.action}`);

console.log(
  verdictFailures === 0
    ? '\nALL VERDICTS PASSED'
    : `\n${verdictFailures} VERDICT(S) FAILED`,
);
process.exit(verdictFailures === 0 ? 0 : 1);
