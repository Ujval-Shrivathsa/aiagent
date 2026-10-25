import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentToldCallerToRepeat,
  callerReallyInterrupted,
  reviewCallerTurn,
} from '../turn-verifier';
import { PDF_INTEREST_QUESTION_KN, PDF_SITE_QUESTION_KN } from '../kannada-script';

describe('turn verifier — context before she answers', () => {
  it('treats "why are you asking" as a question to answer, not a request to repeat', () => {
    const review = reviewCallerTurn({
      text: 'Why are you asking me this?',
      lastAgentLine: PDF_SITE_QUESTION_KN,
      areasDelivered: false,
    });
    assert.equal(review.intent, 'why_asking');
    assert.equal(review.plan.action, 'explain_why');
    if (review.plan.action === 'explain_why') {
      assert.match(review.plan.nudge, /ಮೈಸೂರ/);
      assert.ok(review.plan.nudge.includes(PDF_SITE_QUESTION_KN));
      assert.match(review.plan.nudge, /Do NOT ask them to repeat/);
    }
    assert.ok(review.elapsedMs < 100);
  });

  it('explains the locations question once that line has been said', () => {
    const review = reviewCallerTurn({
      text: 'ಯಾಕೆ ಕೇಳ್ತಿದೀರಿ',
      lastAgentLine: PDF_INTEREST_QUESTION_KN,
      areasDelivered: true,
    });
    assert.equal(review.intent, 'why_asking');
    if (review.plan.action === 'explain_why') {
      assert.ok(review.plan.nudge.includes(PDF_INTEREST_QUESTION_KN));
    }
  });

  it('hears an answer that comes after the caller repeats the question', () => {
    const first = reviewCallerTurn({
      text: PDF_SITE_QUESTION_KN,
      lastAgentLine: PDF_SITE_QUESTION_KN,
      areasDelivered: false,
    });
    assert.equal(first.intent, 'echo_waiting');
    const second = reviewCallerTurn({
      text: 'ಹೌದು',
      previousCallerText: PDF_SITE_QUESTION_KN,
      lastAgentLine: PDF_SITE_QUESTION_KN,
      areasDelivered: false,
    });
    assert.equal(second.intent, 'echo_then_answer');
    assert.deepEqual(second.plan, { action: 'take_answer', answer: 'yes' });
  });

  it('takes yes in the same breath as the repeated question', () => {
    const review = reviewCallerTurn({
      text: `${PDF_SITE_QUESTION_KN} ಹೌದು`,
      lastAgentLine: PDF_SITE_QUESTION_KN,
      areasDelivered: false,
    });
    assert.equal(review.intent, 'echo_then_answer');
    if (review.plan.action === 'take_answer') assert.equal(review.plan.answer, 'yes');
  });

  it('still allows a real request to hear the line again', () => {
    const review = reviewCallerTurn({
      text: 'ಮತ್ತೆ ಹೇಳಿ',
      lastAgentLine: PDF_SITE_QUESTION_KN,
      areasDelivered: false,
    });
    assert.equal(review.intent, 'repeat_request');
    assert.equal(review.plan.action, 'allow');
  });

  it('does not cut a line for noise, an echo, or why-asking', () => {
    assert.equal(callerReallyInterrupted('hmm', PDF_SITE_QUESTION_KN), false);
    assert.equal(callerReallyInterrupted(PDF_SITE_QUESTION_KN, PDF_SITE_QUESTION_KN), false);
    assert.equal(callerReallyInterrupted('Why are you asking me this?', PDF_SITE_QUESTION_KN), false);
    assert.equal(callerReallyInterrupted('I am not interested in a site', PDF_SITE_QUESTION_KN), true);
  });

  it('recognises Priya asking them to say it again', () => {
    assert.equal(agentToldCallerToRepeat('ಮತ್ತೆ ಹೇಳಿ'), true);
    assert.equal(agentToldCallerToRepeat('Can you repeat that once again?'), true);
    assert.equal(agentToldCallerToRepeat(PDF_INTEREST_QUESTION_KN), false);
  });
});
