import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDF_INVESTMENT_YES_CLOSE } from '../Outbound/callguide';
import {
  createOutboundThanksGuardState,
  simulateOutboundClosingTurn,
} from '../outbound-thanks-guard';

describe('outbound thanks flow simulation', () => {
  it('plays the first closing with thank you, then mutes repeats', () => {
    let state = createOutboundThanksGuardState();

    const first = simulateOutboundClosingTurn(PDF_INVESTMENT_YES_CLOSE, state);
    assert.equal(first.play, true, 'first closing must play');
    assert.equal(first.state.thanksSpoken, true);
    assert.equal(first.state.hardMuteAfterClose, true);
    state = first.state;

    const repeat = simulateOutboundClosingTurn('Thank you.', state);
    assert.equal(repeat.play, false);
    assert.ok(
      repeat.reason === 'hard_mute_after_close' || repeat.reason === 'redundant_thanks',
    );

    const muteRepeat = simulateOutboundClosingTurn('Thank you. Thank you.', state);
    assert.equal(muteRepeat.play, false);
    assert.equal(muteRepeat.reason, 'hard_mute_after_close');
  });

  it('does not mute before the first thanks turn plays', () => {
    let state = createOutboundThanksGuardState();
    const closing = simulateOutboundClosingTurn(PDF_INVESTMENT_YES_CLOSE, state);
    assert.equal(closing.play, true);
    assert.equal(closing.state.hardMuteAfterClose, true);
  });
});
