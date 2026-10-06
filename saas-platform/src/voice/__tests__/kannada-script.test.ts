/**
 * Tests for the single outbound script module (v5 final spec).
 * Run: npx tsx --test src/voice/__tests__/kannada-script.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_OPENING_KN,
  PDF_OPENING,
  PDF_OPENING_TURN1_KN,
  PDF_OPENING_INTRO_KN,
  PDF_NAME_QUESTION_KN,
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
  PDF_INTEREST_QUESTION_KN,
  PDF_HANDOFF_LINE_KN,
  PDF_THANKS_CLOSE_KN,
  CALLBACK_OUTSIDE_WINDOW_LINE_KN,
  OUTBOUND_NOT_INTERESTED_CLOSE_KN,
  SILENCE_CHECK_LINE_KN,
  SILENCE_TIMEOUT_CLOSE_KN,
  SILENCE_CHECK_AFTER_MS,
  SILENCE_CLOSE_AFTER_CHECK_MS,
  SILENCE_GOODBYE_LINE_KN,
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
  it('opening = intro AND site question in ONE turn, THEN the name', () => {
    // OWNER-SPECIFIED ORDER: greet + name + "are you looking for a site in
    // Mysuru?" is spoken as the opening. The name question comes after the yes,
    // and the projects come after the name.
    assert.match(PDF_OPENING_KN, /ಪ್ರಿಯಾ/);
    assert.match(PDF_OPENING_KN, /ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್/);
    assert.match(PDF_OPENING_KN, /ಸೈಟ್ ಬೇಕಾ\?/); // the site question IS in the opening
    assert.equal(PDF_OPENING, PDF_OPENING_KN);
    assert.equal(PDF_OPENING_TURN1_KN, PDF_OPENING_KN, 'the opening turn speaks the site question');

    // The intro-only constant is kept for reference but is no longer the opening.
    assert.match(PDF_OPENING_INTRO_KN, /ಪ್ರಿಯಾ/);
    // TURN 2 — the name question, after the caller says yes.
    assert.match(PDF_NAME_QUESTION_KN, /ಹೆಸರು/);
    // TURN 3 — the projects, not another site question.
    assert.match(PDF_AREAS_LINE_KN, /ರಸ್ತೆ|ಪ್ರದೇಶ/);
    assert.match(PDF_INTEREST_QUESTION_KN, /ಆಸಕ್ತಿ/);

    // OWNER-SPECIFIED: the greeting speaks the intro AND the site question in one
    // utterance. The name question is still a later turn.
    const greeting = getOutboundGreetingInstruction();
    assert.match(greeting, /Speak now/);
    // The agent was heard announcing "I will tell what I am programmed to tell"
    // before the opening, because the instruction was phrased as a meta-command
    // the model narrated. It must now forbid any such preamble outright.
    assert.match(greeting, /say NOTHING before it/);
    assert.match(
      greeting,
      /never mention that you are following instructions|never mention that you are following instructions/,
    );
    assert.match(greeting, /being programmed/);
    assert.match(greeting, /Then stop and listen/);
    assert.ok(
      greeting.includes(PDF_OPENING_TURN1_KN),
      'the greeting speaks the intro AND the site question',
    );
    assert.ok(
      greeting.includes(PDF_SITE_QUESTION_KN),
      'the site question is part of the opening, not a later turn',
    );
    assert.ok(!greeting.includes(PDF_NAME_QUESTION_KN), 'the name question is a LATER turn');
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

  it('interest question asked after the locations line (said as written every call)', () => {
    assert.match(PDF_INTEREST_QUESTION_KN, /ಆಸಕ್ತಿ/);
    assert.match(PDF_INTEREST_QUESTION_KN, /\?/);
    assert.equal(hasLatin(PDF_INTEREST_QUESTION_KN), false);
    // The locations line itself stays question-free — the question is spoken
    // as a follow-up in the same turn, phrased fresh every time.
    assert.doesNotMatch(PDF_AREAS_LINE_KN, /\?/);
    const nudge = OUTBOUND_YES_LOCATIONS_NUDGE;
    assert.match(nudge, /interest question/i);
    // Owner decision 1: the nudge is GUIDANCE. It must tell the agent how to
    // COVER the turn and hand her the wording, never hand her a line to recite.
    assert.match(nudge, /YOUR OWN WORDS/);
    assert.match(nudge, /paraphrase/i);
    assert.match(nudge, /STOP and WAIT/);
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /TWO QUESTIONS MAX/);
  });

  it('sales-team line carries NO thanks; the ONE ಧನ್ಯವಾದ is the final thank-you line', () => {
    assert.match(PDF_HANDOFF_LINE_KN, /ಸೇಲ್ಸ್ ಟೀಮ್/);
    assert.match(PDF_HANDOFF_LINE_KN, /ಕರೆ ಮಾಡುತ್ತಾರೆ/); // the team WILL CALL them
    assert.doesNotMatch(PDF_HANDOFF_LINE_KN, /ವರ್ಗಾಯಿಸ/); // no live-transfer wording
    // Thanks moved OUT of the sales-team line so the caller is thanked exactly
    // once, right before hangup, instead of twice on the same call.
    assert.doesNotMatch(PDF_HANDOFF_LINE_KN, /ಧನ್ಯವಾದ/);
    assert.equal(hasThanksClosing(PDF_HANDOFF_LINE_KN), false);

    assert.match(PDF_THANKS_CLOSE_KN, /ಧನ್ಯವಾದಗಳು/);
    assert.match(PDF_THANKS_CLOSE_KN, /ಸಮಯ/); // "thank you for your TIME"
    assert.equal(hasThanksClosing(PDF_THANKS_CLOSE_KN), true);
    assert.equal(hasLatin(PDF_THANKS_CLOSE_KN), false);

    assert.equal(hasLatin(PDF_HANDOFF_LINE_KN), false);
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.match(full, /ENDS the call|call ENDS|ends the call|call ends/);
    assert.doesNotMatch(full, /live transfer/i);
    assert.doesNotMatch(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಧನ್ಯವಾದ/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_KN, /ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್/);
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
    assert.match(handoff, /endCall in the SAME turn/);
    assert.match(handoff, /ONE short thank-you/);
    assert.match(handoff, /sales team/i);
    assert.match(handoff, /EXACTLY ONCE/);
  });
});

describe('v5 script — system instructions', () => {
  const full = buildOutboundSystemInstruction('30 Sep 2026');
  const fast = buildOutboundFastConnectInstruction('30 Sep 2026');

  it('carries the spec flow + language-follow rules', () => {
    assert.match(full, /CHANGE ONLY WHEN THE CALLER ASKS/);
    assert.match(full, /Marathi/);
    assert.match(full, /ನಿಮಗೆ ಮೈಸೂರಲ್ಲಿ ಸೈಟ್ ಬೇಕಾ\?/);
    assert.match(full, /STEP 2B — CALLER IS INTERESTED/);
    assert.match(full, /STEP 3 — CALLER SHOWS INTEREST IN A LOCATION/);
    assert.match(full, /ನಿಮ್ಮ ಹೆಸರು ಏನು ಸರ್/); // STEP 1B carries the exact name line
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
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /interested/i);
    assert.match(OUTBOUND_YES_LOCATIONS_NUDGE, /ಹುಣಸೂರು/);
    assert.match(OUTBOUND_YES_ASK_NAME_NUDGE, /ಹುಣಸೂರು/); // alias resolves to locations nudge
    const handoff = buildOutboundHandoffTransferNudge();
    assert.match(handoff, /thank-you/);
    assert.match(handoff, /endCall in the SAME turn/);
    assert.doesNotMatch(handoff, /Do NOT call endCall/);
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE, /reserved for the sales-team closing line/);
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
    assert.match(afterOpening.pendingQuestion, /ಸೈಟ್ ಬೇಕಾ/);
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

describe('silence state machine — the check line twice, then the call ends', () => {
  it('5s quiet → check; 5s more → the SAME check again; 5s more → the call ends', () => {
    // OWNER-SPECIFIED LADDER (CHANGED at the owner's request): 5s quiet → "are
    // you still on the line?", 5s later → the SAME line asked once more, and
    // only after a SECOND unanswered check does a short goodbye end the call.
    // The old ladder asked once at 5s and cut the line at 10s, so a caller who
    // missed the first check — or was still finding the phone — never got
    // another chance. Probing at 2s was tried and rejected: it landed while
    // callers were still finding the phone and read as impatience.
    assert.equal(SILENCE_CHECK_AFTER_MS, 5_000);
    assert.equal(SILENCE_CHECK_REPEAT_AFTER_MS, 5_000, 'the repeat is 5s after the first check');
    assert.equal(SILENCE_CLOSE_AFTER_CHECK_MS, 5_000, 'the call ends 5s after the 2nd check');
    assert.equal(SILENCE_CHECKS_MAX, 2, 'never a third check');
    assert.equal(
      SILENCE_CHECK_AFTER_MS + SILENCE_CHECK_REPEAT_AFTER_MS + SILENCE_CLOSE_AFTER_CHECK_MS,
      15_000,
      'three 5s windows: check, check again, then end',
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

    // Still silent inside that window → nothing at all.
    t = tickOutboundSilence(s, start + 9_900);
    assert.equal(t.action, 'none', 'window still quiet → no talking at all');
    // 5s later: the same line again.
    t = tickOutboundSilence(s, start + 10_100);
    assert.equal(t.action, 'speak_check', 'the same check is asked a second time');
    s = t.state;
    assert.equal(s.checksSpoken, 2);

    // 5s after the SECOND check: goodbye and terminate — never a third check.
    t = tickOutboundSilence(s, start + 15_100);
    assert.equal(t.action, 'close_silence', 'two unanswered checks end the call');
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

  it('the check line is asked TWICE per silent stretch, then the call closes', () => {
    // OWNER REQUEST: one check at 5s left a caller who missed it (or was still
    // finding the phone) with no second chance. The same line is now asked again
    // 5s later — word for word — and only after a SECOND unanswered check does
    // the code speak one goodbye and end the call. It never becomes a loop.
    const start = 1000;
    let s = armOutboundSilenceCheck(start);
    let t = tickOutboundSilence(s, start + 5_100);
    assert.equal(t.action, 'speak_check', 'first check at 5s');
    assert.equal(t.state.checksSpoken, 1);

    // The check line's own turn completes → the engine re-arms the cycle. The
    // count MUST survive that, or the ladder restarts and asks a caller who has
    // just heard the question yet again 5s later.
    const afterCheckLineTurn = 5_800;
    const rearmed = armOutboundSilenceCheck(afterCheckLineTurn, t.state.checksSpoken);
    assert.equal(rearmed.checksSpoken, 1, 'a re-arm must not forget the first check');

    // 5s later: the SAME line, a second time — not the close.
    const second = tickOutboundSilence(rearmed, afterCheckLineTurn + 5_100);
    assert.equal(second.action, 'speak_check', 'the check is asked a second time');
    assert.equal(second.state.checksSpoken, 2);

    // Its own turn re-arms too, and the count is still 2.
    const afterSecondTurn = afterCheckLineTurn + 8_600;
    const rearmed2 = armOutboundSilenceCheck(afterSecondTurn, second.state.checksSpoken);
    assert.equal(rearmed2.checksSpoken, 2);

    // 5s after the second check: goodbye + end. NEVER a third check.
    const close = tickOutboundSilence(rearmed2, afterSecondTurn + 5_100);
    assert.equal(close.action, 'close_silence', 'never ask a third time');
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
    // A fresh cycle after new speech starts from the top again — both checks.
    const fresh = armOutboundSilenceCheck(start + 20_000);
    assert.equal(fresh.checksSpoken, 0);
    assert.equal(tickOutboundSilence(fresh, start + 20_000).action, 'none');
    assert.equal(tickOutboundSilence(fresh, start + 25_100).action, 'speak_check');
    const again = tickOutboundSilence(
      armOutboundSilenceCheck(start + 27_000, 1),
      start + 32_100,
    );
    assert.equal(again.action, 'speak_check', 'a new quiet spell gets both checks');
    assert.equal(again.state.checksSpoken, 2);
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
    assert.match(SILENCE_CHECK_LINE_KN, /ಇದೀರಾ/);
  });

  it('delivery guidance reaches the FAST CONNECT instruction (the one live for the opening)', () => {
    // Regression guard: the opening line is spoken from FAST CONNECT only, so if
    // the delivery block is missing there, Priya's first sentence is generated
    // with zero prosody direction — which is what made her sound like a robot.
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    assert.match(fast, /HOW YOU SOUND/);
    assert.match(fast, /Close to the mic|close to the mic/);
    assert.match(fast, /audible|smile/i);
    assert.match(fast, /comma is a breath|A comma is a breath/i);
    // CHANGED at the owner's request: "Match the caller … if they sound tired,
    // soften and slow down" is what made her speak slow once fast on a single
    // call, and different again on the next one. There is now ONE pace, and the
    // old pacing instructions must be gone from BOTH prompts.
    assert.doesNotMatch(fast, /Match the caller/i);
    assert.match(fast, /ONE PACE, EVERY TIME/);
    assert.match(fast, /NEVER change your speed to match how/);
    assert.doesNotMatch(fast, /Vary your rhythm/i);
    assert.doesNotMatch(fast, /finding the words/i);
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    assert.doesNotMatch(full, /Match the caller/i);
    assert.doesNotMatch(full, /Vary your rhythm/i);
    assert.match(full, /ONE PACE, EVERY TIME/);
  });

  it('the whole call is pinned to five fixed steps, in both prompts', () => {
    // The owner described the call exactly: ask about a site, ask the name, tell
    // them the projects, say thanks, then the line goes quiet and ends. Every
    // complaint in this file — slow once fast, repeating, extra unwanted talk —
    // was the model improvising around a script it was never pinned to.
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /THE WHOLE CALL, IN FIVE STEPS/);
      assert.match(flat, /1\. SITE QUESTION/);
      assert.match(flat, /2\. THEIR NAME/);
      assert.match(flat, /3\. THE PROJECTS/);
      assert.match(flat, /4\. THE CLOSE/);
      assert.match(flat, /5\. THEN STOP TALKING/);
      assert.ok(flat.includes(PDF_AREAS_LINE_KN), 'the projects line is in the pinned script');
      assert.ok(flat.includes(PDF_THANKS_CLOSE_KN), 'the thank-you is in the pinned script');
      assert.match(flat, /There is NO sixth step/);
      assert.match(flat, /said AS WRITTEN/);
      assert.match(flat, /You are not decorating\s+this script, you are saying it/);
    }

    // The "no rephrasing" rule lives in CONVERSATION DRIVE, which only the full
    // instruction carries — the fast-connect one has the five-step block instead.
    const fullFlat = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
    assert.match(fullFlat, /Say each script line AS WRITTEN/);
    assert.match(fullFlat, /no rephrasing, no fresh wording/);
    assert.match(fullFlat, /no "in your own words"/);
    assert.match(fullFlat, /Never repeat a line you have already said, in any wording/);
    assert.ok(
      fullFlat.includes(`AS WRITTEN, in ONE utterance: "${PDF_AREAS_LINE_KN}"`),
      'the locations line must be delivered AS WRITTEN',
    );
    assert.ok(
      fullFlat.includes(`the ONE interest question AS WRITTEN: "${PDF_INTEREST_QUESTION_KN}"`),
      'the interest question must be delivered AS WRITTEN',
    );
    // The "phrase it fresh every call" instruction is what made the same step
    // sound like three different people across three calls.
    assert.doesNotMatch(fullFlat, /phrase it FRESH and cheerful every call/i);
    assert.doesNotMatch(fullFlat, /fresh phrasing every call/i);
  });

  it('prompt: silence means ask twice, then end the call', () => {
    // Prompts are line-wrapped, so compare against a whitespace-normalised copy.
    const full = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026').replace(/\s+/g, ' ');

    // Full instruction (Kannada check line): the check may be asked TWICE in one
    // silent stretch, word for word both times, and never a third time. The CODE
    // ends the call after the second unanswered check — the model is no longer
    // told to call endCall there, because that close is muted and hard-ended by
    // the engine anyway. CHANGED FROM "EXACTLY ONCE per call" at the owner's
    // request: one check at 5s left a caller who missed it with no second chance.
    assert.match(full, /The check line may be asked TWICE in one silent stretch/);
    assert.match(full, /Both times it is the EXACT same sentence/);
    assert.match(full, /NEVER say that check line a third time/);
    assert.match(full, /If the caller is STILL silent after that, the code will end the call/);
    assert.match(full, /While waiting, say NOTHING at all/);
    // The OLD rule ("say that check line EXACTLY ONCE per call") must be gone.
    // Scoped to the CHECK line: the thank-you is still spoken EXACTLY ONCE per
    // call, and that rule must survive this change.
    assert.doesNotMatch(full, /check line EXACTLY ONCE/i);
    assert.match(full, /spoken EXACTLY ONCE per call/, 'the thank-you rule is untouched');

    // Fast-connect instruction (the one live at call start): same rule in English.
    assert.match(fast, /ask "are you still there\?" then listen/);
    assert.match(fast, /it a second time ~5s later — say the SAME line again, word for word/);
    assert.match(fast, /If they are still silent after that, call endCall/);
    assert.match(fast, /Never say that check line a third time/);

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
    assert.match(OUTBOUND_THANKS_FALLBACK_NUDGE, /ONE short thank-you/);
    assert.match(OUTBOUND_THANKS_FALLBACK_NUDGE, /YOUR OWN WORDS/);
    assert.match(OUTBOUND_THANKS_FALLBACK_NUDGE, /exactly ONCE/);
    assert.doesNotMatch(OUTBOUND_THANKS_FALLBACK_NUDGE, /endCall/);
  });

  it('the prompt bans confirm-questions and the future sign-off on both instructions', () => {
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026');
    const full = buildOutboundSystemInstruction('30 Sep 2026');
    // The FAST CONNECT instruction is the one live for the opening turn, so both
    // bans have to live there too — not only in the long reconnect prompt.
    for (const prompt of [fast, full]) {
      assert.match(prompt, /NEVER ask (?:them|the caller) to confirm what they just said/);
      assert.match(prompt, /did you say yes sir\?/);
      assert.match(prompt, /if you want a site in the future/);
      assert.match(prompt, /consider Alliance Square/);
    }
    // The sales-team close is never allowed to end without the thank-you.
    assert.match(fast, /the thank-you ALWAYS follows it/);
    assert.match(full, /the ONLY thing you may say is the thank-you line/);
  });

  it('the handoff nudge forbids any sentence after the thank-you', () => {
    const nudge = buildOutboundHandoffTransferNudge();
    assert.match(nudge, /After the thank-you say NOTHING/);
    assert.match(nudge, /exactly ONCE/i);
    assert.match(nudge, /sales team/i);
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
      assert.match(flat, /ONLY repeat request (?:you ever make|on this call)/i);
      assert.match(flat, /NEVER ask them to repeat/i);
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
    assert.equal(honorificForName(null), HONORIFIC_SIR_KN, 'unknown name → sir, never ma’am');
    assert.equal(honorificForName(''), HONORIFIC_SIR_KN);
    assert.equal(honorificForName('Xyzzy'), HONORIFIC_SIR_KN, 'unknown name → sir');
  });

  it('builds the address the caller actually hears', () => {
    assert.equal(nameWithHonorific('Ravi'), 'Ravi ಸರ್');
    assert.equal(nameWithHonorific('Lakshmi'), 'Lakshmi ಮಾಮ್');
    assert.equal(nameWithHonorific(null), '');
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
    assert.ok(projects.includes('Ravi ಸರ್'));
    // Feminine names must produce ma'am, not sir.
    assert.ok(buildOutboundProjectsNudge('Lakshmi', HONORIFIC_MAAM_KN).includes('Lakshmi ಮಾಮ್'));
    // Never thank them at the projects step — the engine treats ಧನ್ಯವಾದ as
    // "close the call", so thanking here would hang up before the transfer.
    assert.ok(!PDF_AREAS_LINE_KN.includes('ಧನ್ಯವಾದ'));
    assert.ok(!PDF_INTEREST_QUESTION_KN.includes('ಧನ್ಯವಾದ'));
    // The thank-you belongs to the close, which is what ends the call.
    assert.match(PDF_THANKS_CLOSE_KN, /ಧನ್ಯವಾದ/);
    assert.ok(!PDF_HANDOFF_LINE_KN.includes('ಧನ್ಯವಾದ'), 'the sales line carries no thanks');
  });

  it('the nudges ask for the name, then tell them about the projects', () => {
    // The nudge MUST quote the line: with no Kannada to anchor it, the agent improvised "ನಮ್ಗೆ ಹೆಸರು ಏನು ಸರ್?" instead of the correct "ನಿಮ್ಮ ಹೆಸರು ಏನು ಸರ್?" on a real call.
    // It still says YOUR OWN WORDS, so this is a reference wording, not a recital.
    assert.ok(
      OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_NAME_QUESTION_KN),
      'the name nudge must carry the real Kannada sentence',
    );
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /Say ONLY this one short question/);
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /STOP and WAIT/);
    // The site question already rode in the opening, so the name nudge must
    // not re-ask it and must not jump to the projects.
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /no project list/i);
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.ok(projects.includes(PDF_AREAS_LINE_KN), 'must tell them the projects');
    assert.ok(projects.includes(PDF_INTEREST_QUESTION_KN), 'must ask the one interest question');
    assert.ok(projects.includes('Ravi ಸರ್'), 'must address them by name');
    const maam = buildOutboundProjectsNudge('Lakshmi', HONORIFIC_MAAM_KN);
    assert.ok(maam.includes('Lakshmi ಮಾಮ್'), 'must use maam for a feminine name');
    // No name → still tell the projects, addressed as sir.
    const anon = buildOutboundProjectsNudge(null, HONORIFIC_SIR_KN);
    assert.ok(anon.includes(PDF_AREAS_LINE_KN));
    // ಧನ್ಯವಾದ in the projects turn would end the call early, so it is banned.
    assert.doesNotMatch(projects, /ಧನ್ಯವಾದ\s*"?\s*$/);
    const declined = buildOutboundNameDeclinedNudge(HONORIFIC_SIR_KN);
    assert.ok(declined.includes(PDF_AREAS_LINE_KN));
    assert.match(declined, /Do NOT ask again/);
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
      assert.match(flat, /ASK THEIR NAME|ask their NAME/i);
      assert.match(flat, /never press|do not press/i);
      // The prompt must carry the opening that is actually SPOKEN, so the
      // model is never told to skip the site question and ask it later.
      assert.ok(
        flat.includes(PDF_OPENING_TURN1_KN),
        'the prompt must carry the real spoken opening (intro + site question)',
      );
      assert.ok(flat.includes(PDF_SITE_QUESTION_KN));
      // ...and it must say the site question is asked ONCE, in the opening.
      assert.match(flat, /never again|asked once/i);
      // The bare intro alone is no longer the first line anywhere in the prompt.
      assert.ok(
        !flat.includes(`FIRST LINE: "${PDF_OPENING_INTRO_KN}"`),
        'the prompt must not hand her an opening that drops the site question',
      );
    }
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
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /nothing before it, nothing after it/);
  });

  it('both prompts ban a reaction before the line the script asks for', () => {
    for (const flat of [full, fast]) {
      assert.match(flat, /GET TO THE POINT/);
      // The exact words the caller complained about, named as banned openers.
      assert.match(flat, /"like that"/);
      assert.match(flat, /"ohh"/);
      assert.match(flat, /ಅಹಾ/);
      assert.match(flat, /a SIGNAL, not something to react to/i);
    }
  });

  it('the name nudge sends her straight to the name question', () => {
    const flat = OUTBOUND_NAME_QUESTION_NUDGE.replace(/\s+/g, ' ');
    assert.match(flat, /Say ONLY this one short question/);
    assert.match(flat, /nothing before it, nothing after it/);
    assert.match(flat, /not something to react to/i);
    assert.match(flat, /"like that"/);
    assert.match(flat, /STOP and WAIT for their name/);
  });

  it('after the name she thanks in ONE word and goes straight to the locations', () => {
    const projects = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN).replace(/\s+/g, ' ');
    assert.ok(projects.includes(PDF_ACK_KN), 'the acknowledgement word must be anchored');
    assert.ok(
      projects.includes(`single Kannada word "${PDF_ACK_KN}"`),
      'the acknowledgement must be pinned to the one Kannada word',
    );
    assert.match(projects, /NOT a sentence/);
    assert.match(projects, /Ravi ಸರ್/);
    assert.ok(projects.includes(PDF_AREAS_LINE_KN));
    assert.ok(projects.includes(PDF_INTEREST_QUESTION_KN));
    // She must not re-ask what the caller already answered.
    assert.match(projects, /Do NOT re-ask the site question/);
    // "Speak NOW" — the caller's complaint was silence after the name.
    assert.match(projects, /Speak NOW/);
    assert.match(projects, /do not react to the name/i);
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
    assert.match(flat, /Do NOT ask again/);
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
    assert.equal(extractCallerName('ನಿಮ್ಮ ಹೆಸರು ಏನು ಸರ್'), null);
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
    assert.ok(!OUTBOUND_CLEAN_CLOSE_NUDGE.includes(PDF_HANDOFF_LINE_KN));
    assert.ok(!OUTBOUND_CLEAN_CLOSE_NUDGE.includes(PDF_THANKS_CLOSE_KN));
    assert.match(OUTBOUND_CLEAN_CLOSE_NUDGE, /exactly ONCE/i);
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
      assert.match(flat, /last thing you say|LAST thing you ever say/i);
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

  it('the name-question retry asks the same single question and nothing else', () => {
    const n = OUTBOUND_NAME_QUESTION_RETRY_NUDGE;
    assert.ok(n.includes(PDF_NAME_QUESTION_KN), 'must carry the exact name question');
    assert.match(n, /NO sound/i);
    assert.equal(n.includes(PDF_AREAS_LINE_KN), false, 'must not list the projects');
  });

  it('the projects retry carries the name, the areas and the interest question', () => {
    const n = buildOutboundProjectsRetryNudge('Ravi', HONORIFIC_SIR_KN);
    assert.ok(n.includes(nameWithHonorific('Ravi')), 'must address the caller by name');
    assert.ok(n.includes(PDF_ACK_KN), 'must use the one-word acknowledgement');
    assert.ok(n.includes(PDF_AREAS_LINE_KN), 'must carry the projects line');
    assert.ok(n.includes(PDF_INTEREST_QUESTION_KN), 'must carry the interest question');
    assert.match(n, /NO sound/i);
    assert.match(n, /NEVER say thank you/i);
  });

  it('the projects retry without a name falls back to the honorific alone', () => {
    const n = buildOutboundProjectsRetryNudge(null, HONORIFIC_SIR_KN);
    assert.ok(n.includes(HONORIFIC_SIR_KN));
    assert.ok(n.includes(PDF_AREAS_LINE_KN));
    assert.equal(n.includes('undefined'), false);
  });
});
