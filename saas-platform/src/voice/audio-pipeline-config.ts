/**
 * Live voice audio pipeline thresholds.
 *
 * Stages (do not conflate):
 *   1. raw telephony mu-law  — recording only
 *   2. denoised PCM          — HP + adaptive gate + gain (this module)
 *   3. speech detection      — local VAD + Gemini AAD
 *   4. transcription         — Gemini inputAudioTranscription
 *   5. assistant generation  — Gemini Live AUDIO modality
 *
 * All values are overridable via env so we can tune without code changes.
 */
function num(env: string | undefined, fallback: number): number {
  if (env == null || env === '') return fallback;
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

/** Plivo/Twilio mu-law streams arrive in ~20ms frames — floor for silence windows. */
const TELEPHONY_FRAME_MS = 20;

function silenceMs(env: string | undefined, fallback: number): number {
  return Math.max(TELEPHONY_FRAME_MS, num(env, fallback));
}

function str(env: string | undefined, fallback: string): string {
  const v = (env || '').trim();
  return v || fallback;
}

export type AudioPipelineConfig = {
  inputGain: number;
  noiseFloorMin: number;
  noiseFloorMax: number;
  gateOpenMinRms: number;
  gateOpenMaxRms: number;
  gateFloorMult: number;
  gateCloseRatio: number;
  gateReleaseMs: number;
  gateFloor: number;
  bargeInMinRms: number;
  bargeInFloorMult: number;
  bargeInMinMs: number;
  /** Require the noise gate to be open before local barge-in fires. */
  bargeInRequireGateOpen: boolean;
  vadEnergyMinRms: number;
  vadEnergyFloorMult: number;
  vadSilenceMs: number;
  aadSilenceDurationMs: number;
  aadPrefixPaddingMs: number;
  aadEndSensitivity: string;
  aadStartSensitivity: string;
  /** Nudge Gemini if no audio reply this long after customer speech ends. */
  responseWatchdogMs: number;
  /** Crest factor / ZCR — speech vs steady background (TV, fan). */
  speechMinCrestFactor: number;
  speechMinZeroCrossRate: number;
  speechQuietFloorMult: number;
  /** Closed-gate gain boost when frame is speech-like (quiet caller pickup). */
  speechLikeGateFloor: number;
  voiceDebug: boolean;
};

export function loadAudioPipelineConfig(): AudioPipelineConfig {
  return {
    // Turn-end: ~400ms AAD + ~480ms local VAD — tolerates breaths/pauses in Kannada.
    // (25ms cut callers off mid-sentence; gate ducking hurt quiet-voice STT.)
    // Quiet speech: low RMS open threshold; full gain always forwarded to Gemini.
    inputGain: num(process.env.VOICE_INPUT_GAIN, 2.45),
    noiseFloorMin: num(process.env.VOICE_NOISE_FLOOR_MIN, 35),
    noiseFloorMax: num(process.env.VOICE_NOISE_FLOOR_MAX, 750),
    gateOpenMinRms: num(process.env.VOICE_GATE_OPEN_MIN_RMS, 95),
    gateOpenMaxRms: num(process.env.VOICE_GATE_OPEN_MAX_RMS, 1100),
    gateFloorMult: num(process.env.VOICE_GATE_FLOOR_MULT, 1.95),
    gateCloseRatio: num(process.env.VOICE_GATE_CLOSE_RATIO, 0.68),
    gateReleaseMs: num(process.env.VOICE_GATE_RELEASE_MS, 220),
    gateFloor: num(process.env.VOICE_GATE_FLOOR, 0.62),
    // High barge-in bar + speech-like check — TV/room noise must not clear AI audio.
    bargeInMinRms: num(process.env.VOICE_BARGE_IN_MIN_RMS, 2000),
    bargeInFloorMult: num(process.env.VOICE_BARGE_IN_FLOOR_MULT, 7.5),
    bargeInMinMs: num(process.env.VOICE_BARGE_IN_MIN_MS, 400),
    bargeInRequireGateOpen: str(process.env.VOICE_BARGE_IN_REQUIRE_GATE, '1') !== '0',
    vadEnergyMinRms: num(process.env.VOICE_VAD_ENERGY_MIN_RMS, 140),
    vadEnergyFloorMult: num(process.env.VOICE_VAD_ENERGY_FLOOR_MULT, 1.65),
    vadSilenceMs: silenceMs(process.env.VOICE_VAD_SILENCE_MS, 480),
    aadSilenceDurationMs: silenceMs(process.env.VOICE_AAD_SILENCE_MS, 400),
    aadPrefixPaddingMs: num(process.env.VOICE_AAD_PREFIX_PADDING_MS, 150),
    aadEndSensitivity: str(process.env.VOICE_AAD_END_SENSITIVITY, 'END_SENSITIVITY_LOW'),
    aadStartSensitivity: str(process.env.VOICE_AAD_START_SENSITIVITY, 'START_SENSITIVITY_HIGH'),
    responseWatchdogMs: num(process.env.VOICE_RESPONSE_WATCHDOG_MS, 1400),
    speechMinCrestFactor: num(process.env.VOICE_SPEECH_MIN_CREST, 1.95),
    speechMinZeroCrossRate: num(process.env.VOICE_SPEECH_MIN_ZCR, 0.032),
    speechQuietFloorMult: num(process.env.VOICE_SPEECH_QUIET_FLOOR_MULT, 1.12),
    speechLikeGateFloor: num(process.env.VOICE_SPEECH_LIKE_GATE_FLOOR, 0.88),
    voiceDebug: str(process.env.VOICE_DEBUG, '') === '1' || str(process.env.LATENCY_DEBUG, '') === '1',
  };
}
