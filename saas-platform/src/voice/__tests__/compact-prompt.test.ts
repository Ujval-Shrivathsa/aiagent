import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutboundSystemInstruction,
  buildOutboundProjectReferenceContext,
} from '../Outbound/callguide.ts';

describe('compact outbound prompt', () => {
  it('uses a much smaller live system instruction when deferring project reference', () => {
    const compact = buildOutboundSystemInstruction('22 Aug 2026', null, {
      deferProjectReference: true,
    });
    const full = buildOutboundSystemInstruction('22 Aug 2026', null, {
      deferProjectReference: false,
    });
    assert.ok(compact.length < full.length * 0.75, 'compact prompt should be materially smaller');
    assert.ok(compact.length < 44000, `compact still too large: ${compact.length}`);
    assert.match(compact, /ANSWER CUSTOMER QUESTIONS IN KANNADA/);
    assert.doesNotMatch(compact, /Travel Time & Connectivity/);
  });

  it('defers full PDF blocks to post-connect reference context', () => {
    const ref = buildOutboundProjectReferenceContext();
    assert.match(ref, /PROJECT REFERENCE/);
    assert.match(ref, /Sridevi Lake View/);
    assert.match(ref, /Travel Time & Connectivity/);
  });
});
