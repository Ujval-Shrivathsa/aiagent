/**
 * ============================================================================
 *   CONVERSATIONAL NATURALNESS — the conversational realization layer.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 *
 * The call has TWO layers and they were previously collapsed into one:
 *
 *   1. BUSINESS CONTENT — what MUST be communicated. The opening, the name
 *      question, the areas substance, the one interest question, the
 *      sales-team handoff, the single thank-you. This stays deterministic and
 *      stays pinned. It is owned by kannada-script.ts and is NOT negotiable.
 *
 *   2. CONVERSATIONAL REALIZATION — HOW that content is spoken. Which of a
 *      small curated set of acknowledgements carries the caller's name; how
 *      much to say when the caller is pressed for time; whether a phrase was
 *      already used this call. This is where a scripted agent betrays itself.
 *
 * A single hard-coded acknowledgement ('ಸರ್ತಿ') is correct but robotic: every
 * call, every caller, the same token at the same beat. The fix is NOT random
 * variation — it is a SMALL CURATED SET with a DETERMINISTIC selector and a
 * no-repeat guard, so the behaviour is reproducible in a test and stable on a
 * live call.
 *
 * HARD INVARIANTS (all unit-tested, none of them may be relaxed):
 *   - Every acknowledgement is at most 3 words. It is a beat, not a sentence.
 *   - No acknowledgement may contain a thanks-style close. ಧನ್ಯವಾದ is the
 *     engine's end-of-call trigger (hasThanksClosing), so an acknowledgement
 *     that trips it would hang the call up before the caller ever hears what
 *     we have. This is the single most dangerous constraint in the file.
 *   - An acknowledgement never adds warmth the business did not ask for. No
 *     "thank you so much for sharing", no fawning, no second sentence.
 *   - Tone directives may change LENGTH, EXPLANATION and PACE OF STRATEGY.
 *     They may never change business content, never unlock a new claim, and
 *     never make the agent mirror the caller's emotional energy (owner
 *     decision: one calm even pace; a tired caller does not make Priya slower
 *     and a pleased one does not make her brighter).
 *
 * DEPENDENCY DIRECTION
 *   conversation-naturalness.ts  ->  kannada-script.ts   (one way only)
 *   kannada-script.ts does NOT import this file. The chosen acknowledgement is
 *   passed IN to the nudges as an optional argument, which keeps the module
 *   graph acyclic and leaves every existing nudge test untouched.
 *
 * KANNADA CAVEAT — READ BEFORE TOUCHING THE PHRASES
 *   Every phrase below is written in spoken Mysuru Kannada, not literary
 *   Kannada, and every one of them still needs sign-off from a native speaker
 *   before it is trusted in production. They are marked in
 *   docs/KANNADA_STYLE_GUIDE.md. If a phrase is rejected, remove it from the
 *   set — do not "improve" it by translating from English.
 */

import {
  hasThanksClosing,
  nameWithHonorific,
} from './kannada-script';

/** Longest acknowledgement we will ever speak, in whitespace-separated words. */
export const ACK_MAX_WORDS = 3;

/**
 * The owner's original single-word acknowledgement, and the guaranteed default.
 * Exported so the engine's rollback switch (OUTBOUND_ACK_LEGACY_ONLY) and this
 * module can never drift to two different "defaults" — a failure that would be
 * invisible until a caller heard the wrong beat.
 */
export const DEFAULT_ACK_WORD_KN = 'ಸರ್ತಿ';

export type AckKind =
  /** "I have it" — used when the caller has just given the name. */
  | 'recognition'
  /** Plain agreement / move on. */
  | 'confirm'
  /** Carrying the conversation to the next beat. */
  | 'transition'
  /** Very short continuation. */
  | 'continuation';

export type AckVariant = {
  kind: AckKind;
  /** Spoken Kannada. Lower-case, no trailing punctuation, no honorific. */
  text: string;
  /** Why this phrase is natural in a Mysuru phone call. Kept for the audit. */
  note: string;
  /** Set false until a native speaker has signed the phrase off. */
  validatedByNativeSpeaker: boolean;
};

/**
 * THE CURATED SET. Four to six phrases is the honest size: a phone call needs
 * a beat, not a vocabulary, and every extra variant is another chance to sound
 * like a template.
 *
 * 'ಸರ್ತಿ' leads because it is the owner's existing choice (PDF_ACK_KN) and
 * must remain the default. The rest are equally short spoken forms that a
 * Mysuru salesperson actually uses; none of them is a literary construction.
 */
export const ACK_VARIANTS_KN: readonly AckVariant[] = [
  {
    kind: 'recognition',
    text: 'ಸರ್ತಿ',
    note: "Owner's original choice. Neutral 'alright / sure'. Never trips the thanks detector.",
    validatedByNativeSpeaker: false,
  },
  {
    kind: 'recognition',
    text: 'ಹೌದು',
    note: "'ಹೌದು' is the most common spoken yes/okay in colloquial Kannada. Carries recognition, not enthusiasm.",
    validatedByNativeSpeaker: false,
  },
  {
    kind: 'recognition',
    text: 'ಆಯಿತು',
    note: "'got it' — natural in speech, slightly more familiar than ಸರ್ತಿ. Good after a name.",
    validatedByNativeSpeaker: false,
  },
  {
    kind: 'transition',
    text: 'ಸರಿ',
    note: "Short, calm 'right / ok'. Sits well directly before the areas line.",
    validatedByNativeSpeaker: false,
  },
  {
    kind: 'continuation',
    text: 'ಅರ್ಥಾಯಿತು',
    note: "'understood'. One word in speech, and reads as attentive rather than mechanical.",
    validatedByNativeSpeaker: false,
  },
];

/**
 * Deterministic per-call ROTATION of the acknowledgement set.
 *
 * WHY THIS EXISTS — this is a bug that the unit tests could not see. The engine
 * keeps a fresh no-repeat guard per call and asks for "the first phrase not yet
 * used". With a fresh guard that ALWAYS returns element 0, so every single call
 * in every campaign still opened with the identical beat: the set varied the
 * REPAIR but never the first thing the caller heard, which is the one they are
 * most likely to notice. Rotating by a stable per-call seed fixes that without
 * introducing randomness — the same call always produces the same sequence, so
 * a live call is still reproducible and a test is still assertable.
 *
 * `seed` should come from the call's opaque id. Returns a copy; never mutates.
 */
export function acknowledgementPoolFor(
  seed: number,
  variants: readonly AckVariant[] = ACK_VARIANTS_KN,
): string[] {
  const texts = variants.map((v) => v.text);
  if (texts.length < 2) return texts;
  const n = texts.length;
  const offset = ((Math.trunc(seed) % n) + n) % n;
  return texts.slice(offset).concat(texts.slice(0, offset));
}

/** Stable numeric seed from an opaque call id (base-36 hash string). */
export function acknowledgementSeed(callId: string | null | undefined): number {
  const raw = String(callId || '').replace(/[^0-9a-z]/gi, '');
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 36);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

/** Hard safety gate. Every produced acknowledgement MUST pass this. */
export function isSafeAcknowledgement(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (hasThanksClosing(t)) return false;
  if (t.split(/\s+/).length > ACK_MAX_WORDS) return false;
  return true;
}

function squash(s: string): string {
  return s.replace(/\s+/gu, '');
}

/**
 * Choose ONE acknowledgement deterministically.
 *
 * `variantIndex` is the call ordinal (or any stable per-call counter) — NOT a
 * random number. Two reasons: a live call must be reproducible when something
 * goes wrong, and a unit test must be able to assert the exact phrase. Given
 * the same inputs this always returns the same phrase.
 *
 * `avoid` is the list of phrases already used on this call. It is honoured
 * BEFORE the index is applied, so a caller never hears the same acknowledgement
 * twice, and a second repair cannot hand back the phrase the first one used.
 */
export function chooseAcknowledgement(args: {
  kind?: AckKind;
  /** Stable per-call counter, e.g. how many acknowledgements have been used. */
  variantIndex?: number;
  /** Phrases already spoken on this call. */
  avoid?: readonly string[];
  /** Pin to the owner's single word (rollback switch, and the default). */
  legacyOnly?: boolean;
}): string {
  const { kind, variantIndex = 0, avoid = [], legacyOnly = false } = args;
  const avoided = new Set(avoid.map(squash));
  const base = DEFAULT_ACK_WORD_KN;

  if (legacyOnly) return base;

  const pool = ACK_VARIANTS_KN.filter((v) => (kind ? v.kind === kind : true)).filter(
    (v) => !avoided.has(squash(v.text)),
  );
  // Fall back to any unused variant before reusing one: exhausting the pool is
  // allowed, repeating a used phrase is not.
  const usable = pool.length
    ? pool
    : ACK_VARIANTS_KN.filter((v) => !avoided.has(squash(v.text)));

  const pick = usable.length ? usable[Math.abs(variantIndex) % usable.length] : null;
  return pick ? pick.text : base;
}

/**
 * Attach the caller's name (with the right honorific) to an acknowledgement.
 *
 * OWNER RULE: the acknowledgement CARRIES THE NAME, and a title exists only
 * for a captured name. With no name there is NO honorific — the old
 * "fall back to a bare ಸರ್" behaviour is what put ಸರ್ in her mouth before she
 * had ever heard the caller's name.
 *
 * This is the owner's decision D4: the acknowledgement is
 * not a greeting, and it is not allowed to become a sentence.
 */
export function acknowledgementWithName(
  base: string,
  name: string | null | undefined,
  _honorific?: string,
): string {
  const who = nameWithHonorific(name);
  return who ? `${base} ${who}` : base;
}

/* ------------------------------------------------------------------ *
 * CALLER SIGNAL → TONE STRATEGY
 * ------------------------------------------------------------------ */

export type CallerSignal =
  | 'neutral'
  | 'short_answer'
  | 'long_answer'
  | 'hesitant'
  | 'busy'
  | 'confused'
  | 'annoyed'
  | 'interested'
  | 'uninterested';

const SHORT_ANSWER_MAX_CHARS = 12;
const LONG_ANSWER_MIN_CHARS = 90;

const BUSY_RE =
  /(\b(?:busy|occupied|not possible right now|call me later|in a meeting|driving|at work right now|give me a (call|ring))\b|ಇದೀಗ ಬರುವುದಿಲ್ಲ|ಮತ್ತೆ ಕರೆ|ಕೆಲವು ಕೆಲವು ಸಮಯ)/i;
/*
 * NOTE: a bare "what" is deliberately NOT in this pattern. "what is the rate?"
 * is a PRICE QUESTION, not a failure to understand, and classifying it as
 * confusion told the agent to re-explain the same point instead of answering
 * the step. Confusion must be an actual comprehension failure — a request to
 * repeat, or an explicit statement that they did not follow.
 */
const CONFUSED_RE =
  /(\b(?:sorry\s*,?\s*(?:what|come again)|come again|pardon|one more time|can you repeat|repeat that|didn'?t (?:hear|catch|get|follow)|not follow|didn'?t understand|confused)\b|ಏನು ಅರ್ಥ|ಮತ್ತೆ ಹೇಳಿ|ಕೇಳುತ್ತಿದೆ ಅಲ್ಲ|ಅರ್ಥ ಆಗಲಿಲ್ಲ)/i;
const ANNOYED_RE =
  /(\b(?:stop calling|don'?t call again|remove my number|annoying|frustrat\w*|fed up|already told you)\b|ತಡೆ|ಇನ್ನೂ ಕರೆ ಮಾಡಬೇಡಿ|ಬೇಡ)/i;
const INTERESTED_RE =
  /(\b(?:interested|tell me more|send (?:me )?(?:the )?(?:details|info)|when can i visit|price|rate|emi|loan|book\w*|how much)\b|ಆಸಕ್ತಿ|ಹೆಚ್ಚು ಹೇಳಿ|ವಿವರ|ಬೆಳೆಕೊಳ್ಳು|ಯಾವಾಗ)/i;
const NOT_INTERESTED_RE =
  /(\b(?:not interested|no interest|don'?t want|didn'?t ask for this|wrong number)\b|ಆಸಕ್ತಿ ಇಲ್ಲ|ಬೇಡ|ತಪ್ಪ ಸಂಖ್ಯೆ)/i;
const HESITANT_RE =
  /(\b(?:maybe|not sure|dunno|don'?t know|thinking|let me think|just looking|only browsing)\b|ಅಂದ್ರೆ|ತಿಳಿಯಿಲ್ಲ|ಯೋಚಿಸಿ|ನೋಡುತ್ತಿದ್ನಿ)/i;

/**
 * Classify ONE caller utterance into a communication signal.
 *
 * Order matters and is intentional:
 *   1. ANNOYED outranks BUSY — annoyed needs concision AND respect, and
 *      treating it as merely "busy" would keep talking.
 *   2. A REFUSAL outranks a repeat request and outranks interest. "not
 *      interested, what is the rate anyway" must close the call, not trigger a
 *      re-explanation of the current step. (This ordering was wrong once: the
 *      old pattern matched a bare "what" and answered a decline with
 *      confusion.)
 *   3. A request to repeat outranks interest — a caller who says "can you
 *      repeat that?" needs the repeat, not a sales move.
 */
export function detectCallerSignal(text: string): CallerSignal {
  const t = String(text || '').trim();
  if (!t) return 'neutral';

  if (ANNOYED_RE.test(t)) return 'annoyed';
  if (NOT_INTERESTED_RE.test(t)) return 'uninterested';
  if (BUSY_RE.test(t)) return 'busy';
  if (CONFUSED_RE.test(t)) return 'confused';
  if (INTERESTED_RE.test(t)) return 'interested';
  if (HESITANT_RE.test(t)) return 'hesitant';

  const len = t.length;
  if (len <= SHORT_ANSWER_MAX_CHARS) return 'short_answer';
  if (len >= LONG_ANSWER_MIN_CHARS) return 'long_answer';
  return 'neutral';
}

/**
 * The private instruction that adapts COMMUNICATION STRATEGY for this turn.
 *
 * What it may change: how long the turn is, how much she explains, how direct
 * she is. What it may never change: which step of the call she is on, the
 * pinned wording of an anchored line, what she is allowed to claim, or the
 * single-pace rule. It is deliberately phrased as a length/strategy hint, not
 * an emotional one — the personality is fixed and the strategy is what flexes.
 */
export function buildToneDirective(signal: CallerSignal): string {
  switch (signal) {
    case 'busy':
      return (
        'SYSTEM (internal): the caller is pressed for time. Keep your next turn to ONE short ' +
        'sentence — say only what the current step needs, no extra detail, no second thought. ' +
        'Same calm level, just shorter. Do not add warmth, do not apologise, and do not keep them on the line.'
      );
    case 'annoyed':
      return (
        'SYSTEM (internal): the caller sounds irritated. Be especially brief and respectful: ' +
        'one short sentence, no re-asking, no selling, no "just one more thing". If it is the ' +
        'not-interested or busy close, take it and end the call cleanly.'
      );
    case 'confused':
      return (
        'SYSTEM (internal): the caller did not follow. Make the SAME point more simply — one ' +
        'idea, plain everyday words, the same length as before, not longer. Then STOP and let them ' +
        'answer. Do not ask a new question and do not apologise twice.'
      );
    case 'short_answer':
      return (
        'SYSTEM (internal): the caller answered in very few words. Match that — answer in a short ' +
        'turn yourself. A short answer is NOT enthusiasm and NOT consent to a longer pitch. ' +
        'Say what the current step needs and stop.'
      );
    case 'long_answer':
      return (
        'SYSTEM (internal): the caller explained at length. Do not summarise it back to them. ' +
        'Acknowledge in one beat and move to the current step in ONE short sentence.'
      );
    case 'hesitant':
      return (
        'SYSTEM (internal): the caller sounds unsure. Take the pressure off — do not push, do not ' +
        'repeat the question, do not add a second question. Give them room with one short line.'
      );
    case 'interested':
      return (
        'SYSTEM (internal): the caller sounds interested. Warmth may go up slightly — still the ' +
        'same calm pace and the same volume — but keep it short. Interest is not permission to ' +
        'add detail, a price, an offer, or another question.'
      );
    case 'uninterested':
      return (
        'SYSTEM (internal): the caller is not interested. Stop selling. Close kindly and briefly, ' +
        'once, and end the call. Do not argue, do not name more projects, do not ask why.'
      );
    case 'neutral':
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ *
 * REPETITION PROTECTION
 * ------------------------------------------------------------------ */

/**
 * A tiny immutable "what have we already said" guard.
 *
 * It exists because three separate loops can otherwise repeat themselves: the
 * acknowledgement, the step repair, and the "you already said that" nudge. The
 * failure it prevents is a caller hearing the exact same phrase twice while
 * the agent appears not to notice.
 */
export type RecentSpoken = {
  /** Most recent last. */
  keys: readonly string[];
  limit: number;
};

export function createRecentSpoken(limit = 4): RecentSpoken {
  return { keys: [], limit: Math.max(1, limit) };
}

export function rememberSpoken(guard: RecentSpoken, key: string): RecentSpoken {
  const k = String(key || '').trim();
  if (!k) return guard;
  const keys = [k, ...guard.keys].slice(0, guard.limit);
  return { ...guard, keys };
}

/** True when this exact key was already used inside the guard window. */
export function wasSpoken(guard: RecentSpoken, key: string): boolean {
  const k = squash(String(key || '').trim());
  return guard.keys.some((existing) => squash(existing) === k);
}

/**
 * Pick the first candidate that is not already in the guard window; remember it.
 * Falls back to the first candidate when the whole pool has been used, because
 * being repetitive is strictly better than being silent.
 */
export function pickUnspoken<T>(
  guard: RecentSpoken,
  keyFor: (candidate: T) => string,
  candidates: readonly T[],
): { pick: T; guard: RecentSpoken } {
  if (!candidates.length) {
    throw new Error('pickUnspoken: candidates must not be empty');
  }
  const fresh = candidates.find((c) => !wasSpoken(guard, keyFor(c)));
  const chosen = fresh ?? candidates[0];
  return { pick: chosen, guard: rememberSpoken(guard, keyFor(chosen)) };
}
