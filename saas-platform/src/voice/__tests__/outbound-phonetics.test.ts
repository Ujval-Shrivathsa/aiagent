import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOutboundPhoneticRules,
  PRONUNCIATION_GUIDE,
} from '../Outbound/phonetics';

describe('outbound phonetics', () => {
  it('uses Hun-sooru for Hunsur per revised PDF', () => {
    assert.match(PRONUNCIATION_GUIDE.Hunsur, /Hun-sooru/);
    assert.match(PRONUNCIATION_GUIDE['Hunsur Road'], /Hun-sooru/);
    assert.match(PRONUNCIATION_GUIDE.Srirampura, /shree-raam-poo-ra/);
  });

  it('phonetic rules emphasize Hun-sooru and natural spoken forms', () => {
    const rules = buildOutboundPhoneticRules();
    assert.match(rules, /Hun-sooru/);
    assert.match(rules, /ಹುಣೂರು/);
    assert.match(rules, /shree-raam-poo-ra/);
    assert.match(rules, /Never say "Hun-sur"/);
  });
});
