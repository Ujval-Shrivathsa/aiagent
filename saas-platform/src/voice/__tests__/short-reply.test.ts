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

  it('ignores empty noise', () => {
    assert.equal(isCustomerTurnSignal(''), false);
    assert.equal(isCustomerTurnSignal('uh'), false);
  });
});
