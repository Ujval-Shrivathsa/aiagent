/**
 * Speech-first frame classification for 8kHz telephony audio.
 *
 * Architecture (replaces the old crest-factor/ZCR-only check — see the media
 * handler in logic.ts for the wiring):
 *
 *   1. analyzePcmFrame  — per-20ms-frame metrics: RMS, peak, crest factor,
 *      zero-crossing rate AND two spectral shape probes that crest/ZCR miss:
 *        • lowEnergyRatio  — fraction of total energy below 500Hz. Voiced
 *          speech carries its energy in harmonics ABOVE the telephony HP
 *          corner (120Hz), while the noisiest real-world triggers — fans,
 *          AC, traffic rumble, truck drone — are almost pure low-band
 *          energy. Loud low-band rumble that previously PASSED every
 *          threshold now scores lowEnergyRatio ≈ 1 and is rejected.
 *        • spectralFlatness — geometric/arithmetic mean ratio over 8 log
 *          bands (150–3500Hz). Speech is harmonically structured (flatness
 *          < ~0.5); broadband hiss/white noise (keyboard, static, hiss
 *          bursts) is flat (≈ 1.0).
 *
 *   2. classifyFrame — every frame gets a POSITIVE speech score (harmonic
 *      energy, voice-band presence, crest dynamics) and NEGATIVE evidence
 *      (low-band dominance, flatness, steady-state RMS). It never rejects
 *      on one metric: the score must clear a floor for a 'speech' verdict,
 *      otherwise the frame is 'ambiguous' (harmless — never opens anything,
 *      still forwarded) or 'noise'/'silent'.
 *
 *   3. updateSpeechGate — a pure debounce state machine around local VAD.
 *      Single 20ms frames (door slam, keyboard click, one noisy packet)
 *      cannot start a turn: N_CONSECUTIVE speech-class frames must agree
 *      first (~3 frames = 60ms). The OLD code started a turn on ONE frame,
 *      which is exactly why white-noise bursts (rms≈5000) fired USER_SPEAKING
 *      and why the recovery ladder kept answering noise.
 *
 * Latency contract: the debounce adds ≤ ~60–80ms to speech ONSET and is
 * fully hidden inside the 120ms AAD prefix padding — no perceived lag.
 */

export type FrameMetrics = {
  rms: number;
  peak: number;
  crestFactor: number;
  zeroCrossRate: number;
  /** Fraction of total energy in the sub-500Hz band (voice fundamental is above the HP corner). */
  lowEnergyRatio: number;
  /** Spectral flatness 0..1 over 9 log-spaced bands 150–4000Hz (1 = pure white noise). */
  spectralFlatness: number;
  /** Max normalized autocorrelation at 125–400Hz pitch lags (voiced speech ≈ 0.5–0.9, noise ≈ 0). */
  periodicity: number;
};

/** 8 log-spaced analysis bands across the telephony speech range. */
const BAND_EDGES = [150, 250, 420, 700, 1150, 1900, 2600, 3500];
const LOW_BAND_HZ = 500;
const CROSS_MIN_ABS = 60;

/** One-pole 500Hz low-pass coefficient @ 8kHz sample rate. */
const LOWPASS_A = Math.exp(-2 * Math.PI * LOW_BAND_HZ / 8000);

export function analyzePcmFrame(samples: Int16Array, count: number): FrameMetrics {
  const n = Math.min(count, samples.length);
  let sumSquares = 0;
  let peak = 0;
  let crossings = 0;
  let lowSum = 0;
  let prevSign = 0;
  let lowY = 0;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSquares += s * s;
    // One-pole 500Hz low-pass tracks the sub-voice band; its squared output
    // accumulates the low-band energy used for the lowEnergyRatio probe.
    lowSum += lowY * lowY;
    lowY = LOWPASS_A * lowY + (1 - LOWPASS_A) * s;
    const sign = s >= 0 ? 1 : -1;
    if (i > 0 && sign !== prevSign && abs > CROSS_MIN_ABS) crossings++;
    prevSign = sign;
  }

  const rms = n > 0 ? Math.sqrt(sumSquares / n) : 0;
  const crestFactor = rms > 1 ? peak / rms : 0;
  const zeroCrossRate = n > 0 ? crossings / n : 0;
  const lowEnergyRatio = sumSquares > 0 ? Math.min(1, lowSum / sumSquares) : 0;
  const spectralFlatness = estimateFlatness(samples, n);
  const periodicity = estimatePeriodicity(samples, n);

  return { rms, peak, crestFactor, zeroCrossRate, lowEnergyRatio, spectralFlatness, periodicity };
}

/**
 * Normalized-autocorrelation voicing probe over pitch lags 20–56 samples
 * (2.5–7ms → 143–400Hz fundamentals). Voiced speech repeats at the glottal
 * period (ρ ≈ 0.5–0.9); white noise / hiss / keyboard do not (|ρ| < 0.15).
 * The envelope-correlation of a real voice only raises this further.
 */
function estimatePeriodicity(samples: Int16Array, n: number): number {
  if (n < 80) return 0;
  const minLag = 20;
  const maxLag = Math.min(56, (n >> 1) - 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
  if (energy < 1) return 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += samples[i] * samples[i + lag];
    const rho = sum / energy;
    if (rho > best) best = rho;
  }
  return Math.max(0, best);
}

/**
 * Spectral flatness over 9 log-spaced bands (150–4000Hz), each band energy
 * summed from 3 Goertzel bins (~6 dof per band at 20ms). This dof count
 * matters: single-bin flatness scores white noise only ≈ 0.56 (exponential
 * bin powers), which lets it slip under any useful veto — summed 6-dof band
 * energies put white noise at ≈ 0.84 while harmonic speech stays ≈ 0.2–0.5.
 * Returns 0 (pure tone / strongly harmonic) … ~1 (white).
 */
function estimateFlatness(samples: Int16Array, n: number): number {
  if (n < 40) return 0;
  const powers: number[] = [];
  let prevEdge = 150;
  const edges = BAND_EDGES;
  for (let b = 0; b < edges.length; b++) {
    const lo = prevEdge;
    const hi = edges[b];
    prevEdge = hi;
    let bandPower = 0;
    for (let k = 1; k <= 3; k++) {
      const f = lo * Math.pow(hi / lo, k / 3);
      const w = 2 * Math.PI * f / 8000;
      const coeff = 2 * Math.cos(w);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) {
        const s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      bandPower += Math.max(s1 * s1 + s2 * s2 - coeff * s1 * s2, 0);
    }
    powers.push(Math.max(bandPower / n, 1e-6));
  }
  // Top band 3500–4000Hz: one-pole high-pass remainder (~6 dof equivalent).
  const lpA = Math.exp(-2 * Math.PI * 3400 / 8000);
  let hy = 0, hp = 0;
  for (let i = 0; i < n; i++) {
    hy = lpA * hy + (1 - lpA) * samples[i];
    hp += (samples[i] - hy) * (samples[i] - hy);
  }
  powers.push(Math.max(hp / n, 1e-6));

  let logSum = 0;
  let linSum = 0;
  for (const p of powers) {
    logSum += Math.log(p);
    linSum += p;
  }
  const geo = Math.exp(logSum / powers.length);
  const ari = linSum / powers.length;
  return ari > 0 ? Math.min(1, geo / ari) : 0;
}

export type SpeechClass = 'speech' | 'ambiguous' | 'noise' | 'silent';

export type SpeechClassifyConfig = {
  /** Positive evidence weights. */
  weightCrest: number;
  weightVoiceBand: number;
  weightHarmonic: number;
  weightPeriodicity: number;
  /** Score needed for a definite 'speech' verdict (0..1+ scale). */
  speechScoreMin: number;
  /** Score above which a frame is kept as 'ambiguous' instead of 'noise'. */
  ambiguousScoreMin: number;
  /** Negative evidence (hard vetoes). */
  maxLowEnergyRatio: number;
  maxFlatnessSpeech: number;
  /** White noise / static ZCR ≈ 0.5+; speech (even sibilants) stays < 0.3. */
  maxZeroCrossRate: number;
  /** Absolute quiet line — below noiseFloor × this the frame is 'silent'. */
  silentFloorMult: number;
};

export const DEFAULT_SPEECH_CLASSIFY: SpeechClassifyConfig = {
  weightCrest: 1.0,
  weightVoiceBand: 0.8,
  weightHarmonic: 0.7,
  weightPeriodicity: 0.9,
  speechScoreMin: 1.0,
  ambiguousScoreMin: 0.55,
  maxLowEnergyRatio: 0.82,
  maxFlatnessSpeech: 0.62,
  maxZeroCrossRate: 0.45,
  silentFloorMult: 1.1,
};

export type SpeechClassifyInput = {
  metrics: FrameMetrics;
  noiseFloorRms: number;
  config: SpeechClassifyConfig;
};

/**
 * Classify ONE 20ms frame. Two-stage:
 *
 *   VETO stage — hard rejects that score cannot override:
 *     • flat spectrum (flatness > max): white noise, hiss, keyboard/static
 *       bursts. NOTE white noise ALSO has high crest (peak/rms ≈ 3–4 over
 *       160 samples) so crest evidence alone must NEVER win — this veto is
 *       what fixes the old "white-noise burst triggers VAD" bug.
 *     • pure low-band energy (lowEnergyRatio > max): fan/AC/traffic rumble.
 *
 *   SCORE stage — positive speech evidence must clear the floor: crest
 *   dynamics + voice-band presence + harmonic structure. "Not obviously
 *   noise" is never enough to be 'speech'.
 */
export function classifyFrame(input: SpeechClassifyInput): SpeechClass {
  const { metrics: m, noiseFloorRms, config } = input;

  if (m.rms < noiseFloorRms * config.silentFloorMult) return 'silent';

  // VETO 1: broadband / flat spectrum — never speech regardless of crest.
  if (m.spectralFlatness > config.maxFlatnessSpeech) return 'noise';
  // VETO 2: energy stuck in the sub-voice band — fan/AC/traffic rumble.
  if (m.lowEnergyRatio > config.maxLowEnergyRatio) return 'noise';
  // VETO 3: white noise / static / keyboard hiss — ZCR ≈ 0.5+ vs speech < 0.3
  // (measured: mu-law white noise ZCR ≈ 0.53; catches what flatness misses).
  if (m.zeroCrossRate > config.maxZeroCrossRate) return 'noise';

  // Positive evidence, each capped at 1.
  const crestEvidence = Math.min(1, m.crestFactor / 2.2);
  const voiceBandEvidence = Math.min(
    1,
    (config.maxLowEnergyRatio - m.lowEnergyRatio) / 0.5,
  );
  const harmonicEvidence = Math.min(1, Math.max(0, (0.6 - m.spectralFlatness) / 0.45));
  const periodicityEvidence = Math.min(1, Math.max(0, (m.periodicity - 0.15) / 0.45));
  const score =
    config.weightCrest * crestEvidence +
    config.weightVoiceBand * voiceBandEvidence +
    config.weightHarmonic * harmonicEvidence +
    config.weightPeriodicity * periodicityEvidence;

  if (score >= config.speechScoreMin) return 'speech';
  if (score >= config.ambiguousScoreMin) return 'ambiguous';
  return 'noise';
}

// ---------------------------------------------------------------------------
// Debounced speech gate — the ONLY thing allowed to start a caller turn.
// ---------------------------------------------------------------------------

export type SpeechGateState = {
  /** Consecutive speech-class frames seen (reset by any clear miss). */
  runLength: number;
  /** Speech-class frames seen inside the current candidate window. */
  windowSpeech: number;
  windowStartAt: number | null;
  /** True while the gate holds a confirmed turn open (between START and END). */
  speaking: boolean;
  /** Speech-class frames seen while speaking — keeps the turn alive. */
  speakingRun: number;
};

export function createSpeechGateState(): SpeechGateState {
  return { runLength: 0, windowSpeech: 0, windowStartAt: null, speaking: false, speakingRun: 0 };
}

export type SpeechGateConfig = {
  /** Speech-class frames required to START a turn (~60ms at 20ms frames). */
  startConsecutiveMs: number;
  /** How long a candidate window stays open for stragglers. */
  candidateWindowMs: number;
  /** Allowed non-speech frame before an OPEN turn closes (~120ms intra-word gaps). */
  speakingToleranceMs: number;
  frameMs: number;
};

export const DEFAULT_SPEECH_GATE: SpeechGateConfig = {
  startConsecutiveMs: 60,
  candidateWindowMs: 90,
  speakingToleranceMs: 140,
  frameMs: 20,
};

export type SpeechGateInput = {
  state: SpeechGateState;
  frameClass: SpeechClass;
  now: number;
  config: SpeechGateConfig;
};

export type SpeechGateDecision = {
  state: SpeechGateState;
  event: 'none' | 'start' | 'end';
};

/**
 * Pure debounce state machine. 'speech' frames accumulate; anything ≤
 * 'ambiguous' inside an open turn KEEPS the turn (intra-word gaps must not
 * commit half-spoken Kannada words); any 'noise'/'silent' frame resets the
 * start candidate but NOT an open turn (the 250ms VAD silence window still
 * governs the turn END — this gate only ever delays the START).
 */
export function updateSpeechGate(input: SpeechGateInput): SpeechGateDecision {
  const { frameClass, now, config } = input;
  const s: SpeechGateState = { ...input.state };
  const frameMs = config.frameMs || 20;

  if (s.speaking) {
    if (frameClass === 'speech') {
      s.speakingRun += 1;
      return { state: s, event: 'none' };
    }
    // Ambiguous frames inside a turn are tolerated — VAD silence owns the end.
    if (frameClass === 'ambiguous') {
      s.speakingRun = Math.max(0, s.speakingRun - 1);
      return { state: s, event: 'none' };
    }
    // Clear noise/silence drains the hold; turn END still comes from VAD
    // silence timing in the caller — here we only track the hold strength.
    s.speakingRun = 0;
    s.runLength = 0;
    s.windowSpeech = 0;
    s.windowStartAt = null;
    return { state: s, event: 'none' };
  }

  if (frameClass === 'speech') {
    s.runLength += 1;
    if (s.windowStartAt === null) {
      s.windowStartAt = now;
      s.windowSpeech = 1;
    } else {
      s.windowSpeech += 1;
      if (now - s.windowStartAt > config.candidateWindowMs) {
        // Window stretched too long — restart the candidate from this frame.
        s.windowStartAt = now;
        s.windowSpeech = 1;
      }
    }
    if (s.runLength * frameMs >= config.startConsecutiveMs) {
      s.speaking = true;
      s.speakingRun = s.runLength;
      return { state: s, event: 'start' };
    }
    return { state: s, event: 'none' };
  }

  // Not speech: ambiguous keeps a run alive ONLY inside the candidate window
  // (a single diphthong gap must not kill the candidate), noise/silent reset.
  if (frameClass === 'ambiguous' && s.windowStartAt !== null) {
    if (now - s.windowStartAt <= config.candidateWindowMs) {
      return { state: s, event: 'none' };
    }
  }
  s.runLength = 0;
  s.windowSpeech = 0;
  s.windowStartAt = null;
  return { state: s, event: 'none' };
}

// ---------------------------------------------------------------------------
// Adaptive noise floor — classification-driven (replaces the fixed-rate blend).
// ---------------------------------------------------------------------------

export type NoiseFloorConfig = {
  /** Steady noise converges to the frame RMS at this rate (fast). */
  steadyRate: number;
  /** Transient noise converges at this rate (slow — a slam must not move the floor). */
  transientRate: number;
  /** During AI playback, noise-tracking slows further (agent audio ≠ room noise). */
  aiPlayingSteadyRate: number;
  aiPlayingTransientRate: number;
  /** During confirmed caller speech the floor must NOT track up. */
  speechRate: number;
  /** Frames of sustained noise before the fast steadyRate engages
   * (~160ms — a one-frame flat burst is a transient, not a new noise level). */
  steadyMinFrames: number;
  /** RMS below this multiple of the floor always pulls the floor DOWN. */
  quietPullMult: number;
  quietPullRate: number;
  min: number;
  max: number;
};

export const DEFAULT_NOISE_FLOOR: NoiseFloorConfig = {
  steadyRate: 0.06,
  transientRate: 0.008,
  aiPlayingSteadyRate: 0.012,
  aiPlayingTransientRate: 0.003,
  /** 0 = structural invariant: SPEECH NEVER RAISES THE FLOOR. Any value > 0
   * reintroduces the scream-trap over long utterances. */
  speechRate: 0,
  steadyMinFrames: 8,
  quietPullMult: 1.9,
  quietPullRate: 0.07,
  min: 30,
  max: 750,
};

/**
 * Classification-driven floor adaptation. Sustained NOISE (fan spinning up,
 * TV switched on) pulls the floor UP quickly — the floor rises to meet
 * stationary background. Transients (doors, keyboard) barely move it.
 * Real SPEECH NEVER raises the floor — structural invariant, not a rate
 * knob (any positive rate converges over a long utterance = scream-trap).
 */
export function nextNoiseFloorRms(
  current: number,
  metrics: FrameMetrics,
  frameClass: SpeechClass,
  aiPlaying: boolean,
  cfg: NoiseFloorConfig = DEFAULT_NOISE_FLOOR,
  sustainedNoiseFrames = 0,
): number {
  const rms = metrics.rms;
  // Steady-noise signature: NOT speech-class, spectrally flat OR pure
  // low-band, AND sustained for ≥ steadyMinFrames (~160ms). Duration is what
  // separates a new noise level (fan switched on) from a transient burst.
  const steadyNoise =
    sustainedNoiseFrames >= (cfg.steadyMinFrames ?? 8) &&
    (frameClass === 'noise' || frameClass === 'ambiguous') &&
    (metrics.spectralFlatness > 0.6 || metrics.lowEnergyRatio > 0.85);

  let next: number;
  if (rms < current * cfg.quietPullMult) {
    // Quiet frame — always track down (fast) so silence after noise recovers.
    next = current + (rms - current) * cfg.quietPullRate;
  } else if (frameClass === 'speech') {
    next = current; // STRUCTURAL INVARIANT: speech never raises the floor
  } else if (aiPlaying) {
    next = current + (rms - current) * (steadyNoise ? cfg.aiPlayingSteadyRate : cfg.aiPlayingTransientRate);
  } else {
    next = current + (rms - current) * (steadyNoise ? cfg.steadyRate : cfg.transientRate);
  }
  if (next < cfg.min) next = cfg.min;
  if (next > cfg.max) next = cfg.max;
  return next;
}
