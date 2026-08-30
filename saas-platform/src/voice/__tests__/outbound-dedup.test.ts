import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDuplicateOutboundSpeech,
  registerOutboundSpeech,
  allowsRepeatReplay,
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
