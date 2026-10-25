/**
 * ============================================================================
 *   CALL MEMORY — what the caller already told us, in a form that survives a
 *   dropped session.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 *
 * A human salesperson remembers the last thirty seconds of the call without
 * trying. The Gemini Live session remembers it too — while the session is
 * alive. The session is not always alive: `logic.ts` reconnects on a stalled
 * audio stream or a closed socket, and the reconnect builds a FRESH session
 * ("RECONNECT IMPLEMENTATION — fresh session + restored state + resume line").
 * What is restored is the instructions — the full call guide, the project
 * reference and the runtime state block. What is NOT restored is the dialogue:
 * the caller's own words are gone, because the new session starts with an
 * empty history.
 *
 * The runtime block encodes the STEP ("the opening was already spoken") but not
 * the CONTENT (they said their name is Ravi, they asked about Hunsur, they said
 * they are driving). So a caller whose line drops mid-call can get asked
 * something they already answered. That is the single most human-detectable
 * memory failure there is: "I already told you that."
 *
 * This module is a bounded transcript of exactly that — the caller's recent
 * utterances, the agent's own last line, and the facts the flow has captured —
 * rendered as one private context block the reconnect injects. It is a recall
 * aid, not a transcript store:
 *
 *   - BOUNDED: the last few utterances, each truncated. A recall block that
 *     grows with the call would eventually cost more than it gives.
 *   - SILENT BY DEFAULT: with nothing remembered it returns '' and the caller
 *     of this module injects nothing. Absent information must not become
 *     prompt noise.
 *   - PRIVATE: every line is wrapped so the model treats it as background. It
 *     also refuses to carry anything that looks like a system directive, so a
 *     stray internal string can never be laundered into the conversation.
 *   - NO NEW FACTS: it repeats only what the caller said and what the flow
 *     already knows. It cannot invent a name, a locality or a price.
 *
 * Pure helpers — unit-tested without a live call. Wired from logic.ts.
 */

import { looksLikeSpokenNameQuestion } from './kannada-script';
export const RECALL_MAX_UTTERANCES = 4;

/** Per-utterance cap. Long enough for a real answer, short enough to stay cheap. */
export const RECALL_MAX_CHARS_PER_LINE = 160;

/** The step the call has reached. Mirrors the runtime state block's own words. */
export type CallStep = 'opening' | 'locations' | 'projects' | 'closing' | 'ended';

export type CallMemory = {
  /** Caller utterances, oldest first. Most recent last. */
  callerLines: readonly string[];
  /** The last line the agent actually spoke to the caller. */
  lastAgentLine: string | null;
  /** The caller's name, once the flow has captured one. */
  callerName: string | null;
  /** ಸರ್ / ಮಾಮ್, once chosen. */
  honorific: string | null;
  /** Where the flow is. */
  step: CallStep;
  /** The active conversation language at the time of the recall. */
  language: string | null;
};

export function createCallMemory(): CallMemory {
  return {
    callerLines: [],
    lastAgentLine: null,
    callerName: null,
    honorific: null,
    step: 'opening',
    language: null,
  };
}

/**
 * Anything that reads as an internal directive, not as caller speech.
 *
 * This is a safety filter with a specific failure in mind: the recall block is
 * injected as a `user` turn, so a line that reached this module from the wrong
 * place would be replayed to the model as though the caller had said it. The
 * module prefers to drop a line than to relay a directive.
 */
const DIRECTIVE_SHAPED =
  /(SYSTEM\s*\(internal|SYSTEM CONTEXT|\[SYSTEM|PRIVATE MATERIAL|endCall\(|nudge says|internal, private)/i;

/**
 * Normalise one caller utterance for storage.
 * Returns '' when the line is not worth remembering.
 */
export function normalizeCallerLine(text: string): string {
  const t = String(text || '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!t) return '';
  if (DIRECTIVE_SHAPED.test(t)) return '';
  return t.length > RECALL_MAX_CHARS_PER_LINE
    ? `${t.slice(0, RECALL_MAX_CHARS_PER_LINE - 1).trimEnd()}…`
    : t;
}

function squash(s: string): string {
  return String(s || '').replace(/\s+/gu, '').toLowerCase();
}

/**
 * Remember one caller utterance.
 *
 * Consecutive duplicates collapse: on a bad line the same "ಹೌದು" can arrive
 * twice, and listing it twice makes the recall block look like a machine wrote
 * it — which is exactly the impression it exists to prevent. A repeat that is
 * NOT consecutive is kept, because "the same answer twice" is real information
 * the agent should not re-ask about.
 */
export function rememberCallerLine(memory: CallMemory, text: string): CallMemory {
  const line = normalizeCallerLine(text);
  if (!line) return memory;
  const last = memory.callerLines[memory.callerLines.length - 1];
  if (last && squash(last) === squash(line)) return memory;
  const callerLines = [...memory.callerLines, line].slice(-RECALL_MAX_UTTERANCES);
  return { ...memory, callerLines };
}

/** Remember the agent's own last spoken line, so it is never said twice. A name question is never stored, so a restarted session cannot be told to say it. */
export function rememberAgentLine(memory: CallMemory, text: string): CallMemory {
  const line = normalizeCallerLine(text);
  if (!line || looksLikeSpokenNameQuestion(line)) return memory;
  return { ...memory, lastAgentLine: line };
}

export function setCallStep(memory: CallMemory, step: CallStep): CallMemory {
  if (memory.step === step) return memory;
  return { ...memory, step };
}

export function setKnownCaller(
  memory: CallMemory,
  patch: { name?: string | null; honorific?: string | null; language?: string | null },
): CallMemory {
  const next: CallMemory = { ...memory };
  if (patch.name !== undefined && patch.name !== null && patch.name.trim()) {
    next.callerName = patch.name.trim();
  }
  if (patch.honorific !== undefined && patch.honorific !== null && patch.honorific.trim()) {
    next.honorific = patch.honorific.trim();
  }
  if (patch.language !== undefined && patch.language !== null && patch.language.trim()) {
    next.language = patch.language.trim();
  }
  return next;
}

const STEP_LABEL: Record<CallStep, string> = {
  opening: 'the opening question has been asked; no answer needed from you yet',
  locations: 'the caller has answered the opening; the next spoken line is the locations',
  projects: 'the localities have been given',
  closing: 'the call has reached the closing step',
  ended: 'the call is over',
};

/** True when there is anything at all worth injecting. */
export function hasRecalledContext(memory: CallMemory): boolean {
  return memory.callerLines.length > 0 || Boolean(memory.lastAgentLine) || Boolean(memory.callerName);
}

/**
 * Render the recall block. Returns '' when nothing is known — the caller of
 * this function must then inject NOTHING, so an early reconnect stays silent.
 */
export function buildRecallContext(memory: CallMemory): string {
  if (!hasRecalledContext(memory)) return '';

  const lines: string[] = [
    'WHAT HAS ALREADY HAPPENED ON THIS CALL (your session was restarted mid-call; this is the only record of it).',
    `Flow position: ${STEP_LABEL[memory.step]}.`,
  ];

  if (memory.language) {
    lines.push(`The conversation is in: ${memory.language}. Do not announce or change it.`);
  }
  if (memory.callerLines.length) {
    lines.push('What the caller has already said (oldest first):');
    for (const line of memory.callerLines) lines.push(`- "${line}"`);
  }
  if (memory.lastAgentLine) {
    lines.push(`Your own last spoken line, which the caller has already heard: "${memory.lastAgentLine}"`);
  }

  lines.push(
    'Never ask again for anything listed above, never re-say your last line, and never say that you lost track, ' +
      'that your system restarted, or that you need them to repeat something already answered. Simply carry on ' +
      'from the flow position above, in the same calm tone, with audio.',
  );
  lines.push(
    'After the caller\'s yes, say the locations line. If they ask a side question, answer in one short sentence, then return to the question you were on.',
  );

  return lines.join('\n');
}
