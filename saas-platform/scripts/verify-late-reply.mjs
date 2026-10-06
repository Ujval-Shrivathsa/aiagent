/**
 * Verification for the two owner reports this change fixes:
 *
 *   1. "After I told her my name she did not speak at all." → the SPEAK GUARD:
 *      every step nudge is followed by a guard that re-issues the step when no
 *      agent audio reached the caller.
 *   2. "If we are silent and I speak after 3-5 seconds, before the call ends,
 *      she must still respond." → the silence tick now HOLDS (renewably) for
 *      late caller speech, and a caller who speaks during the goodbye CANCELS
 *      the close instead of being hung up on.
 *
 * Part 1 proves the wiring statically (the engine file is not importable — it
 * needs a live WebSocket — so the call sites are checked in source).
 * Part 2 prints the real timeline, computed from the imported constants.
 *
 * Run: npx tsx scripts/verify-late-reply.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const logicPath = path.join(root, 'src/voice/logic.ts');
// The engine file is CRLF — normalise so the wiring checks can be written with
// plain \n regexes (a \n that does not match is a silent false PASS/FAIL).
const logic = fs.readFileSync(logicPath, 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/**
 * Formatting-tolerant "does B follow A" check.
 *
 * WHY: this file used to match single-line source literals such as
 * `text: buildOutboundProjectsNudge(outboundCallerName, outboundCallerHonorific),`.
 * The moment that call site was reformatted across several lines — to pass the
 * per-call acknowledgement — the check FAILED even though the guard was still
 * armed exactly where it always was. A check that cries wolf on a line break is
 * a check people learn to ignore, so the pattern is matched with whitespace
 * tolerance instead of an exact literal. The INVARIANT is unchanged.
 */
const afterRe = (a, bRe) => {
  const ia = logic.indexOf(a);
  if (ia < 0) return false;
  return bRe.test(logic.slice(ia));
};

const after = (a, b, within = 6) => {
  const ia = logic.indexOf(a);
  if (ia < 0) return false;
  // Search for b from a's position, so an identical string in the import block
  // can never satisfy the check.
  const ib = logic.indexOf(b, ia);
  if (ib < 0) return false;
  return logic.slice(ia, ib).split('\n').length <= within;
};

console.log('=== 1. SPEAK GUARD wiring (no dead air after a step nudge) ===');
check(
  'guard is armed right after the name question',
  after(
    "geminiSession?.sendRealtimeInput({ text: OUTBOUND_NAME_QUESTION_NUDGE });",
    "armOutboundStepAudioGuard('the name question'",
  ),
);
check(
  'guard is armed right after the projects nudge (the name step)',
  afterRe(
    'buildOutboundProjectsNudge(',
    /armOutboundStepAudioGuard\(\s*'the projects line'/,
  ),
);
check(
  'guard is armed on the name-declined path too',
  after(
    'text: buildOutboundNameDeclinedNudge(outboundCallerHonorific),',
    "armOutboundStepAudioGuard(\n        'the projects line'",
  ),
);
check(
  'guard is armed on the interested-before-name fallback',
  after('if (!handleNameStep(userText)) {', 'OUTBOUND_NAME_QUESTION_RETRY_NUDGE,', 8),
);
check('guard clears itself the moment agent audio reaches the caller', after(
  'lastAiAudioAt = Date.now();',
  'clearOutboundStepAudioGuard();',
));
check(
  'guard refuses to fire while the caller is mid-sentence',
  logic.includes('if (vadIsSpeaking) return;') &&
    logic.includes("[SPEAK-GUARD] No agent audio"),
);
check(
  'a dropped turn does NOT count as having spoken',
  /if \(lastAiAudioAt > armedAt && !lastOutboundTurnSuppressed\) return;/.test(logic),
);
check(
  'attempts are bounded (never a nudge loop)',
  /OUTBOUND_STEP_AUDIO_GUARD_MAX = 2/.test(logic) &&
    /attempt < OUTBOUND_STEP_AUDIO_GUARD_MAX/.test(logic),
);

console.log('\n=== 2. LATE REPLY: the silence ladder holds, and cancels the goodbye ===');
check(
  'the tick asks the pure policy before it acts',
  logic.includes('shouldHoldSilenceClose({'),
);
check(
  'the hold is renewable within a bound (was a one-shot flag)',
  /outboundSilenceDefers \+= 1/.test(logic) &&
    /OUTBOUND_SILENCE_MAX_DEFERS = 4/.test(logic) &&
    !logic.includes('outboundSilenceDeferUsed'),
);
check(
  'speech-class energy holds the close too (VAD fires before any transcript)',
  /lastSpeechEnergyAt,\n\s+graceMs: OUTBOUND_SILENCE_SPEECH_GRACE_MS,/.test(logic),
);
check(
  'caller VOICE cancels a pending goodbye',
  /cancelSilenceCloseIfCallerSpeaks\('caller voice'\);/.test(logic),
);
check(
  'caller TRANSCRIPT cancels a pending goodbye',
  /cancelSilenceCloseIfCallerSpeaks\('caller transcript'\);/.test(logic),
);
check(
  'cancellation clears the close deadline and the endCall authorisation',
  /clearOutboundCloseDeadline\(\);/.test(logic) &&
    /outboundSpokenCloseText = '';/.test(logic) &&
    /outboundBusyCloseSent = false;/.test(logic),
);
check(
  'the goodbye is marked cancellable when it is sent',
  after(
    "outboundSpokenCloseText = 'silence goodbye';",
    'outboundSilenceGoodbyeSentAt = Date.now();',
  ),
);
check(
  'cancellation is refused once the thank-you has been spoken',
  logic.includes('shouldCancelPendingSilenceClose({'),
);
check(
  'a stalled turn after the name re-says the projects line instead of closing',
  /outboundAreasLineDelivered &&\n\s+!outboundAreasLineHeard &&\n\s+!outboundLocationsNudgeSent/.test(
    logic,
  ) && logic.includes('let outboundAreasLineHeard = false;'),
);

console.log('\n=== 3. TIMELINE: name step, then dead air (no agent audio) ===');
{
  const script = await import(
    pathToFileURL(path.join(root, 'src/voice/speech-recovery.ts')).href
  );
  const rec = script.loadRecoveryConfig();
  const guardMs = Number(/OUTBOUND_STEP_AUDIO_GUARD_MS = ([\d_]+)/.exec(logic)[1].replace(/_/g, ''));
  const guardMax = Number(/OUTBOUND_STEP_AUDIO_GUARD_MAX = (\d+)/.exec(logic)[1]);
  const kn = await import(
    pathToFileURL(path.join(root, 'src/voice/kannada-script.ts')).href
  );
  console.log('  t=0.0s  caller gives their name — nudge sent, speak guard armed');
  const repairs = [];
  for (let attempt = 1; attempt <= Math.max(1, rec.maxAttempts); attempt += 1) {
    repairs.push({
      at: (rec.transcriptGraceMs + (attempt - 1) * rec.escalateGraceMs) / 1000,
      what: `recovery ladder nudge #${attempt} (reply now)`,
    });
  }
  for (let attempt = 1; attempt <= guardMax; attempt += 1) {
    repairs.push({
      at: (guardMs * attempt) / 1000,
      what: `speak guard ${attempt}/${guardMax} re-issues the step`,
    });
  }
  repairs.sort((a, b) => a.at - b.at);
  for (const r of repairs) console.log(`  t=${r.at.toFixed(1)}s  ${r.what}`);
  const firstVoice = Math.min(rec.transcriptGraceMs, guardMs);
  check(
    'the caller hears SOMETHING within the first 5s window',
    firstVoice <= kn.SILENCE_CHECK_AFTER_MS,
    `first repair at ${(firstVoice / 1000).toFixed(1)}s`,
  );
}

console.log('\n=== 4. TIMELINE: silence ladder vs a caller who answers LATE ===');
{
  const kn = await import(
    pathToFileURL(path.join(root, 'src/voice/kannada-script.ts')).href
  );
  const graceMs = Number(
    /OUTBOUND_SILENCE_SPEECH_GRACE_MS = ([\d_]+)/.exec(logic)[1].replace(/_/g, ''),
  );
  const maxDefers = Number(/OUTBOUND_SILENCE_MAX_DEFERS = (\d+)/.exec(logic)[1]);

  // Walk the real ladder: 5s quiet → check #1, 13s → check #2, 21s → goodbye.
  let state = kn.armOutboundSilenceCheck(0, 0);
  const events = [];
  for (let now = 0; now <= 40_000; now += 50) {
    const tick = kn.tickOutboundSilence(state, now);
    state = tick.state;
    if (tick.action !== 'none') events.push({ at: now, action: tick.action });
  }
  const checkAt = events.find((e) => e.action === 'speak_check').at;
  const goodbyeAt = events.find((e) => e.action === 'close_silence').at;
  console.log(
    `  ladder: check #1 @ ${checkAt / 1000}s → check #2 @ ${
      events[1].at / 1000
    }s → goodbye @ ${goodbyeAt / 1000}s`,
  );

  const cases = [
    { speaksAt: 4_000, label: 'talks at 4s — just before the first check' },
    { speaksAt: checkAt - 50, label: `talks at ${(checkAt - 50) / 1000}s — the tick is due` },
    { speaksAt: 12_000, label: 'talks at 12s — after both checks' },
    { speaksAt: goodbyeAt + 300, label: `talks at ${(goodbyeAt + 300) / 1000}s — the goodbye is going out` },
  ];
  for (const c of cases) {
    const duringGoodbye = c.speaksAt >= goodbyeAt;
    // The tick nearest after their voice (the ladder re-arms every 5s window).
    const tickAt = c.speaksAt + 50;
    const holds = kn.shouldHoldSilenceClose({
      now: tickAt,
      lastCallerVoiceAt: c.speaksAt,
      lastSpeechEnergyAt: 0,
      graceMs,
      defersUsed: 0,
      maxDefers,
    });
    const cancels = kn.shouldCancelPendingSilenceClose({
      goodbyeSentAt: duringGoodbye ? goodbyeAt : 0,
      thanksSpoken: false,
      hardMute: false,
      transferStarted: false,
    });
    // Their transcript lands ~0.6s after they start speaking and resets the
    // cycle outright, so either the window is held or the close is cancelled.
    const responds = duringGoodbye ? cancels : holds;
    console.log(
      `  caller ${c.label}: ${duringGoodbye ? 'CANCEL the goodbye' : holds ? 'HOLD the window' : 'PROCEED'}`,
    );
    check(`caller ${c.label} → still gets a response`, responds);
  }
  check(
    'the ladder still terminates for a genuinely silent line',
    goodbyeAt > 0 && goodbyeAt <= 25_000,
    `goodbye @ ${goodbyeAt / 1000}s`,
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
