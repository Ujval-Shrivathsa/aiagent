/**
 * Server-side guard against premature endCall tool invocations.
 * The model must not hang up on silence, opening-only, or early turns.
 */

import { isLikelySttNoise, isShortAffirmativeReply } from './short-reply';

export type EndCallGuardInput = {
  callDurationMs: number;
  customerClearGoodbye: boolean;
  /** Meaningful customer STT turns (not opening echo / noise). */
  customerUtteranceCount: number;
  /** notInterested in the same tool batch as endCall. */
  batchHasNotInterested: boolean;
  /** PDF outbound flow — short scripted closes are allowed after customer spoke. */
  isOutbound?: boolean;
  // (silenceTimeoutClose REMOVED — silence never authorizes ending a call.)
  /** Busy / call-back-later close line spoken (cold-call spec trigger 4). */
  busyCallbackClose?: boolean;
  /**
   * The sales-team close ("I'll forward you to the sales team") plus the
   * thank-you was spoken. The model has FULL authority to end the call here —
   * it calls endCall in the very same turn as that close line, which arrives
   * BEFORE the engine has flagged outboundBusyCloseSent, so this is checked
   * straight off the model's own turn text.
   */
  salesTeamClose?: boolean;
};

export type EndCallGuardResult = {
  allow: boolean;
  reason: string;
};

export function shouldAllowEndCall(input: EndCallGuardInput): EndCallGuardResult {
  const {
    callDurationMs,
    customerClearGoodbye,
    customerUtteranceCount,
    batchHasNotInterested,
  } = input;

  if (customerClearGoodbye) {
    return { allow: true, reason: 'customer_clear_goodbye' };
  }

  // (No silence branch — silence can NEVER allow ending the call. The system
  // keeps listening and softly reprompts forever instead.)

  // Cold-call spec trigger 4: busy / call-back-later close — always allowed.
  if (input.busyCallbackClose) {
    return { allow: true, reason: 'busy_callback_close' };
  }

  // Sales-team close + thank-you spoken. The model owns ending the call after
  // this, so it is ALWAYS allowed here — including a short call, where the
  // duration floor below would otherwise reject it.
  if (input.salesTeamClose) {
    return { allow: true, reason: 'sales_team_close' };
  }

  if (batchHasNotInterested && customerUtteranceCount >= 1) {
    return { allow: true, reason: 'not_interested_confirmed' };
  }

  // Opening "yes" is only the first turn — do not hang up yet.
  if (input.isOutbound && customerUtteranceCount >= 2) {
    return { allow: true, reason: 'outbound_scripted_flow' };
  }

  if (customerUtteranceCount < 1) {
    return {
      allow: false,
      reason: 'no_customer_speech',
    };
  }

  // Opening + brief reply only — block unless explicit goodbye or notInterested.
  if (callDurationMs < 15_000) {
    return {
      allow: false,
      reason: 'call_too_short',
    };
  }

  return { allow: true, reason: 'conversation_eligible' };
}

export function isMeaningfulCustomerUtterance(
  text: string,
  looksLikeOpeningEchoFn: (t: string) => boolean,
): boolean {
  const t = text.trim();
  if (!t || isLikelySttNoise(t)) return false;
  if (isShortAffirmativeReply(t)) return true;
  if (looksLikeOpeningEchoFn(t)) return false;
  return true;
}
