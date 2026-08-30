/**
 * Run: npx tsx --test src/voice/__tests__/end-call-guard.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMeaningfulCustomerUtterance, shouldAllowEndCall } from '../end-call-guard';

const noEcho = () => false;
const alwaysEcho = () => true;

describe('end-call-guard', () => {
  it('blocks endCall when customer never spoke', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 60_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 0,
      batchHasNotInterested: false,
    });
    assert.equal(r.allow, false);
    assert.equal(r.reason, 'no_customer_speech');
  });

  it('blocks early endCall without goodbye or notInterested', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 8_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 1,
      batchHasNotInterested: false,
    });
    assert.equal(r.allow, false);
    assert.equal(r.reason, 'call_too_short');
  });

  it('allows endCall on clear customer goodbye even when short', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 5_000,
      customerClearGoodbye: true,
      customerUtteranceCount: 1,
      batchHasNotInterested: false,
    });
    assert.equal(r.allow, true);
    assert.equal(r.reason, 'customer_clear_goodbye');
  });

  it('allows endCall after notInterested with customer speech', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 6_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 1,
      batchHasNotInterested: true,
    });
    assert.equal(r.allow, true);
    assert.equal(r.reason, 'not_interested_confirmed');
  });

  it('blocks outbound hangup after only the opening yes', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 8_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 1,
      batchHasNotInterested: false,
      isOutbound: true,
    });
    assert.equal(r.allow, false);
    assert.equal(r.reason, 'call_too_short');
  });

  it('allows outbound scripted close after the purpose answer', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 20_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 2,
      batchHasNotInterested: false,
      isOutbound: true,
    });
    assert.equal(r.allow, true);
    assert.equal(r.reason, 'outbound_scripted_flow');
  });

  it('allows endCall after sustained conversation', () => {
    const r = shouldAllowEndCall({
      callDurationMs: 30_000,
      customerClearGoodbye: false,
      customerUtteranceCount: 3,
      batchHasNotInterested: false,
    });
    assert.equal(r.allow, true);
    assert.equal(r.reason, 'conversation_eligible');
  });

  it('counts meaningful utterances only', () => {
    assert.equal(isMeaningfulCustomerUtterance('ha', () => false), true);
    assert.equal(isMeaningfulCustomerUtterance('houda', () => false), true);
    assert.equal(isMeaningfulCustomerUtterance('uh', () => false), false);
    assert.equal(isMeaningfulCustomerUtterance('houda', () => true), true);
    assert.equal(isMeaningfulCustomerUtterance('looking for investment', () => true), false);
    assert.equal(isMeaningfulCustomerUtterance('hello', noEcho), true);
    assert.equal(isMeaningfulCustomerUtterance('ಹೌದು site ಬೇಕು', noEcho), true);
  });
});
