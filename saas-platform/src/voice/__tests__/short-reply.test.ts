import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCustomerTurnSignal,
  isShortAffirmativeReply,
  looksLikeOpeningEcho,
} from '../short-reply';

describe('short-reply', () => {
  it('recognises houda / haudu / ha as real turns', () => {
    for (const s of ['houda', 'haudu', 'howdu', 'ha', 'haan', 'ok', 'sari', 'ಹೌದು', 'ಸರಿ', 'ಹೇಳಿ']) {
      assert.equal(isShortAffirmativeReply(s), true, s);
      assert.equal(isCustomerTurnSignal(s), true, s);
      assert.equal(looksLikeOpeningEcho(s), false, s);
    }
  });

  it('still blocks opening echo', () => {
    assert.equal(looksLikeOpeningEcho('ನಾನು ಭೂಮಿ Alliance Square ಇಂದ ಮಾತಾಡ್ತಿದ್ದೀನಿ'), true);
    assert.equal(isCustomerTurnSignal('ನೀವು Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ?'), false);
  });

  it('never treats a real customer answer as opening echo', () => {
    for (const said of [
      "Yes, I'm looking for a site in Hunsur",
      'yes I am looking for a site in mysuru',
      'ಹೌದು ಸೈಟ್ ನೋಡ್ತಿದ್ದೀನಿ',
      'I want a plot in Narasipura',
    ]) {
      assert.equal(looksLikeOpeningEcho(said), false, said);
      assert.equal(isCustomerTurnSignal(said), true, said);
    }
  });

  it('ignores empty noise', () => {
    assert.equal(isCustomerTurnSignal(''), false);
    assert.equal(isCustomerTurnSignal('uh'), false);
  });
});
