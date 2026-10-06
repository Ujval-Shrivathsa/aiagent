/**
 * ============================================================================
 *   CALL TELEMETRY — measurable evidence for "does this feel human?".
 * ============================================================================
 *
 * WHY THIS EXISTS
 *
 * Until now, every quality claim about the agent was an opinion. "She sounds
 * scripted", "she was quiet after my name", "she talks over me" — none of those
 * could be checked without a human on a handset, and the handset is exactly
 * where the agent cannot go. Telemetry closes the part of that gap that CAN be
 * closed remotely: how long the caller waited for the first syllable, how often
 * the agent talked over them, how often a step had to be repaired, how often
 * silence was recovered, how often a late reply rescued a closing goodbye, and
 * why the call ended.
 *
 * PRIVACY — READ BEFORE ADDING A FIELD
 *   Nothing here may contain a name, a phone number, a transcript, or anything
 *   derived from one. A call is identified by `callId`, a short hash of the
 *   call UUID, so two records of the same call can be joined during an
 *   investigation but cannot be traced back to a person from this file. Latency
 *   values are millisecond counts; the rest are integers. If you are tempted to
 *   add a field that identifies a caller, do not — write the aggregate to the
 *   call log instead.
 *
 * This module is deliberately free of I/O so the counters can be asserted in a
 * unit test with no clock and no audio.
 */

export type CallEndReason =
  | 'thank_you_close'
  | 'not_interested_close'
  | 'silence_goodbye'
  | 'busy_close'
  | 'caller_hangup'
  | 'guard'
  | 'none';

export type LatencyBuckets = {
  /** Caller speech ended → the first audio byte of the agent's reply. */
  callerToAgentMs: number[];
  /** Agent's turn produced its first audio after the model started it. */
  firstAudioDelayMs: number[];
  /** Caller interrupted the agent → agent stopped transmitting audio. */
  bargeInYieldMs: number[];
};

export type CallTelemetry = {
  callId: string;
  startedAt: number;
  /** Caller turns that produced a real (non-noise, non-echo) transcript. */
  callerTurns: number;
  /** Total caller speech time in ms, summed across confirmed speech spans. */
  callerSpeechMs: number;
  agentTurns: number;
  agentAudioMs: number;
  /** Interrupts where the caller was proven to have interrupted. */
  bargeIns: number;
  /** Step nudges re-issued because the step produced no audible audio. */
  repairs: number;
  /** Silence checks spoken. */
  silenceChecks: number;
  /** Silence goodbyes that a late caller reply cancelled. */
  lateRepliesRescued: number;
  languageSwitches: number;
  /** Acknowledgements spoken, and how many repeated one already used. */
  acksSpoken: number;
  ackRepeatsBlocked: number;
  endReason: CallEndReason;
  endedAt: number | null;
  latency: LatencyBuckets;
};

/**
 * Opaque, non-reversible call identifier. The input is the provider call UUID,
 * which is already a random identifier and contains no personal data — hashing
 * it only shortens what we would otherwise log.
 */
export function opaqueCallId(callUuid: string | null | undefined): string {
  const raw = String(callUuid || 'unknown');
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function createCallTelemetry(callId: string, startedAt: number): CallTelemetry {
  return {
    callId,
    startedAt,
    callerTurns: 0,
    callerSpeechMs: 0,
    agentTurns: 0,
    agentAudioMs: 0,
    bargeIns: 0,
    repairs: 0,
    silenceChecks: 0,
    lateRepliesRescued: 0,
    languageSwitches: 0,
    acksSpoken: 0,
    ackRepeatsBlocked: 0,
    endReason: 'none',
    endedAt: null,
    latency: { callerToAgentMs: [], firstAudioDelayMs: [], bargeInYieldMs: [] },
  };
}

function pushCapped(list: number[], value: number, cap = 32): number[] {
  const next = list.concat([Math.max(0, Math.round(value))]);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Every mutator returns a NEW object, so telemetry is assertable in tests. */
export function recordCallerSpeechEnd(
  t: CallTelemetry,
  at: number,
  speechMs: number,
): CallTelemetry {
  return {
    ...t,
    callerTurns: t.callerTurns + 1,
    callerSpeechMs: t.callerSpeechMs + Math.max(0, Math.round(speechMs)),
    latency: { ...t.latency, callerToAgentMs: pushCapped(t.latency.callerToAgentMs, at - t.startedAt) },
  };
}

export function recordAgentTurn(
  t: CallTelemetry,
  firstAudioDelayMs: number,
  audioMs: number,
): CallTelemetry {
  return {
    ...t,
    agentTurns: t.agentTurns + 1,
    agentAudioMs: t.agentAudioMs + Math.max(0, Math.round(audioMs)),
    latency: { ...t.latency, firstAudioDelayMs: pushCapped(t.latency.firstAudioDelayMs, firstAudioDelayMs) },
  };
}

export function recordBargeIn(t: CallTelemetry, yieldMs: number): CallTelemetry {
  return {
    ...t,
    bargeIns: t.bargeIns + 1,
    latency: { ...t.latency, bargeInYieldMs: pushCapped(t.latency.bargeInYieldMs, yieldMs) },
  };
}

export function recordRepair(t: CallTelemetry): CallTelemetry {
  return { ...t, repairs: t.repairs + 1 };
}

export function recordSilenceCheck(t: CallTelemetry): CallTelemetry {
  return { ...t, silenceChecks: t.silenceChecks + 1 };
}

export function recordLateReplyRescue(t: CallTelemetry): CallTelemetry {
  return { ...t, lateRepliesRescued: t.lateRepliesRescued + 1 };
}

export function recordLanguageSwitch(t: CallTelemetry): CallTelemetry {
  return { ...t, languageSwitches: t.languageSwitches + 1 };
}

export function recordAck(t: CallTelemetry, wasRepeatBlocked: boolean): CallTelemetry {
  return {
    ...t,
    acksSpoken: t.acksSpoken + 1,
    ackRepeatsBlocked: t.ackRepeatsBlocked + (wasRepeatBlocked ? 1 : 0),
  };
}

export function recordEnd(t: CallTelemetry, reason: CallEndReason, at: number): CallTelemetry {
  return { ...t, endReason: reason, endedAt: at };
}

/**
 * Percentiles use the NEAREST-RANK definition: index = ceil(q * n) - 1.
 *
 * The convention matters and is easy to get wrong on small samples — a call has
 * a handful of turns, not thousands. With the floor(q * n) variant the median of
 * two samples came back as the SLOWER of the two, which quietly flatters a
 * regression: a call that waited 120ms would report 120 for both p50 and max and
 * look consistent. Nearest-rank makes p50 of [90, 120] report 90 and p95 report
 * the worst value, which is what a latency tail is for. When there is only one
 * sample, all three figures are that sample — correct, and deliberately not
 * smoothed away.
 */
function stats(values: number[]): { n: number; p50: number; p95: number; max: number } {
  if (!values.length) return { n: 0, p50: 0, p95: 0, max: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1))];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

export function summarize(t: CallTelemetry) {
  return {
    callId: t.callId,
    durationMs: (t.endedAt ?? Date.now()) - t.startedAt,
    callerTurns: t.callerTurns,
    callerSpeechMs: t.callerSpeechMs,
    agentTurns: t.agentTurns,
    bargeIns: t.bargeIns,
    repairs: t.repairs,
    silenceChecks: t.silenceChecks,
    lateRepliesRescued: t.lateRepliesRescued,
    languageSwitches: t.languageSwitches,
    acksSpoken: t.acksSpoken,
    ackRepeatsBlocked: t.ackRepeatsBlocked,
    endReason: t.endReason,
    callerToAgentMs: stats(t.latency.callerToAgentMs),
    firstAudioDelayMs: stats(t.latency.firstAudioDelayMs),
    bargeInYieldMs: stats(t.latency.bargeInYieldMs),
  };
}

export type TelemetrySummary = ReturnType<typeof summarize>;

/* ------------------------------------------------------------------ *
 * PROCESS-WIDE RING BUFFER
 *
 * One Node process serves every call, so the last N finished calls are kept
 * in memory and surfaced on the existing read-only diagnostic endpoint. It is
 * deliberately tiny and in-memory only: it must never become a database, and a
 * restart losing the buffer is the correct trade.
 * ------------------------------------------------------------------ */

const RECENT_LIMIT = 20;
const recent: TelemetrySummary[] = [];

export function publishCall(summary: TelemetrySummary): void {
  recent.unshift(summary);
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
}

export function recentCalls(): readonly TelemetrySummary[] {
  return recent;
}

export function resetRecentCalls(): void {
  recent.length = 0;
}

/** Fleet-level view, so a regression is visible before a single call is read. */
export function aggregateRecent(): {
  calls: number;
  bargeIns: number;
  repairs: number;
  lateRepliesRescued: number;
  languageSwitches: number;
  ackRepeatsBlocked: number;
  callerToAgentP95: number;
  firstAudioP95: number;
  endReasons: Record<string, number>;
} {
  const agg = {
    calls: recent.length,
    bargeIns: 0,
    repairs: 0,
    lateRepliesRescued: 0,
    languageSwitches: 0,
    ackRepeatsBlocked: 0,
    callerToAgentP95: 0,
    firstAudioP95: 0,
    endReasons: {} as Record<string, number>,
  };
  for (const c of recent) {
    agg.bargeIns += c.bargeIns;
    agg.repairs += c.repairs;
    agg.lateRepliesRescued += c.lateRepliesRescued;
    agg.languageSwitches += c.languageSwitches;
    agg.ackRepeatsBlocked += c.ackRepeatsBlocked;
    agg.callerToAgentP95 = Math.max(agg.callerToAgentP95, c.callerToAgentMs.p95);
    agg.firstAudioP95 = Math.max(agg.firstAudioP95, c.firstAudioDelayMs.p95);
    agg.endReasons[c.endReason] = (agg.endReasons[c.endReason] || 0) + 1;
  }
  return agg;
}
