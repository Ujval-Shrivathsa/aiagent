/**
 * Conversation language from the customer's latest *meaningful* utterance.
 *
 * Rules:
 * - Kannada script ⇒ Kannada (loanwords like plot/budget do not flip to English)
 * - Clear English sentences ⇒ English
 * - Isolated English loanwords inside Kannada / Kanglish stay Kannada
 * - Short fillers (ok, hmm, hello) do not force a switch
 */

import { detectScriptLanguage, isPrimarilyKannada } from './script-detect';

/** Common English loanwords in Mysuru real-estate Kannada — not a language switch. */
export const KANGLISH_LOANWORDS = [
  'property',
  'plot',
  'budget',
  'location',
  'project',
  'investment',
  'emi',
  'booking',
  'visit',
  'site',
  'loan',
  'office',
  'rate',
  'sqft',
  'layout',
  'registration',
  'construction',
  'alliance',
  'square',
  'mysore',
  'mysuru',
  'okay',
  'ok',
  'yes',
  'no',
  'hello',
  'hi',
  'thanks',
  'thank',
  'please',
  'sir',
  'madam',
  'call',
  'phone',
  'number',
  'time',
  'today',
  'tomorrow',
  'morning',
  'evening',
  'ready',
  'price',
  'cost',
  'acre',
  'guntas',
  'gunta',
] as const;

export type ConversationLanguage = 'kn' | 'en';

export type MeaningfulLanguageDecision =
  | { language: ConversationLanguage; confidence: 'high' | 'medium'; reason: string }
  | { language: null; confidence: 'none'; reason: string };

const LOANWORD_RE = new RegExp(
  `\\b(${KANGLISH_LOANWORDS.join('|')})\\b`,
  'gi',
);

function stripLoanwordsAndNoise(text: string): string {
  return String(text || '')
    .replace(LOANWORD_RE, ' ')
    .replace(/[0-9₹,%./+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLER_ONLY =
  /^(hmm+|hmm+|uh+|um+|ah+|ha+|haan+|han+|ok+|okay+|yes+|no+|yeah+|sari|ಸರಿ|ಹೌದು|ಇಲ್ಲ|ಹಲೋ|hello|hi|bye)[.!?]*$/i;

/**
 * Classify the customer's latest utterance for reply language.
 * Returns null when the utterance should not change the current language.
 */
export function detectMeaningfulConversationLanguage(
  text: string,
): MeaningfulLanguageDecision {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) {
    return { language: null, confidence: 'none', reason: 'empty' };
  }
  if (FILLER_ONLY.test(raw)) {
    return { language: null, confidence: 'none', reason: 'filler' };
  }

  if (isPrimarilyKannada(raw) || detectScriptLanguage(raw) === 'kn') {
    return { language: 'kn', confidence: 'high', reason: 'kannada_script' };
  }

  const script = detectScriptLanguage(raw);
  if (script === 'hi' || script === 'ta' || script === 'te' || script === 'ml') {
    // Other Indic scripts: keep prior language (do not invent a new TTS path here).
    return { language: null, confidence: 'none', reason: `other_indic_${script}` };
  }

  const stripped = stripLoanwordsAndNoise(raw);
  const latinTokens = (stripped.match(/[A-Za-z]{3,}/g) || []).filter(Boolean);

  if (script === 'en' || (latinTokens.length >= 2 && !/[\u0C80-\u0CFF]/.test(raw))) {
    // Clear English after removing loanwords / short fillers
    if (latinTokens.length >= 2 || /\b(i|i'm|im|we|we're|looking|interested|not|don't|dont|want|need|can|could|please|tell|about)\b/i.test(stripped)) {
      return { language: 'en', confidence: 'high', reason: 'clear_english' };
    }
    if (latinTokens.length === 1) {
      return { language: null, confidence: 'none', reason: 'single_latin_token' };
    }
  }

  if (!stripped && /[A-Za-z]/.test(raw)) {
    // Only loanwords / numbers left → stay on current language (usually Kannada)
    return { language: null, confidence: 'none', reason: 'loanwords_only' };
  }

  return { language: null, confidence: 'none', reason: 'ambiguous' };
}

/**
 * Apply detection to prior conversation language. Switches immediately on
 * high/medium confidence; otherwise keeps previous.
 */
export function resolveNextConversationLanguage(
  previous: ConversationLanguage,
  customerText: string,
): { language: ConversationLanguage; switched: boolean; decision: MeaningfulLanguageDecision } {
  const decision = detectMeaningfulConversationLanguage(customerText);
  if (decision.language && decision.language !== previous) {
    return { language: decision.language, switched: true, decision };
  }
  if (decision.language) {
    return { language: decision.language, switched: false, decision };
  }
  return { language: previous, switched: false, decision };
}

export function languageCodeForConversation(lang: ConversationLanguage): 'kn-IN' | 'en-IN' {
  return lang === 'en' ? 'en-IN' : 'kn-IN';
}

export function languageSwitchSystemPrompt(
  lang: ConversationLanguage,
): string {
  if (lang === 'en') {
    return (
      'LANGUAGE SWITCH: The customer\'s latest meaningful utterance is clear English. ' +
      'Reply in calm Indian English for this turn and until they switch again. ' +
      'Preserve all conversation context. Do not restart the greeting. Do not announce the language switch.'
    );
  }
  return (
    'LANGUAGE SWITCH: The customer\'s latest meaningful utterance is Kannada (or Kanglish). ' +
    'Reply in simple spoken Mysuru Kannada for this turn and until they switch again. ' +
    'Preserve all conversation context. Do not restart the greeting. Do not announce the language switch. ' +
    'Isolated English loanwords (plot, budget, site, …) are NOT a reason to stay in English.'
  );
}
