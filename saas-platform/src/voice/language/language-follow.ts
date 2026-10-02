/**
 * ============================================================================
 *   LANGUAGE FOLLOW — Kannada default, follow the caller's actual language.
 * ============================================================================
 *   Spec: the agent's default and primary language is Kannada. It follows the
 *   language the caller is ACTUALLY speaking (never guessed from identity or
 *   records) and switches only when the caller clearly switches:
 *     Kannada ↔ English ↔ Marathi ↔ Hindi
 *
 *   - Loanwords / fillers / place names never trigger a switch.
 *   - A clear sentence in another language switches (English: 1 turn,
 *     Marathi/Hindi: 2 consecutive turns — to survive Kannada↔Marathi overlap).
 *   - Once switched, stay in the caller's language until they switch again.
 *   - The result feeds the TTS languageCode for the next AI turn.
 *
 *   Pure helpers — unit-tested without a live call. Wired from logic.ts.
 * ============================================================================
 */

import { detectScriptLanguage, isPrimarilyKannada } from './script-detect';

export type FollowLanguage = 'kn' | 'en' | 'mr' | 'hi';

/**
 * TTS languageCode per conversation language.
 *
 * `kn` maps to null on purpose: Kannada is NOT in Google's documented Live
 * language list, so a `kn-IN` code is silently ignored by the API while the
 * model detects Kannada from the script by itself. Sending null lets the
 * native-audio model handle Kannada — and lets it switch naturally when the
 * caller switches. en/mr/hi ARE documented locales and are sent explicitly.
 */
export const TTS_LANGUAGE_BY_CONVERSATION: Record<FollowLanguage, string | null> = {
  kn: null,
  en: 'en-IN',
  mr: 'mr-IN',
  hi: 'hi-IN',
};

export function ttsLanguageFor(lang: FollowLanguage): string | null {
  return TTS_LANGUAGE_BY_CONVERSATION[lang] ?? null;
}

/** Common English loanwords in Mysuru real-estate Kannada — not a language switch. */
const LOANWORDS = [
  'property', 'plot', 'budget', 'location', 'project', 'investment', 'emi',
  'booking', 'visit', 'site', 'loan', 'office', 'rate', 'sqft', 'layout',
  'registration', 'construction', 'alliance', 'square', 'mysore', 'mysuru',
  'okay', 'ok', 'yes', 'no', 'yeah', 'hello', 'hi', 'bye', 'thanks', 'thank',
  'please', 'sir', 'madam', 'call', 'phone', 'number', 'time', 'today',
  'tomorrow', 'morning', 'evening', 'ready', 'price', 'cost', 'acre',
  'gunta', 'guntas', 'interested', 'interestedu', 'houda', 'hauda', 'sari',
] as const;

const LOANWORD_RE = new RegExp(`\\b(${LOANWORDS.join('|')})\\b`, 'gi');

const FILLER_ONLY =
  /^(hmm+|uh+|um+|ah+|ha+|haan+|han+|ho+|ok+|okay+|yes+|no+|yeah+|acha+|accha+|barobar|sari|ಸರಿ|ಹೌದು|ಇಲ್ಲ|ಹಲೋ|ಹಾ|हो|हाँ|हां|अच्छा|बरोबर)[.!?]*$/i;

function stripLoanwordsAndNoise(text: string): string {
  return String(text || '')
    .replace(LOANWORD_RE, ' ')
    .replace(/[0-9₹,%./+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Marathi-specific vocabulary/grammar markers (distinct from Hindi).
 * NOTE: \b never matches around Devanagari in JS regex — Latin tokens use \b,
 * Devanagari markers are matched as plain substrings.
 */
const MARATHI_MARKERS =
  /\b(aho|kaay|kay|tithe|ithe|nahi|mala|tumhi|ahe|aahes|aahat|kuthe|kiti|kasa|kashi|nako|pahije|zala|zhala|jhala|udya|aata|saral|chhan)\b|मला|तुम्ही|आहे|आहेत|नाही|काय|इथे|तिथे|उद्या|नको|पाहिजे|मध्ये|मराठी/i;

/** Hindi markers (distinct from Marathi). */
const HINDI_MARKERS =
  /\b(hai|hain|hoon|kya|kyun|kahan|kab|kaise|kitna|mera|meri|aap|tum|nahin|chahiye|hoga|hogi|karna|karenge|abhi|accha|theek|thik|bhaiya|mujhe|aapka|hoga)\b|हैं|हूँ|क्या|क्यों|कहाँ|नहीं|चाहिए|अभी|ठीक|मुझे/i;

const EXPLICIT_LANGUAGE_REQUEST =
  /\b(?:speak|talk|continue|reply|tell me|explain|switch)\s+(?:in\s+)?(english|kannada|marathi|hindi)\b|\bin\s+(english|kannada|marathi|hindi)\b|\b(english|kannada|marathi|hindi)\s+(please|only|alli|nalli|madhi|madhun|mein)\b/i;

export type LanguageSwitchState = {
  language: FollowLanguage;
  /** Consecutive clear non-Kannada turns toward a candidate switch. */
  candidate: FollowLanguage | null;
  streak: number;
};

export function createLanguageSwitchState(): LanguageSwitchState {
  return { language: 'kn', candidate: null, streak: 0 };
}

export type MeaningfulLanguageDecision =
  | { language: FollowLanguage; confidence: 'high' | 'medium'; reason: string }
  | { language: null; confidence: 'none'; reason: string };

/**
 * Classify ONE caller utterance. Returns null when it should not change the
 * current language (filler, loanwords-only, other scripts, unclear).
 */
export function detectUtteranceLanguage(text: string): MeaningfulLanguageDecision {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return { language: null, confidence: 'none', reason: 'empty' };
  if (FILLER_ONLY.test(raw)) return { language: null, confidence: 'none', reason: 'filler' };

  // Explicit request wins immediately ("speak in English", "ಇಂಗ್ಲೀಷ್ ನಲ್ಲಿ ಹೇಳಿ" via STT).
  const req = raw.match(EXPLICIT_LANGUAGE_REQUEST);
  if (req) {
    const word = (req[1] || req[2] || req[3] || '').toLowerCase();
    const lang: FollowLanguage =
      word === 'english' ? 'en' : word === 'marathi' ? 'mr' : word === 'hindi' ? 'hi' : 'kn';
    return { language: lang, confidence: 'high', reason: 'explicit_request' };
  }

  // Indic script detection is authoritative. NOTE: script-detect maps ALL
  // Devanagari to 'hi' — Marathi vs Hindi is decided by vocabulary markers.
  const script = detectScriptLanguage(raw);
  if (isPrimarilyKannada(raw) || script === 'kn') {
    return { language: 'kn', confidence: 'high', reason: 'kannada_script' };
  }
  if (script === 'hi') {
    if (MARATHI_MARKERS.test(raw)) {
      return { language: 'mr', confidence: 'high', reason: 'marathi_markers' };
    }
    return { language: 'hi', confidence: 'high', reason: 'hindi_script' };
  }
  if (script && script !== 'en') {
    return { language: null, confidence: 'none', reason: `other_script_${script}` };
  }

  // Latin script: transliterated Marathi/Hindi first, then English sentences.
  if (MARATHI_MARKERS.test(raw)) {
    return { language: 'mr', confidence: 'medium', reason: 'marathi_markers_latin' };
  }
  if (HINDI_MARKERS.test(raw)) {
    return { language: 'hi', confidence: 'medium', reason: 'hindi_markers_latin' };
  }
  const stripped = stripLoanwordsAndNoise(raw);
  if (!stripped) return { language: null, confidence: 'none', reason: 'loanwords_only' };
  const strippedTokens = (stripped.match(/[A-Za-z]{2,}/g) || []).length;
  const strippedWords = stripped.split(/\s+/).filter(Boolean).length;
  if (strippedTokens >= 2 && strippedTokens / Math.max(1, strippedWords) >= 0.5) {
    return { language: 'en', confidence: 'high', reason: 'english_sentence' };
  }
  return { language: null, confidence: 'none', reason: 'kanglish' };
}

/**
 * Feed one caller utterance into the follow state.
 * Kannada is sticky (default); a switch needs a clear sentence — English can
 * switch on one clear turn, Marathi/Hindi on two consecutive clear turns (they
 * overlap heavily with Kannada in Latin transliteration).
 */
export function followLanguageFromUtterance(
  state: LanguageSwitchState,
  text: string,
): { language: FollowLanguage; switched: boolean; state: LanguageSwitchState } {
  const decision = detectUtteranceLanguage(text);

  // Kannada (or unclear) always returns to/stays in the default cleanly.
  if (!decision.language) {
    return { language: state.language, switched: false, state: { ...state, candidate: null, streak: 0 } };
  }
  if (decision.language === 'kn') {
    return { language: 'kn', switched: state.language !== 'kn', state: createLanguageSwitchState() };
  }

  const target = decision.language;
  if (state.language === target) {
    return { language: target, switched: false, state: { ...state, candidate: null, streak: 0 } };
  }

  // English switches on one clear sentence; Marathi/Hindi need a 2-turn streak.
  const need = target === 'en' ? 1 : 2;
  const streak = state.candidate === target ? state.streak + 1 : 1;
  if (streak >= need) {
    return {
      language: target,
      switched: true,
      state: { language: target, candidate: null, streak: 0 },
    };
  }
  return {
    language: state.language,
    switched: false,
    state: { ...state, candidate: target, streak },
  };
}

/**
 * Private system prompt fragment sent to the model when the language changes.
 * The model already has the language rules; this just sets the active target.
 */
export function languageFollowSystemPrompt(lang: FollowLanguage): string {
  const name =
    lang === 'kn' ? 'Kannada' : lang === 'en' ? 'English' : lang === 'mr' ? 'Marathi' : 'Hindi';
  return (
    `SYSTEM (internal): The caller has switched to ${name}. From your next turn onward speak ${name} — ` +
    `natural and conversational, never literal translation. Keep the same script step and continue. ` +
    `Do not mention the language change.`
  );
}
