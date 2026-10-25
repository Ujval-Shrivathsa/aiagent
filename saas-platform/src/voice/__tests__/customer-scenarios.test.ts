/**
 * Real-customer scenarios — act like a stranger on the phone and assert the
 * decision layer routes correctly (no name ask, no ignored answers, etc.).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_OPENING_EN,
  PDF_AREAS_LINE_KN,
  PDF_AREAS_LINE_EN,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE,
  OUTBOUND_SILENCE_CHECK_NUDGE,
  buildOutboundLocationInterestNudge,
  buildOutboundRepeatQuestionNudge,
  buildOutboundIdentityAnswerNudge,
  detectOutboundLocality,
  looksLikeAnswerToSiteQuestion,
  looksLikeSpokenNameQuestion,
  looksLikeRepeatRequest,
  looksLikeCustomerBusy,
  looksLikeIdentityQuestion,
  nameQuestionAudioGate,
  promptLeaksNameQuestionExample,
  getOutboundGreetingInstruction,
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  VOICE_BEHAVIOR_VERSION,
} from '../kannada-script';
import {
  isCustomerTurnSignal,
  looksLikeOpeningEcho,
  isShortAffirmativeReply,
  isLikelySttNoise,
} from '../short-reply';
import { reviewCallerTurn, agentToldCallerToRepeat } from '../turn-verifier';

/** What the engine should do after the opening, for a caller utterance. */
function nextAfterOpening(caller: string): 'locations' | 'location_fact' | 'decline' | 'busy' | 'repeat' | 'identity' | 'ignore' | 'listen' {
  const t = String(caller || '').trim();
  if (!t || isLikelySttNoise(t)) return 'ignore';
  if (looksLikeOpeningEcho(t) && !looksLikeAnswerToSiteQuestion(t)) return 'ignore';
  if (looksLikeRepeatRequest(t)) return 'repeat';
  if (looksLikeIdentityQuestion(t)) return 'identity';
  if (looksLikeCustomerBusy(t)) return 'busy';
  if (
    (/\b(not interested|don'?t want|stop calling)\b/i.test(t) || /(?:ಬೇಡ|ಇಲ್ಲ)/.test(t)) &&
    !looksLikeAnswerToSiteQuestion(t)
  ) {
    return 'decline';
  }
  if (isShortAffirmativeReply(t) || looksLikeAnswerToSiteQuestion(t)) {
    const place = detectOutboundLocality(t);
    return place ? 'location_fact' : 'locations';
  }
  return 'listen';
}

describe('customer scenarios — stranger on the phone', () => {
  it('opening is the owner English line and never embeds a name question', () => {
    assert.equal(
      PDF_OPENING_EN,
      "Hello, I'm Priya from Alliance Square. Are you looking for a site in Mysuru?",
    );
    const g = getOutboundGreetingInstruction('en');
    assert.ok(g.includes(PDF_OPENING_EN));
    assert.match(g, /muted until you finish/);
    assert.match(g, /Only AFTER the last word/);
    assert.equal(promptLeaksNameQuestionExample(g), false);
    assert.equal(promptLeaksNameQuestionExample(buildOutboundSystemInstruction('1 Jan 2026')), false);
    assert.equal(promptLeaksNameQuestionExample(buildOutboundFastConnectInstruction('1 Jan 2026')), false);
    assert.match(VOICE_BEHAVIOR_VERSION, /answer-questions/);
  });

  it('plain yes goes to locations — never a name ask', () => {
    for (const said of ['yes', 'Yeah', 'ಹೌದು', 'houda', 'ok', 'ಸರಿ']) {
      assert.equal(nextAfterOpening(said), 'locations', said);
      assert.equal(looksLikeSpokenNameQuestion(OUTBOUND_YES_LOCATIONS_NUDGE), false);
      assert.ok(!OUTBOUND_YES_LOCATIONS_NUDGE.includes('ಹೆಸರು'));
    }
    assert.ok(OUTBOUND_YES_LOCATIONS_NUDGE.includes(PDF_AREAS_LINE_KN));
    assert.ok(OUTBOUND_YES_LOCATIONS_NUDGE.includes(PDF_AREAS_LINE_EN));
  });

  it('real customer: "Yes, I\'m looking for a site in Hunsur" is heard and routes to Hunsur fact', () => {
    const said = "Yes, I'm looking for a site in Hunsur";
    assert.equal(looksLikeOpeningEcho(said), false, 'must not treat answer as opening echo');
    assert.equal(isCustomerTurnSignal(said), true, 'must count as a real customer turn');
    assert.equal(looksLikeAnswerToSiteQuestion(said), true);
    assert.equal(detectOutboundLocality(said), 'hunsur');
    assert.equal(nextAfterOpening(said), 'location_fact');
    const nudge = buildOutboundLocationInterestNudge('hunsur');
    assert.match(nudge, /Speak the location fact/);
    assert.doesNotMatch(nudge, /ಹೆಸರು/);
  });

  it('Kannada interest is heard, not ignored as echo', () => {
    const said = 'ಹೌದು ಸರ್, ಮೈಸೂರಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದ್ದೀನಿ';
    assert.equal(looksLikeOpeningEcho(said), false);
    assert.equal(isCustomerTurnSignal(said), true);
    assert.equal(nextAfterOpening(said), 'locations');
  });

  it('decline and busy close cleanly', () => {
    assert.equal(nextAfterOpening('not interested'), 'decline');
    assert.equal(nextAfterOpening('ಇಲ್ಲ ಬೇಡ'), 'decline');
    assert.equal(nextAfterOpening('I am busy right now'), 'busy');
    assert.match(OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE, /endCall/);
  });

  it('silence stays quiet — never invents tell-me-once-more', () => {
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /Say NOTHING/);
    assert.match(OUTBOUND_SILENCE_CHECK_NUDGE, /tell me once more/i);
    assert.equal(agentToldCallerToRepeat('tell me once more please'), true);
    assert.equal(agentToldCallerToRepeat(PDF_AREAS_LINE_KN), false);
  });

  it('unclear speech / noise is ignored; explicit cannot-hear repeats once', () => {
    assert.equal(nextAfterOpening('uhm'), 'ignore');
    assert.equal(nextAfterOpening('uh'), 'ignore');
    assert.equal(nextAfterOpening(''), 'ignore');
    assert.equal(nextAfterOpening("I couldn't hear you"), 'repeat');
    assert.equal(nextAfterOpening('ಮತ್ತೆ ಹೇಳಿ'), 'repeat');
    const nudge = buildOutboundRepeatQuestionNudge(PDF_OPENING_EN);
    assert.ok(nudge.includes(PDF_OPENING_EN));
    assert.doesNotMatch(nudge, /ಹೆಸರು/);
  });

  it('who are you → identity answer, not a name ask of the caller', () => {
    assert.equal(looksLikeIdentityQuestion('Who are you?'), true);
    assert.equal(nextAfterOpening('Who are you?'), 'identity');
    const id = buildOutboundIdentityAnswerNudge();
    assert.match(id, /Priya/);
    assert.doesNotMatch(id, /ಹೆಸರು/);
    assert.equal(promptLeaksNameQuestionExample(id), false);
  });

  it('confusing: why are you asking / echo of the question', () => {
    const why = reviewCallerTurn({
      text: 'why are you asking?',
      areasDelivered: false,
      lastAgentLine: PDF_OPENING_EN,
    });
    assert.equal(why.intent, 'why_asking');
    assert.equal(why.plan.action, 'explain_why');

    const echo = reviewCallerTurn({
      text: 'ನಿಮಗೆ ಮೈಸೂರಿನಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದೀರಾ?',
      areasDelivered: false,
      lastAgentLine: 'ನಿಮಗೆ ಮೈಸೂರಿನಲ್ಲಿ ಸೈಟ್ ನೋಡ್ತಿದೀರಾ?',
    });
    assert.equal(echo.intent, 'echo_waiting');
    assert.equal(echo.plan.action, 'wait_after_echo');
  });

  it('if the model invents a name question, the gate drops it every time', () => {
    for (const invented of [
      'ನಿಮ್ಮ ಹೆಸರು ಏನು?',
      'what is your name please',
      'can I get your name',
      'आपका नाम क्या है?',
      'nimma hesaru enu',
    ]) {
      assert.equal(looksLikeSpokenNameQuestion(invented), true, invented);
      assert.equal(nameQuestionAudioGate(invented), 'drop', invented);
      assert.equal(
        nameQuestionAudioGate(`ಸರಿ ${invented}`, { areasDelivered: false }),
        'drop',
        invented,
      );
    }
    // Before locations, a long non-script preamble must not release.
    assert.equal(
      nameQuestionAudioGate('Okay so before we continue I wanted to ask you something', {
        areasDelivered: false,
      }),
      'hold',
    );
  });

  it('agent opening echo is still blocked; customer interest is not', () => {
    assert.equal(looksLikeOpeningEcho("Hello, I'm Priya from Alliance Square"), true);
    assert.equal(isCustomerTurnSignal("Hello, I'm Priya from Alliance Square"), false);
    assert.equal(looksLikeOpeningEcho('ನೀವು Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ?'), true);
    assert.equal(isCustomerTurnSignal("Yes looking for a plot near Hunsur road"), true);
  });
});
