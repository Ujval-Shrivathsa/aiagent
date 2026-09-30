/**
 * Unit tests for the speech-recovery ladder (no live Gemini / telephony).
 * Run: npx tsx --test src/voice/__tests__/speech-recovery.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  armSpeechRecovery,
  cancelSpeechRecovery,
  createSpeechRecoveryState,
  disarmSpeechRecovery,
  loadRecoveryConfig,
  resolveSpeechRecoveryWithAiAudio,
  resolveSpeechRecoveryWithTranscript,
  speechRecoveryNudgeText,
  tickSpeechRecovery,
} from '../speech-recovery';

const CFG = {
  transcriptGraceMs: 1100,
  escalateGraceMs: 1600,
  maxAttempts: 2,
};

describe('speech-recovery config', () => {
  it('loads bounded defaults', () => {
    const cfg = loadRecoveryConfig();
    assert.ok(cfg.transcriptGraceMs >= 800, 'grace window gives STT a real chance');
    assert.ok(cfg.transcriptGraceMs <= 2000, 'grace window stays fast');
    assert.ok(cfg.maxAttempts >= 1 && cfg.maxAttempts <= 3, 'escalation bounded');
    assert.ok(cfg.escalateGraceMs >= cfg.transcriptGraceMs, 'escalation waits at least as long');
  });
});

describe('speech-recovery ladder', () => {
  it('stays idle until a speech end arms it', () => {
    const s = createSpeechRecoveryState();
    assert.equal(tickSpeechRecovery(s, CFG, 10_000).action, 'none');
  });

  it('does not nudge before the grace window elapses', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    const early = tickSpeechRecovery(s, CFG, 10_000 + 500);
    assert.equal(early.action, 'none');
    assert.equal(early.state.stage, 'grace');
  });

  it('nudges ask_repeat when no transcript arrives in the grace window', () => {
    const s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    const d = tickSpeechRecovery(s, CFG, 10_000 + 1100);
    assert.equal(d.action, 'send_recovery_nudge');
    if (d.action === 'send_recovery_nudge') {
      assert.equal(d.kind, 'ask_repeat');
      assert.equal(d.attempt, 1);
      assert.equal(d.state.stage, 'nudge');
      assert.equal(d.state.attempts, 1);
    }
  });

  it('transcript arrival switches to answerGrace and expects reply audio', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    s = resolveSpeechRecoveryWithTranscript(s, 10_200);
    assert.equal(s.stage, 'answerGrace');
    // AI audio resolves everything.
    s = resolveSpeechRecoveryWithAiAudio(s);
    assert.equal(s.stage, 'idle');
    assert.equal(tickSpeechRecovery(s, CFG, 99_999).action, 'none');
  });

  it('nudges reply_now when a transcript arrived but no AI reply followed', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    s = resolveSpeechRecoveryWithTranscript(s, 10_100);
    const d = tickSpeechRecovery(s, CFG, 10_100 + 1100);
    assert.equal(d.action, 'send_recovery_nudge');
    if (d.action === 'send_recovery_nudge') {
      assert.equal(d.kind, 'reply_now');
      assert.equal(d.attempt, 1);
    }
  });

  it('escalates with a more explicit nudge, then hands over to the silence protocol', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    const first = tickSpeechRecovery(s, CFG, 11_100);
    assert.equal(first.action, 'send_recovery_nudge');
    if (first.action === 'send_recovery_nudge') s = first.state;

    const second = tickSpeechRecovery(s, CFG, 11_100 + 1600);
    assert.equal(second.action, 'send_recovery_nudge');
    if (second.action === 'send_recovery_nudge') {
      assert.equal(second.attempt, 2);
      s = second.state;
    }

    const third = tickSpeechRecovery(s, CFG, 11_100 + 1600 + 1600);
    assert.equal(third.action, 'give_up_to_silence_protocol');
    assert.equal(third.state.stage, 'idle');
  });

  it('a new speech start disarms the pending recovery', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    const d = tickSpeechRecovery(s, CFG, 11_500);
    if (d.action === 'send_recovery_nudge') s = d.state;
    s = disarmSpeechRecovery(s);
    assert.equal(s.stage, 'idle');
    assert.equal(tickSpeechRecovery(s, CFG, 99_999).action, 'none');
  });

  it('cancel fully resets the ladder', () => {
    let s = armSpeechRecovery(createSpeechRecoveryState(), 10_000);
    s = cancelSpeechRecovery(s);
    assert.equal(s.stage, 'idle');
    assert.equal(s.armedAt, null);
    assert.equal(s.attempts, 0);
  });

  it('nudge text never tells the model to hang up and stays private', () => {
    for (const kind of ['ask_repeat', 'reply_now'] as const) {
      for (const attempt of [1, 2]) {
        const text = speechRecoveryNudgeText(kind, attempt);
        assert.ok(!/endCall/i.test(text), 'nudge must not trigger endCall');
        assert.match(text, /internal, private/);
        assert.match(text, /LISTEN|NOW/);
      }
    }
    assert.match(speechRecoveryNudgeText('ask_repeat', 1), /repeat/);
    assert.match(speechRecoveryNudgeText('reply_now', 1), /Reply NOW/);
  });
});
