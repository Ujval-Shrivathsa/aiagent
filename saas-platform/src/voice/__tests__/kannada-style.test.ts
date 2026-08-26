/**
 * Kannada persona / opening unit tests.
 * Run: npx tsx --test src/voice/__tests__/kannada-style.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutboundKannadaOpening,
  OUTBOUND_OPENING_QUESTION_KN,
  OUTBOUND_PURPOSE_QUESTION_KN,
  OUTBOUND_PURPOSE_QUESTION_EN,
  inboundGreetingSpeakInstruction,
  outboundGreetingSpeakInstruction,
  KANNADA_ANSWER_SITE_RULES,
  KANNADA_THROUGHOUT_RULES,
  LANGUAGE_FOLLOW_RULES,
  MYSORE_NATIVE_DIALECT,
  SITE_DETAIL_DISCLOSURE_RULES,
  SIMPLE_KANNADA_STYLE,
  VOICE_DELIVERY_STYLE,
  TURN_TAKING_STYLE,
  NO_INVENTION_RULES,
  SILENCE_AND_WAITING_BEHAVIOR,
} from '../kannada-style';

describe('outbound Kannada opening', () => {
  it('uses short simple Kannada beats and ends with listen question', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /^ನಮಸ್ಕಾರ/);
    assert.match(opening, /ಭೂಮಿ/);
    assert.match(opening, /Alliance Square/);
    assert.match(opening, /ಮಾತಾಡ್ತಿದ್ದೀನಿ/);
    assert.match(opening, /Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.ok(opening.length < 200, 'opening should stay short');
  });

  it('includes customer name when provided', () => {
    const opening = buildOutboundKannadaOpening('Manjunath');
    assert.match(opening, /ನಮಸ್ಕಾರ Manjunath/);
  });

  it('stays neutral when no name or gender is known', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /^ನಮಸ್ಕಾರ/);
    assert.doesNotMatch(opening, /ನಮಸ್ಕಾರ ಸರ್/);
  });

  it('speak instruction demands Mysuru local Kannada and stop after question', () => {
    const instr = outboundGreetingSpeakInstruction('Prajwal');
    assert.match(instr, /Prajwal/);
    assert.match(instr, /pakka Mysuru Kannadiga/i);
    assert.match(instr, /Unhurried pace/i);
    assert.match(instr, /STOP and listen/i);
  });
});

describe('Mysuru dialect and site details', () => {
  it('defines pakka Kannadiga local voice', () => {
    assert.match(MYSORE_NATIVE_DIALECT, /PAKKA KANNADIGA/);
    assert.match(MYSORE_NATIVE_DIALECT, /Mysuru Kannada first/);
  });

  it('requires full site detail when customer asks for details', () => {
    assert.match(SITE_DETAIL_DISCLOSURE_RULES, /FULL detail|FULL factual|ALL available facts/i);
    assert.match(SITE_DETAIL_DISCLOSURE_RULES, /4–8 short spoken sentences/);
    assert.match(KANNADA_ANSWER_SITE_RULES, /FULL detail from PROJECT REFERENCE/);
  });
});

describe('shared style blocks', () => {
  it('locks Kannada throughout unless clear English switch', () => {
    assert.match(KANNADA_THROUGHOUT_RULES, /KANNADA THROUGHOUT THE CALL/);
    assert.match(LANGUAGE_FOLLOW_RULES, /STAYS the default until a clear English switch/);
  });

  it('requires Kannada answers with site names when customer asks', () => {
    assert.match(KANNADA_ANSWER_SITE_RULES, /ANSWER CUSTOMER QUESTIONS IN KANNADA/);
    assert.match(KANNADA_ANSWER_SITE_RULES, /UK Square rate 3300 to 3400 per sqft/);
    assert.match(KANNADA_ANSWER_SITE_RULES, /ಯಾವ projects ಇವೆ/);
  });

  it('forbids choppy IVR delivery and requires simple Kannada', () => {
    assert.match(VOICE_DELIVERY_STYLE, /sound human on a real phone call/);
    assert.match(VOICE_DELIVERY_STYLE, /NATURAL PROSODY/);
    assert.match(VOICE_DELIVERY_STYLE, /unhurried/i);
    assert.match(VOICE_DELIVERY_STYLE, /STOP and listen/i);
    assert.match(SIMPLE_KANNADA_STYLE, /Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.match(SIMPLE_KANNADA_STYLE, /Think in Kannada/i);
    assert.match(SIMPLE_KANNADA_STYLE, /START THE CALL IN KANNADA/i);
    assert.match(SIMPLE_KANNADA_STYLE, /JUST AS effortless/i);
    assert.match(SIMPLE_KANNADA_STYLE, /Kanglish/i);
    assert.match(SIMPLE_KANNADA_STYLE, /ENGLISH ↔ KANNADA PARITY/);
    assert.match(TURN_TAKING_STYLE, /stop speaking/i);
    assert.match(TURN_TAKING_STYLE, /Intro beat → ONE question → Stop → Listen/);
  });

  it('forbids inventing customer intent', () => {
    assert.match(NO_INVENTION_RULES, /NEVER invent/i);
    assert.match(NO_INVENTION_RULES, /site visit/i);
  });

  it('teaches silence vs explicit wait', () => {
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /explicit request to wait/i);
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /5 seconds/i);
    assert.match(SILENCE_AND_WAITING_BEHAVIOR, /not interested/i);
  });

  it('opening retry question is Kannada', () => {
    assert.match(OUTBOUND_OPENING_QUESTION_KN, /Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ/);
  });

  it('purpose question mirrors English in Kanglish', () => {
    assert.match(OUTBOUND_PURPOSE_QUESTION_KN, /construction site ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.match(OUTBOUND_PURPOSE_QUESTION_KN, /investment site ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.doesNotMatch(OUTBOUND_PURPOSE_QUESTION_KN, /ಹೂಡಿಕೆ/);
    assert.match(OUTBOUND_PURPOSE_QUESTION_EN, /construction or are you looking for investment/i);
  });

  it('inbound greeting instruction is Kannada-first and calm', () => {
    const instr = inboundGreetingSpeakInstruction(null);
    assert.match(instr, /Kannada/);
    assert.match(instr, /ನಮಸ್ಕಾರ/);
    assert.match(instr, /STOP/);
  });
});
