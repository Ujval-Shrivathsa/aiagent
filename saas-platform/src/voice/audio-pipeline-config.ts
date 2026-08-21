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
  voiceDebug: boolean;
};

export function loadAudioPipelineConfig(): AudioPipelineConfig {
  return {
    // Slightly lower gain: less amplified fan/TV into Gemini AAD/STT.
    inputGain: num(process.env.VOICE_INPUT_GAIN, 2.0),
    noiseFloorMin: num(process.env.VOICE_NOISE_FLOOR_MIN, 40),
    noiseFloorMax: num(process.env.VOICE_NOISE_FLOOR_MAX, 900),
    // Higher floor + multiplier: background chatter opens the gate less often,
    // but GATE_OPEN_MIN stays low enough for quiet Kannada syllables.
    gateOpenMinRms: num(process.env.VOICE_GATE_OPEN_MIN_RMS, 300),
    gateOpenMaxRms: num(process.env.VOICE_GATE_OPEN_MAX_RMS, 1200),
    gateFloorMult: num(process.env.VOICE_GATE_FLOOR_MULT, 2.6),
    gateCloseRatio: num(process.env.VOICE_GATE_CLOSE_RATIO, 0.72),
    // Longer release so breaths / short hesitations don't close the gate mid-word.
    gateReleaseMs: num(process.env.VOICE_GATE_RELEASE_MS, 450),
    // Duck closed packets more (~18dB) so noise is quieter into Gemini without hard-mute.
    gateFloor: num(process.env.VOICE_GATE_FLOOR, 0.12),
    bargeInMinRms: num(process.env.VOICE_BARGE_IN_MIN_RMS, 1400),
    bargeInFloorMult: num(process.env.VOICE_BARGE_IN_FLOOR_MULT, 6),
    bargeInMinMs: num(process.env.VOICE_BARGE_IN_MIN_MS, 280),
    bargeInRequireGateOpen: str(process.env.VOICE_BARGE_IN_REQUIRE_GATE, '1') !== '0',
    vadEnergyMinRms: num(process.env.VOICE_VAD_ENERGY_MIN_RMS, 550),
    vadEnergyFloorMult: num(process.env.VOICE_VAD_ENERGY_FLOOR_MULT, 2.8),
    // Local speech-end is for logging / re-arming AI after barge-in — tolerate pauses.
    vadSilenceMs: num(process.env.VOICE_VAD_SILENCE_MS, 800),
    // Gemini AAD: was 250ms + END_HIGH → premature turn cuts on hesitations.
    aadSilenceDurationMs: num(process.env.VOICE_AAD_SILENCE_MS, 700),
    aadPrefixPaddingMs: num(process.env.VOICE_AAD_PREFIX_PADDING_MS, 40),
    aadEndSensitivity: str(process.env.VOICE_AAD_END_SENSITIVITY, 'END_SENSITIVITY_LOW'),
    aadStartSensitivity: str(process.env.VOICE_AAD_START_SENSITIVITY, 'START_SENSITIVITY_LOW'),
    voiceDebug: str(process.env.VOICE_DEBUG, '') === '1' || str(process.env.LATENCY_DEBUG, '') === '1',
  };
}
