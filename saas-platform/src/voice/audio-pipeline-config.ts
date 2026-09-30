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
 * PERFORMANCE CONTRACT (final requirement — do not regress):
 *   - Sharpest possible hearing: low energy floors, high start-of-speech
 *     sensitivity, full gain to the model. The caller must never need to
 *     raise their voice or repeat a turn.
 *   - RELIABLE turn-end over 8kHz telephony: ~250ms local VAD + ~250ms AAD
 *     commit. 100ms committed turns on intra-word pauses (the old bug:
 *     "agent never hears my answer"), so the turn boundary now absorbs
 *     normal Kannada word gaps while still replying in well under a second.
 *   - Fast interruption: barge-in arms in ~150ms and only for speech-like
 *     frames, so room noise still cannot clear the agent's audio.
 *   - STABILITY: silence NEVER ends a call. The quiet-caller reprompt cycle
 *     loops forever (see kannada-script.ts); recovery ends in resume-and-
 *     listen, never in a hangup.
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
    // Sharpest hearing: high fixed gain forwards even a whisper at full
    // strength to Gemini (never duck the caller's own speech).
    inputGain: num(process.env.VOICE_INPUT_GAIN, 3.1),
    noiseFloorMin: num(process.env.VOICE_NOISE_FLOOR_MIN, 30),
    noiseFloorMax: num(process.env.VOICE_NOISE_FLOOR_MAX, 750),
    // Open the gate for very quiet speech (≈85 RMS ≈ 3× typical noise floor).
    gateOpenMinRms: num(process.env.VOICE_GATE_OPEN_MIN_RMS, 85),
    gateOpenMaxRms: num(process.env.VOICE_GATE_OPEN_MAX_RMS, 1100),
    gateFloorMult: num(process.env.VOICE_GATE_FLOOR_MULT, 1.75),
    gateCloseRatio: num(process.env.VOICE_GATE_CLOSE_RATIO, 0.6),
    gateReleaseMs: num(process.env.VOICE_GATE_RELEASE_MS, 220),
    gateFloor: num(process.env.VOICE_GATE_FLOOR, 0.72),
    // Fast interruption: arms in ~150ms but only for speech-like frames —
    // TV/room noise still cannot clear AI audio. Absolute floor lowered to
    // 1700 so a NORMAL-volume interruption is never ignored.
    bargeInMinRms: num(process.env.VOICE_BARGE_IN_MIN_RMS, 1700),
    bargeInFloorMult: num(process.env.VOICE_BARGE_IN_FLOOR_MULT, 6.5),
    bargeInMinMs: num(process.env.VOICE_BARGE_IN_MIN_MS, 150),
    bargeInRequireGateOpen: str(process.env.VOICE_BARGE_IN_REQUIRE_GATE, '1') !== '0',
    // VAD start threshold ≈ half a quiet "yes" — soft speech still counts.
    vadEnergyMinRms: num(process.env.VOICE_VAD_ENERGY_MIN_RMS, 85),
    vadEnergyFloorMult: num(process.env.VOICE_VAD_ENERGY_FLOOR_MULT, 1.45),
    // Turn-end: ~250ms local VAD + ~250ms AAD. 100ms was TOO aggressive on
    // 8kHz telephony: intra-word pauses committed half-spoken turns, and the
    // fragmented audio never produced a transcript ("agent ignores speech").
    // 250ms absorbs Kannada word gaps and still commits a short "ಹೌದು" fast.
    vadSilenceMs: silenceMs(process.env.VOICE_VAD_SILENCE_MS, 250),
    aadSilenceDurationMs: silenceMs(process.env.VOICE_AAD_SILENCE_MS, 250),
    // Padding PRECEDES detected speech: 120ms keeps opening syllables of soft
    // Kannada replies inside the turn instead of clipped as pre-turn noise.
    aadPrefixPaddingMs: num(process.env.VOICE_AAD_PREFIX_PADDING_MS, 120),
    // HIGH end sensitivity = Gemini commits the turn promptly; start stays
    // HIGH so the very first syllable of a soft reply is picked up.
    aadEndSensitivity: str(process.env.VOICE_AAD_END_SENSITIVITY, 'END_SENSITIVITY_HIGH'),
    aadStartSensitivity: str(process.env.VOICE_AAD_START_SENSITIVITY, 'START_SENSITIVITY_HIGH'),
    // Recovery budget: nudge within ~0.7s of speech end, full recovery
    // ladder (nudge → escalate → regenerate) inside ~2s. See speech-recovery.ts.
    responseWatchdogMs: num(process.env.VOICE_RESPONSE_WATCHDOG_MS, 700),
    // Speech-like: slightly relaxed crest floor accepts soft/hoarse voices;
    // ZCR still rejects steady TV/fan/AC tones.
    speechMinCrestFactor: num(process.env.VOICE_SPEECH_MIN_CREST, 1.8),
    speechMinZeroCrossRate: num(process.env.VOICE_SPEECH_MIN_ZCR, 0.03),
    speechQuietFloorMult: num(process.env.VOICE_SPEECH_QUIET_FLOOR_MULT, 1.08),
    speechLikeGateFloor: num(process.env.VOICE_SPEECH_LIKE_GATE_FLOOR, 0.88),
    voiceDebug: str(process.env.VOICE_DEBUG, '') === '1' || str(process.env.LATENCY_DEBUG, '') === '1',
  };
}
