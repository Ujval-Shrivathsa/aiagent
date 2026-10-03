/**
 * The owner's decisions for the Priya agent, pinned as tests.
 *
 * Every failure here came from the real call: the name step was skipped, a
 * clearly interested caller was answered with the decline close, and a hearing
 * complaint advanced the flow. These are the contracts that must not regress.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractCallerName,
  looksLikeCannotAnswerLine,
  buildOutboundRepeatQuestionNudge,
  buildOutboundProjectsNudge,
  buildOutboundHandoffTransferNudge,
  getOutboundGreetingInstruction,
  PDF_OPENING_TURN1_KN,
  OUTBOUND_CANNOT_ANSWER_NUDGE,
  OUTBOUND_NAME_QUESTION_NUDGE,
  HONORIFIC_SIR_KN,
  HONORIFIC_MAAM_KN,
} from '../kannada-script';

/**
 * "I am looking for a plot in Hunsur" is the caller answering the PROJECTS
 * question, not giving their name. The "I am ..." rule used to capture the
 * gerund ("looking") and the bare-capital rule captured the locality
 * ("Hunsur"), so Priya addressed the caller by them — and the flow skipped
 * straight past the name step. That is the scrambled call, reproduced.
 */
describe('a caller answering about a plot is never mistaken for a name', () => {
  const interestUtterances = [
    'I am looking for a plot in Hunsur',
    "I'm looking for a plot",
    'I am interested in Mysuru',
    'I want a site in K R Nagar',
    'plot in badami layout',
  ];

  for (const text of interestUtterances) {
    it(`"${text}" yields no name`, () => {
      assert.equal(extractCallerName(text), null);
    });
  }

  it('still captures a real name, however it is offered', () => {
    assert.equal(extractCallerName('Ravi'), 'Ravi');
    assert.equal(extractCallerName('my name is Ravi'), 'Ravi');
    assert.equal(extractCallerName('I am Ravi'), 'Ravi');
    assert.equal(extractCallerName('I am Lakshmi'), 'Lakshmi');
    assert.equal(extractCallerName('this is Priya'), null); // never the agent
  });
});

/**
 * Owner decision 2: "I can't hear you" repeats the SAME question once, slower.
 * The nudge must carry the question it is repeating, or the agent invents a new
 * one and the caller falls further behind.
 */
describe('a hearing complaint repeats the same question, once', () => {
  const nudge = buildOutboundRepeatQuestionNudge('ನಿಮ್ಗೆ ಹೆಸರು ಏನು ಸರ್?');

  it('quotes the question it is repeating', () => {
    assert.match(nudge, /ನಿಮ್ಗೆ ಹೆಸರು ಏನು ಸರ್\?/);
  });

  it('says it slower and louder, then waits', () => {
    assert.match(nudge, /SLOWER/);
    assert.match(nudge, /louder/);
    assert.match(nudge, /STOP\s+and WAIT/);
  });

  it('must not advance the flow or apologise at length', () => {
    assert.match(nudge, /Do NOT move to the next step/);
    assert.match(nudge, /do NOT apologise at length/);
  });

  it('copes with no known previous line', () => {
    const bare = buildOutboundRepeatQuestionNudge('');
    assert.match(bare, /the question you just asked/);
    assert.doesNotMatch(bare, /undefined/);
  });
});

/**
 * Owner decision 5: an answer Priya cannot give ends with the sales team —
 * never a guess, and never an open line.
 */
describe('an unanswerable question is handed to the sales team', () => {
  it('recognises the agent hitting a wall', () => {
    assert.equal(looksLikeCannotAnswerLine("I don't know that"), true);
    assert.equal(looksLikeCannotAnswerLine('I did not catch that'), true);
    assert.equal(looksLikeCannotAnswerLine('not sure about that'), true);
    assert.equal(looksLikeCannotAnswerLine('ನನಗೆ ತಿಳಿಯುವುದಿಲ್ಲ'), true);
    // "I cannot hear you" must NOT land here: that is the agent's single
    // ask-to-repeat line, which buys the caller one more chance. Only a wall
    // the agent cannot get past goes to the sales team.
    assert.equal(looksLikeCannotAnswerLine('I cannot hear you'), false);
  });

  it('does not fire on ordinary sales talk', () => {
    assert.equal(looksLikeCannotAnswerLine('we have plots in Hunsur sir'), false);
    assert.equal(looksLikeCannotAnswerLine('ನಮ್ಮ ಹತ್ತಿರ ಹುಣಸೂರು ಇದೆ ಸರ್'), false);
    assert.equal(looksLikeCannotAnswerLine(''), false);
  });

  it('offers the sales team, thanks once, then ends the call', () => {
    assert.match(OUTBOUND_CANNOT_ANSWER_NUDGE, /sales team/i);
    assert.match(OUTBOUND_CANNOT_ANSWER_NUDGE, /ONE short thank-you/);
    assert.match(OUTBOUND_CANNOT_ANSWER_NUDGE, /endCall in the SAME turn/);
    assert.match(OUTBOUND_CANNOT_ANSWER_NUDGE, /exactly ONCE/);
    assert.match(OUTBOUND_CANNOT_ANSWER_NUDGE, /Do NOT guess/);
  });
});

/**
 * Owner decision 1: the opening is the only scripted line. Everything after it
 * is guidance, and the invariants that protect the call still hold.
 */
describe('only the opening is scripted', () => {
  it('never quotes a line the agent must say', () => {
    assert.doesNotMatch(OUTBOUND_NAME_QUESTION_NUDGE, /you already asked "are you looking/);
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /YOUR OWN WORDS/);
  });

  it('still carries the substance the turn must cover', () => {
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.match(projects, /YOUR OWN WORDS/);
    assert.match(projects, /Ravi ಸರ್/);
    assert.match(projects, /STOP and WAIT/);
  });

  it('never says the thank-you before the close', () => {
    // ಧನ್ಯವಾದ ends the call on this system, so it must not appear in any
    // mid-call turn — only as an explicit BAN in these instructions.
    for (const nudge of [
      OUTBOUND_NAME_QUESTION_NUDGE,
      buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN),
      buildOutboundProjectsNudge(null, HONORIFIC_MAAM_KN),
    ]) {
      const spoken = nudge.replace(/NEVER say[^.]*\./gi, '');
      assert.doesNotMatch(spoken, /ಧನ್ಯವಾದ/, 'no thanks may be spoken mid-flow');
    }
  });
});

/**
 * The transfer line was heard as "I can't connect you with the sales team" —
 * an apology that handed the caller nothing, immediately before the call died.
 * It has to sound like a handover one colleague gives another.
 */
describe('the sales handover is confident, never apologetic', () => {
  const handoff = buildOutboundHandoffTransferNudge();

  it('forbids apologising or claiming it cannot connect them', () => {
    assert.match(handoff, /confident, warm handover/);
    assert.match(handoff, /NEVER sound apologetic or unsure/);
    assert.match(handoff, /NEVER say you cannot connect them/);
  });

  it('still ends on one thank-you and endCall in the same turn', () => {
    assert.match(handoff, /sales team/i);
    assert.match(handoff, /ONE short thank-you/);
    assert.match(handoff, /exactly ONCE/i);
    assert.match(handoff, /endCall in the SAME turn/);
  });
});

/**
 * The opening was prefaced with "I will tell what I am programmed to tell",
 * because the greeting instruction was phrased as a meta-command the model
 * narrated out loud before the real line.
 */
describe('the opening is spoken immediately, with no preamble', () => {
  const greeting = getOutboundGreetingInstruction();

  it('never mentions instructions, a script, or being programmed', () => {
    assert.match(greeting, /never mention that you are following instructions/);
    assert.match(greeting, /being programmed/);
    assert.match(greeting, /say NOTHING before it/);
  });

  it('still speaks the whole opening in one go', () => {
    assert.ok(greeting.includes(PDF_OPENING_TURN1_KN));
    assert.match(greeting, /Then stop and listen/);
  });
});