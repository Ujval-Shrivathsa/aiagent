/**
 * Pure turn / barge-in policy helpers — unit-tested without a live call.
 */

export type BargeInInput = {
  now: number;
  aiPlaybackEndsAt: number;
  rms: number;
  bargeInRms: number;
  gateOpen: boolean;
  requireGateOpen: boolean;
  bargeInStartedAt: number | null;
  minHoldMs: number;
};

export type BargeInDecision =
  | { action: 'none'; startedAt: number | null }
  | { action: 'arm'; startedAt: number }
  | { action: 'fire'; startedAt: null }
  | { action: 'reset'; startedAt: null };

export function evaluateBargeIn(input: BargeInInput): BargeInDecision {
  const candidate =
    input.now < input.aiPlaybackEndsAt &&
    input.rms >= input.bargeInRms &&
    (!input.requireGateOpen || input.gateOpen);

  if (candidate) {
    if (input.bargeInStartedAt === null) {
      return { action: 'arm', startedAt: input.now };
    }
    if (input.now - input.bargeInStartedAt >= input.minHoldMs) {
      return { action: 'fire', startedAt: null };
    }
    return { action: 'none', startedAt: input.bargeInStartedAt };
  }
  return { action: 'reset', startedAt: null };
}

export type SpeechEndInput = {
  vadIsSpeaking: boolean;
  speechEnergy: boolean;
  now: number;
  silenceStartedAt: number | null;
  silenceMs: number;
};

export type SpeechEndDecision =
  | { event: 'none'; vadIsSpeaking: boolean; silenceStartedAt: number | null }
  | { event: 'start'; vadIsSpeaking: true; silenceStartedAt: null }
  | { event: 'end'; vadIsSpeaking: false; silenceStartedAt: null; pausedFor: number }
  | { event: 'silence_arm'; vadIsSpeaking: true; silenceStartedAt: number };

export function evaluateLocalSpeech(input: SpeechEndInput): SpeechEndDecision {
  if (input.speechEnergy) {
    if (!input.vadIsSpeaking) {
      return { event: 'start', vadIsSpeaking: true, silenceStartedAt: null };
    }
    return { event: 'none', vadIsSpeaking: true, silenceStartedAt: null };
  }
  if (!input.vadIsSpeaking) {
    return { event: 'none', vadIsSpeaking: false, silenceStartedAt: null };
  }
  if (input.silenceStartedAt === null) {
    return { event: 'silence_arm', vadIsSpeaking: true, silenceStartedAt: input.now };
  }
  const pausedFor = input.now - input.silenceStartedAt;
  if (pausedFor >= input.silenceMs) {
    return { event: 'end', vadIsSpeaking: false, silenceStartedAt: null, pausedFor };
  }
  return { event: 'none', vadIsSpeaking: true, silenceStartedAt: input.silenceStartedAt };
}
