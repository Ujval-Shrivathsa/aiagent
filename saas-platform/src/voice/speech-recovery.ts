/**
 * Speech-recovery ladder — the "user spoke but nothing happened" failsafe.
 *
 * Guarantees (permanent requirement):
 *   1. Every confirmed customer speech end arms the ladder.
 *   2. If no transcript arrives within the grace window (STT dropped a
 *      quiet "yes"), the model is nudged to ask the caller to repeat —
 *      the call can never sit in silent limbo.
 *   3. If a transcript DID arrive but no AI audio followed, the ladder
 *      moves to answer-grace and nudges the model to reply immediately.
 *   4. AI audio at any point resolves the pending turn.
 *   5. A new speech start disarms the ladder — the new turn owns the state.
 *   6. Escalation is bounded; exhaustion ends in RESUME-AND-LISTEN (one short
 *      spoken line, then the quiet-caller reprompt cycle). The ladder NEVER
 *      hangs up and NEVER hands off to any terminating path.
 *
 * This replaces the old separate response-watchdog so exactly one recovery
 * system exists — no double nudges, no silent gaps.
 *
 * Pure helpers — unit-tested without a live call. Wired from logic.ts.
 */

export type RecoveryStage = 'idle' | 'grace' | 'answerGrace' | 'nudge';

export type SpeechRecoveryState = {
  stage: RecoveryStage;
  /** Date.now() of the event that armed the current stage. */
  armedAt: number | null;
  /** Escalation nudges sent for the current pending turn. */
  attempts: number;
  /** 'barge' = the caller spoke over the agent and is owed an answer, not a repeat-ask. */
  priority: 'normal' | 'barge';
};

export type RecoveryConfig = {
  /** Wait this long for a transcript / AI reply before the first nudge. */
  transcriptGraceMs: number;
  /**
   * After the caller interrupts the agent, answer sooner than a normal turn.
   * Still long enough for them to finish the sentence.
   */
  bargeReplyGraceMs: number;
  /** Wait this long after a nudge before escalating again. */
  escalateGraceMs: number;
  /** Max escalation nudges per pending turn; afterwards the silence protocol owns the call. */
  maxAttempts: number;
};

function num(env: string | undefined, fallback: number): number {
  if (env == null || env === '') return fallback;
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export function loadRecoveryConfig(): RecoveryConfig {
  return {
    // Tight windows for a fast reply. Floor is 800ms so STT still has a real chance.
    transcriptGraceMs: num(process.env.VOICE_RECOVERY_GRACE_MS, 800),
    bargeReplyGraceMs: num(process.env.VOICE_BARGE_REPLY_GRACE_MS, 550),
    escalateGraceMs: num(process.env.VOICE_RECOVERY_ESCALATE_MS, 1200),
    maxAttempts: num(process.env.VOICE_RECOVERY_MAX_ATTEMPTS, 2),
  };
}

export function createSpeechRecoveryState(): SpeechRecoveryState {
  return { stage: 'idle', armedAt: null, attempts: 0, priority: 'normal' };
}

/** Customer speech confirmed ended → wait briefly for STT. */
export function armSpeechRecovery(
  state: SpeechRecoveryState,
  now: number,
): SpeechRecoveryState {
  return { stage: 'grace', armedAt: now, attempts: 0, priority: 'normal' };
}

/**
 * The caller talked over the agent and has now stopped. Skip the
 * "please repeat" step and answer what they said, within about a second.
 */
export function armBargeReplyRecovery(
  state: SpeechRecoveryState,
  now: number,
): SpeechRecoveryState {
  return { stage: 'answerGrace', armedAt: now, attempts: 0, priority: 'barge' };
}

/** A customer transcript arrived — now wait for the AI's reply audio. */
export function resolveSpeechRecoveryWithTranscript(
  state: SpeechRecoveryState,
  now: number,
): SpeechRecoveryState {
  if (state.stage === 'idle') return state;
  if (state.priority === 'barge') {
    return { ...state, stage: 'answerGrace' };
  }
  return { stage: 'answerGrace', armedAt: now, attempts: 0, priority: 'normal' };
}

/** AI audio reached the caller — turn fully resolved. */
export function resolveSpeechRecoveryWithAiAudio(
  state: SpeechRecoveryState,
): SpeechRecoveryState {
  if (state.stage === 'idle') return state;
  return { stage: 'idle', armedAt: null, attempts: 0, priority: 'normal' };
}

/** Caller started speaking again — pending recovery is obsolete. */
export function disarmSpeechRecovery(
  state: SpeechRecoveryState,
): SpeechRecoveryState {
  if (state.stage === 'idle') return state;
  return { stage: 'idle', armedAt: null, attempts: 0, priority: 'normal' };
}

/** Call ended / hard mute — stop everything. */
export function cancelSpeechRecovery(
  state: SpeechRecoveryState,
): SpeechRecoveryState {
  return { stage: 'idle', armedAt: null, attempts: 0, priority: 'normal' };
}

export type RecoveryDecision =
  | { action: 'none'; state: SpeechRecoveryState }
  | {
      action: 'send_recovery_nudge';
      state: SpeechRecoveryState;
      attempt: number;
      kind: 'ask_repeat' | 'reply_now';
    }
  /** Ladder exhausted → resume mid-conversation and keep listening (never hang up). */
  | { action: 'resume_after_exhausted'; state: SpeechRecoveryState };

/**
 * Tick the ladder. Call only when the caller is NOT mid-speech and the
 * echo-tail window has passed — the wiring in logic.ts guards that.
 */
export function tickSpeechRecovery(
  state: SpeechRecoveryState,
  cfg: RecoveryConfig,
  now: number,
): RecoveryDecision {
  if (state.stage === 'idle' || state.armedAt == null) {
    return { action: 'none', state };
  }
  const armedFor = now - state.armedAt;
  const bargeGrace = cfg.bargeReplyGraceMs ?? cfg.transcriptGraceMs;
  const waitingFor =
    state.priority === 'barge' && (state.stage === 'grace' || state.stage === 'answerGrace')
      ? bargeGrace
      : state.stage === 'grace' || state.stage === 'answerGrace'
        ? cfg.transcriptGraceMs
        : cfg.escalateGraceMs;
  if (armedFor < waitingFor) {
    return { action: 'none', state };
  }
  if (state.attempts >= cfg.maxAttempts) {
    // Exhausted → resume-and-listen. The call NEVER ends from here; the
    // quiet-caller reprompt cycle owns the line until the caller speaks.
    return {
      action: 'resume_after_exhausted',
      state: { stage: 'idle', armedAt: null, attempts: 0, priority: 'normal' },
    };
  }
  const attempt = state.attempts + 1;
  const kind: 'ask_repeat' | 'reply_now' =
    state.stage === 'grace' ? 'ask_repeat' : 'reply_now';
  return {
    action: 'send_recovery_nudge',
    state: { stage: 'nudge', armedAt: now, attempts: attempt, priority: state.priority },
    attempt,
    kind,
  };
}

/** Nudge text — private system directive; attempt 2 is more explicit. */
export function speechRecoveryNudgeText(
  kind: 'ask_repeat' | 'reply_now',
  attempt: number,
): string {
  if (kind === 'ask_repeat') {
    return (
      'SYSTEM (internal, private): Their words were not recognized. Do NOT ask them to repeat. ' +
      'Do NOT speak. Stay silent and LISTEN. Do not end the call. Attempt ' +
      String(attempt) +
      '.'
    );
  }
  if (attempt <= 1) {
    return (
      'SYSTEM (internal, private): The caller spoke but you have not replied with audio yet. ' +
      'Reply NOW with spoken audio — one or two sentences continuing the current step of the flow — then LISTEN. ' +
      'Do not repeat the opening. Do not stay silent. Do not end the call.'
    );
  }
  return (
    'SYSTEM (internal, private): The caller is waiting for your reply. Speak NOW — continue the flow ' +
    'with one short question or statement in Kanglish, then LISTEN. Never stay silent. Do not end the call.'
  );
}
