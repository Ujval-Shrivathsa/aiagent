import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasThanksClosing,
  isRedundantOutboundThanksTurn,
  looksLikeThanksOnlyLine,
  PDF_INVESTMENT_YES_CLOSE,
  PDF_BUILD_HOUSE_CLOSE,
  PDF_INVESTMENT_NO_CLOSE,
} from '../Outbound/callguide';

describe('outbound thanks-once closing', () => {
  it('detects thanks in all PDF closing scripts', () => {
    assert.equal(hasThanksClosing(PDF_INVESTMENT_YES_CLOSE), true);
    assert.equal(hasThanksClosing(PDF_BUILD_HOUSE_CLOSE), true);
    assert.equal(hasThanksClosing(PDF_INVESTMENT_NO_CLOSE), true);
  });

  it('flags redundant thank-you turns after thanks already spoken', () => {
    assert.equal(isRedundantOutboundThanksTurn('Thank you.', true), true);
    assert.equal(isRedundantOutboundThanksTurn('Thank you. Thank you.', true), true);
    assert.equal(isRedundantOutboundThanksTurn('Thanks. Bye.', true), true);
    assert.equal(isRedundantOutboundThanksTurn('Sure, thanks again.', true), true);
    assert.equal(isRedundantOutboundThanksTurn('We have projects on Hunsur Road.', true), false);
    assert.equal(isRedundantOutboundThanksTurn('Thank you.', false), false);
  });

  it('treats repeated thank-you-only lines as thanks-only', () => {
    assert.equal(looksLikeThanksOnlyLine('Thank you. Thank you.'), true);
    assert.equal(looksLikeThanksOnlyLine('Thanks. Thanks.'), true);
  });
});
