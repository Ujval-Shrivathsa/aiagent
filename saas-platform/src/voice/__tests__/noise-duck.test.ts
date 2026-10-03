/**
 * The regression that made Priya completely deaf.
 *
 * 'noise' frames were swapped for digital zeros before being sent to the model,
 * so any frame the classifier wrongly rejected was delivered as silence. On a
 * narrowband phone line that is most of what a caller says — which is exactly
 * what happened: a full minute of speech arrived as zeros and the agent never
 * reacted to any of it.
 *
 * These tests pin the rule that closes that hole: noise is attenuated, never
 * erased.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { forwardFrameToModel, NOISE_ATTENUATION } from '../noise-duck';

/** A 20 ms 8 kHz frame, upsampled to 16 kHz — two Int16 per input sample. */
function makeFrame(inputSamples = 160): Buffer {
  const buf = Buffer.alloc(inputSamples * 4);
  for (let i = 0; i < inputSamples; i++) {
    const sample = Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / 8000));
    buf.writeInt16LE(sample, i * 4);
    buf.writeInt16LE(sample, i * 4 + 2);
  }
  return buf;
}

const rms = (b: Buffer) => {
  let sum = 0;
  const n = b.length / 2;
  for (let i = 0; i < n; i++) sum += b.readInt16LE(i * 2) ** 2;
  return Math.sqrt(sum / n);
};

describe('caller audio is attenuated for noise, never erased', () => {
  it('passes speech and ambiguous frames through untouched', () => {
    const pcm = makeFrame();
    for (const cls of ['speech', 'ambiguous', 'silent']) {
      assert.equal(forwardFrameToModel(pcm, 320, cls), pcm, `${cls} must be forwarded verbatim`);
    }
  });

  it('never turns a noise frame into silence', () => {
    const pcm = makeFrame();
    const out = forwardFrameToModel(pcm, 320, 'noise');
    assert.ok(rms(out) > 0, 'a noise frame must still carry signal');
    assert.ok(out.some((s) => s !== 0), 'a noise frame must not be all zeros');
  });

  it('attenuates rather than removes — quieter, but the same signal', () => {
    const pcm = makeFrame();
    const out = forwardFrameToModel(pcm, 320, 'noise');
    const ratio = rms(out) / rms(pcm);
    assert.ok(
      ratio > NOISE_ATTENUATION - 0.02 && ratio < NOISE_ATTENUATION + 0.02,
      `expected ~${NOISE_ATTENUATION}, got ${ratio}`,
    );
  });

  it('leaves the original buffer intact for the next frame', () => {
    const pcm = makeFrame();
    const before = rms(pcm);
    forwardFrameToModel(pcm, 320, 'noise');
    assert.equal(rms(pcm), before, 'filtering must not mutate the caller buffer');
  });

  /**
   * The case that actually happened: a quiet caller on a bad line, whose frames
   * the classifier calls noise. Even at full attenuation the word must remain
   * well clear of the digital floor, or the agent is deaf all over again.
   */
  it('keeps a quiet frame far above the digital floor', () => {
    const quiet = makeFrame(160);
    for (let i = 0; i < quiet.length / 2; i++) {
      quiet.writeInt16LE(Math.round(quiet.readInt16LE(i * 2) * 0.05), i * 2);
    }
    const out = forwardFrameToModel(quiet, 320, 'noise');
    assert.ok(
      rms(out) > 100,
      `a misclassified quiet word must survive, got rms=${rms(out).toFixed(0)}`,
    );
  });
});