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
} from '../kannada-style';

describe('outbound Kannada opening', () => {
  it('uses short simple Kannada beats and ends with listen question', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /ನಮಸ್ಕಾರ/);
    assert.match(opening, /Bhoomi/);
    assert.match(opening, /Alliance Square/);
    assert.match(opening, /ನೋಡ್ತಿದ್ದೀರಾ/);
    assert.ok(opening.length < 220, 'opening should stay short');
  });

  it('includes customer name when provided', () => {
    const opening = buildOutboundKannadaOpening('Manjunath');
    assert.match(opening, /Manjunath/);
    assert.match(opening, /ಸರ್/);
  });

  it('stays neutral when no name or gender is known', () => {
    const opening = buildOutboundKannadaOpening(null);
    assert.match(opening, /ನಮಸ್ಕಾರ/);
    assert.doesNotMatch(opening, /ನಮಸ್ಕಾರ ಸರ್/);
  });

  it('speak instruction demands calm delivery and stop-after-question', () => {
    const instr = outboundGreetingSpeakInstruction('Manjunath');
    assert.match(instr, /calm/i);
    assert.match(instr, /STOP/i);
    assert.match(instr, /excitement/i);
    assert.match(instr, /ನಮಸ್ಕಾರ/);
  });
});

describe('shared style blocks', () => {
  it('forbids theatrical delivery and requires simple Kannada', () => {
    assert.match(VOICE_DELIVERY_STYLE, /Enthusiasm ~4\.5/);
    assert.match(VOICE_DELIVERY_STYLE, /Do NOT exaggerate/);
    assert.match(SIMPLE_KANNADA_STYLE, /do NOT think in English and translate/i);
    assert.match(SIMPLE_KANNADA_STYLE, /professional everyday Kannada/i);
    assert.match(TURN_TAKING_STYLE, /stop speaking/i);
    assert.match(TURN_TAKING_STYLE, /First ~30 seconds/);
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
