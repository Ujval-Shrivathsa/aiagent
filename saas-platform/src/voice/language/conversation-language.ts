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

export type LanguageSwitchState = {
  /** Consecutive clear-English customer turns before leaving Kannada. */
  englishStreak: number;
};

const EXPLICIT_ENGLISH_REQUEST =
  /\b(speak|talk|continue|reply|tell me|explain|switch)\s+(in\s+)?english\b|\bin\s+english\b|\benglish\s+(please|only)\b|\benglish\s+(alli|nalli|lo)\b|ಇಂಗ್ಲಿಷ್|English\s+(alli|nalli|lo)/i;

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
  const rawLatinTokens = (raw.match(/[A-Za-z]{3,}/g) || []).filter(Boolean);
  const strippedLatinTokens = (stripped.match(/[A-Za-z]{3,}/g) || []).filter(Boolean);

  if (!stripped && /[A-Za-z]/.test(raw)) {
    // Only loanwords / numbers left → stay on current language (usually Kannada)
    return { language: null, confidence: 'none', reason: 'loanwords_only' };
  }

  if (script === 'en' || (rawLatinTokens.length >= 4 && !/[\u0C80-\u0CFF]/.test(raw))) {
    // Clear English — use raw text so real-estate loanwords (plot, Mysore) do not hide English
    if (
      rawLatinTokens.length >= 5 ||
      (rawLatinTokens.length >= 4 &&
        /\b(i|i'm|im|we|we're|you|are|is|what|where|how|tell|please|looking|interested|want|need|can|could|don't|dont|yes)\b/i.test(
          raw,
        ))
    ) {
      return { language: 'en', confidence: 'high', reason: 'clear_english' };
    }
    if (strippedLatinTokens.length >= 3 || rawLatinTokens.length >= 3) {
      return { language: 'en', confidence: 'medium', reason: 'partial_english' };
    }
    if (rawLatinTokens.length === 1) {
      return { language: null, confidence: 'none', reason: 'single_latin_token' };
    }
  }

  return { language: null, confidence: 'none', reason: 'ambiguous' };
}

/**
 * Apply detection to prior conversation language. Kannada is locked until the
 * customer explicitly requests English or speaks clear English twice in a row.
 */
export function resolveNextConversationLanguage(
  previous: ConversationLanguage,
  customerText: string,
  state: LanguageSwitchState = { englishStreak: 0 },
): {
  language: ConversationLanguage;
  switched: boolean;
  decision: MeaningfulLanguageDecision;
  state: LanguageSwitchState;
} {
  const raw = String(customerText || '').trim();
  const decision = detectMeaningfulConversationLanguage(customerText);

  if (EXPLICIT_ENGLISH_REQUEST.test(raw)) {
    const next = { englishStreak: 0 };
    if (previous !== 'en') {
      return {
        language: 'en',
        switched: true,
        decision: { language: 'en', confidence: 'high', reason: 'explicit_english_request' },
        state: next,
      };
    }
    return { language: 'en', switched: false, decision, state: next };
  }

  if (decision.language === 'en' && decision.confidence === 'high') {
    const englishStreak = state.englishStreak + 1;
    const nextState = { englishStreak };
    if (previous === 'kn' && englishStreak >= 2) {
      return { language: 'en', switched: true, decision, state: nextState };
    }
    if (previous === 'en') {
      return { language: 'en', switched: false, decision, state: nextState };
    }
    return {
      language: 'kn',
      switched: false,
      decision: { language: null, confidence: 'none', reason: 'english_streak_stay_kannada' },
      state: nextState,
    };
  }

  if (decision.language === 'kn') {
    const nextState = { englishStreak: 0 };
    if (previous !== 'kn') {
      return { language: 'kn', switched: true, decision, state: nextState };
    }
    return { language: 'kn', switched: false, decision, state: nextState };
  }

  return { language: previous, switched: false, decision, state };
}

export function languageCodeForConversation(lang: ConversationLanguage): 'kn-IN' | 'en-IN' {
  return lang === 'en' ? 'en-IN' : 'kn-IN';
}

export function languageSwitchSystemPrompt(
  lang: ConversationLanguage,
): string {
  if (lang === 'en') {
    return (
      'LANGUAGE SWITCH: Customer is speaking clear English. Reply in polished, natural Indian English only. ' +
      'Fluent, concise, professional — like a strong Mysuru sales executive on a phone call. ' +
      'Correct grammar, smooth rhythm, no stiff translationese, no filler fluff. ' +
      '1–2 short sentences + at most one question. Preserve context. Do not restart the greeting or announce the switch.'
    );
  }
  return (
    'LANGUAGE SWITCH: Customer is speaking Kannada / Kanglish. Reply in everyday spoken Mysuru Kannada (Kannada script) ' +
    'with English kept for site names, plot sizes (30 by 40), project names, and prices (per sqft, lakhs). ' +
    'Same ease as English — short, clear, human. Finish each sentence before pausing. ' +
    'Use spoken forms (ಮಾತಾಡ್ತಿದ್ದೀನಿ, ನೋಡ್ತಿದ್ದೀರಾ, ಬೇಕಾ, ಸರಿ, ಹೇಳಿ). ' +
    '1–2 short sentences + at most one question. Preserve context. Do not restart the greeting.'
  );
}
