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
  NEEDS_LOCALITY_QUESTION_KN,
  NEEDS_PURPOSE_QUESTION_KN,
  buildOutboundFastConnectInstruction,
  buildOutboundSystemInstruction,
  extractCallerName,
  looksLikeCannotAnswerLine,
  buildOutboundRepeatQuestionNudge,
  buildOutboundProjectsNudge,
  buildOutboundHandoffTransferNudge,
  getOutboundGreetingInstruction,
  PDF_OPENING_TURN1_KN,
  hasThanksClosing,
  PDF_THANKS_CLOSE_KN,
  PDF_AREAS_LINE_KN,
  PDF_INTEREST_QUESTION_KN,
  PDF_HANDOFF_LINE_KN,
  PDF_NAME_QUESTION_KN,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  OUTBOUND_CANNOT_ANSWER_NUDGE,
  OUTBOUND_NAME_QUESTION_NUDGE,
  HONORIFIC_SIR_KN,
  HONORIFIC_MAAM_KN,
} from '../kannada-script';
import {
  absorbVolunteeredNeeds,
  buildNeedQuestionNudge,
  createNeedsChecklist,
  isNeedsComplete,
  nextUnaskedNeed,
  recordNeedAnswer,
} from '../needs-checklist';
import {
  LISTENING_BEATS_KN,
  chooseListeningBeat,
  isSafeListeningBeat,
} from '../conversation-naturalness';

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
  const nudge = buildOutboundRepeatQuestionNudge('ನಿಮ್ಮ ಹೆಸರು ಏನು ಸರ್?');

  it('never repeats a name question', () => {
    assert.doesNotMatch(nudge, /ಹೆಸರು/);
    assert.match(nudge, /ನೋಡ್ತಿದೀರಾ|looking for a site/i);
  });

  it('says it slower and clearer, then waits', () => {
    assert.match(nudge, /SLOWER/);
    assert.match(nudge, /clearer/);
    assert.match(nudge, /STOP\s+and WAIT/);
  });

  it('must not advance the flow or apologise at length', () => {
    assert.match(nudge, /Do NOT move to the next step/);
    assert.match(nudge, /do NOT apologise at length/);
  });

  it('copes with no known previous line', () => {
    const bare = buildOutboundRepeatQuestionNudge('');
    assert.match(bare, /ನೋಡ್ತಿದೀರಾ/);
    assert.doesNotMatch(bare, /undefined/);
    assert.doesNotMatch(bare, /ಹೆಸರು/);
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
    assert.equal(OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_NAME_QUESTION_KN), false);
    assert.ok(OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_AREAS_LINE_KN));
  });

  it('still carries the substance the turn must cover', () => {
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.match(projects, /YOUR OWN WORDS/);
    assert.doesNotMatch(projects, /Ravi/);
    assert.match(projects, /Say only the line given/);
    assert.match(projects, /STOP and WAIT/);
  });

  it('never says the thank-you before the close', () => {
    // ಧನ್ಯವಾದ ends the call on this system, so it must not appear in any
    // mid-call turn — only as an explicit BAN in these instructions.
    for (const nudge of [
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
describe('the close is recognised however the agent words it', () => {
  it('sees a free-form English thank-you as the close', () => {
    assert.equal(hasThanksClosing('Thank you sir for giving your time'), true);
    assert.equal(hasThanksClosing('thanks for your time sir'), true);
    assert.equal(hasThanksClosing('Thank you for your time.'), true);
  });

  it('still sees the Kannada and Devanagari forms', () => {
    assert.equal(hasThanksClosing(PDF_THANKS_CLOSE_KN), true);
    assert.equal(hasThanksClosing('ಧನ್ಯವಾ ದಗಳು'), true); // transcriber split
    assert.equal(hasThanksClosing('धन्यवाद'), true);
  });

  it('does not fire on ordinary mid-call talk', () => {
    assert.equal(hasThanksClosing('we have plots in Hunsur sir'), false);
    assert.equal(hasThanksClosing('what is your name'), false);
    assert.equal(hasThanksClosing(''), false);
  });
});

/**
 * Priya was overselling the areas as "the sites you are looking for" to a caller
 * who had only said they wanted a site in Mysuru. The honest shape is "we have
 * a few options" — modest, and enough for the caller to react to.
 */
describe('the areas line is offered modestly', () => {
  it('names Hunsur Road, T. Narasipura Road, and Nanjangudu', () => {
    assert.match(PDF_AREAS_LINE_KN, /ಹುಣಸೂರು/);
    assert.match(PDF_AREAS_LINE_KN, /ನರಸೀಪುರ/);
    assert.match(PDF_AREAS_LINE_KN, /ನಂಜನಗೂಡ/);
    assert.match(PDF_AREAS_LINE_KN, /\?/);
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /ಧನ್ಯವಾದ/);
  });

  it('the locations nudge says those three places and then waits', () => {
    assert.ok(OUTBOUND_YES_LOCATIONS_NUDGE.includes(PDF_AREAS_LINE_KN));
    assert.ok(OUTBOUND_YES_LOCATIONS_NUDGE.includes(PDF_INTEREST_QUESTION_KN));
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /STOP and WAIT/);
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /Do NOT say ಧನ್ಯವಾದ/);
  });
});

describe('the sales handover is confident, never apologetic', () => {
  const handoff = buildOutboundHandoffTransferNudge();

  it('forbids apologising or claiming it cannot connect them', () => {
    assert.match(handoff, /confident, warm handover/);
    assert.match(handoff, /NEVER sound apologetic or unsure/);
    assert.match(handoff, /NEVER say you cannot connect them/);
  });

  it('the old name nudge no longer asks for a name', () => {
    const nudge = OUTBOUND_NAME_QUESTION_NUDGE;
    assert.equal(nudge.includes(PDF_NAME_QUESTION_KN), false);
    assert.ok(nudge.includes(PDF_AREAS_LINE_KN));
    assert.doesNotMatch(nudge, /ask their name/i);
    assert.doesNotMatch(nudge, /ಹೆಸರು/);
    assert.doesNotMatch(nudge, /never read out a fixed line/);
  });

  it('carries the Kannada line, so the close cannot come out in English', () => {
    // REGRESSION, from a real call: after a whole conversation in Kannada, the
    // sales-team close came out in English. This nudge was the only close nudge
    // that described the sentence purely in English prose with no Kannada to
    // anchor it, so a long all-English instruction turn primed the model to
    // answer in English. OUTBOUND_YES_LOCATIONS_NUDGE already embeds its
    // Kannada line for exactly this reason — this one now matches.
    assert.ok(
      handoff.includes(PDF_HANDOFF_LINE_KN),
      'the handoff nudge must carry the actual Kannada sentence',
    );
    assert.match(handoff, /The call is in Kannada/);
    assert.match(handoff, /NEVER answer this close in English unless they asked for English/);
  });

  it('still ends on one thank-you and endCall in the same turn', () => {
    assert.match(handoff, /sales team/i);
    assert.match(handoff, /exactly once/i);
    assert.match(handoff, /endCall in the SAME turn/);
  });
});

/**
 * The opening was prefaced with "I will tell what I am programmed to tell",
 * because the greeting instruction was phrased as a meta-command the model
 * narrated out loud before the real line.
 */
describe('the opening is spoken immediately, with no preamble', () => {
  const greeting = getOutboundGreetingInstruction('en');
  const live = getOutboundGreetingInstruction();

  it('never mentions instructions, a script, or being programmed', () => {
    assert.doesNotMatch(live, /being programmed/);
    assert.doesNotMatch(live, /following instructions/);
    assert.match(live, /Do not read this instruction aloud/);
  });

  it('still speaks the whole opening in one go', () => {
    assert.ok(greeting.includes("Hello, I'm Priya from Alliance Square. Are you looking for a site in Mysuru?"));
    assert.ok(live.includes(PDF_OPENING_TURN1_KN));
    assert.match(live, /one sentence/);
    assert.match(live, /then stop and listen/);
  });
});
/**
 * OWNER DECISION — THE NEEDS CHECKLIST (13 Oct 2026).
 *
 * The pinned five steps told the sales team WHO was interested and almost
 * nothing about WHAT the caller needed, so the employee had to re-ask the two
 * qualifying questions the caller had just answered to a machine. The agent now
 * has a two-item todo list — the purpose, and the preferred area — asked one at
 * a time before the close.
 *
 * These tests encode the parts that must not drift: exactly two questions, the
 * pinned lines untouched, an answered or volunteered item never asked, an
 * unanswered item never holding the call open, and the whole thing still unable
 * to trip the thank-you detector.
 */
describe('the needs list is two questions, and the pinned lines are untouched', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026');
  const fast = buildOutboundFastConnectInstruction('30 Sep 2026');

  it('does not ask the purpose or the area on this call', () => {
    for (const prompt of [full, fast]) {
      assert.match(prompt, /After the caller's yes, say only the locations line/);
      assert.doesNotMatch(prompt, /3B\. THE TWO NEEDS QUESTIONS/);
      assert.ok(!prompt.includes(NEEDS_PURPOSE_QUESTION_KN));
      assert.ok(!prompt.includes(NEEDS_LOCALITY_QUESTION_KN));
    }
  });

  it('bans every question the owner did not authorise', () => {
    for (const banned of ['budget', 'plot size', 'timeline', 'documents', 'possession']) {
      assert.ok(
        new RegExp('never ask about[^.]*' + banned, 'i').test(full),
        `"${banned}" must stay on the forbidden list`,
      );
    }
    assert.match(full, /After the caller's yes, say only the locations line/i);
  });

  it('leaves every pinned line exactly as it was', () => {
    for (const prompt of [full, fast]) {
      assert.ok(
        !prompt.includes("Hello, I'm Priya from Alliance Square. Are you looking for a site in Mysuru?"),
        'the English opening is not in the live prompt',
      );
      assert.ok(prompt.includes(PDF_OPENING_TURN1_KN), 'the Kannada opening is still available');
      assert.ok(prompt.includes(PDF_AREAS_LINE_KN), 'the areas line is still word for word');
      assert.ok(prompt.includes(PDF_HANDOFF_LINE_KN), 'the sales-manager line is still word for word');
      assert.ok(prompt.includes(PDF_THANKS_CLOSE_KN), 'the thank-you is still word for word');
    }
    assert.equal(hasThanksClosing(PDF_THANKS_CLOSE_KN), true, 'the thanks detector still fires');
    assert.equal(hasThanksClosing(PDF_AREAS_LINE_KN), false, 'and never on the areas line');
  });

  it('the two questions cannot hang the call up', () => {
    assert.equal(hasThanksClosing(NEEDS_PURPOSE_QUESTION_KN), false);
    assert.equal(hasThanksClosing(NEEDS_LOCALITY_QUESTION_KN), false);
  });

  it('an answer the caller already gave is never asked for again', () => {
    let c = createNeedsChecklist();
    c = absorbVolunteeredNeeds(c, 'I am looking for a plot in Hunsur for investment');
    assert.equal(nextUnaskedNeed(c), null, 'both questions are answered before either is asked');
    const nudge = buildNeedQuestionNudge('purpose', { acquired: null });
    assert.doesNotMatch(nudge, /asked=\[/, 'the nudge carries no second question');
  });

  it('an unanswered question never holds the call open', () => {
    let c = createNeedsChecklist();
    c = recordNeedAnswer(c, 'purpose', 'hmm');
    c = recordNeedAnswer(c, 'locality', 'no idea');
    assert.equal(isNeedsComplete(c), true, 'the call closes with whatever was collected');
  });
});

/**
 * OWNER DECISION — THE ONE PERMITTED HUMAN BEAT (13 Oct 2026).
 *
 * The strict style banned every reaction before a line, which is what removed
 * the machine-chatter the callers complained about — and with it the small sound
 * that makes a voice sound like a person listening. The owner allowed ONE short
 * listening sound, at the START of a real step, and nothing more.
 */
describe('one short listening beat, at the start of a real line only', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026');

  it('the short instruction stays on the four beats and answers a side question', () => {
    assert.match(full, /Stay inside these four beats/);
    assert.match(full, /one short sentence/);
    assert.doesNotMatch(full, /Say nothing else/i);
    assert.doesNotMatch(full, /Say only the line given/i);
    assert.doesNotMatch(full, /ONE exception, and it is the only one/);
  });

  it('every permitted beat is short, safe and Kannada', () => {
    for (const beat of LISTENING_BEATS_KN) {
      assert.equal(isSafeListeningBeat(beat.text), true);
      assert.equal(hasThanksClosing(beat.text), false, 'a beat must never end the call');
    }
    assert.equal(chooseListeningBeat({ variantIndex: 0 }), LISTENING_BEATS_KN[0].text);
  });

  it('the old ban on an opener is still in force for everything else', () => {
    assert.match(full, /No reaction before it/);
    assert.match(full, /never "ohh", "oh", "ah", "okay so"/);
    assert.match(full, /never a laugh/);
  });
});
