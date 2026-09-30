/**
 * Tests for the language-follow module (Kannada default → follows the caller).
 * Run: npx tsx --test src/voice/__tests__/language-follow.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLanguageSwitchState,
  followLanguageFromUtterance,
  detectUtteranceLanguage,
  ttsLanguageFor,
  languageFollowSystemPrompt,
} from '../language/language-follow';

const feed = (texts: string[]) => {
  let state = createLanguageSwitchState();
  const results = texts.map((t) => {
    const r = followLanguageFromUtterance(state, t);
    state = r.state;
    return r;
  });
  return { results, state };
};

describe('language-follow — defaults and switching', () => {
  it('starts Kannada and stays Kannada on Kanglish / fillers / loanwords', () => {
    const { results, state } = feed([
      'ಹೌದು ಸರ್',
      'site ಬೇಕು ಸರ್',
      'ok',
      'price ಏಷ್ಟು',
      'ನನಗೆ plot ಬೇಕಾ ಇಲ್ಲವೋ ನೋಡೋಣ',
    ]);
    assert.ok(results.every((r) => r.language === 'kn' && !r.switched));
    assert.equal(state.language, 'kn');
  });

  it('switches to English on one clear English sentence', () => {
    const { results, state } = feed(['ಹೌದು ಸರ್', 'Yes, tell me more about the site please.']);
    assert.equal(results[1].language, 'en');
    assert.equal(results[1].switched, true);
    assert.equal(state.language, 'en');
  });

  it('stays English until the caller switches back to Kannada', () => {
    const { results, state } = feed([
      'Can you give me the location details?',
      'What is the price range there?',
      'ಸರಿ ಸರ್, ಧನ್ಯವಾದಗಳು',
    ]);
    assert.equal(results[0].language, 'en');
    assert.equal(results[1].language, 'en');
    assert.equal(results[2].language, 'kn');
    assert.equal(results[2].switched, true);
    assert.equal(state.language, 'kn');
  });

  it('switches to Marathi after two clear Marathi turns (Latin transliteration)', () => {
    const { results, state } = feed([
      'Malaa kay aahe tar mala site pahije ahe.',
      'Nako sir, udya malaa office jaaychay aahe.',
    ]);
    assert.equal(results[0].language, 'kn'); // first Marathi turn — not yet
    assert.equal(results[1].language, 'mr');
    assert.equal(results[1].switched, true);
    assert.equal(state.language, 'mr');
  });

  it('switches to Marathi from Devanagari with Marathi markers', () => {
    const decision = detectUtteranceLanguage('मला साइट पाहिजे, उद्या आहे का?');
    assert.equal(decision.language, 'mr');
  });

  it('switches to Hindi from Devanagari without Marathi markers', () => {
    const decision = detectUtteranceLanguage('मुझे साइट चाहिए, क्या आप बता सकते हैं?');
    assert.equal(decision.language, 'hi');
  });

  it('single loanword / filler never switches the language', () => {
    const d1 = detectUtteranceLanguage('site');
    assert.equal(d1.language, null);
    const d2 = detectUtteranceLanguage('ok ok');
    assert.equal(d2.language, null);
  });

  it('explicit language request switches immediately', () => {
    const d = detectUtteranceLanguage('Can you speak in English please?');
    assert.equal(d.language, 'en');
    const d2 = detectUtteranceLanguage('मराठी मध्ये बोला'); // Devanagari → Marathi markers path
    assert.ok(d2.language === 'mr' || d2.language === 'hi');
  });

  it('TTS mapping and prompt text', () => {
    assert.equal(ttsLanguageFor('kn'), 'kn-IN');
    assert.equal(ttsLanguageFor('en'), 'en-IN');
    assert.equal(ttsLanguageFor('mr'), 'mr-IN');
    assert.equal(ttsLanguageFor('hi'), 'hi-IN');
    assert.match(languageFollowSystemPrompt('mr'), /Marathi/);
  });
});
