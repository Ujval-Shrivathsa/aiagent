/**
 * Lightweight script detection for diagnostics (not a full LID model).
 * Used to log whether STT/TTS turns look Kannada vs English vs other Indic.
 */

const KANNADA = /[\u0C80-\u0CFF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const TAMIL = /[\u0B80-\u0BFF]/;
const TELUGU = /[\u0C00-\u0C7F]/;
const MALAYALAM = /[\u0D00-\u0D7F]/;

export type DetectedScript =
  | 'kn'
  | 'hi'
  | 'ta'
  | 'te'
  | 'ml'
  | 'en'
  | 'mixed'
  | 'unknown';

export function detectScriptLanguage(text: string): DetectedScript {
  const t = String(text || '');
  if (!t.trim()) return 'unknown';
  const hits: DetectedScript[] = [];
  if (KANNADA.test(t)) hits.push('kn');
  if (DEVANAGARI.test(t)) hits.push('hi');
  if (TAMIL.test(t)) hits.push('ta');
  if (TELUGU.test(t)) hits.push('te');
  if (MALAYALAM.test(t)) hits.push('ml');
  const hasLatin = /[A-Za-z]{3,}/.test(t);
  if (hits.length === 0) return hasLatin ? 'en' : 'unknown';
  if (hits.length === 1) {
    // Kanglish / Hinglish: Indic script + Latin product words → still primary Indic.
    return hits[0];
  }
  return 'mixed';
}

/** True when text is primarily Kannada script (may include English loanwords). */
export function isPrimarilyKannada(text: string): boolean {
  const t = String(text || '');
  const kn = (t.match(/[\u0C80-\u0CFF]/g) || []).length;
  if (kn < 2) return false;
  const otherIndic =
    (t.match(/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/g) || []).length;
  return kn >= otherIndic;
}
