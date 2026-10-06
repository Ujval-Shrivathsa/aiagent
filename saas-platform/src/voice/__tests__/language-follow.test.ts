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

  it('does NOT switch on a plain English sentence — only on a request', () => {
    // OWNER RULE (amended): detection is not consent. A caller who says one
    // English sentence — or, as seen on a real call, just gives their NAME in
    // Latin script — must NOT flip the conversation to English.
    const { results, state } = feed(['ಹೌದು ಸರ್', 'Yes, tell me more about the site please.']);
    assert.equal(results[1].language, 'kn');
    assert.equal(results[1].switched, false);
    assert.equal(state.language, 'kn');
  });

  it('does NOT switch on the caller giving their name', () => {
    // THE REPORTED BUG: "Ramesh" / "my name is Ravi" is a Latin-script
    // sentence, so the old classifier called it English and the TTS locale
    // flipped to en-IN mid-Kannada-call.
    for (const name of ['Ramesh', 'my name is Ravi', 'I am Kumar', 'Ravi Kumar']) {
      const { results, state } = feed(['ಹೌದು ಸರ್', name]);
      assert.equal(state.language, 'kn', `"${name}" must not switch the language`);
      assert.equal(results[1].switched, false);
    }
  });

  it('stays in Kannada across English/Marathi turns until asked', () => {
    const { results, state } = feed([
      'Can you give me the location details?',
      'What is the price range there?',
      'ಸರಿ ಸರ್, ಧನ್ಯವಾದಗಳು',
    ]);
    assert.ok(results.every((r) => r.language === 'kn' && !r.switched));
    assert.equal(state.language, 'kn');
  });

  it('switches when the caller explicitly asks', () => {
    const { results, state } = feed(['ಹೌದು ಸರ್', 'Please speak in English from now on.']);
    assert.equal(results[1].language, 'en');
    assert.equal(results[1].switched, true);
    assert.equal(state.language, 'en');
  });

  it('stays in the requested language until a DIFFERENT one is asked for', () => {
    const { results, state } = feed([
      'Please speak in English.',
      'Yes, tell me more about the site please.',
      'Now speak in Kannada please.',
    ]);
    assert.equal(results[0].language, 'en');
    assert.equal(results[1].language, 'en', 'an English sentence does not undo the request');
    assert.equal(results[2].language, 'kn');
    assert.equal(results[2].switched, true);
    assert.equal(state.language, 'kn');
  });

  it('does NOT switch on Marathi turns (Latin transliteration)', () => {
    const { results, state } = feed([
      'Malaa kay aahe tar mala site pahije ahe.',
      'Nako sir, udya malaa office jaaychay aahe.',
    ]);
    assert.ok(results.every((r) => r.language === 'kn' && !r.switched));
    assert.equal(state.language, 'kn');
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
    // Kannada has NO documented Live locale: `kn-IN` is accepted but silently
    // ignored, so we send nothing and let the native-audio model detect the
    // script. en/mr/hi ARE documented and are sent explicitly.
    assert.equal(ttsLanguageFor('kn'), null);
    assert.equal(ttsLanguageFor('en'), 'en-IN');
    assert.equal(ttsLanguageFor('mr'), 'mr-IN');
    assert.equal(ttsLanguageFor('hi'), 'hi-IN');
    assert.match(languageFollowSystemPrompt('mr'), /Marathi/);
  });
});
