/**
 * Kannada persona / opening unit tests.
 * Run: npx tsx --test src/voice/__tests__/kannada-style.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutboundKannadaOpening,
  OUTBOUND_OPENING_QUESTION_KN,
  inboundGreetingSpeakInstruction,
  outboundGreetingSpeakInstruction,
  SIMPLE_KANNADA_STYLE,
  VOICE_DELIVERY_STYLE,
  TURN_TAKING_STYLE,
  NO_INVENTION_RULES,
  SILENCE_AND_WAITING_BEHAVIOR,
} from '../kannada-style';

describe('outbound Kannada opening', () => {
  it('uses short simple Kannada beats and ends with listen question', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /ನಮಸ್ಕಾರ/);
    assert.match(opening, /ಭೂಮಿ/);
    assert.match(opening, /Alliance Square/);
    assert.match(opening, /plot ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.ok(opening.length < 160, 'opening should stay short');
  });

  it('includes customer name when provided', () => {
    const opening = buildOutboundKannadaOpening('Manjunath');
    assert.match(opening, /ನಮಸ್ಕಾರ Manjunath/);
  });

  it('stays neutral when no name or gender is known', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /ನಮಸ್ಕಾರ,/);
    assert.doesNotMatch(opening, /ನಮಸ್ಕಾರ ಸರ್/);
  });

  it('speak instruction demands Kannada-first and stop after question', () => {
    const instr = outboundGreetingSpeakInstruction('Prajwal');
    assert.match(instr, /Prajwal/);
    assert.match(instr, /Kannada/i);
    assert.match(instr, /STOP/i);
    assert.match(instr, /do NOT open in English/i);
  });
});

describe('shared style blocks', () => {
  it('forbids theatrical delivery and requires simple Kannada', () => {
    assert.match(VOICE_DELIVERY_STYLE, /Enthusiasm ~4\.5/);
    assert.match(VOICE_DELIVERY_STYLE, /Do NOT exaggerate/);
    assert.match(SIMPLE_KANNADA_STYLE, /do NOT think in English and translate/i);
    assert.match(SIMPLE_KANNADA_STYLE, /START THE CALL IN KANNADA/i);
    assert.match(TURN_TAKING_STYLE, /stop speaking/i);
    assert.match(TURN_TAKING_STYLE, /Speak → Ask → Stop → Listen/);
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
    assert.match(OUTBOUND_OPENING_QUESTION_KN, /ನೋಡ್ತಿದ್ದೀರಾ/);
  });

  it('inbound greeting instruction is Kannada-first and calm', () => {
    const instr = inboundGreetingSpeakInstruction(null);
    assert.match(instr, /Kannada/);
    assert.match(instr, /ನಮಸ್ಕಾರ/);
    assert.match(instr, /STOP/);
  });
});
