/**
 * Conversation language + Kannada-first opening tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMeaningfulConversationLanguage,
  resolveNextConversationLanguage,
} from '../language/conversation-language';
import { buildOutboundKannadaOpening, getOutboundOpeningQuestionKn } from '../kannada-style';
import { loadOpeningConfig } from '../opening-config';
import { buildLiveSpeechConfig, loadLiveSpeechSettings } from '../tts/speech-config';

describe('opening-config + Kannada-first opening', () => {
  it('matches the short Bhoomi / Alliance Square / plot intent', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /^ನಮಸ್ಕಾರ,/);
    assert.match(opening, /Alliance Square ಇಂದ ಭೂಮಿ ಮಾತಾಡ್ತಿದ್ದೀನಿ/);
    assert.match(opening, /ನೀವು plot ನೋಡ್ತಿದ್ದೀರಾ\?/);
    assert.doesNotMatch(opening, /enquiry|site visit|budget/i);
    assert.ok(opening.length < 160, 'opening must stay short');
  });

  it('may include a known name naturally without forcing honorifics', () => {
    const opening = buildOutboundKannadaOpening('Prajwal');
    assert.match(opening, /ನಮಸ್ಕಾರ Prajwal/);
    assert.match(opening, /ಭೂಮಿ ಮಾತಾಡ್ತಿದ್ದೀನಿ/);
    assert.doesNotMatch(opening, /ನಮಸ್ಕಾರ Prajwal ಸರ್/);
  });

  it('loads configurable agent / company / question', () => {
    const prevQ = process.env.VOICE_OPENING_QUESTION_KN;
    process.env.VOICE_OPENING_QUESTION_KN = 'ನೀವು site ನೋಡ್ತಿದ್ದೀರಾ?';
    try {
      assert.match(getOutboundOpeningQuestionKn(loadOpeningConfig()), /site ನೋಡ್ತಿದ್ದೀರಾ/);
    } finally {
      if (prevQ === undefined) delete process.env.VOICE_OPENING_QUESTION_KN;
      else process.env.VOICE_OPENING_QUESTION_KN = prevQ;
    }
  });
});

describe('meaningful conversation language', () => {
  it('keeps Kannada when only loanwords appear in Kannada', () => {
    const d = detectMeaningfulConversationLanguage('ಸರಿ, ನನಗೆ plot budget ಬೇಕು');
    assert.equal(d.language, 'kn');
  });

  it('does not switch on loanwords-only Latin fragments', () => {
    const d = detectMeaningfulConversationLanguage('plot budget site');
    assert.equal(d.language, null);
  });

  it('switches to English on a clear English sentence immediately', () => {
    const r = resolveNextConversationLanguage('kn', "Yes, I'm looking for a plot in Mysore.");
    assert.equal(r.language, 'en');
    assert.equal(r.switched, true);
  });

  it('switches back to Kannada immediately', () => {
    const r = resolveNextConversationLanguage('en', 'ಹೌದು, ನೋಡ್ತಿದ್ದೀನಿ ಸರ್');
    assert.equal(r.language, 'kn');
    assert.equal(r.switched, true);
  });

  it('ignores short fillers', () => {
    const r = resolveNextConversationLanguage('kn', 'Okay');
    assert.equal(r.switched, false);
    assert.equal(r.language, 'kn');
  });
});

describe('TTS Kannada-first defaults', () => {
  it('defaults languageCode to kn-IN', () => {
    const prev = process.env.VOICE_TTS_LANGUAGE_CODE;
    delete process.env.VOICE_TTS_LANGUAGE_CODE;
    try {
      const settings = loadLiveSpeechSettings();
      assert.equal(settings.languageCode, 'kn-IN');
      assert.equal(buildLiveSpeechConfig(settings).languageCode, 'kn-IN');
    } finally {
      if (prev === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prev;
    }
  });

  it('allows auto override', () => {
    const prev = process.env.VOICE_TTS_LANGUAGE_CODE;
    process.env.VOICE_TTS_LANGUAGE_CODE = 'auto';
    try {
      assert.equal(loadLiveSpeechSettings().languageCode, null);
    } finally {
      if (prev === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prev;
    }
  });
});
