/**
 * Tests for the single outbound script module (v5 final spec).
 * Run: npx tsx --test src/voice/__tests__/kannada-script.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_OPENING_KN,
  PDF_OPENING,
  PDF_AREAS_LINE_KN,
  PDF_HANDOFF_LINE_KN,
  OUTBOUND_NOT_INTERESTED_CLOSE_KN,
  SILENCE_CHECK_LINE_KN,
  SILENCE_TIMEOUT_CLOSE_KN,
  getOutboundGreetingInstruction,
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  buildOutboundProjectReferenceContext,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  OUTBOUND_YES_ASK_NAME_NUDGE,
  buildOutboundHandoffTransferNudge,
  OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE,
  OUTBOUND_SILENCE_CHECK_NUDGE,
  OUTBOUND_SILENCE_RESUME_NUDGE,
  buildOutboundIdentityAnswerNudge,
  buildOutboundOffTopicAnswerNudge,
  buildOutboundResumeNudge,
  hasThanksClosing,
  looksLikeAreasLine,
  looksLikeHandoffLine,
  looksLikeNotInterestedCloseLine,
  looksLikeRepeatRequest,
  looksLikeCustomerBusy,
  looksLikeThanksOnlyLine,
  looksLikeOpeningRestate,
  looksLikeIdentityQuestion,
  looksLikeContextInterrupt,
  deriveOutboundConversationMemory,
  createOutboundSilenceState,
  armOutboundSilenceCheck,
  tickOutboundSilence,
  detectForbiddenLayoutMention,
  allowedLayoutsList,
} from '../kannada-script';

/** Latin letters outside the {name} placeholder are forbidden in SPOKEN lines. */
const hasLatin = (s: string) => /[A-Za-z]/.test(s.replace(/\{name\}/g, ''));

describe('v5 script — spoken lines', () => {
  it('opening = intro + site question, ONE Kannada utterance', () => {
    assert.match(PDF_OPENING_KN, /ಪ್ರಿಯಾ/);
    assert.match(PDF_OPENING_KN, /ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್/);
    assert.match(PDF_OPENING_KN, /ಸೈಟ್ ನೋಡ್ತಿದೀರಾ ಸರ್\?/); // the spec question IS present
    assert.equal(PDF_OPENING, PDF_OPENING_KN);
    const greeting = getOutboundGreetingInstruction();
    assert.match(greeting, /OPEN NOW/);
    assert.match(greeting, /no delay/);
    assert.match(greeting, /ಸೈಟ್ ನೋಡ್ತಿದೀರಾ/);
  });

  it('locations line = the four areas, no trailing question', () => {
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /\{name\}/);
    assert.match(PDF_AREAS_LINE_KN, /ಹುಣಸೂರು/);
    assert.match(PDF_AREAS_LINE_KN, /ನರಸೀಪುರ/);
    assert.match(PDF_AREAS_LINE_KN, /ಶ್ರೀರಾಂಪುರ/);
    assert.match(PDF_AREAS_LINE_KN, /ಕೆ\. ಆರ್\. ನಗರ/);
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /\?/);
    assert.equal(hasLatin(PDF_AREAS_LINE_KN), false);
  });

  it('transfer line CONTAINS the one ಧನ್ಯವಾದ; not-interested close does NOT', () => {
    assert.match(PDF_HANDOFF_LINE_KN, /ಧನ್ಯವಾದಗಳು/);
    assert.match(PDF_HANDOFF_LINE_KN, /ಸೇಲ್ಸ್ ಟೀಮ್|ವರ್ಗಾಯಿಸ/);
    assert.equal(hasThanksClosing(PDF_HANDOFF_LINE_KN), true);
    assert.equal(hasLatin(PDF_HANDOFF_LINE_KN), false);
    assert.doesNotMatch(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಧನ್ಯವಾದ/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್/);
    assert.equal(hasLatin(SILENCE_CHECK_LINE_KN), false);
    assert.equal(hasLatin(SILENCE_TIMEOUT_CLOSE_KN), false);
  });
});

describe('v5 script — system instructions', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026');
  const fast = buildOutboundFastConnectInstruction('30 Sep 2026');

  it('carries the spec flow + language-follow rules', () => {
    assert.match(full, /FOLLOW THE CALLER/);
    assert.match(full, /Marathi/);
    assert.match(full, /ಸೈಟ್ ನೋಡ್ತಿದೀರಾ/);
    assert.match(full, /STEP 2B — CALLER IS INTERESTED/);
    assert.match(full, /STEP 3 — CALLER SHOWS INTEREST IN A LOCATION/);
    assert.doesNotMatch(full, /ನಿಮ್ಮ ಹೆಸರು/); // no name-ask anywhere
    assert.doesNotMatch(full, /setName/);
    assert.match(full, /SILENCE \/ TURN-TAKING PROTOCOL/);
    assert.match(full, /HEARING GUARANTEE/);
    assert.match(full, /END THE CALL/);
    assert.ok(fast.length < full.length * 0.75, `fast=${fast.length} full=${full.length}`);
    assert.match(fast, /FIRST LINE:/);
    assert.match(fast, /Marathi/);
  });

  it('reference context + nudges carry the exact v5 lines', () => {
    const ref = buildOutboundProjectReferenceContext();
    assert.match(ref, /Opening:/);
    assert.match(ref, /Locations line:/);
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /INTERESTED/);
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /ಹುಣಸೂರು/);
    assert.match(OUTBOUND_YES_ASK_NAME_NUDGE, /ಹುಣಸೂರು/); // alias resolves to locations nudge
    const handoff = buildOutboundHandoffTransferNudge();
    assert.match(handoff, /ಧನ್ಯವಾದಗಳು/);
    assert.match(handoff, /Do NOT call endCall/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE, /reserved for the transfer line/);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /ಇನ್ನೂ ಲೈನ್‌ನಲ್ಲಿ ಇದೀರಾ/);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /keep listening/);
    assert.doesNotMatch(OUTBOUND_SILENCE_CHECK_NUDGE, /endCall in the SAME turn/);
    assert.match(OUTBOUND_SILENCE_RESUME_NUDGE, /Do NOT hang up/);
    assert.doesNotMatch(OUTBOUND_SILENCE_RESUME_NUDGE, /endCall/);
    assert.match(buildOutboundIdentityAnswerNudge(), /CURRENT conversation language/);
    assert.match(buildOutboundOffTopicAnswerNudge(), /CURRENT conversation language/);
    const resume = buildOutboundResumeNudge({
      topic: 't',
      pendingQuestion: PDF_OPENING_KN,
      lastAiUtterance: '',
    });
    assert.match(resume, /caller's current language/);
  });
});

describe('v5 script — detectors', () => {
  it('areas / handoff / not-interested lines (exact or pattern)', () => {
    assert.equal(looksLikeAreasLine(PDF_AREAS_LINE_KN), true);
    assert.equal(looksLikeAreasLine('We have sites near Hunsur Road, T. Narasipura Road.'), true);
    assert.equal(looksLikeAreasLine('Yes I am looking for a site.'), false);
    assert.equal(looksLikeHandoffLine(PDF_HANDOFF_LINE_KN), true);
    assert.equal(
      looksLikeHandoffLine('Thank you for your interest, sir. I will transfer your call to our sales team.'),
      true,
    );
    assert.equal(looksLikeHandoffLine(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeNotInterestedCloseLine(OUTBOUND_NOT_INTERESTED_CLOSE_KN), true);
    assert.equal(looksLikeNotInterestedCloseLine(PDF_HANDOFF_LINE_KN), false);
  });

  it('repeat requests detected; busy callers route to the same NO', () => {
    assert.equal(looksLikeRepeatRequest('ಮತ್ತೆ ಹೇಳಿ ಸರ್'), true);
    assert.equal(looksLikeRepeatRequest("I couldn't hear you"), true);
    assert.equal(looksLikeRepeatRequest('ಹೌದು'), false);
    // Busy = NO per the flowchart — detector feeds the same close path.
    assert.equal(looksLikeCustomerBusy('I am busy right now'), true);
    assert.equal(looksLikeCustomerBusy('ನಾನು ಖಾಲಿ ಇಲ್ಲ ಸರ್'), true);
    assert.equal(looksLikeCustomerBusy('ಕಾಲ್ ಮಾಡ್ಬೇಡ'), false);
    assert.equal(looksLikeCustomerBusy("I'm not interested"), false);
  });

  it('thanks closing is Kannada-safe and multi-script', () => {
    assert.equal(hasThanksClosing('ಧನ್ಯವಾದಗಳು ಸರ್'), true);
    assert.equal(hasThanksClosing('धन्यवाद'), true);
    assert.equal(hasThanksClosing('Thank you'), true);
    assert.equal(looksLikeThanksOnlyLine('ಧನ್ಯವಾದಗಳು.'), true);
    assert.equal(looksLikeThanksOnlyLine('ಸರಿ ಸರ್, ಧನ್ಯವಾದಗಳು'), false);
  });

  it('opening restate = identity + opening question together', () => {
    assert.equal(looksLikeOpeningRestate(PDF_OPENING_KN), true); // the v5 opening HAS the question
    assert.equal(looksLikeOpeningRestate('ಹಲೋ ಸರ್, ನಾನು ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್‌ನಿಂದ ಪ್ರಿಯಾ ಸರ್.'), false);
  });

  it('identity / context interrupts', () => {
    assert.equal(looksLikeIdentityQuestion('Who are you?'), true);
    assert.equal(looksLikeIdentityQuestion('ಹೌದು'), false);
    assert.equal(looksLikeContextInterrupt('Who are you?'), true);
    assert.equal(looksLikeContextInterrupt('yes'), false);
  });

  it('conversation memory tracks opening → areas → transfer', () => {
    const afterOpening = deriveOutboundConversationMemory(PDF_OPENING_KN);
    assert.match(afterOpening.pendingQuestion, /ಸೈಟ್ ನೋಡ/);
    const afterAreas = deriveOutboundConversationMemory(PDF_AREAS_LINE_KN, afterOpening);
    assert.match(afterAreas.topic, /areas/i);
    const afterHandoff = deriveOutboundConversationMemory(PDF_HANDOFF_LINE_KN, afterAreas);
    assert.match(afterHandoff.topic, /transfer/i);
  });

  it('forbidden projects caught in Latin and Kannada script', () => {
    assert.equal(detectForbiddenLayoutMention('We also have Jeevan Vihar'), 'Jeevan Vihar');
    assert.equal(detectForbiddenLayoutMention('ಜೀವನ ವಿಹಾರ ಇದೆ ಸರ್'), 'Jeevan Vihar (KN)');
    assert.equal(detectForbiddenLayoutMention('UK Square is nice'), null);
    assert.match(allowedLayoutsList(), /UK Square/);
  });
});

describe('silence state machine — NEVER terminates', () => {
  it('9s quiet → check line, then repeats forever — NO close, NO hangup', () => {
    let s = armOutboundSilenceCheck(1000);
    let t = tickOutboundSilence(s, 9000);
    assert.equal(t.action, 'none', 'quiet inside the window does nothing');
    t = tickOutboundSilence(s, 11000);
    assert.equal(t.action, 'speak_check', 'past 9s quiet → soft reprompt');
    s = t.state;
    assert.equal(s.reason, 'checked');
    assert.ok(s.deadline != null, 'a next window is ALWAYS armed');
    t = tickOutboundSilence(s, 20000);
    assert.equal(t.action, 'none', 'second window still quiet');
    t = tickOutboundSilence(s, 21001);
    assert.equal(t.action, 'speak_check', 'reprompt repeats — never a close');
    assert.equal(t.state.reason, 'checked', 'state NEVER reaches a terminal closed state');
    assert.ok(t.state.deadline != null, 'deadline always re-armed — infinite listening loop');
    assert.equal(createOutboundSilenceState().reason, 'idle');
  });

  it('system prompt forbids any silence-based endCall', () => {
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /SILENCE NEVER ENDS THE CALL/);
    assert.doesNotMatch(full, /SILENCE TIMEOUT CLOSE/);
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    assert.doesNotMatch(fast, /silence timeout/i);
  });
});
