/**
 * What the agent's model receives for a caller frame.
 *
 * This existed because background noise was reaching the model and being
 * transcribed as phantom speech. "Noise" frames were swapped for digital zeros
 * — which is what made Priya completely deaf: on a narrowband phone line the
 * frame classifier is least reliable, so ordinary speech was regularly classed
 * as noise, and the model received silence while the caller spoke for a full
 * minute.
 *
 * The asymmetry settles it. A phantom turn costs one beat of the call. Total
 * deafness costs the entire call. So noise is ATTENUATED, never erased: a word
 * the classifier wrongly rejected is still intelligible, while steady
 * background noise cannot dominate the stream.
 */

/**
 * How much of a noise-classified frame is kept.
 *
 * Pushed down from 0.35 to cut steady background harder — fan, traffic, TV.
 * It stays well above zero on purpose: this is the one number standing between
 * a noisy line and a totally deaf agent, and silence is the failure that costs
 * the whole call.
 */
export const NOISE_ATTENUATION = 0.18;

/**
 * Attenuate one 16-bit little-endian PCM frame.
 *
 * `int16Count` is the number of Int16 samples in `pcm` (two per 8 kHz input
 * sample, because the frame is upsampled 8 kHz -> 16 kHz). Non-noise frames are
 * returned UNCHANGED and un-copied — the common path must stay allocation-free.
 */
export function forwardFrameToModel(
  pcm: Buffer,
  int16Count: number,
  frameClass: string,
): Buffer {
  if (frameClass !== 'noise') return pcm;
  const ducked = Buffer.allocUnsafe(pcm.length);
  pcm.copy(ducked);
  for (let i = 0; i < int16Count; i++) {
    const sample = ducked.readInt16LE(i * 2);
    ducked.writeInt16LE(Math.round(sample * NOISE_ATTENUATION), i * 2);
  }
  return ducked;
}