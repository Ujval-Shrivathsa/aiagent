/**
 * Short Kannada/English acknowledgments are REAL customer turns — not silence,
 * not opening echo, not STT noise to ignore.
 */

/**
 * Only the AGENT's own opening / self-intro coming back through the mic.
 * Must NEVER match a real customer answer ("yes I'm looking for a site in Hunsur")
 * — that used to silence the caller after the greeting.
 */
const AGENT_OPENING_ECHO =
  /(?:this is (?:bhoomi|priya)|i'?m priya(?:\s+from)?|i am priya(?:\s+from)?|hello,?\s*i'?m priya|ನಾನು\s*ಪ್ರಿಯಾ|ನಾನು\s*ಅಲಯನ್ಸ್|ನಾನು\s*ಭೂಮಿ|from alliance square(?:\s+properties)?[^.?!]{0,40}(?:looking|interested|ಮಾತಾಡ)|enquiry ಮಾಡಿದ್ದೀರಲ್ಲ|ಮಾತಾಡ್ತಿದ್ದೀನಿ|ಮಾತಾಡ್ತಿದೀನಿ)/i;

/** Agent's site question echoed alone (no customer yes / interest wording). */
const AGENT_SITE_QUESTION_ECHO =
  /^(?:[\s,]*(?:hello|hi|ನಮಸ್ಕಾರ|ಹಲೋ)[\s,]*)?(?:are you looking for a (?:residential )?(?:site|plot) in mys|interested in buying a site in mys|ನಿಮಗೆ\s*ಮೈಸೂರಿನಲ್ಲಿ\s*ಸೈಟ್\s*(?:ನೋಡ|ನೊತಿ|ತಗೊಳ್ಳೋ)|ನೀವು\s*.{0,20}site\s*ನೋಡ್ತಿದ)/i;

/** Roman + Kannada script short replies common on Mysuru calls. */
const SHORT_AFFIRMATIVE =
  /^(?:houda|haudu|howdu|howda|haud|haan|han|ha+|yes+|yeah+|yep+|ok+|okay+|sari|seri|hmm+|hm+|heli|hel+|hello|hi|ಹೌದು|ಹೌದ|ಸರಿ|ಹಾ+|ಹೇ+|ಹೇಳಿ|ಓಕೆ|ಅಲ್ವಾ|ಬೇಕು|ಬೇಡ|ಇಲ್ಲ)[.!?\s]*$/iu;

const STT_NOISE = /^[uhm.\s]+$/iu;

/** Customer is answering the opening — never treat as echo. */
function looksLikeCustomerSiteAnswer(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\s*(yes|yeah|yep|yup|ya|haudu|houda|howdu|haan|han|ok|okay|sari|seri|ಹೌದು|ಹೌದ|ಸರಿ|ಓಕೆ|ಹಾ)\b/i.test(t)) {
    return true;
  }
  if (/\b(looking for|interested in|i want|i need|searching for|after a (?:plot|site))\b/i.test(t)) {
    return true;
  }
  if (/(ನೋಡುತ್ತಿದ್ದೇನೆ|ನೋಡ್ತಿದ್ದೀನಿ|ನೋಡ್ತಿದೀನಿ|ಆಸಕ್ತಿ|ಬೇಕು)/.test(t)) return true;
  if (/(hunsur|narasipura|nanjangud|ಹುಣಸೂರು|ನರಸೀಪುರ|ನಂಜನಗೂಡ)/i.test(t)) return true;
  return false;
}

export function looksLikeOpeningEcho(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isShortAffirmativeReply(t)) return false;
  if (looksLikeCustomerSiteAnswer(t)) return false;
  if (AGENT_OPENING_ECHO.test(t)) return true;
  // Pure agent question echo with no customer interest words.
  if (AGENT_SITE_QUESTION_ECHO.test(t) && t.length <= 120) return true;
  return false;
}

export function isShortAffirmativeReply(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length > 24) return false;
  return SHORT_AFFIRMATIVE.test(t);
}

export function isLikelySttNoise(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isShortAffirmativeReply(t)) return false;
  return t.length < 2 || STT_NOISE.test(t);
}

/** Any transcript that should clear wait state and expect an AI reply. */
export function isCustomerTurnSignal(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || isLikelySttNoise(t)) return false;
  if (looksLikeOpeningEcho(t)) return false;
  return true;
}

export const SHORT_ACK_REPLY_NUDGE =
  'SYSTEM (internal): Customer gave a short reply (yes / houda / haudu / sari / ok / ಹೌದು / ಸರಿ). ' +
  'This is a REAL turn — reply NOW with warm Kanglish: one complete flowing sentence + at most one question. ' +
  'Do NOT stay silent. Do NOT treat this as unexplained silence. Continue the conversation naturally.';

export function shortAckNudgeWithQuote(text: string): string {
  const q = String(text || '').trim().slice(0, 80);
  return `${SHORT_ACK_REPLY_NUDGE} They said: "${q}"`;
}
