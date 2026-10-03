import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_THANKS_CLOSE_KN,
  PDF_HANDOFF_LINE_KN,
  shouldDropRepeatedThanksInTurn,
} from '../kannada-script';

const HOP = ' ಮಾರ್ಕೆಟ್ಟಿಂಗ್ ಟೀಮ್ ನಿಮ್ಮದೇಕೆ ಕರೆ ಮಾಡುತ್ತಾರೆ';

test('the first thank-you in a turn is never dropped', () => {
  assert.equal(shouldDropRepeatedThanksInTurn(false, 'ಧನ್ಯವಾದ ಸರ್'), false);
  assert.equal(shouldDropRepeatedThanksInTurn(false, PDF_THANKS_CLOSE_KN), false);
});

test('a thanks repeated inside one turn is dropped', () => {
  // This is the caller complaint: the thank-you spoken two or three times.
  assert.equal(shouldDropRepeatedThanksInTurn(true, 'ಧನ್ಯವಾದ'), true);
  assert.equal(shouldDropRepeatedThanksInTurn(true, ' ಧನ್ಯವಾದ ಸರ್'), true);
  assert.equal(shouldDropRepeatedThanksInTurn(true, 'thank you'), true);
  assert.equal(shouldDropRepeatedThanksInTurn(true, ' ಧನ್ಯವಾ ದ ಸರ್'), true, 'split word must still match');
});

test('the tail of the close is NOT truncated', () => {
  // The thank-you streams across several messages. A continuation carries no
  // second thank-you, so it MUST play — dropping it would cut the line off.
  assert.equal(shouldDropRepeatedThanksInTurn(true, ' ಸರ್ ನಿಮ್ಮ ಸಮಯಕ್ಕೂ'), false);
  assert.equal(shouldDropRepeatedThanksInTurn(true, ' ಆಗಿ ಮನೆಯಿರಿ'), false);
  assert.equal(shouldDropRepeatedThanksInTurn(true, ''), false);
});

test('the sales-team line is not mistaken for a repeated thanks', () => {
  assert.equal(shouldDropRepeatedThanksInTurn(true, HOP), false);
  assert.equal(shouldDropRepeatedThanksInTurn(true, PDF_HANDOFF_LINE_KN), false);
});
