/**
 * Lead status lifecycle unit tests (no DB).
 * Run: npx tsx --test src/lib/__tests__/lead-status.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_STATUS,
  canTransition,
  normalizeLeadStatus,
  statusFromProviderHangup,
  sourcesForTransition,
  outcomeFromFlags,
  splitLeadStatusFields,
  composeLegacyStatus,
  dualFieldsForTransition,
  OUTCOME_UNKNOWN,
} from '../lead-status';

describe('normalizeLeadStatus', () => {
  it('maps legacy aliases', () => {
    assert.equal(normalizeLeadStatus('not - interested'), LEAD_STATUS.NOT_INTERESTED);
    assert.equal(normalizeLeadStatus('scheduled visit'), LEAD_STATUS.VISIT_SCHEDULED);
    assert.equal(normalizeLeadStatus('completed'), LEAD_STATUS.CALL_COMPLETED);
  });
});

describe('happy-path transitions', () => {
  it('allows pending → calling → answered → call completed → outcomes', () => {
    assert.equal(canTransition(LEAD_STATUS.PENDING, LEAD_STATUS.CALLING), true);
    assert.equal(canTransition(LEAD_STATUS.CALLING, LEAD_STATUS.ANSWERED), true);
    assert.equal(canTransition(LEAD_STATUS.ANSWERED, LEAD_STATUS.CALL_COMPLETED), true);
    for (const o of [
      LEAD_STATUS.INTERESTED,
      LEAD_STATUS.FOLLOW_UP,
      LEAD_STATUS.VISIT_SCHEDULED,
      LEAD_STATUS.NOT_INTERESTED,
    ]) {
      assert.equal(canTransition(LEAD_STATUS.CALL_COMPLETED, o), true, o);
    }
  });

  it('rejects invalid jumps', () => {
    assert.equal(canTransition(LEAD_STATUS.PENDING, LEAD_STATUS.ANSWERED), false);
    assert.equal(canTransition(LEAD_STATUS.CALLING, LEAD_STATUS.CALL_COMPLETED), false);
    assert.equal(canTransition(LEAD_STATUS.NOT_ANSWERED, LEAD_STATUS.CALL_COMPLETED), false);
  });
});

describe('unanswered and failed', () => {
  it('calling → not answered | failed', () => {
    assert.equal(canTransition(LEAD_STATUS.CALLING, LEAD_STATUS.NOT_ANSWERED), true);
    assert.equal(canTransition(LEAD_STATUS.CALLING, LEAD_STATUS.FAILED), true);
  });

  it('maps provider hangup correctly', () => {
    assert.equal(
      statusFromProviderHangup({ providerStatus: 'no-answer' }),
      LEAD_STATUS.NOT_ANSWERED
    );
    assert.equal(
      statusFromProviderHangup({ providerStatus: 'busy' }),
      LEAD_STATUS.NOT_ANSWERED
    );
    assert.equal(
      statusFromProviderHangup({ providerStatus: 'failed' }),
      LEAD_STATUS.FAILED
    );
    assert.equal(
      statusFromProviderHangup({
        providerStatus: 'completed',
        durationSec: 45,
        wasAnswered: true,
      }),
      LEAD_STATUS.CALL_ENDED
    );
    assert.equal(
      statusFromProviderHangup({
        hangupCause: 'NORMAL_CLEARING',
        durationSec: 0,
        wasAnswered: false,
      }),
      LEAD_STATUS.NOT_ANSWERED
    );
  });
});

describe('idempotent webhook sources', () => {
  it('does not allow call ended to overwrite visit scheduled', () => {
    const sources = sourcesForTransition(LEAD_STATUS.CALL_ENDED);
    assert.equal(sources.includes(LEAD_STATUS.VISIT_SCHEDULED), false);
    assert.equal(sources.includes(LEAD_STATUS.FOLLOW_UP), false);
    assert.equal(sources.includes(LEAD_STATUS.NOT_INTERESTED), false);
    assert.equal(sources.includes(LEAD_STATUS.ANSWERED), true);
    assert.equal(sources.includes(LEAD_STATUS.CALLING), true);
  });

  it('self-transition is allowed for duplicate callbacks', () => {
    assert.equal(canTransition(LEAD_STATUS.CALL_ENDED, LEAD_STATUS.CALL_ENDED), true);
    assert.equal(sourcesForTransition(LEAD_STATUS.NOT_ANSWERED).includes(LEAD_STATUS.NOT_ANSWERED), true);
  });
});

describe('outcomeFromFlags', () => {
  it('promotes call completed based on interest flags', () => {
    assert.equal(outcomeFromFlags({ interested: true }), LEAD_STATUS.INTERESTED);
    assert.equal(outcomeFromFlags({ interested: false }), LEAD_STATUS.NOT_INTERESTED);
    assert.equal(outcomeFromFlags({ interested: true, followUp: true }), LEAD_STATUS.FOLLOW_UP);
    assert.equal(outcomeFromFlags({ interested: null }), null);
  });
});

describe('splitLeadStatusFields', () => {
  it('keeps call + outcome separate for known outcome status', () => {
    const split = splitLeadStatusFields({ status: 'interested' });
    assert.equal(split.call_status, LEAD_STATUS.CALL_COMPLETED);
    assert.equal(split.outcome_status, LEAD_STATUS.INTERESTED);

    const unanswered = splitLeadStatusFields({ status: 'not answered' });
    assert.equal(unanswered.call_status, LEAD_STATUS.NOT_ANSWERED);
    assert.equal(unanswered.outcome_status, OUTCOME_UNKNOWN);

    const dual = dualFieldsForTransition(LEAD_STATUS.FOLLOW_UP);
    assert.equal(dual.callStatus, LEAD_STATUS.CALL_COMPLETED);
    assert.equal(dual.outcomeStatus, LEAD_STATUS.FOLLOW_UP);
    assert.equal(composeLegacyStatus(dual.callStatus, dual.outcomeStatus), LEAD_STATUS.FOLLOW_UP);
  });

  it('prefers explicit dual columns over legacy status', () => {
    const split = splitLeadStatusFields({
      status: 'interested',
      callStatus: 'call completed',
      outcomeStatus: 'follow up',
    });
    assert.equal(split.call_status, LEAD_STATUS.CALL_COMPLETED);
    assert.equal(split.outcome_status, LEAD_STATUS.FOLLOW_UP);
  });
});
