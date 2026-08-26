/**
 * Detect when the customer is asking a direct question that deserves
 * a factual answer (site names, rates, locations) — not qualification deflection.
 */

const QUESTION_MARK = /\?|？/;

const QUESTION_START =
  /^(what|which|where|when|how|who|tell me|can you|could you|do you|does|is there|are there|how much|how many|any|list|give me|i want to know|i need|price|rate|cost|details|information|about|sites|projects|layouts|available|booking)/i;

const KANNADA_QUESTION =
  /(?:ಏನು|ಎಷ್ಟು|ಎಲ್ಲಿ|ಯಾವ|ಹೇಗೆ|ಯಾವುದು|ಯಾವದು|ತಿಳಿಸ|ಹೇಳ|details|rate|price|site|project|layout|projects|sites|ಬೇಕು|ಇದೆಯಾ|ಇವೆಯಾ|available)/i;

const NAMED_PROJECT_ASK =
  /\b(uk square|sridevi|cnm apex|serene|adhya|alliance square|layout|site|project|rate|price|sqft|per sqft|location|address|booking)\b/i;

const DETAIL_ASK =
  /\b(details?|tell me (?:more )?about|more about|full info|information about|everything about|explain|describe|info)\b/i;

const KANNADA_DETAIL_ASK =
  /(?:ವಿವರ|ಹೇಳ(?:ಿ|್ತ(?:ೀ|ಿ)ರ(?:ಾ|ಿ))|ತಿಳ(?:ಿಸ(?:ಿ|್ತ(?:ೀ|ಿ)ರ(?:ಾ|ಿ)))|ಏನ(?:ು|ೆ) (?:ಇದೆ|ಇವೆ)|details|bagge|gurithu|guritu|kodi)/i;

const NAMED_PROJECT =
  /\b(uk square|sridevi|cnm apex|alliance serene|serene phase|adhya enclave)\b/i;

export function looksLikeSiteDetailRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 4) return false;
  if (DETAIL_ASK.test(t) && (NAMED_PROJECT.test(t) || NAMED_PROJECT_ASK.test(t))) return true;
  if (KANNADA_DETAIL_ASK.test(t) && (NAMED_PROJECT.test(t) || NAMED_PROJECT_ASK.test(t))) return true;
  if (NAMED_PROJECT.test(t) && /(?:about|regarding|on|for|bagge|gurithu)/i.test(t)) return true;
  return false;
}

export function looksLikeCustomerQuestion(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 4) return false;
  if (looksLikeSiteDetailRequest(t)) return true;
  if (QUESTION_MARK.test(t)) return true;
  if (QUESTION_START.test(t)) return true;
  if (KANNADA_QUESTION.test(t) && t.length >= 6) return true;
  if (NAMED_PROJECT_ASK.test(t) && /(?:ಎಷ್ಟು|rate|price|where|location|details|tell|about|ಹೇಳ|ತಿಳಿಸ)/i.test(t)) {
    return true;
  }
  return false;
}

export const CUSTOMER_QUESTION_ANSWER_NUDGE =
  'SYSTEM (internal): The customer asked a DIRECT question. ANSWER IT NOW in warm Mysuru Kanglish — ' +
  'project/site names in English, prices and sizes clearly spoken. ' +
  'Use PROJECT REFERENCE and layout facts. Do NOT deflect to qualification first. Do NOT skip site names. ' +
  'Do NOT say you lack info if the answer is in PROJECT REFERENCE. At most ONE follow-up question on a LATER turn — not in the same turn as the answer.';

export const SITE_DETAIL_ANSWER_NUDGE =
  'SYSTEM (internal): The customer asked for SITE DETAILS about a project you mentioned. ' +
  'Give FULL factual detail from PROJECT REFERENCE now — location, rate, facing, sizes, amenities, landmarks, approvals, booking. ' +
  'Use 4–8 short spoken sentences in pakka Mysuru Kanglish. Complete each sentence. ' +
  'NO questions in this turn — answer fully, then STOP and listen. One qualify question only on your NEXT turn if needed.';
