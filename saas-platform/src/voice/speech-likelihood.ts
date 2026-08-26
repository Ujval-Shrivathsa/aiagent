/**
 * Distinguish quiet human speech from steady background noise (TV, fan, AC).
 * Telephony speech has higher crest factor and zero-crossing rate than rumble/hum.
 */

export type FrameMetrics = {
  rms: number;
  peak: number;
  crestFactor: number;
  zeroCrossRate: number;
};

export function analyzePcmFrame(samples: Int16Array, count: number): FrameMetrics {
  let sumSquares = 0;
  let peak = 0;
  let crossings = 0;
  let prevSign = 0;
  const n = Math.min(count, samples.length);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSquares += s * s;
    const sign = s >= 0 ? 1 : -1;
    if (i > 0 && sign !== prevSign && abs > 60) crossings++;
    prevSign = sign;
  }
  const rms = n > 0 ? Math.sqrt(sumSquares / n) : 0;
  const crestFactor = rms > 1 ? peak / rms : 0;
  const zeroCrossRate = n > 0 ? crossings / n : 0;
  return { rms, peak, crestFactor, zeroCrossRate };
}

export type SpeechLikeConfig = {
  minCrestFactor: number;
  minZeroCrossRate: number;
  /** RMS must exceed noise floor × this to count as speech-like. */
  quietSpeechFloorMult: number;
};

export type SpeechLikeInput = FrameMetrics & {
  noiseFloorRms: number;
  config: SpeechLikeConfig;
};

/** True when the frame looks like human speech, not steady background noise. */
export function isSpeechLike(input: SpeechLikeInput): boolean {
  const { rms, crestFactor, zeroCrossRate, noiseFloorRms, config } = input;
  if (rms < noiseFloorRms * config.quietSpeechFloorMult) return false;
  if (crestFactor >= config.minCrestFactor) return true;
  if (
    zeroCrossRate >= config.minZeroCrossRate &&
    crestFactor >= config.minCrestFactor * 0.82
  ) {
    return true;
  }
  return false;
}

export type GateOpenInput = {
  rms: number;
  gateOpenRms: number;
  gateCloseRms: number;
  quietOpenRms: number;
  gateOpen: boolean;
  speechLike: boolean;
};

/** Hysteresis: speech-like opens gate; steady noise above RMS alone does not. */
export function shouldOpenGate(input: GateOpenInput): boolean {
  if (input.gateOpen) {
    return input.rms >= input.gateCloseRms || input.speechLike;
  }
  if (input.speechLike && input.rms >= input.quietOpenRms) return true;
  return input.speechLike && input.rms >= input.gateOpenRms;
}
