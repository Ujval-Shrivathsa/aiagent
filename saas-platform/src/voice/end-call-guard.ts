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

  if (batchHasNotInterested && customerUtteranceCount >= 1) {
    return { allow: true, reason: 'not_interested_confirmed' };
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
