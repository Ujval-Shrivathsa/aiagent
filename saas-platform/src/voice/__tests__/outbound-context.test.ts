import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOutboundResumeNudge,
  deriveOutboundConversationMemory,
  looksLikeContextInterrupt,
  looksLikeIdentityQuestion,
} from '../Outbound/context-flow';
import { PDF_OPENING, PDF_PURPOSE_QUESTION } from '../Outbound/callguide';

describe('outbound context flow', () => {
  it('detects identity questions', () => {
    assert.equal(looksLikeIdentityQuestion('Who are you?'), true);
    assert.equal(looksLikeIdentityQuestion('Which company is this?'), true);
    assert.equal(looksLikeIdentityQuestion('yes investment'), false);
  });

  it('detects context interrupts but not short replies', () => {
    assert.equal(looksLikeContextInterrupt('Who are you?'), true);
    assert.equal(looksLikeContextInterrupt('What time is it?'), true);
    assert.equal(looksLikeContextInterrupt('yes'), false);
  });

  it('tracks conversation memory from AI turns', () => {
    const afterOpening = deriveOutboundConversationMemory(PDF_OPENING);
    assert.match(afterOpening.topic, /residential site/i);
    assert.equal(afterOpening.pendingQuestion, PDF_OPENING);

    const afterPurpose = deriveOutboundConversationMemory(PDF_PURPOSE_QUESTION, afterOpening);
    assert.match(afterPurpose.topic, /investment/i);
    assert.equal(afterPurpose.pendingQuestion, PDF_PURPOSE_QUESTION);

    const afterPitch =
      'We have two projects on Hunsur Road and T. Narasipura Road. Would you like to know more about these projects?';
    const mem = deriveOutboundConversationMemory(afterPitch, afterPurpose);
    assert.match(mem.pendingQuestion, /know more about these projects/i);
  });

  it('builds resume nudge with pending topic', () => {
    const nudge = buildOutboundResumeNudge({
      topic: 'investment projects',
      pendingQuestion: 'Would you like to know more about these projects?',
      lastAiUtterance: '',
    });
    assert.match(nudge, /investment projects/);
    assert.match(nudge, /Would you like to know more/);
  });
});
