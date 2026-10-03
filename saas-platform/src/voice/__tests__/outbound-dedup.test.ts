import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDuplicateOutboundSpeech,
  registerOutboundSpeech,
  allowsRepeatReplay,
  repeatsSentenceWithinTurn,
} from '../outbound-dedup';

describe('outbound-dedup', () => {
  it('detects exact and near-duplicate turns across the call', () => {
    const spoken = new Set<string>();
    const line =
      'Is this for investment, or are you looking to build a house immediately?';
    registerOutboundSpeech(line, spoken);
    assert.equal(isDuplicateOutboundSpeech(line, spoken), true);
    assert.equal(
      isDuplicateOutboundSpeech(
        'Is this for investment, or are you looking to build a house immediately?',
        spoken,
      ),
      true,
    );
    assert.equal(
      isDuplicateOutboundSpeech('We have two projects on Hunsur Road.', spoken),
      false,
    );
  });

  it('STRICT rule: flags reworded repeats (same info, different words)', () => {
    const spoken = new Set<string>();
    registerOutboundSpeech(
      'We currently have two projects that could be suitable for investment.',
      spoken,
    );
    assert.equal(
      isDuplicateOutboundSpeech(
        'We have two projects that are suitable for investment.',
        spoken,
      ),
      true,
    );
  });

  it('STRICT rule: repeat-on-request only replays the immediately-previous line', () => {
    const prev = 'Are you looking for a site in Mysore?';
    const reworded = 'Looking for a site in Mysore, sir?';
    assert.equal(allowsRepeatReplay(reworded, prev, true), true);
    assert.equal(allowsRepeatReplay(reworded, prev, false), false);
  });

  it('registers sentence chunks so partial repeats are caught', () => {
    const spoken = new Set<string>();
    const pitch =
      'We currently have two projects that could be suitable for investment. One is on Hunsur Road.';
    registerOutboundSpeech(pitch, spoken);
    assert.equal(
      isDuplicateOutboundSpeech('One is on Hunsur Road.', spoken),
      true,
    );
  });

  it('allows one replay when customer asked to repeat', () => {
    const prev = 'Is this for investment, or are you looking to build a house immediately?';
    assert.equal(allowsRepeatReplay(prev, prev, true), true);
    assert.equal(allowsRepeatReplay(prev, prev, false), false);
  });
});

/**
 * A model turn that says the same thing twice INSIDE itself. The turn-level
 * guards compare against EARLIER turns, so these slipped through and the
 * caller heard the same sentence twice on one call.
 */
describe('self-repeating turns', () => {
  it('catches a verbatim sentence repeated inside one turn', () => {
    assert.equal(
      repeatsSentenceWithinTurn('One is on Hunsur Road. One is on Hunsur Road.'),
      true,
    );
    assert.equal(
      repeatsSentenceWithinTurn(
        'We have sites near Hunsur Road. We have sites near Hunsur Road.',
      ),
      true,
    );
  });

  it('catches a reworded sentence repeated inside one turn', () => {
    assert.equal(
      repeatsSentenceWithinTurn(
        'Our sales team will call you shortly. The sales team is going to call you right away.',
      ),
      true,
    );
  });

  it('leaves genuinely different turns alone', () => {
    assert.equal(
      repeatsSentenceWithinTurn('One is on Hunsur Road. The other is near T. Narasipura.'),
      false,
    );
    assert.equal(repeatsSentenceWithinTurn('A single sentence with no full stop.'), false);
    assert.equal(repeatsSentenceWithinTurn(''), false);
    // Two short fragments are too small to compare on.
    assert.equal(repeatsSentenceWithinTurn('Yes sir. Ok.'), false);
  });
});
