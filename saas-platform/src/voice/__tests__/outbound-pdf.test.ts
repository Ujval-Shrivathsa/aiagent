import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PDF_OPENING,
  PDF_PURPOSE_QUESTION,
  PDF_INVESTMENT_PITCH,
  PDF_INVESTMENT_YES_CLOSE,
  PDF_BUILD_HOUSE_CLOSE,
  looksLikeRepeatRequest,
  looksLikeInvestmentPitchYes,
  looksLikeManagerCallbackQuestion,
  looksLikeSalesManagerCallbackLine,
  looksLikeThanksOnlyLine,
  hasThanksClosing,
  buildOutboundSystemInstruction,
} from '../Outbound/callguide';

describe('outbound PDF callguide', () => {
  it('includes exact PDF opening and purpose question', () => {
    assert.equal(PDF_OPENING, 'Hi, are you looking for a residential site in Mysuru?');
    assert.match(PDF_PURPOSE_QUESTION, /investment.*build a house immediately/i);
    assert.match(PDF_INVESTMENT_PITCH, /Hunsur Road/);
    assert.match(PDF_INVESTMENT_PITCH, /T\. Narasipura Road/);
    assert.match(PDF_BUILD_HOUSE_CLOSE, /Srirampura Ring Road/);
    assert.match(PDF_INVESTMENT_YES_CLOSE, /Sales Managers will give you a call/);
    assert.match(PDF_INVESTMENT_YES_CLOSE, /Thank you/);
  });

  it('detects repeat requests per communication guidelines', () => {
    assert.equal(looksLikeRepeatRequest("I couldn't hear you"), true);
    assert.equal(looksLikeRepeatRequest('Please repeat'), true);
    assert.equal(looksLikeRepeatRequest('Your voice is not clear'), true);
    assert.equal(looksLikeRepeatRequest('yes investment'), false);
  });

  it('routes investment pitch yes and give-more-details to investment yes close', () => {
    assert.equal(looksLikeInvestmentPitchYes('yes'), true);
    assert.equal(looksLikeInvestmentPitchYes('give more details'), true);
    assert.equal(looksLikeInvestmentPitchYes('Can you give me more details?'), true);
    assert.equal(looksLikeInvestmentPitchYes('tell me more'), true);
    assert.equal(looksLikeInvestmentPitchYes('no thanks'), false);
  });

  it('routes price/RERA to manager callback only', () => {
    assert.equal(looksLikeManagerCallbackQuestion('What is the price?'), true);
    assert.equal(looksLikeManagerCallbackQuestion('Is it RERA registered?'), true);
    assert.equal(looksLikeManagerCallbackQuestion('give more details'), false);
    assert.equal(looksLikeManagerCallbackQuestion('please repeat'), false);
  });

  it('embeds PDF structure, Hunsur pronunciation, and persona guard', () => {
    const prompt = buildOutboundSystemInstruction('Sunday, 30 August 2026');
    assert.match(prompt, /Indian English accent/);
    assert.match(prompt, /Hun-sooru/);
    assert.match(prompt, /Never say you are an AI/);
    assert.match(prompt, /CALL CLOSING/);
    assert.match(prompt, /Thank you/);
    assert.match(prompt, /CONTEXTUAL CONVERSATION FLOW/);
    assert.match(prompt, /EXACTLY ONCE/);
    assert.match(prompt, /Hi, are you looking for a residential site in Mysuru/);
    assert.match(prompt, /One of our Sales Managers will give you a call shortly and provide you with more details\. Thank you/);
  });

  it('detects sales manager callback line and paraphrases', () => {
    assert.equal(
      looksLikeSalesManagerCallbackLine(
        'Sure, one of our Sales Managers will give you a call shortly and provide you with more details about the project.',
      ),
      true,
    );
    assert.equal(
      looksLikeSalesManagerCallbackLine('Sure, one of sales manager will contact you shortly'),
      true,
    );
    assert.equal(looksLikeSalesManagerCallbackLine('We have projects on Hunsur Road.'), false);
  });

  it('detects thanks-only repeats at hangup', () => {
    assert.equal(looksLikeThanksOnlyLine('Thank you.'), true);
    assert.equal(looksLikeThanksOnlyLine('Thank you. Thank you. Thank you.'), true);
    assert.equal(looksLikeThanksOnlyLine('Thanks. Thanks.'), true);
    assert.equal(
      looksLikeThanksOnlyLine('Sure, no problem. Thank you for your time.'),
      false,
    );
  });

  it('detects thanks closing in spoken text', () => {
    assert.equal(hasThanksClosing('Sure, no problem. Thank you.'), true);
    assert.equal(hasThanksClosing('Thanks.'), true);
    assert.equal(hasThanksClosing('One moment please.'), false);
  });
});
