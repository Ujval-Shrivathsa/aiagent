import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCustomerQuestion, looksLikeSiteDetailRequest } from '../customer-question';

describe('customer-question', () => {
  it('detects Kannada price and project questions', () => {
    assert.equal(looksLikeCustomerQuestion('UK Square rate ಎಷ್ಟು?'), true);
    assert.equal(looksLikeCustomerQuestion('ಯಾವ projects ಇವೆ?'), true);
    assert.equal(looksLikeCustomerQuestion('CNM Apex location ಹೇಳಿ'), true);
  });

  it('detects English direct questions', () => {
    assert.equal(looksLikeCustomerQuestion('What is the rate for Sridevi Lake View?'), true);
    assert.equal(looksLikeCustomerQuestion('Tell me about UK Square'), true);
  });

  it('detects site detail requests', () => {
    assert.equal(looksLikeSiteDetailRequest('UK Square details ಹೇಳಿ'), true);
    assert.equal(looksLikeSiteDetailRequest('Tell me about CNM Apex City'), true);
    assert.equal(looksLikeSiteDetailRequest('Sridevi Lake View bagge heLi'), true);
    assert.equal(looksLikeSiteDetailRequest('UK Square rate ಎಷ್ಟು?'), false);
  });

  it('ignores short fillers', () => {
    assert.equal(looksLikeCustomerQuestion('hello'), false);
    assert.equal(looksLikeCustomerQuestion('ಹಾ'), false);
  });
});
