/**
 * Wait / silence policy — acceptance scenarios from the patient-salesperson spec.
 * Run: npx tsx --test src/voice/__tests__/wait-policy.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityCheckPhrase,
  beginWaitingForCustomer,
  classifyCustomerWhileWaiting,
  createWaitingState,
  detectExplicitWaitRequest,
  enterCustomerRequestedWait,
  loadWaitConfig,
  nextWaitDeadline,
  onMeaningfulCustomerSpeech,
  tickWait,
} from '../wait-policy';
import { SILENCE_AND_WAITING_BEHAVIOR } from '../kannada-style';

function cfg(overrides: Partial<ReturnType<typeof loadWaitConfig>> = {}) {
  return { ...loadWaitConfig(), ...overrides };
}

describe('wait-policy config', () => {
  it('defaults to ~5s availability check and limited retries', () => {
    const c = loadWaitConfig();
    assert.equal(c.availabilityCheckAfterMs, 5000);
    assert.ok(c.maxAvailabilityChecks >= 1 && c.maxAvailabilityChecks <= 3);
    assert.ok(c.nextCheckDelayMs >= 10000);
    assert.ok(c.justAMinuteMs >= 30000);
  });

  it('honours env overrides', () => {
    const prev = process.env.VOICE_WAIT_AVAILABILITY_CHECK_MS;
    process.env.VOICE_WAIT_AVAILABILITY_CHECK_MS = '6000';
    try {
      assert.equal(loadWaitConfig().availabilityCheckAfterMs, 6000);
    } finally {
      if (prev === undefined) delete process.env.VOICE_WAIT_AVAILABILITY_CHECK_MS;
      else process.env.VOICE_WAIT_AVAILABILITY_CHECK_MS = prev;
    }
  });
});

describe('detectExplicitWaitRequest', () => {
  const c = cfg();

  it('Scenario 3 — exact 10 seconds', () => {
    const d = detectExplicitWaitRequest("Wait, I'll speak after 10 seconds.", c);
    assert.equal(d.requested, true);
    if (d.requested) {
      assert.equal(d.durationMs, 10_000);
      assert.equal(d.kind, 'exact');
    }
  });

  it('Scenario 4 — ಒಂದು ನಿಮಿಷ uses longer window', () => {
    const d = detectExplicitWaitRequest('ಒಂದು ನಿಮಿಷ ಸರ್.', c);
    assert.equal(d.requested, true);
    if (d.requested) {
      assert.equal(d.durationMs, c.justAMinuteMs);
      assert.equal(d.kind, 'vague');
    }
  });

  it('detects Kannada and English vague waits', () => {
    assert.equal(detectExplicitWaitRequest('ಸ್ವಲ್ಪ wait ಮಾಡಿ.', c).requested, true);
    assert.equal(detectExplicitWaitRequest('Hold on.', c).requested, true);
    assert.equal(detectExplicitWaitRequest('Just a minute.', c).requested, true);
    assert.equal(detectExplicitWaitRequest('ಇರಿ, ಹೇಳ್ತೀನಿ.', c).requested, true);
  });

  it('does not treat normal answers as wait requests', () => {
    assert.equal(detectExplicitWaitRequest('ಹೌದು, ನೋಡ್ತಿದ್ದೀನಿ.', c).requested, false);
    assert.equal(detectExplicitWaitRequest('Yes, I am looking.', c).requested, false);
  });
});

describe('silence vs requested wait state machine', () => {
  it('Scenario 1 — response before 5s → no availability check', () => {
    const c = cfg({ availabilityCheckAfterMs: 5000 });
    let s = beginWaitingForCustomer(createWaitingState(), 1000);
    const early = tickWait(s, c, 3000, 'ಸರ್'); // 2s later
    assert.equal(early.decision.action, 'none');
    s = onMeaningfulCustomerSpeech(early.state, 3000);
    assert.equal(s.is_waiting, false);
    const after = tickWait(s, c, 9000, 'ಸರ್');
    assert.equal(after.decision.action, 'none');
  });

  it('Scenario 2 — 5s unexplained silence → availability check', () => {
    const c = cfg({ availabilityCheckAfterMs: 5000, maxAvailabilityChecks: 2 });
    let s = beginWaitingForCustomer(createWaitingState(), 0);
    const r = tickWait(s, c, 5000, 'ಸರ್');
    assert.equal(r.decision.action, 'availability_check');
    if (r.decision.action === 'availability_check') {
      assert.match(r.decision.spokenLine, /line ನಲ್ಲಿ ಇದ್ದೀರಾ/);
      assert.match(r.decision.systemPrompt, /AVAILABILITY CHECK/);
    }
    assert.equal(r.state.availability_check_count, 1);
    assert.equal(r.state.reason, 'availability_check');
  });

  it('Scenario 3 — explicit 10s wait suppresses 5s check', () => {
    const c = cfg({ availabilityCheckAfterMs: 5000 });
    let s = beginWaitingForCustomer(createWaitingState(), 0);
    const classified = classifyCustomerWhileWaiting("Wait, I'll speak after 10 seconds.", c);
    assert.equal(classified.kind, 'wait_request');
    if (classified.kind !== 'wait_request') return;
    s = enterCustomerRequestedWait(s, classified.wait.durationMs, 1000);
    assert.equal(s.reason, 'customer_requested_wait');

    // At t=6000 (5s after agent) — still inside 10s requested wait from t=1000
    const mid = tickWait(s, c, 6000, 'ಸರ್');
    assert.equal(mid.decision.action, 'none');
    assert.equal(mid.state.reason, 'customer_requested_wait');

    // After requested window ends → resume normal wait (no immediate check)
    const expired = tickWait(s, c, 1000 + 10_000, 'ಸರ್');
    assert.equal(expired.decision.action, 'requested_wait_expired');
    assert.equal(expired.state.reason, 'normal_wait');
  });

  it('Scenario 4 — one minute wait uses configurable window and skips 5s check', () => {
    const c = cfg({ availabilityCheckAfterMs: 5000, justAMinuteMs: 45_000 });
    let s = beginWaitingForCustomer(createWaitingState(), 0);
    const d = detectExplicitWaitRequest('ಒಂದು ನಿಮಿಷ ಸರ್.', c);
    assert.ok(d.requested);
    if (!d.requested) return;
    s = enterCustomerRequestedWait(s, d.durationMs, 0);
    const at5 = tickWait(s, c, 5000, 'ಸರ್');
    assert.equal(at5.decision.action, 'none');
    const deadline = nextWaitDeadline(s, c, 0);
    assert.equal(deadline, 45_000);
  });

  it('Scenario 5 — resume after wait clears state without restarting checks forever', () => {
    let s = enterCustomerRequestedWait(createWaitingState(), 10_000, 0);
    s = onMeaningfulCustomerSpeech(s, 12_000);
    assert.equal(s.is_waiting, false);
    assert.equal(s.reason, 'idle');
  });

  it('Scenario 6 — after max checks, grace nudge (not not-interested)', () => {
    const c = cfg({
      availabilityCheckAfterMs: 5000,
      maxAvailabilityChecks: 1,
      nextCheckDelayMs: 10_000,
      graceAfterChecksMs: 15_000,
    });
    let s = beginWaitingForCustomer(createWaitingState(), 0);
    const check = tickWait(s, c, 5000, 'ಸರ್');
    assert.equal(check.decision.action, 'availability_check');
    s = check.state;
    // Still silent through post-check delay + grace
    const grace = tickWait(s, c, 5000 + 15_000, 'ಸರ್');
    assert.equal(grace.decision.action, 'grace_callback');
    if (grace.decision.action === 'grace_callback') {
      assert.match(grace.decision.systemPrompt, /not interested/i);
      assert.match(grace.decision.spokenLine, /busy|call ಮಾಡ್ತೀನಿ/i);
    }
  });

  it('does not loop availability checks endlessly', () => {
    const c = cfg({
      availabilityCheckAfterMs: 1000,
      maxAvailabilityChecks: 2,
      nextCheckDelayMs: 2000,
      graceAfterChecksMs: 3000,
    });
    let s = beginWaitingForCustomer(createWaitingState(), 0);
    let now = 1000;
    const check1 = tickWait(s, c, now, 'ಸರ್');
    assert.equal(check1.decision.action, 'availability_check');
    s = check1.state;
    now += 2000;
    const check2 = tickWait(s, c, now, 'ಮ್ಯಾಡಮ್');
    assert.equal(check2.decision.action, 'availability_check');
    s = check2.state;
    now += 2000;
    const noMore = tickWait(s, c, now, 'ಸರ್');
    assert.notEqual(noMore.decision.action, 'availability_check');
  });

  it('uses ಮ್ಯಾಡಮ್ honorific when provided', () => {
    assert.match(availabilityCheckPhrase('ಮ್ಯಾಡಮ್'), /^ಮ್ಯಾಡಮ್/);
  });
});

describe('prompt block', () => {
  it('includes silence and waiting behavior for Gemini', () => {
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /explicit request to wait/i);
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /5 seconds/i);
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /not interested/i);
  });
});
