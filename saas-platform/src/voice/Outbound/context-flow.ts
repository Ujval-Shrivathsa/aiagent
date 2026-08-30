/**
 * Outbound contextual flow — answer side questions, then resume prior topic.
 */

const PDF_OPENING = 'Hi, are you looking for a residential site in Mysuru?';
const PDF_PURPOSE_QUESTION =
  'Is this for investment, or are you looking to build a house immediately?';
const PDF_INVESTMENT_PITCH_PREFIX =
  'We currently have two projects that could be suitable';

export type OutboundConversationMemory = {
  topic: string;
  pendingQuestion: string;
  lastAiUtterance: string;
};

export const CONTEXTUAL_CONVERSATION_RULES = `CONTEXTUAL CONVERSATION FLOW (STRICT):
- If the customer asks a different or unrelated question in the middle of the conversation, answer their question first — briefly and honestly.
- After answering, naturally return to the previous topic or pending question. Do NOT restart the opening greeting.
- Do NOT make the customer repeat information they already provided (yes/no, investment vs build, etc.).
- Maintain awareness of the full conversation. Transition back naturally, like a human sales officer — e.g. "As we were discussing the projects, would you like to know more?"
- The call is a real conversation, not a rigid questionnaire. Remember where you left off.`;

const IDENTITY_QUESTION =
  /\b(who are you|who is this|who am i (?:speaking|talking) (?:to|with)|what(?:'s| is) your name|your name|which company|what company|where are you calling from|why are you calling|who called|are you (?:a )?bot|are you (?:an )?ai|nimma hesaru|yaaru idu|yaaru neevu|alliance square yaaru)\b/i;

const OFF_TOPIC_QUESTION =
  /\?|^(?:what|who|where|when|why|how|tell me|can you|could you|do you|is this|are you)\b/i;

export function looksLikeIdentityQuestion(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return IDENTITY_QUESTION.test(t);
}

/** Unrelated mid-call question that should be answered before resuming script flow. */
export function looksLikeContextInterrupt(
  text: string,
  opts?: { skipRepeat?: (t: string) => boolean; skipManager?: (t: string) => boolean },
): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (looksLikeIdentityQuestion(t)) return true;
  if (opts?.skipRepeat?.(t)) return false;
  if (opts?.skipManager?.(t)) return false;
  if (/^(yes|no|yeah|yep|nope|ok|okay|ha|hmm)\b/i.test(t)) return false;
  return OFF_TOPIC_QUESTION.test(t);
}

function extractLastQuestion(text: string): string | null {
  const t = String(text || '').trim();
  if (!t.includes('?')) return null;
  const idx = t.lastIndexOf('?');
  const start = Math.max(0, t.lastIndexOf('.', idx - 1), t.lastIndexOf('!', idx - 1));
  const q = t.slice(start > 0 ? start + 1 : 0, idx + 1).trim();
  return q.length >= 8 ? q : null;
}

export function deriveOutboundConversationMemory(
  aiText: string,
  prev?: OutboundConversationMemory | null,
): OutboundConversationMemory {
  const t = String(aiText || '').trim();
  const base: OutboundConversationMemory = {
    topic: prev?.topic || 'residential sites in Mysuru',
    pendingQuestion: prev?.pendingQuestion || PDF_OPENING,
    lastAiUtterance: t || prev?.lastAiUtterance || '',
  };
  if (!t) return base;

  if (t.includes(PDF_OPENING) || /looking for a residential site in mysuru/i.test(t)) {
    return {
      topic: 'whether they are looking for a residential site in Mysuru',
      pendingQuestion: PDF_OPENING,
      lastAiUtterance: t,
    };
  }
  if (t.includes(PDF_PURPOSE_QUESTION) || /investment.*build a house/i.test(t)) {
    return {
      topic: 'whether this is for investment or to build a house immediately',
      pendingQuestion: PDF_PURPOSE_QUESTION,
      lastAiUtterance: t,
    };
  }
  if (
    /would you like to know more about these projects/i.test(t) ||
    (t.includes('Hunsur') && /Narasipura/i.test(t))
  ) {
    return {
      topic: 'the two investment projects on Hunsur Road and T. Narasipura Road',
      pendingQuestion: 'Would you like to know more about these projects?',
      lastAiUtterance: t,
    };
  }
  if (t.includes(PDF_INVESTMENT_PITCH_PREFIX)) {
    return {
      topic: 'the investment projects on Hunsur Road and T. Narasipura Road',
      pendingQuestion: 'Would you like to know more about these projects?',
      lastAiUtterance: t,
    };
  }

  const lastQ = extractLastQuestion(t);
  if (lastQ) {
    return {
      topic: base.topic,
      pendingQuestion: lastQ,
      lastAiUtterance: t,
    };
  }
  return { ...base, lastAiUtterance: t };
}

export function buildOutboundIdentityAnswerNudge(companyName = 'Alliance Square'): string {
  return (
    `SYSTEM (internal): Customer asked who you are. Answer in ONE short sentence: you are calling from ${companyName} ` +
    `about residential sites in Mysuru. Do NOT say you are an AI. Then in the SAME turn, naturally return to where the conversation left off.`
  );
}

export function buildOutboundOffTopicAnswerNudge(): string {
  return (
    'SYSTEM (internal): Customer asked an unrelated question mid-call. Give a brief honest answer in one or two sentences. ' +
    'Then in the SAME turn, naturally return to the previous topic — do NOT restart the opening greeting.'
  );
}

export function buildOutboundResumeNudge(memory: OutboundConversationMemory): string {
  const topic = memory.topic || 'the residential site enquiry';
  const question = memory.pendingQuestion || PDF_OPENING;
  return (
    `SYSTEM (internal): Resume the conversation naturally. You were discussing: ${topic}. ` +
    `Continue from the pending point without repeating lines already spoken on this call. ` +
    `Pending question/topic: "${question.slice(0, 200)}". ` +
    `Do NOT make the customer repeat information they already gave. Transition naturally — e.g. "As we were talking about the projects, ..."`
  );
}
