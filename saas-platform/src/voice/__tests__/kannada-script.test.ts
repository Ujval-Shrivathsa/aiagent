/**
 * Tests for the single outbound script module (v5 final spec).
 * Run: npx tsx --test src/voice/__tests__/kannada-script.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_OPENING_KN,
  PDF_OPENING_EN,
  PDF_OPENING_HI,
  VOICE_BEHAVIOR_VERSION,
  PDF_OPENING,
  PDF_OPENING_TURN1_KN,
  PDF_OPENING_INTRO_KN,
  PDF_NAME_QUESTION_KN,
  NEEDS_PURPOSE_QUESTION_KN,
  NEEDS_LOCALITY_QUESTION_KN,
  PDF_SITE_QUESTION_KN,
  PDF_ACK_KN,
  SILENCE_CHECK_REPEAT_AFTER_MS,
  SILENCE_CHECKS_MAX,
  postThanksHangupAction,
  OUTBOUND_END_AFTER_THANKS_MS,
  OUTBOUND_THANKS_AUDIO_SETTLE_MS,
  OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS,
  HONORIFIC_SIR_KN,
  HONORIFIC_MAAM_KN,
  extractCallerName,
  looksLikeSpokenNameQuestion,
  nameQuestionAudioGate,
  promptLeaksNameQuestionExample,
  detectOutboundLocality,
  buildOutboundLocationInterestNudge,
  LOCATION_FACT_HUNSUR_KN,
  honorificForName,
  nameWithHonorific,
  looksLikeNameRefusal,
  looksLikeAnswerToSiteQuestion,
  OUTBOUND_NAME_QUESTION_NUDGE,
  OUTBOUND_NAME_QUESTION_RETRY_NUDGE,
  buildOutboundProjectsNudge,
  buildOutboundProjectsRetryNudge,
  buildOutboundNameDeclinedNudge,
  PDF_AREAS_LINE_KN,
  PDF_AREAS_LINE_EN,
  PDF_INTEREST_QUESTION_KN,
  PDF_HANDOFF_LINE_KN,
  PDF_THANKS_CLOSE_KN,
  PDF_INTERESTED_CLOSE_KN,
  CALLBACK_OUTSIDE_WINDOW_LINE_KN,
  OUTBOUND_NOT_INTERESTED_CLOSE_KN,
  SILENCE_CHECK_LINE_KN,
  SILENCE_TIMEOUT_CLOSE_KN,
  SILENCE_CHECK_AFTER_MS,
  SILENCE_CLOSE_AFTER_CHECK_MS,
  SILENCE_GOODBYE_LINE_KN,
  SILENCE_GOODBYE_LINE_EN,
  looksLikeSilenceCheckEcho,
  OUTBOUND_SILENCE_GOODBYE_NUDGE,
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
  OUTBOUND_SILENCE_CANCELLED_NUDGE,
  shouldHoldSilenceClose,
  shouldCancelPendingSilenceClose,
  buildOutboundIdentityAnswerNudge,
  buildOutboundOffTopicAnswerNudge,
  buildOutboundResumeNudge,
  hasThanksClosing,
  looksLikeAreasLine,
  looksLikeHandoffLine,
  looksLikeNotInterestedCloseLine,
  looksLikeEchoConfirmQuestion,
  looksLikeFutureSitePitch,
  looksLikeStutteredClose,
  looksLikeCantHearLine,
  OUTBOUND_CLEAN_CLOSE_NUDGE,
  squashScriptText,
  OUTBOUND_THANKS_FALLBACK_NUDGE,
  looksLikeRepeatRequest,
  looksLikeRepeatLastLine,
  routeCallerQuestion,
  sideQuestionsMoveToClose,
  sideAnswerFor,
  SIDE_ANSWER_WHO_EN,
  SIDE_ANSWER_WHO_KN,
  SIDE_ANSWER_WHY_EN,
  SIDE_ANSWER_WHY_KN,
  SIDE_ANSWER_DEFER_EN,
  SIDE_ANSWER_DEFER_KN,
  SIDE_ANSWER_ROBOT_EN,
  SIDE_ANSWER_ROBOT_KN,
  buildRepeatLastLineTurn,
  looksLikeNameClarification,
  looksLikeCustomerBusy,
  looksLikeThanksOnlyLine,
  looksLikeOpeningRestate,
  looksLikeIdentityQuestion,
  looksLikeContextInterrupt,
  deriveOutboundConversationMemory,
  createOutboundSilenceState,
  armOutboundSilenceCheck,
  resetOutboundSilence,
  tickOutboundSilence,
  nextOutboundSilenceDeadline,
  detectForbiddenLayoutMention,
  allowedLayoutsList,
} from '../kannada-script';

/** Latin letters outside the {name} placeholder are forbidden in SPOKEN lines. */
const hasLatin = (s: string) => /[A-Za-z]/.test(s.replace(/\{name\}/g, ''));

describe('v5 script — spoken lines', () => {
  it('opening = intro AND the site question in ONE turn, and never a name', () => {
    assert.equal(
      PDF_OPENING_KN,
      'ಹಲೋ, ನಾನು ಪ್ರಿಯಾ, ಅಲಯನ್ಸ್ ಸ್ಕ್ವೇರ್ ನಿಂದ ಕರೆ ಮಾಡ್ತಿದ್ದೀನಿ, ನಿಮಗೆ ಮೈಸೂರಿನಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದೀರಾ?',
    );
    assert.equal(
      PDF_OPENING_EN,
      "Hello, I am Priya calling from Alliance Square. Are you looking for a site in Mysuru?",
    );
    assert.match(PDF_OPENING_HI, /प्रिया/);
    assert.match(PDF_OPENING_HI, /मैसूरु|मैसूर/);
    assert.match(VOICE_BEHAVIOR_VERSION, /exact-lines/);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /tell me once more/i);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /एक बार फिर/);
    assert.equal(looksLikeSpokenNameQuestion('आपका नाम क्या है?'), true);
    assert.equal(looksLikeRepeatRequest('फिर से बोलो'), true);
    // Prompts must never quote a name question — that teaches the model to say it.
    assert.equal(promptLeaksNameQuestionExample(PDF_NAME_QUESTION_KN), true);
    assert.equal(promptLeaksNameQuestionExample(buildOutboundSystemInstruction('30 Sep 2026')), false);
    assert.equal(promptLeaksNameQuestionExample(buildOutboundFastConnectInstruction('30 Sep 2026')), false);
    assert.equal(promptLeaksNameQuestionExample(getOutboundGreetingInstruction('en')), false);
    assert.match(PDF_OPENING_KN, /ಪ್ರಿಯಾ/);
    assert.equal(PDF_OPENING, PDF_OPENING_KN);
    assert.equal(PDF_OPENING_TURN1_KN, PDF_OPENING_KN, 'the opening turn speaks the site question');

    // The intro-only constant is kept for reference but is no longer the opening.
    assert.match(PDF_OPENING_INTRO_KN, /ಪ್ರಿಯಾ/);
    assert.match(PDF_NAME_QUESTION_KN, /ಹೆಸರು/);
    assert.match(PDF_AREAS_LINE_KN, /ರಸ್ತೆ/);
    assert.match(PDF_INTEREST_QUESTION_KN, /ಓಕೆನಾ/);

    // OWNER-SPECIFIED: live greeting speaks the English opening word for word.
    const greeting = getOutboundGreetingInstruction('en');
    assert.equal(greeting, PDF_OPENING_EN);
    assert.doesNotMatch(greeting, /being programmed/);
    const liveGreeting = getOutboundGreetingInstruction();
    assert.equal(liveGreeting, PDF_OPENING_KN);
    assert.ok(!liveGreeting.includes(PDF_OPENING_EN));
    assert.ok(!greeting.includes(PDF_NAME_QUESTION_KN));
  });

  it('no honorific in any line that can be spoken before the name is known', () => {
    // OWNER RULE: address the caller neutrally until they actually give a name.
    // These five are all reachable before step 1C (a silent caller, an immediate
    // "no", a garbled answer), so none of them may carry an honorific.
    const preNameLines: Array<[string, string]> = [
      ['opening', PDF_OPENING_KN],
      ['name question', PDF_NAME_QUESTION_KN],
      ['silence check', SILENCE_CHECK_LINE_KN],
      ['decline close', OUTBOUND_NOT_INTERESTED_CLOSE_KN],
    ];
    for (const [label, line] of preNameLines) {
      assert.ok(!line.includes(HONORIFIC_SIR_KN), `${label} says "sir" before the name is known: ${line}`);
      assert.ok(!line.includes(HONORIFIC_MAAM_KN), `${label} says "ma'am" before the name is known: ${line}`);
    }
  });

  it('locations line = Hunsur Road, T. Narasipura Road, and Nanjangudu', () => {
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /\{name\}/);
    assert.match(PDF_AREAS_LINE_KN, /ಹುಣಸೂರು/);
    assert.match(PDF_AREAS_LINE_KN, /ನರಸೀಪುರ/);
    assert.match(PDF_AREAS_LINE_KN, /ನಂಜನಗೂಡ/);
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /ಶ್ರೀರಾಂಪುರ/);
    assert.match(PDF_AREAS_LINE_KN, /\?/);
    assert.equal(hasLatin(PDF_AREAS_LINE_KN), false);
  });

  it('interest question asked after the locations line (said as written every call)', () => {
    assert.match(PDF_INTEREST_QUESTION_KN, /ಓಕೆನಾ/);
    assert.match(PDF_INTEREST_QUESTION_KN, /\?/);
    assert.equal(hasLatin(PDF_INTEREST_QUESTION_KN), false);
    // The locations line already includes this question. It is not asked again.
    assert.ok(PDF_AREAS_LINE_KN.includes(PDF_INTEREST_QUESTION_KN));
    const nudge = OUTBOUND_YES_LOCATIONS_NUDGE;
    assert.equal(nudge, PDF_AREAS_LINE_KN);
    assert.ok(nudge.includes(PDF_INTEREST_QUESTION_KN));
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /AT MOST TWO QUESTIONS/);
    assert.match(full, /After the caller's yes, say only the locations line/);
    assert.ok(!full.includes(NEEDS_PURPOSE_QUESTION_KN), 'the purpose question is not part of this call');
    assert.ok(!full.includes(NEEDS_LOCALITY_QUESTION_KN), 'the locality question is not part of this call');
    assert.match(full, /never ask\s+permission to continue/i);
    assert.match(full, /no "shall I continue\?"/);
    for (const banned of ['budget', 'plot size', 'timeline', 'documents', 'possession']) {
      assert.ok(
        new RegExp('Never ask about[^.]*' + banned, 'i').test(full),
        `the instruction must keep "${banned}" on the forbidden-question list`,
      );
    }
    assert.doesNotMatch(full, /TWO QUESTIONS MAX/);
  });

  it('sales-manager line carries NO thanks; the thank-you is its own close', () => {
    assert.match(PDF_HANDOFF_LINE_KN, /ಸೇಲ್ಸ್ ಮ್ಯಾನೇಜರ್/);
    assert.match(PDF_HANDOFF_LINE_KN, /ಕರೆ ಮಾಡಿ/);
    assert.doesNotMatch(PDF_HANDOFF_LINE_KN, /ವರ್ಗಾಯಿಸ/);
    assert.doesNotMatch(PDF_HANDOFF_LINE_KN, /ಧನ್ಯವಾದ/);
    assert.equal(hasThanksClosing(PDF_HANDOFF_LINE_KN), false);

    assert.match(PDF_THANKS_CLOSE_KN, /ಧನ್ಯವಾದಗಳು/);
    assert.equal(hasThanksClosing(PDF_THANKS_CLOSE_KN), true);
    assert.equal(hasLatin(PDF_THANKS_CLOSE_KN), false);

    assert.equal(hasLatin(PDF_HANDOFF_LINE_KN), false);
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /ENDS the call|call ENDS|ends the call|call ends/);
    assert.doesNotMatch(full, /live transfer/i);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಧನ್ಯವಾದ/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಸಮಯ/);
    assert.equal(hasLatin(SILENCE_CHECK_LINE_KN), false);
    assert.equal(hasLatin(SILENCE_TIMEOUT_CLOSE_KN), false);
  });

  it('out-of-window callback line names the window and offers both alternatives', () => {
    assert.match(CALLBACK_OUTSIDE_WINDOW_LINE_KN, /10/);
    assert.match(CALLBACK_OUTSIDE_WINDOW_LINE_KN, /7/);
    assert.match(CALLBACK_OUTSIDE_WINDOW_LINE_KN, /ಬೇರೆ ದಿನ/); // "another day"
    assert.match(CALLBACK_OUTSIDE_WINDOW_LINE_KN, /ಶೀಘ್ರದಲ್ಲೇ/); // "shortly"
    assert.equal(hasLatin(CALLBACK_OUTSIDE_WINDOW_LINE_KN), false);
    assert.equal(hasThanksClosing(CALLBACK_OUTSIDE_WINDOW_LINE_KN), false);

    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /10am–7pm/);
    assert.match(full, /not possible/);
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    assert.match(fast, /10am–7pm/);
  });

  it('close nudges end on the single thank-you, not the sales-team line', () => {
    const handoff = buildOutboundHandoffTransferNudge();
    assert.equal(handoff, PDF_INTERESTED_CLOSE_KN);
    assert.match(buildOutboundSystemInstruction('30 Sep 2026'), /endCall in the SAME turn/);
  });
});

describe('v5 script — system instructions', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026');
  const fast = buildOutboundFastConnectInstruction('30 Sep 2026');

  it('carries the spec flow + language-follow rules', () => {
    assert.match(full, /Start in Kannada/);
    assert.doesNotMatch(full, /Opening is English/);
    assert.match(full, /FIRST LINE:/);
    assert.doesNotMatch(full, /CHANGE ONLY WHEN THE CALLER ASKS/);
    assert.match(full, /Marathi/);
    assert.doesNotMatch(full, /Are you looking for a site in Mysuru/);
    assert.match(getOutboundGreetingInstruction(), /ನೋಡ್ತಿದೀರಾ/);
    assert.match(full, /STEP 1B — CALLER SAYS YES/);
    assert.match(full, /STEP 3 — CALLER SAYS YES TO THE LOCATIONS/);
    assert.match(full, /After the caller's yes, say only the locations line/);
    // OWNER RULE: no "sir"/"ma'am" before the customer's name is known.
    assert.ok(!PDF_NAME_QUESTION_KN.includes('ಸರ್'), 'the name question must stay neutral');
    for (const p of [fast, full]) {
      assert.match(p, /never ಸರ್, never ಮಾಮ್/, 'both instructions must forbid an honorific before the name');
    }
    assert.doesNotMatch(full, /setName/);
    assert.match(full, /SILENCE \/ TURN-TAKING PROTOCOL/);
    assert.match(full, /HEARING GUARANTEE/);
    assert.match(full, /END THE CALL/);
    assert.equal(fast, full, 'fast-connect and the full guide are the same instruction');
    assert.match(fast, /FIRST LINE:/);
    assert.match(fast, /Marathi/);
  });

  it('reference context + nudges carry the exact v5 lines', () => {
    const ref = buildOutboundProjectReferenceContext();
    assert.ok(getOutboundGreetingInstruction().includes(PDF_OPENING_TURN1_KN));
    assert.ok(!ref.includes(PDF_OPENING_TURN1_KN));
    assert.ok(!ref.includes(PDF_OPENING_EN));
    assert.equal(OUTBOUND_YES_LOCATIONS_NUDGE, PDF_AREAS_LINE_KN);
    assert.match(ref, /After the caller's yes, say only the locations line/);
    assert.doesNotMatch(ref, /Name question/);
    assert.doesNotMatch(ref, /\bname\b/i);
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /ಹುಣಸೂರು/);
    assert.match(OUTBOUND_YES_ASK_NAME_NUDGE, /ಹುಣಸೂರು/);
    const handoff = buildOutboundHandoffTransferNudge();
    assert.equal(handoff, PDF_INTERESTED_CLOSE_KN);
    assert.match(ref, /endCall in the SAME turn/);
    assert.doesNotMatch(handoff, /Do NOT call endCall/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE, /ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಧನ್ಯವಾದಗಳು/);
    assert.doesNotMatch(OUTBOUND_SILENCE_CHECK_NUDGE, /ಇನ್ನೂ ಲೈನ್‌ನಲ್ಲಿ ಇದೀರಾ/);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /Say NOTHING/);
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
    assert.equal(looksLikeAreasLine(PDF_AREAS_LINE_EN), true);
    assert.equal(nameQuestionAudioGate(PDF_AREAS_LINE_EN), 'release');
    assert.equal(looksLikeAreasLine('We have sites near Hunsur Road, T. Narasipura Road.'), true);
    assert.equal(looksLikeAreasLine('Yes I am looking for a site.'), false);
    assert.equal(looksLikeHandoffLine(PDF_HANDOFF_LINE_KN), true);
    assert.equal(
      looksLikeHandoffLine('Thank you for your interest, sir. I will transfer your call to our sales team.'),
      true,
    );
    // New closing wording (thanks + "sales team will call you") — any phrasing.
    assert.equal(
      looksLikeHandoffLine('Thank you so much, sir! Our sales team will call you very soon.'),
      true,
    );
    assert.equal(looksLikeHandoffLine('Our sales team will call you soon, sir.'), true);
    assert.equal(looksLikeHandoffLine(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeHandoffLine(PDF_INTEREST_QUESTION_KN), false);
    assert.equal(looksLikeNotInterestedCloseLine(OUTBOUND_NOT_INTERESTED_CLOSE_KN), true);
    assert.equal(looksLikeNotInterestedCloseLine(PDF_HANDOFF_LINE_KN), false);
  });

  it('repeat requests detected; busy callers route to the same NO', () => {
    assert.equal(looksLikeRepeatRequest('ಮತ್ತೆ ಹೇಳಿ ಸರ್'), true);
    assert.equal(looksLikeRepeatRequest("I couldn't hear you"), true);
    assert.equal(looksLikeRepeatRequest('ಹೌದು'), false);
    assert.equal(looksLikeNameClarification('ಮತ್ತೆ ಹೇಳಿ'), true);
    assert.equal(looksLikeNameClarification('ಕೇಳಿಸಲಿಲ್ಲ'), true);
    assert.equal(looksLikeNameClarification('what did you say'), true);
    assert.equal(looksLikeNameClarification('ರಮೇಶ್'), false);
    assert.equal(looksLikeNameClarification('ಹೌದು'), false);
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

  it('conversation memory tracks opening → areas → sales-team closing', () => {
    const afterOpening = deriveOutboundConversationMemory(PDF_OPENING_KN);
    assert.match(afterOpening.pendingQuestion, /ನೋಡ್ತಿದೀರಾ|looking for a site/i);
    const afterEn = deriveOutboundConversationMemory(PDF_OPENING_EN);
    assert.match(afterEn.topic, /looking for a site in Mysuru/i);
    const afterAreas = deriveOutboundConversationMemory(PDF_AREAS_LINE_KN, afterOpening);
    assert.match(afterAreas.topic, /areas/i);
    const afterHandoff = deriveOutboundConversationMemory(PDF_HANDOFF_LINE_KN, afterAreas);
    assert.match(afterHandoff.topic, /sales team/i);
  });

  it('forbidden projects caught in Latin and Kannada script', () => {
    assert.equal(detectForbiddenLayoutMention('We also have Jeevan Vihar'), 'Jeevan Vihar');
    assert.equal(detectForbiddenLayoutMention('ಜೀವನ ವಿಹಾರ ಇದೆ ಸರ್'), 'Jeevan Vihar (KN)');
    assert.equal(detectForbiddenLayoutMention('UK Square is nice'), null);
    assert.match(allowedLayoutsList(), /UK Square/);
  });
});

describe('silence state machine — one check, then the call ends', () => {
  it('5s quiet → one check; 5s more with no answer → the call ends', () => {
    assert.equal(SILENCE_CHECK_AFTER_MS, 5_000);
    assert.equal(SILENCE_CHECK_REPEAT_AFTER_MS, 5_000, '5s after the check before goodbye');
    assert.equal(SILENCE_CLOSE_AFTER_CHECK_MS, 5_000, 'the call ends 5s after the one check');
    assert.equal(SILENCE_CHECKS_MAX, 1, 'the check is asked once');
    assert.equal(
      SILENCE_CHECK_AFTER_MS + SILENCE_CLOSE_AFTER_CHECK_MS,
      10_000,
      'two 5s windows: one check, then end',
    );

    const start = 1000;
    let s = armOutboundSilenceCheck(start);
    let t = tickOutboundSilence(s, start + 4_900);
    assert.equal(t.action, 'none', 'quiet inside the 5s window does nothing');
    t = tickOutboundSilence(s, start + 5_100);
    assert.equal(t.action, 'speak_check', '5s quiet → the availability check');
    s = t.state;
    assert.equal(s.reason, 'checked');
    assert.equal(s.checksSpoken, 1);
    assert.ok(s.deadline != null, 'a wait window is armed for the answer');

    // Still silent inside that window → nothing at all. Never a second check.
    t = tickOutboundSilence(s, start + 9_900);
    assert.equal(t.action, 'none', 'window still quiet → no talking at all');
    t = tickOutboundSilence(s, start + 10_100);
    assert.equal(t.action, 'close_silence', 'one unanswered check ends the call');
    assert.equal(t.state.reason, 'closed');
    assert.equal(t.state.deadline, null, 'terminal state has no next window');
    assert.equal(
      nextOutboundSilenceDeadline(t.state),
      null,
      'the loop can never re-arm after closing',
    );
    // It stays closed forever — no repeat, no loop.
    assert.equal(tickOutboundSilence(t.state, 999999).action, 'none');
    assert.equal(createOutboundSilenceState().reason, 'idle');
  });

  it('the check line is asked ONCE per silent stretch, then the call closes', () => {
    const start = 1000;
    let s = armOutboundSilenceCheck(start);
    let t = tickOutboundSilence(s, start + 5_100);
    assert.equal(t.action, 'speak_check', 'first check at 5s');
    assert.equal(t.state.checksSpoken, 1);

    // The check line's own turn completes → the engine re-arms the cycle. The
    // count MUST survive that, or the ladder restarts and asks again.
    const afterCheckLineTurn = 5_800;
    const rearmed = armOutboundSilenceCheck(afterCheckLineTurn, t.state.checksSpoken);
    assert.equal(rearmed.checksSpoken, 1, 'a re-arm must not forget the first check');

    const close = tickOutboundSilence(rearmed, afterCheckLineTurn + 5_100);
    assert.equal(close.action, 'close_silence', 'never ask a second time');
    assert.equal(close.state.reason, 'closed');
    assert.equal(tickOutboundSilence(close.state, 999999).action, 'none', 'stays closed');
    assert.equal(
      tickOutboundSilence(close.state, 999999).action !== 'speak_check',
      true,
      'a closed cycle never speaks again',
    );
  });

  it('caller speech fully resets the cycle, so a LATER quiet spell can check again', () => {
    const start = 1000;
    let s = armOutboundSilenceCheck(start);
    s = tickOutboundSilence(s, start + 5_100).state; // check line spoken
    assert.equal(s.checksSpoken, 1);
    // The caller speaks → resetOutboundSilenceCycle() → idle, count cleared.
    const afterSpeech = resetOutboundSilence();
    assert.equal(afterSpeech.reason, 'idle');
    assert.equal(afterSpeech.checksSpoken, 0);
    assert.equal(nextOutboundSilenceDeadline(afterSpeech), null);
    // A fresh cycle after new speech starts from the top again — one check.
    const fresh = armOutboundSilenceCheck(start + 20_000);
    assert.equal(fresh.checksSpoken, 0);
    assert.equal(tickOutboundSilence(fresh, start + 20_000).action, 'none');
    assert.equal(tickOutboundSilence(fresh, start + 25_100).action, 'speak_check');
    const again = tickOutboundSilence(
      armOutboundSilenceCheck(start + 27_000, 1),
      start + 32_100,
    );
    assert.equal(again.action, 'close_silence', 'a count of one is already the only check');
  });

  it('the check nudge tells the model to answer again instead of falling silent', () => {
    // The nudge previously said only "stop and listen". Combined with "say
    // NOTHING while waiting", that is an instruction to go quiet even when the
    // caller does answer — the exact symptom being fixed.
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /never go silent again/i);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /keep listening/);
    assert.doesNotMatch(OUTBOUND_SILENCE_CHECK_NUDGE, /endCall in the SAME turn/);
    // The prompt rules must agree with the nudge.
    const prompt = buildOutboundSystemInstruction('4 Oct 2026');
    assert.match(prompt, /never stay silent again/i);
    // Silence never ends the call by itself — the CODE does that, so the model
    // must not be told to call endCall into a blocked, mute-armed close.
    assert.doesNotMatch(prompt, /the call is over: call endCall immediately/);
  });

  it('the exit line is a goodbye, not a second copy of the check', () => {
    // Asking the same question twice is what made quiet calls talk over
    // themselves, so the exit must be a different sentence from the check.
    assert.notEqual(SILENCE_GOODBYE_LINE_KN, SILENCE_CHECK_LINE_KN);
    assert.ok(SILENCE_GOODBYE_LINE_KN.length > 0);
    assert.match(OUTBOUND_SILENCE_GOODBYE_NUDGE, /END of the call/);
    assert.match(OUTBOUND_SILENCE_GOODBYE_NUDGE, /ONE short goodbye/);
    assert.match(OUTBOUND_SILENCE_GOODBYE_NUDGE, /endCall in the SAME turn/);
    assert.match(OUTBOUND_SILENCE_GOODBYE_NUDGE, /exactly ONCE/);
    assert.match(SILENCE_GOODBYE_LINE_KN, /ಸರ್/);
    assert.match(SILENCE_GOODBYE_LINE_KN, /ಬೈ/);
    assert.match(SILENCE_GOODBYE_LINE_EN, /Sir, if you are busy we will call you later/);
    assert.match(SILENCE_GOODBYE_LINE_EN, /Have a nice day\. Bye\./);
    assert.match(SILENCE_CHECK_LINE_KN, /ಇದೀರಾ/);
    assert.equal(looksLikeSilenceCheckEcho(SILENCE_CHECK_LINE_KN), true);
    assert.equal(looksLikeSilenceCheckEcho('ಹೌದು'), false);
    assert.equal(looksLikeSilenceCheckEcho('are you still there?'), true);
  });

  it('the one instruction carries a single persona paragraph and no pace-matching', () => {
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.equal(fast, full);
    assert.match(fast, /young Kannadiga woman/);
    assert.match(fast, /feminine, soft/);
    assert.match(fast, /close to the mic/);
    assert.match(fast, /polite/);
    assert.doesNotMatch(fast, /HOW YOU SOUND/);
    assert.doesNotMatch(fast, /Match the caller/i);
    assert.doesNotMatch(fast, /Vary your rhythm/i);
    assert.doesNotMatch(fast, /\bname\b/i);
  });

  it('the whole call is pinned to four beats, in both prompts', () => {
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /THE WHOLE CALL — four beats/);
      assert.match(flat, /After the caller's yes, say only the locations line/);
      assert.doesNotMatch(flat, /3B\. THE TWO NEEDS QUESTIONS/);
    }

    const fullFlat = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
    assert.match(fullFlat, /Say each script line AS WRITTEN/);
    assert.match(fullFlat, /no rephrasing, no fresh wording/);
    assert.match(fullFlat, /Never repeat a line you have already said, in any wording/);
    assert.equal(getOutboundGreetingInstruction(), PDF_OPENING_KN);
    assert.equal(OUTBOUND_YES_LOCATIONS_NUDGE, PDF_AREAS_LINE_KN);
    assert.doesNotMatch(fullFlat, /phrase it FRESH and cheerful every call/i);
    assert.doesNotMatch(fullFlat, /fresh phrasing every call/i);
  });

  it('prompt: silence means one check, then the busy goodbye and endCall', () => {
    // Prompts are line-wrapped, so compare against a whitespace-normalised copy.
    const full = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026').replace(/\s+/g, ' ');

    assert.doesNotMatch(full, /say the check line ONCE/);
    assert.match(full, /If they are silent, say NOTHING/);
    assert.match(full, /While waiting, say NOTHING at all/);
    assert.match(SILENCE_GOODBYE_LINE_KN, /ಸರ್, ನೀವು ಬ್ಯುಸಿ ಇದ್ರೆ/);
    assert.match(full, /spoken EXACTLY ONCE per call/);
    assert.doesNotMatch(full, /asked TWICE in one silent stretch/);

    assert.match(fast, /If they are silent, say nothing/);
    assert.match(fast, /Do not ask them to repeat/);
    assert.match(fast, /call endCall/);

    // Neither may still claim silence never ends the call.
    for (const prompt of [full, fast]) {
      assert.doesNotMatch(prompt, /SILENCE NEVER ENDS THE CALL/);
      assert.doesNotMatch(prompt, /silence timeout/i);
    }
    assert.match(full, /YOU END THE CALL/);
  });
});

/**
 * The owner asked for the call to end one second after the thank-you, and for
 * the thank-you to be said IN FULL. Those two only work together if the 1s is
 * measured from the end of the AUDIO — a transcript can arrive before the audio
 * of the same sentence, and hanging up off the transcript clipped the line
 * mid-word.
 */
describe('the thank-you is played in full, then the call ends 1s later', () => {
  it('waits rather than hangs up when there is no audio at all to judge', () => {
    // A close that produced no audio must never be treated as "finished
    // playing" — that is exactly the clipped-thank-you failure.
    const d = postThanksHangupAction({
      playbackEndsAt: 0,
      lastAudioAt: 0,
      now: 10,
      waitDeadline: 10_000,
    });
    assert.equal(d.action, 'wait', 'no audio can never mean "safe to hang up"');
  });

  it('gives up waiting after the cap, so a stuck stream cannot hold the call open', () => {
    const cap = OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS;
    const waiting = postThanksHangupAction({
      playbackEndsAt: 0,
      lastAudioAt: 0,
      now: cap,
      waitDeadline: cap,
    });
    assert.equal(waiting.action, 'wait', 'still inside the cap');
    const capped = postThanksHangupAction({
      playbackEndsAt: 0,
      lastAudioAt: 0,
      now: cap + 1,
      waitDeadline: cap,
    });
    assert.equal(capped.action, 'hangup', 'the cap must always end the call');
    assert.equal(capped.retryInMs, OUTBOUND_END_AFTER_THANKS_MS);
  });

  it('waits while audio is still playing', () => {
    const now = 10_000;
    const playing = postThanksHangupAction({
      playbackEndsAt: now + 900,
      lastAudioAt: now,
      now,
    });
    assert.equal(playing.action, 'wait');
    assert.ok(playing.retryInMs > 0, 'must re-check later, never hang up on live audio');
    const lastSyllable = postThanksHangupAction({
      playbackEndsAt: now + 40,
      lastAudioAt: now - 400,
      now,
    });
    assert.equal(lastSyllable.action, 'wait', '40ms still in the buffer is the final word');
  });

  it('waits for the audio to settle, because the transcript can lead it', () => {
    const now = 10_000;
    // Playback has drained but audio landed 100ms ago — the rest of the
    // sentence may still be arriving, so the 1s clock must not start.
    const justArrived = postThanksHangupAction({
      playbackEndsAt: now - 20,
      lastAudioAt: now - 100,
      now,
    });
    assert.equal(justArrived.action, 'wait', 'must not hang up on a just-arrived chunk');
    assert.ok(justArrived.retryInMs >= 200, 'and must wait for the settle window');
  });

  it('ends the call 1s after the audio has settled', () => {
    const now = 10_000;
    const done = postThanksHangupAction({
      playbackEndsAt: now - 500,
      lastAudioAt: now - 600,
      now,
    });
    assert.equal(done.action, 'hangup');
    assert.equal(done.retryInMs, OUTBOUND_END_AFTER_THANKS_MS);
    assert.equal(OUTBOUND_END_AFTER_THANKS_MS, 1_000, 'the owner asked for 1 second');
  });

  it('walks a realistic stream: the whole sentence plays before any hangup', () => {
    // The thank-you arrives as a stream of 20ms chunks over ~3s. At no point may
    // the decision be to hang up, and the first 'hangup' may only come once the
    // final chunk has been quiet for the settle window.
    const start = 100_000;
    const chunkMs = 20;
    const chunks = 150; // ~3s of speech
    let now = start;
    let lastAudioAt = 0;
    let playbackEndsAt = 0;
    let firstHangupAt: number | null = null;
    for (let i = 0; i < chunks; i++) {
      playbackEndsAt = Math.max(now, playbackEndsAt) + chunkMs;
      lastAudioAt = now;
      now += chunkMs;
      const d = postThanksHangupAction({ playbackEndsAt, lastAudioAt, now });
      if (d.action === 'hangup' && firstHangupAt === null) firstHangupAt = now;
    }
    assert.equal(firstHangupAt, null, 'never hang up while the sentence is still arriving');
    // Stream finished at `now`; the caller hangs up 1s after the settle window.
    const afterStream = postThanksHangupAction({ playbackEndsAt, lastAudioAt, now });
    assert.equal(afterStream.action, 'wait', 'still inside the settle window');
    const settled = postThanksHangupAction({
      playbackEndsAt,
      lastAudioAt,
      now: now + OUTBOUND_THANKS_AUDIO_SETTLE_MS + 10,
    });
    assert.equal(settled.action, 'hangup');
    assert.equal(settled.retryInMs, 1_000);
    // The hangup fires 1s after the settle window, and the settle window only
    // starts once the last chunk has landed — so the caller always hears at
    // least a full second of the thank-you's end before the line drops.
    const hangupAt = now + OUTBOUND_THANKS_AUDIO_SETTLE_MS + 10 + settled.retryInMs;
    assert.ok(
      hangupAt - lastAudioAt >= 1_000,
      `hangup ${hangupAt - lastAudioAt}ms after the last audio chunk — must be >= 1000`,
    );
  });
});

/**
 * The Live output transcriber inserts stray spaces INSIDE Kannada words
 * ("ಸೇ ಲ್ಸ್", "ಕ ರೆ ಮಾ ಡು ತ್ತಾ ರೆ"). Every script-line identity check used to
 * compare raw strings, so on a real call NONE of the close lines were ever
 * recognised: the agent was never muted, the thank-you never landed, and an
 * improvised sign-off looped instead of ending the call.
 */
describe('close-line detection survives the transcriber’s stray spaces', () => {
  /** Split every word of a script line into single characters, joined by spaces. */
  const spaceSplit = (line: string) => line.replace(/\s+/g, ' ').split('').join(' ');

  it('squashScriptText removes all whitespace', () => {
    assert.equal(squashScriptText('ಸರಿ ಸರ್,\tನ\nಮ್ಮ'), 'ಸರಿಸರ್,ನಮ್ಮ');
  });

  it('recognises the sales-team line with the words split apart', () => {
    assert.equal(looksLikeHandoffLine(PDF_HANDOFF_LINE_KN), true);
    assert.equal(looksLikeHandoffLine(spaceSplit(PDF_HANDOFF_LINE_KN)), true);
    assert.equal(looksLikeHandoffLine('ಸರಿ ಸರ್ ನಮ್ಮ ಸೇ ಲ್ಸ್ ಟೀ ಮ್ ಕರೆ ಮಾ ಡು ತ್ತಾ ರೆ'), true);
  });

  it('recognises the thank-you with the word split apart', () => {
    const spoken = PDF_THANKS_CLOSE_KN.replace(/ಧನ್ಯವಾದಗಳು/, 'ಧನ್ಯವಾ ದಗಳು');
    assert.equal(hasThanksClosing(spoken), true);
  });

  it('recognises the locations line with the words split apart', () => {
    assert.equal(looksLikeAreasLine(PDF_AREAS_LINE_KN), true);
    assert.equal(looksLikeAreasLine(spaceSplit(PDF_AREAS_LINE_KN)), true);
    assert.equal(looksLikeAreasLine('ನ ಮ್ಮ ಹ ತ್ತಿ ರ ಹುಣ ಸೂ ರು ನ ರ ಸೀ ಪು ರ'), true);
  });

  it('recognises the not-interested close in Kannada AND its English wording', () => {
    assert.equal(looksLikeNotInterestedCloseLine(OUTBOUND_NOT_INTERESTED_CLOSE_KN), true);
    assert.equal(looksLikeNotInterestedCloseLine(spaceSplit(OUTBOUND_NOT_INTERESTED_CLOSE_KN)), true);
    // The exact wording the caller heard looping on the line.
    assert.equal(
      looksLikeNotInterestedCloseLine('if you want a site in the future please consider alliance square'),
      true,
    );
  });
});

/** The "did you say yes sir?" stall and the improvised "consider us later" sign-off. */
describe('stalled and improvised turns are detected', () => {
  it('flags echo/confirm questions in every form', () => {
    assert.equal(looksLikeEchoConfirmQuestion('Did you say yes sir?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('You said yes, right?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('did you say'), true);
    assert.equal(looksLikeEchoConfirmQuestion('am I hearing you right?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('ಹೌದು ಎಂದು ಹೇಳಿದೆಯಾ?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('ಹೌ ದು ಎಂ ದು ಹೇ ಳಿ ದೆ ಯಾ?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('ಸರಿಯೇ?'), true);
    assert.equal(looksLikeEchoConfirmQuestion('ಅರ್ಥವಾಗಿದೆಯೇ?'), true);
  });

  it('does NOT flag real questions or real script lines', () => {
    assert.equal(looksLikeEchoConfirmQuestion(''), false);
    assert.equal(looksLikeEchoConfirmQuestion('ನಿಮಗೆ ಹೆಚ್ಚು ವಿವರ ಬೇಕೆ?'), false);
    assert.equal(looksLikeEchoConfirmQuestion(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeEchoConfirmQuestion(PDF_HANDOFF_LINE_KN), false);
    assert.equal(looksLikeEchoConfirmQuestion(PDF_OPENING_KN), false);
  });

  it('flags the improvised future sign-off but NOT the real decline close', () => {
    assert.equal(
      looksLikeFutureSitePitch('if you want a site in the future please consider alliance square'),
      true,
    );
    assert.equal(looksLikeFutureSitePitch('ಭವಿಷ್ಯದಲ್ಲೇ ಸೈಟ್ ಬೇಕಾದರೆ ಮನೆಮಾಡಿ.'), true);
    assert.equal(looksLikeFutureSitePitch('ಭವಿ ಷ್ಯದ ಲ್ಲೇ ಸೈ ಟ್ ಬೇ ಕಾ ದರೆ ಮ ನೆ ಮಾ ಡಿ'), true);
    // The SCRIPT decline close owns this wording — it is a legitimate close.
    assert.equal(looksLikeFutureSitePitch(OUTBOUND_NOT_INTERESTED_CLOSE_KN), false);
  });

  it('classifies a Kannada reword of the decline close as a BANNED pitch on an interested call', () => {
    // This is the wording the caller heard looping. It also matches the decline
    // close PATTERN, but the interested path must ban it (the caller never said
    // no) and close properly with the sales line + thank-you instead.
    const reworded = 'ಭವಿಷ್ಯದಲ್ಲೇ ಸೈಟ್ ಬೇಕಾದರೆ ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್ ನೆನಪಿಸಿಕೊಳ್ಳಿ ಸರ್.';
    assert.equal(looksLikeNotInterestedCloseLine(reworded), true);
    assert.equal(looksLikeFutureSitePitch(reworded), true);
  });

  it('never flags a turn that also carries the sales-team line', () => {
    // The whole turn is legitimate; only its missing thank-you needs handling.
    assert.equal(
      looksLikeFutureSitePitch(
        `${PDF_HANDOFF_LINE_KN} ಭವಿಷ್ಯದಲ್ಲೇ ಸೈಟ್ ಬೇಕಾದರೆ ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್ ನೆನಪಿಸಿಕೊಳ್ಳಿ.`,
      ),
      false,
    );
  });
});

/** The engine's guaranteed-thanks fallback and the prompt rules behind it. */
describe('the close always ends in exactly one thank-you', () => {
  it('the fallback nudge asks for the thanks line and nothing else', () => {
    assert.match(OUTBOUND_THANKS_FALLBACK_NUDGE, /exactly once/i);
    assert.ok(OUTBOUND_THANKS_FALLBACK_NUDGE.includes(PDF_INTERESTED_CLOSE_KN));
    assert.doesNotMatch(OUTBOUND_THANKS_FALLBACK_NUDGE, /endCall/);
  });

  it('the prompt bans confirm-questions and the future sign-off on both instructions', () => {
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    // The FAST CONNECT instruction is the one live for the opening turn, so both
    // bans have to live there too — not only in the long reconnect prompt.
    for (const prompt of [fast, full]) {
      assert.match(prompt, /NEVER ask (?:them|the caller) to confirm what they just said/);
    }
    assert.match(fast, /call endCall in that same turn/);
  });

  it('the handoff nudge forbids any sentence after the thank-you', () => {
    const nudge = buildOutboundHandoffTransferNudge();
    assert.equal(nudge, PDF_INTERESTED_CLOSE_KN);
  });
});

/**
 * Priya used to say "I couldn't hear you" over and over instead of listening:
 * poor transcription re-armed the recovery ladder on every speech end.
 */
describe('"I couldn\'t hear you" is said at most once', () => {
  it('recognises the line in every language it comes out in', () => {
    assert.equal(looksLikeCantHearLine("I couldn't hear you"), true);
    assert.equal(looksLikeCantHearLine('I could not hear you clearly'), true);
    assert.equal(looksLikeCantHearLine("I didn't catch that"), true);
    assert.equal(looksLikeCantHearLine('I cannot understand'), true);
    assert.equal(looksLikeCantHearLine('ಸರ್, ಕೇಳಿಸುವುದಿಲ್ಲ'), true);
    assert.equal(looksLikeCantHearLine('ಅರ್ಥವಾಗಲಿಲ್ಲ'), true);
    // Transcriber splits words: this still has to be caught.
    assert.equal(looksLikeCantHearLine('ಸ ರ್ ಕೇ ಳಿ ಸು ವು ದಿ ಲ್ಲ'), true);
  });

  it('does not flag real replies or real script lines', () => {
    assert.equal(looksLikeCantHearLine(''), false);
    assert.equal(looksLikeCantHearLine(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeCantHearLine(PDF_OPENING_INTRO_KN), false);
    assert.equal(looksLikeCantHearLine('Ravi'), false);
    // The CALLER asking to repeat is a different thing — never suppressed by us.
    assert.equal(looksLikeCantHearLine('I could not hear you'), true, 'agent side only');
  });

  it('the prompt permits exactly one repeat request, never two', () => {
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /NEVER ask them to repeat/i);
      assert.doesNotMatch(flat, /ONLY repeat request/i);
    }
  });
});

/**
 * TURN 1B/1C — the caller is asked for their name, then addressed as sir or ma'am.
 */
describe('caller name and honorific', () => {
  it('reads a name out of the ways people actually give one', () => {
    assert.equal(extractCallerName('Ravi'), 'Ravi');
    assert.equal(extractCallerName('my name is Ravi'), 'Ravi');
    assert.equal(extractCallerName("I'm Anitha"), 'Anitha');
    assert.equal(extractCallerName('I am Lakshmi'), 'Lakshmi');
    assert.equal(extractCallerName('this is Prakash'), 'Prakash');
    assert.equal(extractCallerName('Ravi here'), 'Ravi');
  });

  it('never invents a name, and never captures the agent as the caller', () => {
    assert.equal(extractCallerName(''), null);
    assert.equal(extractCallerName('mmhmm'), null);
    assert.equal(extractCallerName('yes'), null);
    assert.equal(extractCallerName('ok'), null);
    assert.equal(extractCallerName('I am Priya'), null, 'Priya is the AGENT');
  });

  it('ma’am only for a clearly feminine name, sir for everything else', () => {
    assert.equal(honorificForName('Anitha'), HONORIFIC_MAAM_KN);
    assert.equal(honorificForName('lakshmi'), HONORIFIC_MAAM_KN);
    assert.equal(honorificForName('Ravi'), HONORIFIC_SIR_KN);
    assert.equal(honorificForName('Prakash'), HONORIFIC_SIR_KN);
    // OWNER RULE: a missing name is NO title — never a default ಸರ್.
    assert.equal(honorificForName(null), '', 'no name → no honorific, never ಸರ್');
    assert.equal(honorificForName(''), '');
    assert.equal(honorificForName('Xyzzy'), HONORIFIC_SIR_KN, 'unknown name → sir');
  });

  it('builds the address the caller actually hears', () => {
    assert.equal(nameWithHonorific('Ravi'), 'Ravi ಸರ್');
    assert.equal(nameWithHonorific('Lakshmi'), 'Lakshmi ಮಾಮ್');
    assert.equal(nameWithHonorific(null), '');
  });

  it('a spoken name question is recognised so it can be cut', () => {
    assert.equal(looksLikeSpokenNameQuestion('ನಿಮ್ಮ ಹೆಸರು ಏನು?'), true);
    assert.equal(looksLikeSpokenNameQuestion('what is your name'), true);
    assert.equal(looksLikeSpokenNameQuestion('can I get your name please'), true);
    assert.equal(looksLikeSpokenNameQuestion('what should I call you'), true);
    assert.equal(looksLikeSpokenNameQuestion('nimma hesaru enu'), true);
    assert.equal(looksLikeSpokenNameQuestion('who am I speaking with'), true);
    assert.equal(looksLikeSpokenNameQuestion('may I know who this is'), true);
    assert.equal(looksLikeSpokenNameQuestion('आपका नाम क्या है?'), true);
    assert.equal(looksLikeSpokenNameQuestion(PDF_OPENING_KN), false);
    assert.equal(looksLikeSpokenNameQuestion(PDF_OPENING_EN), false);
    assert.equal(looksLikeSpokenNameQuestion(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeSpokenNameQuestion(PDF_INTERESTED_CLOSE_KN), false);
    assert.equal(looksLikeSpokenNameQuestion(OUTBOUND_NOT_INTERESTED_CLOSE_KN), false);
    assert.equal(looksLikeSpokenNameQuestion('ನೀವು ಯಾರು?'), true);
    assert.equal(looksLikeSpokenNameQuestion('ನಿಮ್ಮನ್ನು ಹೇಗೆ ಕರೆಯೋದು?'), true);
    assert.equal(looksLikeSpokenNameQuestion('may I know your name'), true);
    assert.equal(looksLikeSpokenNameQuestion('name please'), true);
    assert.equal(looksLikeSpokenNameQuestion('who is calling'), true);
    assert.equal(looksLikeSpokenNameQuestion('what name should I use'), true);
    assert.equal(looksLikeSpokenNameQuestion('what is the name'), true);
    assert.equal(looksLikeSpokenNameQuestion('ಹೆಸರೇನು'), true);
    assert.equal(looksLikeSpokenNameQuestion('ಹೆಸರು ಹೇಳಿ'), true);
    assert.equal(looksLikeSpokenNameQuestion('ಹೆಸರು ಹೇಳ್ತೀರಾ'), true);
    assert.equal(looksLikeSpokenNameQuestion('who is this'), false);
  });

  it('holds audio until a name question can be ruled out, then drops the whole turn', () => {
    assert.equal(nameQuestionAudioGate(''), 'hold');
    assert.equal(nameQuestionAudioGate('ನಿಮ್ಮ'), 'hold');
    assert.equal(nameQuestionAudioGate('Okay so'), 'hold', 'short lead-in must not auto-release');
    assert.equal(
      nameQuestionAudioGate('Okay so let me just check one thing with you'),
      'hold',
      'before locations, length alone must not release',
    );
    assert.equal(
      nameQuestionAudioGate('Okay so let me just check one thing with you', {
        areasDelivered: true,
      }),
      'release',
      'after locations, a long non-name line may play',
    );
    assert.equal(nameQuestionAudioGate('ನಿಮ್ಮ ಹೆಸರು ಏನು?'), 'drop');
    assert.equal(nameQuestionAudioGate(`ನಿಮ್ಮ ಹೆಸರು ಏನು? ${PDF_AREAS_LINE_KN}`), 'drop');
    assert.equal(nameQuestionAudioGate(PDF_AREAS_LINE_KN), 'release');
    assert.equal(nameQuestionAudioGate(PDF_INTERESTED_CLOSE_KN), 'release');
    assert.equal(nameQuestionAudioGate(OUTBOUND_NOT_INTERESTED_CLOSE_KN), 'release');
    assert.equal(nameQuestionAudioGate(PDF_OPENING_KN), 'release');
    assert.equal(nameQuestionAudioGate(PDF_OPENING_EN), 'release');
  });

  it('detects Hunsur / Narasipura / Nanjangudu and carries approved location facts', () => {
    assert.equal(detectOutboundLocality('ಹುಣಸೂರು ಕಡೆ ನೋಡ್ತಿದ್ದೀನಿ'), 'hunsur');
    assert.equal(detectOutboundLocality('T. Narasipura Road please'), 'narasipura');
    assert.equal(detectOutboundLocality('Nanjangudu is fine'), 'nanjangudu');
    assert.equal(detectOutboundLocality('yes'), null);
    const hunsur = buildOutboundLocationInterestNudge('hunsur');
    assert.ok(hunsur.includes(LOCATION_FACT_HUNSUR_KN));
    assert.ok(hunsur.includes(PDF_INTERESTED_CLOSE_KN));
    assert.match(hunsur, /Speak the location fact/);
    assert.doesNotMatch(hunsur, /ಹೆಸರು/);
    assert.match(hunsur, /endCall/);
  });

  it('spots a refusal so the name is never pressed for twice', () => {
    assert.equal(looksLikeNameRefusal("don't want to give"), true);
    assert.equal(looksLikeNameRefusal('no need'), true);
    assert.equal(looksLikeNameRefusal('ಹೆಸರು ಕೊಡ್ಬೇಡ'), true);
    assert.equal(looksLikeNameRefusal('Ravi'), false);
  });

  it('the projects step speaks the areas and the interest question, addressed by honorific', () => {
    // OWNER FLOW: greeting (intro + site question) -> yes -> name -> PROJECTS
    // addressed as sir/ma'am -> interested -> sales team -> agent hangs up.
    // The old build asked the name on ANY first utterance and then repeated the
    // site question, so the caller heard the questions out of order.
    assert.ok(PDF_OPENING_KN.includes(PDF_SITE_QUESTION_KN), 'opening carries the site question');
    assert.ok(
      !PDF_NAME_QUESTION_KN.includes(PDF_SITE_QUESTION_KN),
      'the name question must not re-ask the site question',
    );
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.ok(projects.includes(PDF_AREAS_LINE_KN));
    assert.ok(projects.includes(PDF_INTEREST_QUESTION_KN));
    assert.doesNotMatch(projects, /Ravi/);
    assert.doesNotMatch(buildOutboundProjectsNudge('Lakshmi', HONORIFIC_MAAM_KN), /Lakshmi/);
    // Never thank them at the projects step — the engine treats ಧನ್ಯವಾದ as
    // "close the call", so thanking here would hang up before the transfer.
    assert.ok(!PDF_AREAS_LINE_KN.includes('ಧನ್ಯವಾದ'));
    assert.ok(!PDF_INTEREST_QUESTION_KN.includes('ಧನ್ಯವಾದ'));
    // The thank-you belongs to the close, which is what ends the call.
    assert.match(PDF_THANKS_CLOSE_KN, /ಧನ್ಯವಾದ/);
    assert.ok(!PDF_HANDOFF_LINE_KN.includes('ಧನ್ಯವಾದ'), 'the sales line carries no thanks');
  });

  it('a yes goes to the locations, and the old name nudge does not ask for a name', () => {
    assert.equal(OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_NAME_QUESTION_KN), false);
    assert.ok(OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_AREAS_LINE_KN));
    assert.doesNotMatch(OUTBOUND_NAME_QUESTION_NUDGE, /ask their name/i);
    assert.doesNotMatch(OUTBOUND_NAME_QUESTION_NUDGE, /ಹೆಸರು/);
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.ok(projects.includes(PDF_AREAS_LINE_KN), 'must tell them the projects');
    assert.ok(projects.includes(PDF_INTEREST_QUESTION_KN), 'must ask the one interest question');
    assert.doesNotMatch(projects, /Ravi/, 'must not address them by name');
    const maam = buildOutboundProjectsNudge('Lakshmi', HONORIFIC_MAAM_KN);
    assert.doesNotMatch(maam, /Lakshmi/, 'must not use a name');
    // No name → still tell the projects, with NO title (owner rule).
    const anon = buildOutboundProjectsNudge(null, HONORIFIC_SIR_KN);
    assert.ok(anon.includes(PDF_AREAS_LINE_KN));
    // The ban text itself says "never ಸರ್" — what must never appear is a TITLE
    // handed to her as an address.
    assert.ok(!/"ಸರ್"/.test(anon), 'no name → the nudge must never hand her a ಸರ್ address');
    assert.ok(!/"ಮಾಮ್"/.test(anon), 'no name → the nudge must never hand her a ಮಾಮ್ address');
    assert.ok(!/as\s+"ಸರ್"/.test(anon), 'no name → no address-as-ಸರ್ instruction');
    assert.match(anon, /say only the locations line/i);
    assert.match(anon, /Say only the line given/);
    // ಧನ್ಯವಾದ in the projects turn would end the call early, so it is banned.
    assert.doesNotMatch(projects, /ಧನ್ಯವಾದ\s*"?\s*$/);
    const declined = buildOutboundNameDeclinedNudge(HONORIFIC_SIR_KN);
    assert.ok(declined.includes(PDF_AREAS_LINE_KN));
    assert.match(declined, /Do NOT press/);
  });

  it('both prompts tell her to say the REAL opening first, not the bare intro', () => {
    // REGRESSION from a live call: the prompts still described the OLD order —
    // say the intro alone, wait, ask the name, THEN ask the site question —
    // while the opening actually spoken is the intro AND the site question in
    // one breath. The model therefore improvised on the caller's "yes"
    // ("ohh like that") and re-asked the site question at the name step, which
    // is what left the caller with nothing usable after giving their name.
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /After the caller's yes, say only the locations line/);
      assert.doesNotMatch(flat, /ask their name/i);
      assert.equal(OUTBOUND_YES_LOCATIONS_NUDGE, PDF_AREAS_LINE_KN);
      // The prompt must carry the opening that is actually SPOKEN, so the
      // model is never told to skip the site question and ask it later.
      assert.ok(
        !flat.includes(PDF_OPENING_EN),
        'the live prompt must not also carry the English opening',
      );
      assert.equal(getOutboundGreetingInstruction(), PDF_OPENING_TURN1_KN);
      assert.ok(getOutboundGreetingInstruction().includes(PDF_SITE_QUESTION_KN));
      // ...and it must say the site question is asked ONCE, in the opening.
      assert.match(flat, /never again|asked once/i);
      // The bare intro alone is no longer the first line anywhere in the prompt.
      assert.ok(
        !flat.includes(`FIRST LINE: "${PDF_OPENING_INTRO_KN}"`),
        'the prompt must not hand her an opening that drops the site question',
      );
    }
  });

  it('a refused or missing name never routes to a spoken ಸರ್ (owner rule)', () => {
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      // The OLD wording told her to address a nameless caller as ಸರ್ — banned.
      assert.doesNotMatch(flat, /use "ಸರ್" into the locations/i);
      assert.doesNotMatch(flat, /address them as "ಸರ್" straight into/i);
      assert.match(flat, /never ಸರ್, never ಮಾಮ್/);
    }
    const declined = buildOutboundNameDeclinedNudge('ಸರ್');
    assert.ok(!declined.includes('Address them as'), 'the declined nudge must not assign a title');
    assert.match(declined, /never ಸರ್, never ಮಾಮ್/);
  });
});

/**
 * From a real call: after a plain "yes" to the site question Priya said an
 * improvised "ohh like that" and nothing else useful, and after the caller gave
 * their name she said nothing at all. Both symptoms trace to the same thing —
 * the model inventing a conversational beat, or inventing a whole turn, where
 * the script had already decided what to say.
 */
describe('get to the point — no filler reaction, and the name step always speaks', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
  const fast = buildOutboundFastConnectInstruction('30 Sep 2026').replace(/\s+/g, ' ');

  it('the name step NEVER opens with a thank-you, in any language', () => {
    // REGRESSION, from a real call against this build: the caller gave their
    // name and heard TOTAL SILENCE. The projects nudge said "thank them in ONE
    // short acknowledgement", so Priya said "Thank you Ravi sir, we have sites
    // in Hunusuru…". hasThanksClosing() matches the ENGLISH word "thanks?", the
    // engine logged "Thank-you spoken — muting", and the turn was cut off
    // mid-sentence. The whole locations line was lost.
    const nudge = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.doesNotMatch(nudge, /thank them/i, 'never ask for a thank-you in this turn');
    // Outside an explicit "NEVER say ..." ban, no thank-you may be requested —
    // requesting one is exactly what made the engine mute the turn mid-sentence.
    const spoken = nudge.replace(/NEVER say[^.]*\./gi, '');
    assert.doesNotMatch(spoken, /thank/i, 'no thank-you is asked for in this turn');
    assert.match(nudge, /acknowledge them with ONE short word/);
    // The word itself is pinned, so the model has something concrete to say.
    assert.match(nudge, new RegExp(`single Kannada word "${PDF_ACK_KN}"`));
    // The English ban matters: the close detector matches "thanks?" too.
    assert.match(nudge, /NEVER say the words thank you or thanks in ANY language/);
    // Same promise, in every variant of the nudge.
    for (const n of [
      buildOutboundProjectsNudge(null, HONORIFIC_SIR_KN),
      buildOutboundProjectsNudge('Lakshmi', HONORIFIC_MAAM_KN),
      buildOutboundNameDeclinedNudge(HONORIFIC_SIR_KN),
    ]) {
      assert.doesNotMatch(n, /thank them/i);
    }
  });

  it('nothing may follow the name question, and no step may be promised', () => {
    // The same real call: after asking the name she added "I'll give you more
    // information". The prompt's own "say it in your own words / phrase it fresh
    // every call" rule is what invites that, so the fixed lines are exempted.
    for (const flat of [full, fast]) {
      assert.match(flat, /FIXED LINES are word-for-word/);
      assert.match(flat, /EXEMPT from the "say it in your own words/);
      assert.match(flat, /NEVER promise to explain more later/);
      assert.match(flat, /I'll give you more information/);
      assert.match(flat, /On a fixed line there is NOTHING before it and NOTHING after it/);
    }
    assert.equal(OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_NAME_QUESTION_KN), false);
  });

  it('both prompts ban a reaction before the line the script asks for', () => {
    for (const flat of [full, fast]) {
      assert.match(flat, /GET TO THE POINT/);
      // The exact words the caller complained about, named as banned openers.
      assert.match(flat, /"like that"/);
      assert.match(flat, /"ohh"/);
      assert.match(flat, /ಅಹಾ/);
      assert.doesNotMatch(flat, /a SIGNAL, not something to react to/i);
      assert.doesNotMatch(flat, /Say nothing else/i);
      assert.doesNotMatch(flat, /Say only the line given/i);
      assert.match(flat, /one short sentence/);
    }
  });

  it('the old name nudge now says the locations and never the name', () => {
    const flat = OUTBOUND_NAME_QUESTION_NUDGE.replace(/\s+/g, ' ');
    assert.equal(flat.includes(PDF_NAME_QUESTION_KN), false);
    assert.ok(flat.includes(PDF_AREAS_LINE_KN));
    assert.doesNotMatch(flat, /ask their name/i);
    assert.doesNotMatch(flat, /ಹೆಸರು/);
  });

  it('after the name she thanks in ONE word and goes straight to the locations', () => {
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN).replace(/\s+/g, ' ');
    assert.ok(projects.includes(PDF_ACK_KN), 'the acknowledgement word must be anchored');
    assert.ok(
      projects.includes(`single Kannada word "${PDF_ACK_KN}"`),
      'the acknowledgement must be pinned to the one Kannada word',
    );
    assert.match(projects, /NOT a sentence/);
    assert.doesNotMatch(projects, /Ravi/);
    assert.ok(projects.includes(PDF_AREAS_LINE_KN));
    assert.ok(projects.includes(PDF_INTEREST_QUESTION_KN));
    // She must not re-ask what the caller already answered.
    assert.match(projects, /Do NOT re-ask the site question/);
    // "Speak NOW" — the caller's complaint was silence after the name.
    assert.match(projects, /Speak NOW/);
    assert.match(projects, /do not react/i);
  });

  it('the acknowledgement is ಸರ್ತಿ, and it can never be mistaken for the close', () => {
    // SAFETY: ಧನ್ಯವಾದ is the engine's close trigger. The one-word thanks that
    // precedes the locations MUST NOT trip it, or the call ends before the
    // caller hears what we have.
    assert.equal(hasThanksClosing(PDF_ACK_KN), false, 'ಸರ್ತಿ must not look like a close');
    assert.equal(hasThanksClosing(`${PDF_ACK_KN} Ravi ಸರ್ ${PDF_AREAS_LINE_KN}`), false);
    assert.equal(hasThanksClosing(PDF_THANKS_CLOSE_KN), true, 'the real close still trips');
    // The nudge must not hand the model the dangerous word as an option.
    const spoken = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN)
      .replace(/NEVER say[^.]*\./gi, '');
    assert.doesNotMatch(spoken, /ಧನ್ಯವಾದ/);
  });

  it('a declined name still goes straight to the locations, with no reaction', () => {
    const flat = buildOutboundNameDeclinedNudge(HONORIFIC_SIR_KN).replace(/\s+/g, ' ');
    assert.ok(flat.includes(PDF_AREAS_LINE_KN));
    assert.match(flat, /React to nothing/);
    assert.match(flat, /Do NOT re-ask the site question/);
    assert.match(flat, /Do NOT press/);
    // OWNER RULE: a declined name is still no name — no title may be spoken.
    assert.ok(!flat.includes(HONORIFIC_SIR_KN) || /never ಸರ್, never ಮಾಮ್/.test(flat));
    assert.match(flat, /never ಸರ್, never ಮಾಮ್/);
  });
});

/**
 * A caller who gives their name in Kannada script was addressed as a bare ಸರ್
 * for the whole call, because \b never matches around Indic script and the
 * capitalised-word rule could not see those names at all.
 */
describe('names spoken in Kannada script are captured', () => {
  it('reads a bare Kannada-script name', () => {
    assert.equal(extractCallerName('ರಮೇಶ್'), 'ರಮೇಶ್');
    assert.equal(extractCallerName('ಲಕ್ಷ್ಮಿ'), 'ಲಕ್ಷ್ಮಿ');
    assert.equal(extractCallerName('ನಾನು ರಮೇಶ್'), 'ರಮೇಶ್', 'skip the "I am"');
    assert.equal(extractCallerName('ಹೆಸರು ಸುಧಾ'), 'ಸುಧಾ');
  });

  it('never mistakes our own question or an acknowledgement for their name', () => {
    // An echo of a line PRIYA just said is the single most likely thing to be
    // captured by mistake once Kannada script is in scope. Every word the
    // agent speaks is excluded, so an echo of the site question cannot be
    // handed back to the caller as their own name.
    assert.equal(extractCallerName('ನಿಮ್ಮ ಹೆಸರು ಏನು?'), null);
    assert.equal(extractCallerName('ಮೈಸೂರಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದ್ದೀರಾ ಸರ್'), null);
    assert.equal(extractCallerName('ಮೈಸೂರಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದ್ದೀರಾ'), null);
    assert.equal(extractCallerName('ಹೌದು'), null);
    assert.equal(extractCallerName('ಸರಿ'), null);
    assert.equal(extractCallerName('ಧನ್ಯವಾದ'), null);
    // A Kannada ANSWER is not a name: it must be dropped, not spoken back —
    // including when its words are words PRIYA also uses.
    assert.equal(extractCallerName('ಹುಣಸೂರಿನಲ್ಲಿ ಆಸಕ್ತಿ ಇದೆ'), null);
    assert.equal(extractCallerName('ಹುಣಸೂರಿನಲ್ಲಿ ಆಸಕ್ತಿ'), null);
    assert.equal(extractCallerName('ನರಸೀಪುರ ಬೇಕು'), null);
    // Latin behaviour is unchanged.
    assert.equal(extractCallerName('Ravi'), 'Ravi');
    assert.equal(extractCallerName('I am Priya'), null);
  });

  it('gives a clearly feminine Kannada name maam, and every other name sir', () => {
    assert.equal(honorificForName('ಲಕ್ಷ್ಮಿ'), HONORIFIC_MAAM_KN);
    assert.equal(honorificForName('ಸುಧಾ'), HONORIFIC_MAAM_KN);
    assert.equal(honorificForName('ರಮೇಶ್'), HONORIFIC_SIR_KN);
    assert.equal(honorificForName('ಪ್ರಕಾಶ್'), HONORIFIC_SIR_KN);
    // Conservative default: an unknown Kannada name is sir, never guessed.
    assert.equal(honorificForName('ಝಡಪತ್ರ'), HONORIFIC_SIR_KN);
    assert.equal(nameWithHonorific('ಲಕ್ಷ್ಮಿ'), `ಲಕ್ಷ್ಮಿ ${HONORIFIC_MAAM_KN}`);
  });
});

/**
 * The caller heard "thank you sir for your time" many times in a row. Every
 * audio part of ONE model turn is played before the mute arms, so a stuttered
 * close had to be dropped and replaced with one clean close.
 */
describe('the thank-you is said exactly once, then the call ends', () => {
  it('flags a close that repeats the thank-you', () => {
    assert.equal(looksLikeStutteredClose(PDF_THANKS_CLOSE_KN), false);
    assert.equal(
      looksLikeStutteredClose(`${PDF_HANDOFF_LINE_KN} ${PDF_THANKS_CLOSE_KN}`),
      false,
      'a normal, single close is never a stutter',
    );
    // The thank-you three times in one turn.
    assert.equal(
      looksLikeStutteredClose(
        `${PDF_HANDOFF_LINE_KN} ${PDF_THANKS_CLOSE_KN} ${PDF_THANKS_CLOSE_KN} ${PDF_THANKS_CLOSE_KN}`,
      ),
      true,
    );
    // …even when the transcriber splits the word apart.
    assert.equal(
      looksLikeStutteredClose(
        `${PDF_HANDOFF_LINE_KN} ನಿಮ್ಗೆ ಸಮಯ ಕೊಡಿ ದಂ ತೆ ಧನ್ಯವಾ ದಗಳು ಸರ್ ನಿಮ್ಗೆ ಸಮಯ ಕೊಡಿ ದಂ ತೆ ಧನ್ಯವಾ ದಗಳು ಸರ್`,
      ),
      true,
    );
    // The whole close pair said twice.
    assert.equal(
      looksLikeStutteredClose(
        `${PDF_HANDOFF_LINE_KN} ${PDF_THANKS_CLOSE_KN} ${PDF_HANDOFF_LINE_KN} ${PDF_THANKS_CLOSE_KN}`,
      ),
      true,
    );
  });

  it('does not flag an ordinary mid-call turn', () => {
    assert.equal(looksLikeStutteredClose(PDF_AREAS_LINE_KN), false);
    assert.equal(looksLikeStutteredClose(PDF_OPENING_KN), false);
    assert.equal(looksLikeStutteredClose(''), false);
  });

  it('the replacement close says both lines exactly once and ends the call', () => {
    // Guidance again: it describes the close, it does not recite it.
    assert.ok(OUTBOUND_CLEAN_CLOSE_NUDGE.includes(PDF_INTERESTED_CLOSE_KN));
    assert.match(OUTBOUND_CLEAN_CLOSE_NUDGE, /exactly once/i);
    assert.match(OUTBOUND_CLEAN_CLOSE_NUDGE, /call endCall/);
    assert.match(OUTBOUND_CLEAN_CLOSE_NUDGE, /Do not do that again/);
  });

  it('the strict end rule is in BOTH instructions the model sees', () => {
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /STRICT/);
      assert.match(flat, /call endCall in that same turn/);
      // The thank-you is never repeated and never reworded. (This used to match
      // the literal words "Never repeat it", which only existed in the SILENCE
      // rules — "never repeat it, never rephrase it, never say it again" — which
      // this change rewrote. The rule being protected is the thank-you's, so the
      // assertion is scoped to it.)
      assert.match(flat, /never reword it|never reword/i);
      assert.match(flat, /call endCall/i);
    }
  });
});

/**
 * From a real call: the caller said "yes I am looking for a site" — answering the
 * opening exactly — and heard nothing at all. The name step advanced only on a
 * SHORT affirmative (whole-string anchored, capped at 24 characters), so a longer
 * reply fell straight past it, and the interested classifier then deliberately
 * stayed quiet because the name step was unfinished. Two defects, one dead line.
 */
describe('a longer "yes" still answers the site question', () => {
  it('accepts a yes that is more than one short word', () => {
    for (const said of [
      'yes I am looking for a site',
      'yes i am looking for a site in mysuru',
      'Yes, I want a plot',
      'yes in Mysuru',
      "yeah I'm interested",
      'haan I want a site',
      'ಹೌದು ನೋಡುತ್ತಿದ್ದೇನೆ',
      'ಹೌದು ಸೈಟ್ ಬೇಕು',
    ]) {
      assert.equal(looksLikeAnswerToSiteQuestion(said), true, `must accept: ${said}`);
    }
  });

  it('still refuses the replies that are NOT an answer to the opening', () => {
    for (const said of [
      'not interested',
      "I don't want a site",
      'I am busy right now',
      'call me later',
      'wrong number',
      'I do not want to give my name',
      'ಇಲ್ಲ ಬೇಡ',
      // A decline that STARTS with "ಸರಿ" must stay a decline: "ಸರಿ ಬೇಡ" is
      // "okay, not interested", not a yes.
      'ಸರಿ ಬೇಡ',
      'ಸರಿ, ಇಲ್ಲ',
      '',
    ]) {
      assert.equal(looksLikeAnswerToSiteQuestion(said), false, `must refuse: ${said}`);
    }
  });

  it('is not fooled by STT noise or an unrelated sentence', () => {
    assert.equal(looksLikeAnswerToSiteQuestion('uhm'), false);
    assert.equal(looksLikeAnswerToSiteQuestion('what is your name'), false);
  });
});

/**
 * OWNER REPORT: "after I tell the name she didn't speak at all", plus "if we are
 * silent and I speak after 3-5 seconds, before the call ends, she must still
 * respond". These lock the two mechanisms that make that impossible:
 *   - the speak guard (a step that produced NO audio is re-issued), and
 *   - the late-reply cancellation (speech while the goodbye is pending cancels
 *     the close and gets an answer).
 */
describe('no dead air after the name, and a late reply is always answered', () => {
  const GRACE = 3_000;
  const MAX_DEFERS = 4;

  it('holds the silence close while the caller has just spoken', () => {
    // The tick fires 5s after the agent's own line, and the caller who starts
    // talking at 3-5s is still speaking AT that moment — which is exactly what
    // this grace window sees. Boundary is inclusive: "speak after 3 seconds"
    // means 3 seconds of quiet is still caller speech.
    for (const spokeAgoMs of [0, 250, 2_999, 3_000]) {
      assert.equal(
        shouldHoldSilenceClose({
          now: 10_000,
          lastCallerVoiceAt: 10_000 - spokeAgoMs,
          lastSpeechEnergyAt: 0,
          graceMs: GRACE,
          defersUsed: 0,
          maxDefers: MAX_DEFERS,
        }),
        true,
        `voice ${spokeAgoMs}ms ago must hold the close`,
      );
    }
  });

  it('does not hold on stale voice — the caller has had their window', () => {
    for (const spokeAgoMs of [3_001, 6_000]) {
      assert.equal(
        shouldHoldSilenceClose({
          now: 10_000,
          lastCallerVoiceAt: 10_000 - spokeAgoMs,
          lastSpeechEnergyAt: 0,
          graceMs: GRACE,
          defersUsed: 0,
          maxDefers: MAX_DEFERS,
        }),
        false,
        `voice ${spokeAgoMs}ms ago must not hold the close`,
      );
    }
  });

  it('holds on speech-class energy alone, before any transcript exists', () => {
    assert.equal(
      shouldHoldSilenceClose({
        now: 10_000,
        lastCallerVoiceAt: 0,
        lastSpeechEnergyAt: 9_500,
        graceMs: GRACE,
        defersUsed: 0,
        maxDefers: MAX_DEFERS,
      }),
      true,
    );
  });

  it('still ends a genuinely silent line, and the holds are bounded', () => {
    assert.equal(
      shouldHoldSilenceClose({
        now: 10_000,
        lastCallerVoiceAt: 4_000,
        lastSpeechEnergyAt: 4_000,
        graceMs: GRACE,
        defersUsed: 0,
        maxDefers: MAX_DEFERS,
      }),
      false,
      'voice long ago is not a reason to keep holding',
    );
    assert.equal(
      shouldHoldSilenceClose({
        now: 10_000,
        lastCallerVoiceAt: 9_900,
        lastSpeechEnergyAt: 9_900,
        graceMs: GRACE,
        defersUsed: MAX_DEFERS,
        maxDefers: MAX_DEFERS,
      }),
      false,
      'the ladder must still terminate',
    );
  });

  it('cancels a pending silence goodbye the moment the caller speaks', () => {
    assert.equal(
      shouldCancelPendingSilenceClose({
        goodbyeSentAt: 1_000,
        thanksSpoken: false,
        hardMute: false,
        transferStarted: false,
      }),
      true,
    );
  });

  it('refuses to cancel once the close is committed', () => {
    for (const committed of [
      { goodbyeSentAt: 1_000, thanksSpoken: true, hardMute: true, transferStarted: false },
      { goodbyeSentAt: 1_000, thanksSpoken: false, hardMute: true, transferStarted: false },
      { goodbyeSentAt: 1_000, thanksSpoken: false, hardMute: false, transferStarted: true },
      { goodbyeSentAt: 0, thanksSpoken: false, hardMute: false, transferStarted: false },
    ]) {
      assert.equal(
        shouldCancelPendingSilenceClose(committed),
        false,
        JSON.stringify(committed),
      );
    }
  });

  it('the cancellation nudge cancels the close and carries no script line', () => {
    const n = OUTBOUND_SILENCE_CANCELLED_NUDGE;
    assert.match(n, /NOT over/i);
    assert.match(n, /Do NOT say goodbye/i);
    assert.match(n, /Do NOT call endCall/i);
    assert.equal(n.includes(PDF_AREAS_LINE_KN), false, 'must not smuggle a spoken line');
    assert.equal(n.includes(PDF_THANKS_CLOSE_KN), false);
  });

  it('the name-question retry says the locations and never asks for a name', () => {
    const n = OUTBOUND_NAME_QUESTION_RETRY_NUDGE;
    assert.equal(n.includes(PDF_NAME_QUESTION_KN), false);
    assert.ok(n.includes(PDF_AREAS_LINE_KN));
  });

  it('the projects retry says the locations once and never asks for a name', () => {
    const n = buildOutboundProjectsRetryNudge('Ravi', HONORIFIC_SIR_KN);
    assert.ok(!n.includes(nameWithHonorific('Ravi')), 'must not address the caller by name');
    assert.ok(n.includes(PDF_ACK_KN), 'must use the one-word acknowledgement');
    assert.ok(n.includes(PDF_AREAS_LINE_KN), 'must carry the projects line');
    assert.ok(n.includes(PDF_INTEREST_QUESTION_KN), 'the locations line already includes the question');
    assert.match(n, /NO sound/i);
    assert.match(n, /NEVER say thank you/i);
  });

  it('the projects retry without a name uses NO honorific (owner rule)', () => {
    const n = buildOutboundProjectsRetryNudge(null, HONORIFIC_SIR_KN);
    // The ban text itself says "never ಸರ್" — check no TITLE is handed over.
    assert.ok(!/"ಸರ್"/.test(n), 'no name → never a ಸರ್ address');
    assert.ok(!/"ಮಾಮ್"/.test(n), 'no name → never a ಮಾಮ್ address');
    assert.ok(!/addressing them as "ಸರ್"/.test(n));
    assert.ok(n.includes(PDF_AREAS_LINE_KN));
    assert.equal(n.includes('undefined'), false);
  });
});

describe('repeat detector and side-question routing', () => {
  it('hears a request to say the last line again', () => {
    for (const said of ['repeat', 'again', 'what', 'what?', 'sorry', 'pardon', 'ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ', 'ಮತ್ತೆ ಹೇಳಿ']) {
      assert.equal(looksLikeRepeatLastLine(said), true, said);
      assert.equal(routeCallerQuestion(said), 'repeat', said);
    }
    assert.equal(looksLikeRepeatLastLine("what's the price"), false);
    assert.equal(routeCallerQuestion("what's the price"), 'defer');
    assert.equal(routeCallerQuestion('yes'), null);
    assert.equal(routeCallerQuestion('Hunsur'), null);
  });

  it('routes the caller questions and keeps answers free of a thank-you', () => {
    assert.equal(routeCallerQuestion('who is this'), 'who');
    assert.equal(routeCallerQuestion('who are you'), 'who');
    assert.equal(routeCallerQuestion('why are you calling'), 'why');
    assert.equal(routeCallerQuestion('where is the site'), 'where');
    assert.equal(routeCallerQuestion('are you a robot'), 'robot');
    assert.equal(routeCallerQuestion('are you an AI'), 'robot');
    assert.equal(routeCallerQuestion('call me later'), 'callback');
    assert.equal(routeCallerQuestion('not now'), 'callback');
    assert.equal(routeCallerQuestion('what is the price'), 'defer');
    assert.equal(routeCallerQuestion('ನೀವು ಯಾರು'), 'who');
    assert.equal(sideAnswerFor('who', 'who is this'), SIDE_ANSWER_WHO_KN);
    assert.equal(sideAnswerFor('who', 'ನೀವು ಯಾರು'), SIDE_ANSWER_WHO_KN);
    assert.equal(sideAnswerFor('who', 'please speak english'), SIDE_ANSWER_WHO_EN);
    assert.equal(sideAnswerFor('why', 'why are you calling'), SIDE_ANSWER_WHY_KN);
    assert.equal(sideAnswerFor('why', 'ಯಾಕೆ ಕರೆ ಮಾಡ್ದೀರಾ'), SIDE_ANSWER_WHY_KN);
    assert.equal(sideAnswerFor('defer', 'how much'), SIDE_ANSWER_DEFER_KN);
    assert.equal(sideAnswerFor('defer', 'ಬೆಲೆ ಎಷ್ಟು'), SIDE_ANSWER_DEFER_KN);
    assert.equal(sideAnswerFor('robot', 'are you a robot'), SIDE_ANSWER_ROBOT_KN);
    assert.equal(sideAnswerFor('robot', 'ನೀವು ರೋಬೋಟ್ ಆ?'), SIDE_ANSWER_ROBOT_KN);
    assert.match(sideAnswerFor('where', 'where is the site'), /ಹುಣಸೂರು/);
    assert.match(sideAnswerFor('where', 'where is the Hunsur site'), /ಹುಣಸೂರು/);
    for (const line of [
      SIDE_ANSWER_WHO_EN,
      SIDE_ANSWER_WHO_KN,
      SIDE_ANSWER_WHY_EN,
      SIDE_ANSWER_WHY_KN,
      SIDE_ANSWER_DEFER_EN,
      SIDE_ANSWER_DEFER_KN,
      SIDE_ANSWER_ROBOT_EN,
      SIDE_ANSWER_ROBOT_KN,
    ]) {
      assert.equal(hasThanksClosing(line), false, line);
      assert.doesNotMatch(line, /ಧನ್ಯವಾದ|thank/i);
    }
    assert.equal(sideQuestionsMoveToClose(0), false);
    assert.equal(sideQuestionsMoveToClose(1), false);
    assert.equal(sideQuestionsMoveToClose(2), true);
    const replay = buildRepeatLastLineTurn(PDF_OPENING_EN);
    assert.match(replay, /a little slower/);
    assert.ok(replay.includes(PDF_OPENING_EN));
    assert.doesNotMatch(replay, /\bname\b/i);
  });
});
