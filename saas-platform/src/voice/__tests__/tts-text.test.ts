/**
 * TTS text prep + early chunking for low TTFA.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTtsText, takeSpeakableChunks, softenTextbookKannada, stripAiBoilerplate } from '../tts-text';
import { normalizeSpokenNumbers } from '../spoken-pricing';

describe('prepareTtsText', () => {
  it('keeps English commas for polished pacing', () => {
    const out = prepareTtsText('Yes, I can help with that plot.', 'en-IN');
    assert.match(out, /Yes,/);
    assert.match(out, /plot\./);
  });

  it('spaces Kannada–Latin boundaries for clearer Bulbul', () => {
    const out = prepareTtsText('ನನಗೆbudgetಬೇಕು', 'kn-IN');
    assert.match(out, /ನನಗೆ budget ಬೇಕು/);
  });

  it('converts danda to period for phone Kannada', () => {
    const out = prepareTtsText('ಹೌದು ಸರ್। ನೋಡೋಣ', 'kn-IN');
    assert.match(out, /ಸರ್\./);
    assert.doesNotMatch(out, /।/);
  });

  it('softens textbook Kannada into everyday forms', () => {
    const out = softenTextbookKannada('ತಾವು ಆಸಕ್ತಿ ಹೊಂದಿದ್ದೀರಾ?');
    assert.match(out, /ನೀವು/);
    assert.match(out, /ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.doesNotMatch(out, /ತಾವು/);
  });

  it('strips AI boilerplate from English', () => {
    const out = stripAiBoilerplate('Certainly! I understand your concern. What budget range?', 'en-IN');
    assert.doesNotMatch(out, /Certainly/i);
    assert.match(out, /budget range/);
  });

  it('normalizes dimensions and prices for clear phone speech', () => {
    assert.match(prepareTtsText('30×40 site at ₹3,300 per sq. ft.', 'kn-IN'), /30 by 40/);
    assert.match(prepareTtsText('30×40 site at ₹3,300 per sq. ft.', 'kn-IN'), /3300 per square feet/);
    assert.match(normalizeSpokenNumbers('₹5,450–₹5,500/sqft'), /5450 to .*5500 per square feet/);
  });
});

describe('takeSpeakableChunks', () => {
  it('releases on sentence end', () => {
    const { ready, rest } = takeSpeakableChunks('Hello there. More', {
      allowEarlyPhrase: false,
      minPhraseChars: 8,
    });
    assert.deepEqual(ready, ['Hello there.']);
    assert.equal(rest, 'More');
  });

  it('does not release tiny fragments without sentence end by default', () => {
    const { ready, rest } = takeSpeakableChunks('ಹೌದು, ಅರ್ಥ', { allowEarlyPhrase: false });
    assert.deepEqual(ready, []);
    assert.equal(rest, 'ಹೌದು, ಅರ್ಥ');
  });

  it('releases full sentence at punctuation', () => {
    const { ready, rest } = takeSpeakableChunks('ಹೌದು, ಅರ್ಥ ಆಯ್ತು. ಮುಂದೆ', {
      allowEarlyPhrase: false,
      minPhraseChars: 10,
    });
    assert.deepEqual(ready, ['ಹೌದು, ಅರ್ಥ ಆಯ್ತು.']);
    assert.equal(rest, 'ಮುಂದೆ');
  });

  it('can release an early phrase before punctuation for TTFA', () => {
    const { ready, rest } = takeSpeakableChunks(
      'Understood sir looking for a plot near',
      { allowEarlyPhrase: true, earlyMinChars: 20 },
    );
    assert.ok(ready.length === 1);
    assert.ok(ready[0].length >= 20);
    assert.ok(rest.length > 0);
  });
});
