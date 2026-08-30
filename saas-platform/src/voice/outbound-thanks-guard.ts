import {
  hasThanksClosing,
  isRedundantOutboundThanksTurn,
  looksLikeClosingGoodbye,
  looksLikeThanksOnlyLine,
} from './Outbound/callguide';

export type OutboundThanksGuardState = {
  thanksSpoken: boolean;
  hardMuteAfterClose: boolean;
};

export function createOutboundThanksGuardState(): OutboundThanksGuardState {
  return { thanksSpoken: false, hardMuteAfterClose: false };
}

/** Mirrors logic.ts shouldSuppressOutboundTurn (thanks-related paths). */
export function evaluateOutboundThanksSuppress(
  turnText: string,
  state: OutboundThanksGuardState,
): { suppress: boolean; reason?: string } {
  const trimmed = String(turnText || '').trim();
  if (state.hardMuteAfterClose) {
    return { suppress: true, reason: 'hard_mute_after_close' };
  }
  if (!trimmed) return { suppress: false };
  if (state.thanksSpoken && isRedundantOutboundThanksTurn(trimmed, true)) {
    return { suppress: true, reason: 'redundant_thanks' };
  }
  if (trimmed.length < 8 && state.thanksSpoken && looksLikeThanksOnlyLine(trimmed)) {
    return { suppress: true, reason: 'redundant_thanks' };
  }
  return { suppress: false };
}

export function shouldActivateOutboundPostThanksMute(
  turnText: string,
  state: OutboundThanksGuardState,
): boolean {
  if (state.thanksSpoken) return false;
  return hasThanksClosing(turnText) || looksLikeClosingGoodbye(turnText);
}

export function activateOutboundPostThanksMute(
  state: OutboundThanksGuardState,
): OutboundThanksGuardState {
  if (state.thanksSpoken) return state;
  return { thanksSpoken: true, hardMuteAfterClose: true };
}

/**
 * Simulate outbound turn playback order: suppress check → play → activate mute.
 * Returns whether audio would play and the updated guard state.
 */
export function simulateOutboundClosingTurn(
  turnText: string,
  state: OutboundThanksGuardState,
): { play: boolean; reason?: string; state: OutboundThanksGuardState } {
  const { suppress, reason } = evaluateOutboundThanksSuppress(turnText, state);
  if (suppress) {
    return { play: false, reason, state };
  }
  let next = state;
  if (shouldActivateOutboundPostThanksMute(turnText, next)) {
    next = activateOutboundPostThanksMute(next);
  }
  return { play: true, state: next };
}
