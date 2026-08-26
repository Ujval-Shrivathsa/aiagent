/**
 * Short Kannada/English acknowledgments are REAL customer turns — not silence,
 * not opening echo, not STT noise to ignore.
 */

const OPENING_ECHO =
  /this is bhoomi|alliance square|looking for a site in mysuru|are you looking for a site|ನೋಡ್ತಿದ್ದೀರಾ|ಮಾತಾಡ್ತಿದ್ದೀನಿ|enquiry ಮಾಡಿದ್ದೀರಲ್ಲ|ನಮಸ್ಕಾರ\s*ಸರ್/i;

/** Roman + Kannada script short replies common on Mysuru calls. */
const SHORT_AFFIRMATIVE =
  /^(?:houda|haudu|howdu|howda|haud|haan|han|ha+|yes+|yeah+|yep+|ok+|okay+|sari|seri|hmm+|hm+|heli|hel+|hello|hi|ಹೌದು|ಹೌದ|ಸರಿ|ಹಾ+|ಹೇ+|ಹೇಳಿ|ಓಕೆ|ಅಲ್ವಾ|ಬೇಕು|ಬೇಡ|ಇಲ್ಲ)[.!?\s]*$/iu;

const STT_NOISE = /^[uhm.\s]+$/iu;

export function looksLikeOpeningEcho(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isShortAffirmativeReply(t)) return false;
  return OPENING_ECHO.test(t);
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
