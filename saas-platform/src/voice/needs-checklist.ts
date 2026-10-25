/**
 * ============================================================================
 *   NEEDS CHECKLIST — the agent's to-do list for one call.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 *
 * The pinned five-step call told the sales team WHO was interested but almost
 * nothing about WHAT the caller actually needs. The lead reached the employee's
 * screen carrying a name, a phone number and a transcript — so the human had to
 * re-ask the two qualifying questions the caller had just answered to a
 * machine. That second interview is what this module removes.
 *
 * THE TO-DO LIST, AND ITS LIMITS
 *
 * Two items, in this fixed order, and only after the areas line has landed:
 *
 *   1. purpose   — is this for investment, or to build a home?
 *   2. locality  — which area are they looking in?
 *
 * They are the two answers that decide which project the employee opens with,
 * and both are answerable from facts the business already has. Budget, size,
 * timeline and site-visit willingness were deliberately NOT added: every extra
 * question is another way for a cold call to feel like a form, which is the
 * single most-complained-about failure mode of this agent (see
 * docs/HUMAN_VS_HUMAN_GAP_AUDIT.md §14). Two items is the smallest list that
 * still qualifies the lead.
 *
 * HARD INVARIANTS (all unit-tested; none of these may be relaxed)
 *   - An item that has been ANSWERED is never asked again.
 *   - An item the caller ALREADY VOLUNTEERED is never asked at all — if they
 *     said "I want a plot in Hunsur for investment", both items are already
 *     known and the checklist is done before a single question is spoken.
 *   - An unanswered item NEVER blocks the close. If the caller goes quiet, the
 *     silence protocol closes the call as before and the checklist is simply
 *     left partly empty — the employee gets whatever was collected.
 *   - One question open at a time, exactly like every other step in this flow.
 *   - No question may trip `hasThanksClosing` — that is the engine's close
 *     trigger, so a stray ಧನ್ಯವಾದ in a nudge would hang the call up.
 *   - The questions are NOT pinned lines: they are reworded naturally by the
 *     model, exactly like the interest question. The strings below are the
 *     SUBSTANCE, and they are marked for native-speaker review.
 *
 * KANNADA CAVEAT — READ BEFORE TOUCHING THE PHRASES
 *   The two question lines are spoken Mysuru Kannada and both are flagged
 *   `validatedByNativeSpeaker: false` until a native speaker signs them off,
 *   matching the convention in conversation-naturalness.ts and
 *   docs/KANNADA_STYLE_GUIDE.md.
 *
 * Pure helpers only — no engine state, no I/O, no time. Wired from logic.ts.
 */

import {
  NEEDS_LOCALITY_QUESTION_KN,
  NEEDS_PURPOSE_QUESTION_KN,
  allowedLayoutsList,
} from './kannada-script';

/** The two checklist items, in the order they are asked. */
export const NEED_IDS = ['purpose', 'locality'] as const;

export type NeedId = (typeof NEED_IDS)[number];

/** Why an item will not be asked. Recorded so the dashboard note is honest. */
export type NeedSkipReason =
  /** The caller had already given this away before we asked. */
  | 'volunteered'
  /** They declined to answer the question we asked. */
  | 'declined'
  /** They answered, but nothing usable came out of the reply. */
  | 'unreadable';

export const NEED_SKIP_REASONS: readonly NeedSkipReason[] = [
  'volunteered',
  'declined',
  'unreadable',
] as const;

/** What the caller said, in the form the sales employee will read. */
export type NeedAnswer = {
  id: NeedId;
  /** Canonical, English, human-readable — this is what reaches the employee. */
  label: string;
  /** The caller's own words, trimmed. Kept for the call summary/transcript. */
  raw: string;
};

export type SkippedNeed = {
  id: NeedId;
  why: NeedSkipReason;
};

export type NeedsChecklist = {
  /** Items actually asked, in order. */
  asked: NeedId[];
  /** Items resolved by an answer. */
  answered: NeedAnswer[];
  /** Items deliberately not asked. */
  skipped: SkippedNeed[];
};

/**
 * The question lines, keyed by item.
 *
 * The STRINGS live in kannada-script.ts (with every other spoken line, so the
 * prompt and the engine read the same text) and are re-exported here for the
 * nudge builders. Spoken Mysuru Kannada, loanwords kept in English the way a
 * local salesperson says them (ಸೈಟ್, ಇನ್ವೆಸ್ಟ್ಮೆಂಟ್), and contract verb forms
 * (ನೋಡ್ತಿದೀರಾ) rather than bookish ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ — see LANGUAGE_RULES.
 *
 * NOT pinned: the model says the sense of these in its own words.
 */
export const NEED_QUESTION_KN: Record<NeedId, string> = {
  purpose: NEEDS_PURPOSE_QUESTION_KN,
  locality: NEEDS_LOCALITY_QUESTION_KN,
};

/**
 * Native-speaker sign-off state. Every phrase below is written in spoken Mysuru
 * Kannada and must be heard by a native speaker before it is trusted in
 * production; until then it is flagged here and in the style guide.
 */
export const NEED_PHRASE_VALIDATION: Record<NeedId, { validatedByNativeSpeaker: boolean; note: string }> = {
  purpose: {
    validatedByNativeSpeaker: false,
    note:
      'Two-option question (investment vs building). The guardrails document already specifies this ' +
      'question in English; the Kannada form is unaudited.',
  },
  locality: {
    validatedByNativeSpeaker: false,
    note:
      'Deliberately open — naming the localities here would anchor the caller to what we happen to ' +
      'have instead of telling us what they want.',
  },
};

/** Human labels used in prompts and on the dashboard. */
export const NEED_LABEL: Record<NeedId, string> = {
  purpose: 'Purpose',
  locality: 'Preferred locality',
};

/* ------------------------------------------------------------------ *
 * STATE
 * ------------------------------------------------------------------ */

export function createNeedsChecklist(): NeedsChecklist {
  return { asked: [], answered: [], skipped: [] };
}

export function needsAnsweredIds(checklist: NeedsChecklist): NeedId[] {
  return checklist.answered.map((a) => a.id);
}

export function needsResolvedIds(checklist: NeedsChecklist): NeedId[] {
  return [...checklist.answered.map((a) => a.id), ...checklist.skipped.map((s) => s.id)];
}

export function isNeedResolved(checklist: NeedsChecklist, id: NeedId): boolean {
  return needsResolvedIds(checklist).includes(id);
}

/**
 * The next item to ASK, or null when there is nothing left to ask.
 *
 * "Unasked" is strict, and deliberately so: an item is only returned when it has
 * neither an answer nor a skip AND has not already been spoken. That is what
 * makes it impossible for the engine to ask the same question twice — the moment
 * a question goes out, `markNeedAsked` takes it out of this list, so a later turn
 * cannot hand it back.
 *
 * It follows that a question that is currently OUT and unanswered is NOT the
 * "next" item (it is the open one — see `openNeedQuestion`), and that the list is
 * finished as soon as nothing is left to ask. An unanswered item therefore never
 * holds the call open: the caller of this function gets null, sends the close, and
 * the sales employee receives an honest blank instead of a stalled call.
 *
 * This is the ONE place that decides what the agent asks next, so the "never
 * re-ask" and "skip what they volunteered" rules cannot drift apart between the
 * engine and the tests.
 */
export function nextUnaskedNeed(checklist: NeedsChecklist): NeedId | null {
  for (const id of NEED_IDS) {
    if (isNeedResolved(checklist, id)) continue;
    if (checklist.asked.includes(id)) continue;
    return id;
  }
  return null;
}

export function markNeedAsked(checklist: NeedsChecklist, id: NeedId): NeedsChecklist {
  if (checklist.asked.includes(id)) return checklist;
  return { ...checklist, asked: [...checklist.asked, id] };
}

/** Record an answer. A second answer for the same item never overwrites the first. */
export function recordNeedAnswer(
  checklist: NeedsChecklist,
  id: NeedId,
  utterance: string,
  label?: string,
): NeedsChecklist {
  if (isNeedResolved(checklist, id)) return checklist;
  const raw = normalizeNeedLine(utterance);
  const resolvedLabel = label && label.trim() ? label.trim() : deriveNeedLabel(id, raw);
  return {
    ...checklist,
    answered: [...checklist.answered, { id, label: resolvedLabel, raw }],
  };
}

export function skipNeed(
  checklist: NeedsChecklist,
  id: NeedId,
  why: NeedSkipReason,
): NeedsChecklist {
  if (isNeedResolved(checklist, id)) return checklist;
  return { ...checklist, skipped: [...checklist.skipped, { id, why }] };
}

/** True when nothing is left to ASK — not "everything was answered". */
export function isNeedsComplete(checklist: NeedsChecklist): boolean {
  return nextUnaskedNeed(checklist) === null;
}

/**
 * The question currently waiting for an answer: an item that was asked and is
 * still unresolved, or null when nothing is open.
 *
 * Kept separate from `nextUnaskedNeed` because the two answer different
 * questions — "what did I ask and not hear back on" (this one) versus "what is
 * left to ask" — and a caller's reply belongs to the former.
 */
export function openNeedQuestion(checklist: NeedsChecklist): NeedId | null {
  for (let i = checklist.asked.length - 1; i >= 0; i--) {
    const id = checklist.asked[i];
    if (!isNeedResolved(checklist, id)) return id;
  }
  return null;
}

export function needsAnswer(checklist: NeedsChecklist, id: NeedId): NeedAnswer | null {
  return checklist.answered.find((a) => a.id === id) ?? null;
}

/** True when ANY need has been collected — used to decide if it is worth writing. */
export function hasAnyNeedAnswer(checklist: NeedsChecklist): boolean {
  return checklist.answered.length > 0;
}

function normalizeNeedLine(text: string): string {
  return String(text || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
}

/* ------------------------------------------------------------------ *
 * DERIVATION — what the caller's own words already tell us
 * ------------------------------------------------------------------ */

/** Anything that reads as an internal directive must never enter an answer. */
const DIRECTIVE_SHAPED =
  /(SYSTEM\s*\(internal|SYSTEM CONTEXT|\[SYSTEM|PRIVATE MATERIAL|endCall\(|nudge says)/i;

const INVESTMENT_RE =
  /(\binvest(?:ment|ing|or)?\b|\brental\b|\bappreciation\b|ಇನ್ವೆಸ್ಟ್ಮೆಂಟ್|ಇನ್ವೆಸ್ಟ್|ಹೂಡಿಕೆ|ಹೂಡಿಕೆಗೆ)/i;

/**
 * "Build a home" covers both the verb and the noun a caller actually uses.
 * `ಕಟ್ಟೋಕೆ`/`ಕಟ್ಟಿಸೋಕೆ`/ಮನೆ are the spoken forms; `construction` is the
 * loanword version. `ಇಲ್ಲ` is deliberately NOT here — it is a refusal, not a
 * purpose, and reading it as "construction" was exactly the kind of mistake
 * this module must not make.
 */
const CONSTRUCTION_RE =
  /(\bconstruction\b|\bbuild(?:ing)?\b|\bhouse\b|\bhome\b|\bflat\b|\bvilla\b|ಮನೆ|ಕಟ್ಟೋಕೆ|ಕಟ್ಟಿಸೋಕೆ|ಕಟ್ಟಲು|ಕಟ್ಟುವ)/i;

/**
 * Canonical locality labels. The first four are the areas already named in the
 * pinned areas line, so a caller who says "Hunsur Road" is understood without
 * the agent ever reading the list aloud. The rest are the localities the
 * business already recognises elsewhere in the prompts.
 *
 * English label first, then every spelling a caller or an STT engine may
 * produce (English, Kannada script, and common transliterations).
 */
const LOCALITY_MATCHERS: { label: string; pattern: RegExp }[] = [
  { label: 'Hunsur Road', pattern: /(hunsur|ಹುಣಸೂರು|hunsoor|hun-sur)/i },
  { label: 'T. Narasipura Road', pattern: /(narasipura|ನರಸೀಪುರ|narsipur)/i },
  { label: 'Srirampura', pattern: /(srirampura|ಶ್ರೀರಾಂಪುರ|sreerampura)/i },
  { label: 'K.R. Nagar', pattern: /(k\.?\s?r\.?\s?nagar|ಕೆ\.?\s?ಆರ್\.?\s?ನಗರ|kr nagar)/i },
  { label: 'Bannur Road', pattern: /(bannur|ಬನ್ನೂರು|ಬನ್ನೂರ)/i },
  { label: 'Nanjangud', pattern: /(nanjangud|ನಂಜನಗೂಡು|nanjanagud)/i },
  { label: 'Bogadi Road', pattern: /(bogadi|ಬೊಗಾದಿ|ಬೋಗಾದಿ)/i },
  { label: 'Mysuru city', pattern: /(mysuru|mysore|ಮೈಸೂರು|ಮೈಸೂರಿನ)/i },
];

/** Labels that mean "they named somewhere we do not have a project". */
const OTHER_LOCALITY_LABEL = 'Other area named';

export type NeedPurpose = 'investment' | 'construction' | 'unclear';

/**
 * Classify the caller's words into one of the two purposes.
 *
 * Order: construction is checked FIRST because "looking for investment to
 * build a house" contains both words, and a caller who mentions building is
 * building — an investor does not say ಮನೆ ಕಟ್ಟಿಸೋಕೆ.
 */
export function derivePurpose(text: string): NeedPurpose {
  const t = String(text || '');
  if (!t.trim()) return 'unclear';
  if (DIRECTIVE_SHAPED.test(t)) return 'unclear';
  if (CONSTRUCTION_RE.test(t)) return 'construction';
  if (INVESTMENT_RE.test(t)) return 'investment';
  return 'unclear';
}

/** The canonical locality label, or null when nothing recognisable was named. */
export function deriveLocality(text: string): string | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (DIRECTIVE_SHAPED.test(t)) return null;
  for (const { label, pattern } of LOCALITY_MATCHERS) {
    if (pattern.test(t)) return label;
  }
  return null;
}

function deriveNeedLabel(id: NeedId, text: string): string {
  if (id === 'purpose') {
    const p = derivePurpose(text);
    return p === 'unclear' ? 'Not stated' : p;
  }
  return deriveLocality(text) ?? OTHER_LOCALITY_LABEL;
}

/**
 * Absorb anything the caller gave away BEFORE being asked.
 *
 * A caller who answers the interest question with "I want a plot in Hunsur to
 * build a house" has already answered the whole checklist. Asking both
 * questions anyway is the single most robotic thing this agent could do, so
 * this runs on every caller utterance while the checklist is open.
 *
 * Only utterances that actually resolve something are touched; everything else
 * returns the same object, so this is safe to call unconditionally.
 */
export function absorbVolunteeredNeeds(
  checklist: NeedsChecklist,
  utterance: string,
): NeedsChecklist {
  const raw = String(utterance || '');
  if (!raw.trim()) return checklist;
  let next = checklist;

  // The item we are currently waiting on is NOT a volunteer — its answer is
  // recorded by the caller of this function, from the very same utterance.
  const open = openNeedQuestion(checklist);

  if (open !== 'purpose' && !isNeedResolved(next, 'purpose')) {
    const purpose = derivePurpose(raw);
    if (purpose !== 'unclear') next = recordNeedAnswer(next, 'purpose', raw, purpose);
  }

  if (open !== 'locality' && !isNeedResolved(next, 'locality')) {
    const locality = deriveLocality(raw);
    if (locality) next = recordNeedAnswer(next, 'locality', raw, locality);
  }

  return next;
}

/* ------------------------------------------------------------------ *
 * PROMPTS — what the agent is told to say
 * ------------------------------------------------------------------ */

/**
 * The nudge that asks ONE checklist item.
 *
 * Shape mirrors every other step nudge in this codebase: the substance of the
 * line, said in the model's own words, in the current language, followed by an
 * explicit STOP. The acknowledgement (`ackWord`) is passed in from
 * conversation-naturalness so the beat before the question varies per call
 * instead of being the same token on every dial.
 *
 * The nudge is also the place the "never re-ask" rule is stated to the model,
 * because a model that re-asks an answered question speaks over a caller who
 * has already told us — the failure this whole module exists to prevent.
 */
export function buildNeedQuestionNudge(
  id: NeedId,
  args: {
    acquired?: string | null;
    /** The per-call acknowledgement beat, e.g. ಆಯಿತು. Never a thanks. */
    ackWord?: string;
  } = {},
): string {
  const { ackWord } = args;
  const who =
    'Say only the one question for this step. Say nothing else. Use NO honorific (never ಸರ್, never ಮಾಮ್).';
  const beat = ackWord
    ? `You may open with ONE short word of your own — the Kannada beat "${ackWord}" — and nothing more than that single word. `
    : 'Do not open with any reaction. ';
  const asked = askedSummaryFor(id);

  if (id === 'purpose') {
    return (
      `SYSTEM (internal): the caller is interested and the projects have already been given. ` +
      `${who} This is the NEXT STEP of the call: ask them ONE short question, then stop. ` +
      `${beat}` +
      `Ask, in the CURRENT conversation language and in YOUR OWN WORDS, what they need the plot for — the sense is ` +
      `"${NEED_QUESTION_KN.purpose}" — an investment, or to build a home. That is the whole question: ` +
      `just those two options, nothing else. ` +
      `Do NOT ask about budget, plot size, documents, loans, possession, or when they want to buy; ` +
      `do NOT ask permission to continue and do NOT promise any later step. ` +
      `Do NOT ask anything you have already asked on this call. ${asked}` +
      `NEVER say thank you, thanks or ಧನ್ಯವಾದ in this turn — that word ends the call. ` +
      `Then STOP and WAIT for their answer.`
    );
  }

  return (
    `SYSTEM (internal): the caller is interested and the projects have already been named. ` +
    `${who} This is the NEXT STEP of the call: ask them ONE short question, then stop. ` +
    `${beat}` +
    `Ask, in the CURRENT conversation language and in YOUR OWN WORDS, which area they are looking in — ` +
    `the sense is "${NEED_QUESTION_KN.locality}". Keep it open: do NOT read out the projects, ` +
    `do NOT steer them to ${allowedLayoutsList()}, and do NOT offer a menu. ` +
    `Do NOT ask about budget, plot size, documents, loans or possession, and do NOT ask permission to continue. ` +
    `Do NOT ask anything you have already asked on this call. ${asked}` +
    `NEVER say thank you, thanks or ಧನ್ಯವಾದ in this turn — that word ends the call. ` +
    `Then STOP and WAIT for their answer.`
  );
}

/**
 * States the whole list to the model, because a model that cannot see the end
 * of the checklist invents extra questions. Two items, named, nothing else.
 */
function askedSummaryFor(id: NeedId): string {
  const other: NeedId = id === 'purpose' ? 'locality' : 'purpose';
  return (
    `(This call asks exactly two of these questions — ${NEED_LABEL[id]} and ${NEED_LABEL[other]} — ` +
    `and this is one of them. There is no third.) `
  );
}

/**
 * Dead-air repair for a checklist question, sent only when the question
 * produced no audible audio at all — same contract as the name-question retry.
 */
export function buildNeedQuestionRetryNudge(
  id: NeedId,
  args: { acquired?: string | null } = {},
): string {
  const who = 'Say only the one question for this step. Say nothing else. Use NO honorific — never ಸರ್, never ಮಾಮ್.';
  return (
    `SYSTEM (internal): your last turn produced NO sound and the caller is waiting in silence. ${who} ` +
    `Say the question NOW, out loud, in the CURRENT conversation language and in your own words — the sense is ` +
    `"${NEED_QUESTION_KN[id]}". One short question, nothing before it and nothing after it. ` +
    `Do NOT repeat the projects, do NOT repeat the opening and do NOT say thank you.`
  );
}

/* ------------------------------------------------------------------ *
 * RECALL + PERSISTENCE
 * ------------------------------------------------------------------ */

/**
 * What the checklist has collected, as fact lines for a RESTARTED session.
 *
 * logic.ts rebuilds the Gemini session on a stalled stream, and the new session
 * starts with an empty history — so without this block a caller whose line
 * dropped mid-checklist gets asked the same question twice. Returns '' when
 * nothing is known, so an early reconnect injects nothing at all.
 */
export function buildNeedsContext(checklist: NeedsChecklist): string {
  const lines: string[] = [];
  const purpose = needsAnswer(checklist, 'purpose');
  const locality = needsAnswer(checklist, 'locality');

  if (purpose) {
    lines.push(`Purpose: ${purpose.label}${purpose.raw ? ` (their words: "${purpose.raw}")` : ''}`);
  }
  if (locality) {
    lines.push(
      `Preferred locality: ${locality.label}${locality.raw ? ` (their words: "${locality.raw}")` : ''}`,
    );
  }
  if (!lines.length) return '';

  const skipped = checklist.skipped.length
    ? ` Not asked: ${checklist.skipped.map((s) => `${NEED_LABEL[s.id]} (${s.why})`).join(', ')}.`
    : '';

  return (
    'WHAT THE CALLER HAS ALREADY TOLD YOU (your session was restarted; this is the only record of it):\n' +
    lines.map((l) => `- ${l}`).join('\n') +
    `\nNever ask again for anything listed above.${skipped} Carry straight on with the next step of the call.`
  );
}

/** The fields the engine writes to the lead at the end of the call. */
export type NeedsPersistFields = {
  needPurpose: string | null;
  needLocality: string | null;
};

/**
 * The two lead columns, ready to write.
 *
 * ONE write at the end of the call, never per answer: AGENTS.md forbids
 * high-frequency database writes, and the existing summary write already runs
 * at exactly this moment.
 */
export function needsPersistFields(checklist: NeedsChecklist): NeedsPersistFields {
  return {
    needPurpose: needsAnswer(checklist, 'purpose')?.label ?? null,
    needLocality: needsAnswer(checklist, 'locality')?.label ?? null,
  };
}

/** One line for the written call summary the employee reads. */
export function needsSummaryLine(checklist: NeedsChecklist): string {
  const parts: string[] = [];
  const purpose = needsAnswer(checklist, 'purpose');
  const locality = needsAnswer(checklist, 'locality');
  if (purpose) parts.push(`purpose: ${purpose.label}`);
  if (locality) parts.push(`preferred locality: ${locality.label}`);
  if (!parts.length) return '';
  return `Needs collected on the call — ${parts.join('; ')}.`;
}
