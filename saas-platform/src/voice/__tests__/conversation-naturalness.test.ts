/**
 * Conversation naturalness + telemetry regression suite.
 *
 * These tests exist to protect the INVARIANTS, not the exact phrases: a
 * Kannada variant may be added, replaced or removed after native-speaker review
 * without rewriting this file — but the safety rules below may never bend.
 *
 * The single most important assertion in here is that no acknowledgement can
 * ever contain a thanks-style close. ಧನ್ಯವಾದ is the engine's end-of-call
 * trigger, so an acknowledgement that trips it would hang the call up before
 * the caller ever heard what we have.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACK_MAX_WORDS,
  ACK_VARIANTS_KN,
  acknowledgementWithName,
  buildToneDirective,
  chooseAcknowledgement,
  createRecentSpoken,
  DEFAULT_ACK_WORD_KN,
  detectCallerSignal,
  isSafeAcknowledgement,
  pickUnspoken,
  rememberSpoken,
  wasSpoken,
  type CallerSignal,
} from '../conversation-naturalness';
import {
  buildOutboundProjectsNudge,
  buildOutboundProjectsRetryNudge,
  hasThanksClosing,
  HONORIFIC_MAAM_KN,
  HONORIFIC_SIR_KN,
  nameWithHonorific,
} from '../kannada-script';
import {
  aggregateRecent,
  createCallTelemetry,
  opaqueCallId,
  publishCall,
  recentCalls,
  recordAck,
  recordAgentTurn,
  recordBargeIn,
  recordCallerSpeechEnd,
  recordEnd,
  recordLanguageSwitch,
  recordLateReplyRescue,
  recordRepair,
  recordSilenceCheck,
  resetRecentCalls,
  summarize,
} from '../call-telemetry';

describe('acknowledgement system: curated, small, and safe', () => {
  test('the set is deliberately small — a beat, not a vocabulary', () => {
    assert.ok(
      ACK_VARIANTS_KN.length >= 3,
      'there must be more than one phrase or nothing is curating anything',
    );
    assert.ok(
      ACK_VARIANTS_KN.length <= 6,
      `the set grew to ${ACK_VARIANTS_KN.length}; a phone call needs a beat, not a vocabulary`,
    );
  });

  test('EVERY variant is safe: short, and never a thanks-style close', () => {
    for (const v of ACK_VARIANTS_KN) {
      assert.ok(v.text.trim().length > 0, 'a variant cannot be empty');
      assert.ok(
        v.text.split(/\s+/).length <= ACK_MAX_WORDS,
        `"${v.text}" is ${v.text.split(/\s+/).length} words; the cap is ${ACK_MAX_WORDS}`,
      );
      assert.equal(
        hasThanksClosing(v.text),
        false,
        `"${v.text}" would be read as a close and hang the call up`,
      );
      assert.ok(isSafeAcknowledgement(v.text), `"${v.text}" failed the safety gate`);
    }
  });

  test('variants are unique after whitespace normalisation', () => {
    const seen = new Set(ACK_VARIANTS_KN.map((v) => v.text.replace(/\s+/g, '')));
    assert.equal(seen.size, ACK_VARIANTS_KN.length, 'a duplicate phrase is a bug, not variety');
  });

  test('the safety gate rejects the things it must reject', () => {
    assert.equal(isSafeAcknowledgement(''), false);
    assert.equal(isSafeAcknowledgement('ಧನ್ಯವಾದ ಸರ್'), false, 'a thank-you is a close');
    assert.equal(isSafeAcknowledgement('thanks a lot'), false, 'English thanks too');
    assert.equal(
      isSafeAcknowledgement('ಹೌದು ಸರ್ ನಿಮ್ಮ ಹೆಸರು ಏನು ಸರ್'),
      false,
      'anything past three words has become a sentence',
    );
  });
});

describe('acknowledgement selection: deterministic, never the same twice', () => {
  test("the owner's original word is still the default", () => {
    assert.equal(chooseAcknowledgement({ kind: 'recognition' }), 'ಸರ್ತಿ');
    assert.equal(chooseAcknowledgement({ kind: 'recognition', variantIndex: 0 }), 'ಸರ್ತಿ');
    // The named constant and the literal must be the same word. The engine's
    // rollback switch reads the constant while these assertions read the literal,
    // so if the two ever drift the safety valve would restore a DIFFERENT
    // behaviour than the one the tests pin — invisible until a caller heard it.
    assert.equal(DEFAULT_ACK_WORD_KN, 'ಸರ್ತಿ');
    assert.equal(ACK_VARIANTS_KN[0].text, DEFAULT_ACK_WORD_KN, 'the default leads the set');
  });

  test('legacyOnly pins the original behaviour — this is the rollback', () => {
    for (let i = 0; i < 12; i++) {
      assert.equal(
        chooseAcknowledgement({ kind: 'recognition', variantIndex: i, legacyOnly: true }),
        'ಸರ್ತಿ',
      );
    }
  });

  test('selection is deterministic — a live call is reproducible, a test is assertable', () => {
    const a = chooseAcknowledgement({ kind: 'transition', variantIndex: 2 });
    const b = chooseAcknowledgement({ kind: 'transition', variantIndex: 2 });
    assert.equal(a, b);
  });

  test('a phrase already used on this call is never handed back', () => {
    for (const used of ACK_VARIANTS_KN.map((v) => v.text)) {
      const chosen = chooseAcknowledgement({
        kind: 'recognition',
        avoid: [used],
        variantIndex: 0,
      });
      assert.notEqual(chosen, used, `"${used}" was avoided but came back anyway`);
    }
  });

  test('a whole simulated call never repeats a phrase while the pool lasts', () => {
    let guard = createRecentSpoken(4);
    const spoken: string[] = [];
    for (let i = 0; i < ACK_VARIANTS_KN.length; i++) {
      const r = pickUnspoken(
        guard,
        (v: string) => v,
        ACK_VARIANTS_KN.map((v) => v.text),
      );
      guard = r.guard;
      spoken.push(r.pick);
    }
    assert.equal(new Set(spoken).size, spoken.length, `a phrase repeated in ${spoken.join(' → ')}`);
  });

  test('the guard beats every phrase before it ever repeats one', () => {
    // Deliberately exhaust the window: repetition is allowed, silence is not.
    let guard = createRecentSpoken(2);
    const spoken: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = pickUnspoken(
        guard,
        (v: string) => v,
        ACK_VARIANTS_KN.map((v) => v.text),
      );
      guard = r.guard;
      spoken.push(r.pick);
    }
    assert.equal(spoken.length, 10, 'the agent must always have something to say');
  });

  test('pickUnspoken refuses an empty candidate list instead of going mute', () => {
    assert.throws(() => pickUnspoken(createRecentSpoken(), (v: string) => v, []));
  });
});

describe('the acknowledgement carries the caller name', () => {
  test('it addresses the caller with the right honorific', () => {
    const out = acknowledgementWithName('ಸರ್ತಿ', 'Ravi');
    assert.match(out, /Ravi/);
    assert.match(out, new RegExp(HONORIFIC_SIR_KN));
    assert.equal(hasThanksClosing(out), false);
  });

  test('a Kannada feminine name gets ಮಾಮ್, not ಸರ್', () => {
    const out = acknowledgementWithName('ಹೌದು', 'Lakshmi');
    assert.ok(out.includes(HONORIFIC_MAAM_KN), `expected ಮಾಮ್ in "${out}"`);
  });

  test('with no name there is NO honorific and never an empty beat (owner rule)', () => {
    const out = acknowledgementWithName('ಸರ್ತಿ', null);
    assert.equal(out, 'ಸರ್ತಿ');
    // ಸರ್ತಿ itself contains the letters ಸರ್ — what must never appear is a
    // SEPARATE spoken title after the beat.
    assert.ok(!out.includes(' ಸರ್'), 'no name → never a spoken ಸರ್ after the beat');
    assert.ok(!out.includes('ಮಾಮ್'), 'no name → never ಮಾಮ್');
    assert.equal(hasThanksClosing(out), false);
  });

  test('the name-acknowledgement is still a beat, not a sentence', () => {
    const words = acknowledgementWithName('ಸರ್ತಿ', 'Ravi').split(/\s+/).length;
    assert.ok(words <= 3, `${words} words — the ack plus a name must stay short`);
  });
});

describe('pinned business content vs conversational realization', () => {
  test('the nudge carries the acknowledgement this call was given', () => {
    const nudge = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN, 'ಹೌದು');
    assert.match(nudge, /"ಹೌದು"/);
    assert.ok(
      !nudge.includes(`"${'ಸರ್ತಿ'}"`),
      'the realization passed in must replace the default, not sit beside it',
    );
  });

  test('with no realization given, the owner default is unchanged', () => {
    const nudge = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN);
    assert.match(nudge, /"ಸರ್ತಿ"/);
  });

  test('the retry nudge uses its realization too', () => {
    const retry = buildOutboundProjectsRetryNudge('Ravi', HONORIFIC_SIR_KN, 'ಆಯಿತು');
    assert.match(retry, /"ಆಯಿತು"/);
  });

  test('the business content never varies — only the beat does', () => {
    // THE STRONGEST FORM OF THIS CHECK: substitute the beat out of both messages
    // and require the REMAINDER to be byte-identical. If a future edit lets the
    // acknowledgement change the areas substance, the interest question, the
    // honorific, the no-re-ask ban or the no-thanks ban, this fails — and it
    // fails without hard-coding a single prompt phrase.
    //
    // (An earlier version of this test asserted five literal substrings and
    // produced three false alarms as the prompt was worded differently than the
    // test guessed. Comparing the remainder cannot rot that way.)
    const ackA = 'ಸರ್ತಿ';
    const ackB = 'ಅರ್ಥಾಯಿತು';
    const a = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN, ackA);
    const b = buildOutboundProjectsNudge('Ravi', HONORIFIC_SIR_KN, ackB);
    assert.notEqual(a, b, 'the beat really did change something');
    const normalise = (msg: string, ack: string) => msg.replaceAll(ack, 'THE-BEAT');
    assert.equal(
      normalise(a, ackA),
      normalise(b, ackB),
      'everything except the acknowledgement must be identical — business content is pinned',
    );
    // And the pins that matter most really are in there.
    for (const re of [/few options/i, /Do NOT re-ask the site question/, /NEVER\s+say[\s\S]{0,30}?thank/i]) {
      assert.match(a, re, `the projects nudge lost ${re}`);
      assert.match(b, re, `a varied ack lost ${re}`);
    }
  });

  test('a repair does not hand back the phrase the caller already heard', () => {
    const firstAck = 'ಸರ್ತಿ';
    const repairAck = 'ಹೌದು';
    const repair = buildOutboundProjectsRetryNudge('Ravi', HONORIFIC_SIR_KN, repairAck);
    // Assert on the ACKNOWLEDGEMENT itself, not on the first quoted string in
    // the nudge: the first quoted string is the caller's address ("Ravi ಸರ್"),
    // which is identical in both messages by design.
    assert.ok(
      repair.includes(`"${repairAck}"`),
      'the repair must use the fresh acknowledgement it was handed',
    );
    assert.ok(
      !repair.includes(`"${firstAck}"`),
      'the repair repeated the acknowledgement the caller just heard',
    );
  });
});

describe('caller signal detection', () => {
  const cases: Array<[string, CallerSignal]> = [
    ['ಇಲ್ಲ', 'short_answer'],
    ['ಹೌದು', 'short_answer'],
    ['ಸರಿ', 'short_answer'],
    ['I am busy right now, can you call later', 'busy'],
    ['ಇದೀಗ ಬರುವುದಿಲ್ಲ, ಮತ್ತೆ ಕರೆ', 'busy'],
    ['come again? I did not catch that', 'confused'],
    ['ಮತ್ತೆ ಹೇಳಿ ಏನು ಅರ್ಥ', 'confused'],
    ['stop calling me', 'annoyed'],
    ['ಇನ್ನೂ ಕರೆ ಮಾಡಬೇಡಿ', 'annoyed'],
    ['I am not interested', 'uninterested'],
    ['tell me more about the rates', 'interested'],
    ['ಆಸಕ್ತಿ ಇದೆ', 'interested'],
    ['maybe, just looking for now', 'hesitant'],
    ['ಹೌದು', 'short_answer'],
  ];

  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, () => {
      assert.equal(detectCallerSignal(text), expected);
    });
  }

  test('an irritation is never mistaken for merely busy', () => {
    // "busy" keeps talking; "annoyed" must get the shortest, most respectful reply.
    assert.equal(detectCallerSignal('I am busy'), 'busy');
    assert.equal(detectCallerSignal('I am busy and this is annoying'), 'annoyed');
  });

  test('a request to repeat outranks interest — they need the repeat, not a pitch', () => {
    assert.equal(detectCallerSignal('I am interested, but can you repeat that?'), 'confused');
  });

  test('a refusal outranks a price question in the same breath', () => {
    assert.equal(detectCallerSignal('not interested, what is the rate anyway'), 'uninterested');
  });

  test('a long explanation is not treated as short', () => {
    const long = 'a'.repeat(120);
    assert.equal(detectCallerSignal(long), 'long_answer');
  });

  test('empty speech is neutral, not a signal', () => {
    assert.equal(detectCallerSignal(''), 'neutral');
    assert.equal(detectCallerSignal('   '), 'neutral');
  });
});

describe('tone strategy adapts communication, never the personality', () => {
  test('neutral callers get no directive at all — no extra prompt noise', () => {
    assert.equal(buildToneDirective('neutral'), '');
  });

  const signals: CallerSignal[] = [
    'busy',
    'annoyed',
    'confused',
    'short_answer',
    'long_answer',
    'hesitant',
    'interested',
    'uninterested',
  ];

  for (const s of signals) {
    test(`${s} produces a private, non-empty directive`, () => {
      const d = buildToneDirective(s);
      assert.ok(d.length > 0, `${s} produced no strategy`);
      assert.match(d, /^SYSTEM \(internal\):/, 'a directive must be private, not speech');
    });
  }

  test('no directive ever licenses a new claim, a price, or an offer', () => {
    for (const s of signals) {
      const d = buildToneDirective(s).toLowerCase();
      assert.ok(
        !/you may (offer|quote|discount|negotiate)/.test(d),
        `${s} licenses something new`,
      );
      assert.ok(!d.includes('thank'), `${s} risks a thanks — that word ends the call`);
    }
  });

  test('no directive tells the agent to mirror the caller\'s energy', () => {
    for (const s of signals) {
      const d = buildToneDirective(s).toLowerCase();
      assert.ok(
        !/(if the caller sounds (tired|pleased).*(soften|brighten))|(vary your rhythm)/.test(d),
        `${s} reintroduces energy mirroring`,
      );
    }
  });

  test('a short answer never buys a longer reply', () => {
    assert.match(buildToneDirective('short_answer'), /short/i);
  });

  test('a pressed-for-time caller is told to be shorter, not warmer', () => {
    const d = buildToneDirective('busy');
    assert.match(d, /shorter|short/i);
    // Assert on warmth being GRANTED, not on the substring "warm". The busy
    // directive contains the words "do not add warmth" — a correct prohibition
    // that a substring ban would misread as a violation. The invariant is that
    // busy never buys enthusiasm, so only permissive phrasing is forbidden.
    assert.ok(
      !/(?:be|sound|get|become)\s+(?:warmer|brighter|more engaged|more enthusiastic)|warmth may/i.test(
        d,
      ),
      'busy is not an invitation to be warmer',
    );
  });
});

describe('repetition protection', () => {
  test('remembers and reports what has been said', () => {
    let g = createRecentSpoken(3);
    g = rememberSpoken(g, 'ಸರ್ತಿ');
    assert.equal(wasSpoken(g, 'ಸರ್ತಿ'), true);
    assert.equal(wasSpoken(g, 'ಹೌದು'), false);
  });

  test('whitespace differences do not disguise a repeat', () => {
    let g = createRecentSpoken(3);
    g = rememberSpoken(g, 'ಧನ್ಯವಾದ ಸರ್');
    assert.equal(wasSpoken(g, 'ಧನ್ಯವಾದಸರ್'), true);
  });

  test('the window is bounded', () => {
    let g = createRecentSpoken(2);
    g = rememberSpoken(g, 'a');
    g = rememberSpoken(g, 'b');
    g = rememberSpoken(g, 'c');
    assert.equal(g.keys.length, 2);
    assert.equal(g.keys[0], 'c', 'the most recent key is first');
  });

  test('an empty key is ignored rather than poisoning the window', () => {
    const g = rememberSpoken(createRecentSpoken(3), '   ');
    assert.equal(g.keys.length, 0);
  });
});

describe('call telemetry: evidence without personal data', () => {
  test('the call id is opaque and stable', () => {
    const uuid = 'e5b6c1d2-1111-2222-3333-444455556666';
    const id = opaqueCallId(uuid);
    assert.equal(id, opaqueCallId(uuid), 'must be stable for the same call');
    assert.ok(!id.includes(uuid), 'the id must not carry the provider uuid');
    assert.ok(id.length <= 12, 'the id is a fingerprint, not a payload');
  });

  test('an unknown call still gets an id', () => {
    assert.ok(opaqueCallId(null).length > 0);
    assert.equal(opaqueCallId(undefined), opaqueCallId(null));
  });

  test('caller turns and speech duration accumulate', () => {
    let t = createCallTelemetry('abc', 1_000);
    t = recordCallerSpeechEnd(t, 2_000, 1_400);
    t = recordCallerSpeechEnd(t, 4_000, 900);
    assert.equal(t.callerTurns, 2);
    assert.equal(t.callerSpeechMs, 2_300);
    assert.equal(t.latency.callerToAgentMs.length, 2);
  });

  test('a bogus negative duration is clamped, never stored as a lie', () => {
    let t = createCallTelemetry('abc', 1_000);
    t = recordCallerSpeechEnd(t, 500, -9_999);
    assert.equal(t.callerSpeechMs, 0);
    assert.equal(t.latency.callerToAgentMs[0], 0);
  });

  test('latency history is capped so one call cannot grow memory forever', () => {
    let t = createCallTelemetry('abc', 0);
    for (let i = 0; i < 60; i++) t = recordCallerSpeechEnd(t, i, 100);
    assert.equal(t.latency.callerToAgentMs.length, 32);
  });

  test('barge-in records how fast the agent yielded', () => {
    let t = createCallTelemetry('abc', 0);
    t = recordBargeIn(t, 120);
    t = recordBargeIn(t, 90);
    assert.equal(t.bargeIns, 2);
    const s = summarize(t);
    assert.equal(s.bargeInYieldMs.p50, 90);
    assert.equal(s.bargeInYieldMs.max, 120);
  });

  test('every conversational event has a counter', () => {
    let t = createCallTelemetry('abc', 0);
    t = recordRepair(t);
    t = recordSilenceCheck(t);
    t = recordLateReplyRescue(t);
    t = recordLanguageSwitch(t);
    t = recordAgentTurn(t, 300, 2_000);
    t = recordAck(t, false);
    t = recordAck(t, true);
    const s = summarize(t);
    assert.equal(s.repairs, 1);
    assert.equal(s.silenceChecks, 1);
    assert.equal(s.lateRepliesRescued, 1);
    assert.equal(s.languageSwitches, 1);
    assert.equal(s.agentTurns, 1);
    assert.equal(s.acksSpoken, 2);
    assert.equal(s.ackRepeatsBlocked, 1);
  });

  test('percentiles are ordered and honest about an empty sample', () => {
    const empty = summarize(createCallTelemetry('abc', 0));
    assert.deepEqual(empty.callerToAgentMs, { n: 0, p50: 0, p95: 0, max: 0 });

    let t = createCallTelemetry('abc', 0);
    for (const v of [100, 200, 300, 400, 5_000]) t = recordCallerSpeechEnd(t, v, 0);
    const s = summarize(t);
    assert.equal(s.callerToAgentMs.n, 5);
    assert.ok(s.callerToAgentMs.p50 <= s.callerToAgentMs.p95);
    assert.ok(s.callerToAgentMs.p95 <= s.callerToAgentMs.max);
    assert.equal(s.callerToAgentMs.max, 5_000);
  });

  test('the end reason is recorded with a timestamp', () => {
    let t = createCallTelemetry('abc', 1_000);
    t = recordEnd(t, 'thank_you_close', 9_000);
    assert.equal(t.endReason, 'thank_you_close');
    assert.equal(t.endedAt, 9_000);
    assert.equal(summarize(t).durationMs, 8_000);
  });

  test('a summary exposes counts and latencies ONLY — no name, no number, no transcript', () => {
    const s = summarize(createCallTelemetry('abc', 0)) as Record<string, unknown>;
    // Keys that would indicate personal data being carried. "caller" is NOT in
    // this list: `callerTurns` is a COUNT of caller turns, which is the whole
    // point of turning a call into evidence. The banned terms are the ones that
    // would mean a value, not a tally.
    const banned = ['name', 'phone', 'transcript', 'text', 'uuid', 'number', 'address'];
    for (const key of Object.keys(s)) {
      for (const b of banned) {
        assert.ok(
          !key.toLowerCase().includes(b),
          `telemetry key "${key}" looks like it could carry personal data`,
        );
      }
    }
  });

  test('the call id is opaque — a provider UUID is never published', () => {
    const uuid = '9a1c4f7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
    const id = opaqueCallId(uuid);
    assert.notEqual(id, uuid, 'the raw call UUID must never reach the summary');
    assert.ok(id.length <= 12, 'the opaque id must be short, not a re-encoded UUID');
    assert.ok(!id.includes('-'), 'an opaque id is not a UUID fragment');
    assert.equal(opaqueCallId(uuid), id, 'the mapping must be stable so a call can be joined');
    assert.notEqual(opaqueCallId('different-call'), id, 'two calls must not collide');
  });

  test('the published ring buffer is bounded and newest-first', () => {
    resetRecentCalls();
    for (let i = 0; i < 25; i++) {
      publishCall(summarize(recordEnd(createCallTelemetry(`c${i}`, 0), 'thank_you_close', 1)));
    }
    const recent = recentCalls();
    assert.equal(recent.length, 20, 'the buffer must not grow without bound');
    assert.equal(recent[0].callId, 'c24', 'the newest call must come first');
    resetRecentCalls();
    assert.equal(recentCalls().length, 0);
  });

  test('the fleet aggregate sums the calls it has seen', () => {
    resetRecentCalls();
    let a = createCallTelemetry('a', 0);
    a = recordRepair(a);
    a = recordBargeIn(a, 100);
    a = recordLateReplyRescue(a);
    a = recordEnd(a, 'thank_you_close', 5_000);
    publishCall(summarize(a));

    let b = createCallTelemetry('b', 0);
    b = recordEnd(b, 'not_interested_close', 4_000);
    publishCall(summarize(b));

    const agg = aggregateRecent();
    assert.equal(agg.calls, 2);
    assert.equal(agg.repairs, 1);
    assert.equal(agg.bargeIns, 1);
    assert.equal(agg.lateRepliesRescued, 1);
    assert.equal(agg.endReasons['thank_you_close'], 1);
    assert.equal(agg.endReasons['not_interested_close'], 1);
    resetRecentCalls();
  });
});
