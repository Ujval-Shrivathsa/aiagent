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
  HONORIFIC_SIR_KN,
  HONORIFIC_MAAM_KN,
  extractCallerName,
  honorificForName,
  nameWithHonorific,
  looksLikeNameRefusal,
  OUTBOUND_NAME_QUESTION_NUDGE,
  buildOutboundProjectsNudge,
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
    assert.match(PDF_OPENING_KN, /ಸೈಟ್ ನೋಡ್ತಿದೀರಾ ಸರ್\?/); // the site question IS in the opening
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

  it('interest question asked after the locations line (fresh phrasing each call)', () => {
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
    assert.match(afterOpening.pendingQuestion, /ಸೈಟ್ ನೋಡ/);
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

describe('silence state machine — one check line, then the call ends', () => {
  it('5s quiet → check line ONCE; still silent 5s later → the call ends', () => {
    // OWNER-SPECIFIED LADDER: 5s quiet → "are you still on the line?", then
    // 5s more → a short goodbye and the call ends. The call is therefore over
    // at 10 SECONDS OF TOTAL SILENCE. Probing at 2s was tried and rejected: it
    // landed while callers were still finding the phone and read as impatience.
    assert.equal(SILENCE_CHECK_AFTER_MS, 5_000);
    assert.equal(SILENCE_CLOSE_AFTER_CHECK_MS, 5_000);
    assert.equal(
      SILENCE_CHECK_AFTER_MS + SILENCE_CLOSE_AFTER_CHECK_MS,
      10_000,
      'the call must end at 10s of total silence',
    );

    const start = 1000;
    let s = armOutboundSilenceCheck(start);
    let t = tickOutboundSilence(s, start + 4_900);
    assert.equal(t.action, 'none', 'quiet inside the 5s window does nothing');
    t = tickOutboundSilence(s, start + 5_100);
    assert.equal(t.action, 'speak_check', '5s quiet → the ONE availability check');
    s = t.state;
    assert.equal(s.reason, 'checked');
    assert.ok(s.deadline != null, 'a final wait window is armed for the answer');
    // Still silent inside that window → nothing at all.
    t = tickOutboundSilence(s, start + 9_900);
    assert.equal(t.action, 'none', 'second window still quiet → no talking at all');
    // The check line went unanswered → terminate at 10s total, exactly once.
    t = tickOutboundSilence(s, start + 10_100);
    assert.equal(t.action, 'close_silence', 'unanswered check ends the call');
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
    assert.match(fast, /Match the caller/i);
    // Also present in the full instruction used on reconnect.
    assert.match(buildOutboundSystemInstruction('30 Sep 2026'), /HOW YOU SOUND/);
  });

  it('prompt: silence means ask once, then end the call', () => {
    // Prompts are line-wrapped, so compare against a whitespace-normalised copy.
    const full = buildOutboundSystemInstruction('30 Sep 2026').replace(/\s+/g, ' ');
    const fast = buildOutboundFastConnectInstruction('30 Sep 2026').replace(/\s+/g, ' ');

    // Full instruction (Kannada check line): said ONCE, never repeated, then endCall.
    assert.match(full, /say the check line ONCE/);
    assert.match(full, /Say that check line EXACTLY ONCE per call/);
    assert.match(full, /If the caller is STILL silent afterwards, the call is over/);
    assert.match(full, /While waiting, say NOTHING at all/);

    // Fast-connect instruction (the one live at call start): same rule in English.
    assert.match(fast, /ask "are you still there\?" ONCE, then listen/);
    assert.match(fast, /If they are still silent after that, call endCall/);
    assert.match(fast, /Never repeat that check line/);

    // Neither may still claim silence never ends the call.
    for (const prompt of [full, fast]) {
      assert.doesNotMatch(prompt, /SILENCE NEVER ENDS THE CALL/);
      assert.doesNotMatch(prompt, /silence timeout/i);
    }
    assert.match(full, /YOU END THE CALL/);
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
    // The nudge must NOT quote the line — it must tell the agent to ask the name
    // in her own words. Quoting it is exactly the robotic recital this replaced.
    assert.ok(
      !OUTBOUND_NAME_QUESTION_NUDGE.includes(PDF_NAME_QUESTION_KN),
      'the name nudge is guidance, not a line to recite',
    );
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /YOUR OWN WORDS/);
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /STOP and WAIT/);
    // The site question already rode in the opening, so the name nudge must
    // not re-ask it and must not jump to the projects.
    assert.match(OUTBOUND_NAME_QUESTION_NUDGE, /do not list the projects/i);
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

  it('both prompts describe the three-turn opening', () => {
    for (const prompt of [
      buildOutboundFastConnectInstruction('30 Sep 2026'),
      buildOutboundSystemInstruction('30 Sep 2026'),
    ]) {
      const flat = prompt.replace(/\s+/g, ' ');
      assert.match(flat, /ASK THEIR NAME|ask their NAME once/i);
      assert.match(flat, /never press|do not press/i);
      assert.ok(flat.includes(PDF_OPENING_INTRO_KN));
      assert.ok(flat.includes(PDF_SITE_QUESTION_KN));
    }
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
      assert.match(flat, /Never repeat it/);
      assert.match(flat, /call endCall/i);
    }
  });
});
