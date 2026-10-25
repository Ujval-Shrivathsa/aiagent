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

/**
 * Outbound opening only. Listening and barge-in stay closed until the greeting
 * turn has been generated AND its audio has finished playing on the phone.
 * A hold that never produces audio opens after `holdCapMs`, but a greeting
 * that is still playing is never opened early.
 */
export function greetingListenOpen(input: {
  isOutbound: boolean;
  turnComplete: boolean;
  audioHeard: boolean;
  now: number;
  playbackEndsAt: number;
  holdStartedAt: number;
  holdCapMs: number;
}): boolean {
  if (!input.isOutbound) return true;
  const stillPlaying = input.playbackEndsAt > input.now;
  if (input.audioHeard && stillPlaying) return false;
  if (
    input.holdStartedAt > 0 &&
    input.now - input.holdStartedAt >= input.holdCapMs &&
    !stillPlaying
  ) {
    return true;
  }
  if (!input.audioHeard || !input.turnComplete) return false;
  return input.now >= input.playbackEndsAt;
}

/**
 * Opening playback must not be cleared. The one exception is a turn the
 * name-question detector already matched — that cut stays as it is.
 */
export function mayClearCallerAudio(input: {
  openingFinished: boolean;
  transcriptIsNameQuestion: boolean;
}): boolean {
  if (input.openingFinished) return true;
  return input.transcriptIsNameQuestion;
}

/** A reconnect before the opening has finished ends the call. It does not resume or replay. */
export function reconnectDuringOpening(openingFinished: boolean): 'hangup' | 'resume' {
  return openingFinished ? 'resume' : 'hangup';
}

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
