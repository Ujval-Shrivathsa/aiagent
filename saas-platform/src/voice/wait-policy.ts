/**
 * Conversation wait / silence policy for the live voice agent.
 *
 * Distinguishes:
 *   1. Normal conversational silence (wait patiently)
 *   2. Explicit customer "please wait" requests (respect duration; no 5s check)
 *   3. Unexplained silence long enough for a gentle availability check
 *
 * Pure helpers — unit-tested without a live call. Wired from logic.ts.
 */

function num(env: string | undefined, fallback: number): number {
  if (env == null || env === '') return fallback;
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export type WaitReason =
  | 'idle'
  | 'normal_wait'
  | 'customer_requested_wait'
  | 'availability_check'
  | 'grace_period';

export type WaitConfig = {
  /** Unexplained silence before first availability check (default 5s). */
  availabilityCheckAfterMs: number;
  /** Max "are you there?" style checks before grace handling. */
  maxAvailabilityChecks: number;
  /** Extra silence after a check before the next check / grace. */
  nextCheckDelayMs: number;
  /** Vague "wait a little" / "hold on" window. */
  waitALittleMs: number;
  /** "Just a minute" / "ಒಂದು ನಿಮಿಷ" window. */
  justAMinuteMs: number;
  /** Default when "wait" / "hold on" has no number. */
  holdOnMs: number;
  /** After max checks exhausted, wait this long then soft callback nudge. */
  graceAfterChecksMs: number;
  /** Cap for extracted numeric wait durations. */
  maxRequestedWaitMs: number;
  /** Floor for extracted numeric wait durations. */
  minRequestedWaitMs: number;
};

export function loadWaitConfig(): WaitConfig {
  return {
    availabilityCheckAfterMs: num(process.env.VOICE_WAIT_AVAILABILITY_CHECK_MS, 5000),
    maxAvailabilityChecks: Math.max(0, Math.floor(num(process.env.VOICE_WAIT_MAX_AVAILABILITY_CHECKS, 2))),
    nextCheckDelayMs: num(process.env.VOICE_WAIT_NEXT_CHECK_DELAY_MS, 12000),
    waitALittleMs: num(process.env.VOICE_WAIT_A_LITTLE_MS, 12000),
    justAMinuteMs: num(process.env.VOICE_WAIT_JUST_A_MINUTE_MS, 45000),
    holdOnMs: num(process.env.VOICE_WAIT_HOLD_ON_MS, 12000),
    graceAfterChecksMs: num(process.env.VOICE_WAIT_GRACE_AFTER_CHECKS_MS, 15000),
    maxRequestedWaitMs: num(process.env.VOICE_WAIT_MAX_REQUESTED_MS, 120000),
    minRequestedWaitMs: num(process.env.VOICE_WAIT_MIN_REQUESTED_MS, 5000),
  };
}

export type WaitingState = {
  is_waiting: boolean;
  reason: WaitReason;
  requested_duration_ms: number | null;
  requested_at: number | null;
  silence_started_at: number | null;
  /** Absolute time until which availability checks are suppressed. */
  customer_requested_until: number | null;
  availability_check_sent: boolean;
  availability_check_count: number;
  /** After an availability check was spoken, silence clock for next step. */
  post_check_silence_started_at: number | null;
  grace_nudge_sent: boolean;
};

export function createWaitingState(): WaitingState {
  return {
    is_waiting: false,
    reason: 'idle',
    requested_duration_ms: null,
    requested_at: null,
    silence_started_at: null,
    customer_requested_until: null,
    availability_check_sent: false,
    availability_check_count: 0,
    post_check_silence_started_at: null,
    grace_nudge_sent: false,
  };
}

export type DetectedWaitRequest =
  | { requested: false }
  | { requested: true; durationMs: number; phrase: string; kind: 'exact' | 'vague' };

const EXPLICIT_WAIT_PATTERN =
  /\b(wait|hold\s*on|hold\s*up|give\s*me|just\s*a\s*(sec|second|minute|min|moment)|one\s*(sec|second|minute|min)|a\s*(sec|second|minute|min)|i'?ll\s*(speak|tell|say|check)|let\s*me\s*(see|check|look)|speaking\s*(in|after)|i'?m\s*checking)\b|wait\s*ಮಾಡ|ಸ್ವಲ್ಪ\s*(wait|ತಡಿ|ಇರಿ)|ಒಂದು\s*(ನಿಮಿಷ|ಸೆಕೆಂಡ್|minute|sec)|ನಿಮಿಷ\s*(ಸರ್|ಮ್ಯಾಡಮ್)?|ಇರಿ[.,!]?\s*(ಹೇಳ್ತೀನಿ)?|ಸ್ವಲ್ಪ\s*ತಡಿ|ಹೇಳ್ತೀನಿ|ತಡಿ\s*(ಸರ್|ಮ್ಯಾಡಮ್)?/i;

function clampDuration(ms: number, cfg: WaitConfig): number {
  return Math.min(cfg.maxRequestedWaitMs, Math.max(cfg.minRequestedWaitMs, ms));
}

function extractExactDurationMs(text: string, cfg: WaitConfig): number | null {
  const lower = text.toLowerCase();
  const sec =
    lower.match(/(\d+)\s*(seconds?|secs?|sec\.?|ಸೆಕೆಂಡ್(?:್ಗಳು)?)/i) ||
    text.match(/(\d+)\s*ಸೆಕೆಂಡ್/);
  if (sec) {
    return clampDuration(Number(sec[1]) * 1000, cfg);
  }
  const min =
    lower.match(/(\d+)\s*(minutes?|mins?|min\.?|ನಿಮಿಷ(?:ಗಳು)?)/i) ||
    text.match(/(\d+)\s*ನಿಮಿಷ/);
  if (min) {
    return clampDuration(Number(min[1]) * 60_000, cfg);
  }
  // "10 seconds" style without unit nearby still caught above; "after 10" alone is weak — skip
  return null;
}

function vagueDurationMs(text: string, cfg: WaitConfig): number {
  const t = text.toLowerCase();
  if (
    /just\s*a\s*minute|one\s*minute|a\s*minute|ಒಂದು\s*ನಿಮಿಷ|ನಿಮಿಷ/.test(t) ||
    /ನಿಮಿಷ/.test(text)
  ) {
    return cfg.justAMinuteMs;
  }
  if (/wait\s*a\s*little|a\s*few\s*seconds|few\s*seconds|ಸ್ವಲ್ಪ\s*(wait|ತಡಿ|ಇರಿ)|hold\s*on|hold\s*up/.test(t)) {
    return cfg.waitALittleMs;
  }
  return cfg.holdOnMs;
}

/**
 * Detect explicit waiting intent BEFORE applying the unexplained-silence timeout.
 */
export function detectExplicitWaitRequest(text: string, cfg: WaitConfig): DetectedWaitRequest {
  const trimmed = (text || '').trim();
  if (!trimmed || trimmed.length < 2) return { requested: false };
  if (!EXPLICIT_WAIT_PATTERN.test(trimmed)) return { requested: false };

  const exact = extractExactDurationMs(trimmed, cfg);
  if (exact != null) {
    return { requested: true, durationMs: exact, phrase: trimmed.slice(0, 120), kind: 'exact' };
  }
  return {
    requested: true,
    durationMs: vagueDurationMs(trimmed, cfg),
    phrase: trimmed.slice(0, 120),
    kind: 'vague',
  };
}

export type HonorificKn = 'ಸರ್' | 'ಮ್ಯಾಡಮ್' | null;

export function availabilityCheckPhrase(honorific: HonorificKn): string {
  if (honorific === 'ಮ್ಯಾಡಮ್') return 'ಮ್ಯಾಡಮ್, line ನಲ್ಲಿ ಇದ್ದೀರಾ?';
  if (honorific === 'ಸರ್') return 'ಸರ್, line ನಲ್ಲಿ ಇದ್ದೀರಾ?';
  return 'ಸರ್, line ನಲ್ಲಿ ಇದ್ದೀರಾ?';
}

export function graceCallbackPhrase(honorific: HonorificKn): string {
  const h = honorific === 'ಮ್ಯಾಡಮ್' ? 'ಮ್ಯಾಡಮ್' : 'ಸರ್';
  return `ಸರಿ ${h}, ನೀವು busy ಇದ್ದರೆ ಮತ್ತೆ ಬೇರೆ ಸಮಯದಲ್ಲಿ call ಮಾಡ್ತೀನಿ.`;
}

/** Agent finished a turn — enter WAITING_FOR_CUSTOMER (unless already in requested wait). */
export function beginWaitingForCustomer(state: WaitingState, now: number): WaitingState {
  if (
    state.reason === 'customer_requested_wait' &&
    state.customer_requested_until != null &&
    now < state.customer_requested_until
  ) {
    return { ...state, is_waiting: true };
  }
  // Availability / grace lines are themselves agent turns — keep post-check timing
  // so we do not immediately re-arm a fresh 5s check and ignore nextCheckDelayMs.
  if (
    state.reason === 'availability_check' ||
    state.reason === 'grace_period' ||
    (state.availability_check_sent && state.post_check_silence_started_at != null)
  ) {
    return {
      ...state,
      is_waiting: true,
      silence_started_at: null,
      post_check_silence_started_at: state.post_check_silence_started_at ?? now,
    };
  }
  return {
    ...state,
    is_waiting: true,
    reason: 'normal_wait',
    silence_started_at: now,
    requested_duration_ms: null,
    requested_at: null,
    customer_requested_until: null,
    availability_check_sent: false,
    // Keep availability_check_count across the call so we don't loop forever
    post_check_silence_started_at: null,
  };
}

/** Meaningful customer speech (STT) — clear wait / silence clocks. */
export function onMeaningfulCustomerSpeech(state: WaitingState, now: number): WaitingState {
  return {
    ...createWaitingState(),
    // Preserve check count so we still respect max checks later in the call
    availability_check_count: state.availability_check_count,
    grace_nudge_sent: state.grace_nudge_sent,
  };
}

/** Customer explicitly asked to wait — suppress 5s availability checks. */
export function enterCustomerRequestedWait(
  state: WaitingState,
  durationMs: number,
  now: number,
): WaitingState {
  return {
    ...state,
    is_waiting: true,
    reason: 'customer_requested_wait',
    requested_duration_ms: durationMs,
    requested_at: now,
    silence_started_at: null,
    customer_requested_until: now + durationMs,
    availability_check_sent: false,
    post_check_silence_started_at: null,
  };
}

export type WaitTickDecision =
  | { action: 'none' }
  | { action: 'availability_check'; spokenLine: string; systemPrompt: string }
  | { action: 'grace_callback'; spokenLine: string; systemPrompt: string }
  | { action: 'requested_wait_expired' };

/**
 * Next absolute deadline for scheduling, or null if nothing to wait for.
 */
export function nextWaitDeadline(state: WaitingState, cfg: WaitConfig, now: number): number | null {
  if (!state.is_waiting) return null;

  if (state.reason === 'customer_requested_wait' && state.customer_requested_until != null) {
    return state.customer_requested_until;
  }

  if (state.reason === 'availability_check' || state.availability_check_sent) {
    const start = state.post_check_silence_started_at ?? now;
    if (state.availability_check_count >= cfg.maxAvailabilityChecks) {
      if (state.grace_nudge_sent) return null;
      return start + cfg.graceAfterChecksMs;
    }
    return start + cfg.nextCheckDelayMs;
  }

  if (state.reason === 'normal_wait' && state.silence_started_at != null) {
    return state.silence_started_at + cfg.availabilityCheckAfterMs;
  }

  if (state.reason === 'grace_period' && state.post_check_silence_started_at != null && !state.grace_nudge_sent) {
    return state.post_check_silence_started_at + cfg.graceAfterChecksMs;
  }

  return null;
}

/**
 * Evaluate silence / wait state. Call when a scheduled deadline fires or after state changes.
 */
export function tickWait(
  state: WaitingState,
  cfg: WaitConfig,
  now: number,
  honorific: HonorificKn,
): { state: WaitingState; decision: WaitTickDecision } {
  if (!state.is_waiting) {
    return { state, decision: { action: 'none' } };
  }

  // Explicit wait window still active — never fire availability check.
  if (
    state.reason === 'customer_requested_wait' &&
    state.customer_requested_until != null &&
    now < state.customer_requested_until
  ) {
    return { state, decision: { action: 'none' } };
  }

  // Requested wait just expired → resume normal listening (new silence clock).
  if (
    state.reason === 'customer_requested_wait' &&
    state.customer_requested_until != null &&
    now >= state.customer_requested_until
  ) {
    const next: WaitingState = {
      ...state,
      reason: 'normal_wait',
      silence_started_at: now,
      customer_requested_until: null,
      requested_duration_ms: null,
      requested_at: null,
      availability_check_sent: false,
      post_check_silence_started_at: null,
    };
    return { state: next, decision: { action: 'requested_wait_expired' } };
  }

  // After an availability check was spoken — wait longer before next step.
  if (state.availability_check_sent && state.post_check_silence_started_at != null) {
    const elapsed = now - state.post_check_silence_started_at;

    if (state.availability_check_count >= cfg.maxAvailabilityChecks) {
      if (!state.grace_nudge_sent && elapsed >= cfg.graceAfterChecksMs) {
        const line = graceCallbackPhrase(honorific);
        const next: WaitingState = {
          ...state,
          reason: 'grace_period',
          grace_nudge_sent: true,
          is_waiting: true,
        };
        return {
          state: next,
          decision: {
            action: 'grace_callback',
            spokenLine: line,
            systemPrompt:
              `SILENCE GRACE: The customer did not respond after availability check(s). ` +
              `Speak ONLY this short natural line (or close equivalent), then STOP and listen. ` +
              `Do NOT mark them not interested. Do NOT call endCall yet. Do NOT restart the greeting. ` +
              `Exact words: ${line}`,
          },
        };
      }
      return { state, decision: { action: 'none' } };
    }

    if (elapsed >= cfg.nextCheckDelayMs && state.availability_check_count < cfg.maxAvailabilityChecks) {
      return fireAvailabilityCheck(state, honorific, now);
    }
    return { state, decision: { action: 'none' } };
  }

  // Normal unexplained silence → first / next availability check.
  if (state.reason === 'normal_wait' && state.silence_started_at != null) {
    const elapsed = now - state.silence_started_at;
    if (elapsed >= cfg.availabilityCheckAfterMs) {
      if (state.availability_check_count >= cfg.maxAvailabilityChecks) {
        // Already used all checks earlier; go straight to grace timing.
        const next: WaitingState = {
          ...state,
          reason: 'grace_period',
          availability_check_sent: true,
          post_check_silence_started_at: now,
        };
        return { state: next, decision: { action: 'none' } };
      }
      return fireAvailabilityCheck(state, honorific, now);
    }
  }

  return { state, decision: { action: 'none' } };
}

function fireAvailabilityCheck(
  state: WaitingState,
  honorific: HonorificKn,
  now: number,
): { state: WaitingState; decision: WaitTickDecision } {
  const line = availabilityCheckPhrase(honorific);
  const count = state.availability_check_count + 1;
  const next: WaitingState = {
    ...state,
    is_waiting: true,
    reason: 'availability_check',
    availability_check_sent: true,
    availability_check_count: count,
    silence_started_at: null,
    post_check_silence_started_at: now,
  };
  return {
    state: next,
    decision: {
      action: 'availability_check',
      spokenLine: line,
      systemPrompt:
        `AVAILABILITY CHECK: ~5+ seconds of unexplained silence (customer did NOT ask you to wait). ` +
        `Speak ONLY this short natural confirmation, then STOP and listen. ` +
        `Do NOT ask a new sales question. Do NOT restart the intro. Do NOT call endCall. ` +
        `Do NOT treat silence as not interested. Exact words: ${line}`,
    },
  };
}

/**
 * Decision hierarchy for a customer transcript fragment while waiting.
 */
export function classifyCustomerWhileWaiting(
  text: string,
  cfg: WaitConfig,
): { kind: 'wait_request'; wait: Extract<DetectedWaitRequest, { requested: true }> } | { kind: 'speech' } {
  const wait = detectExplicitWaitRequest(text, cfg);
  if (wait.requested) return { kind: 'wait_request', wait };
  return { kind: 'speech' };
}
