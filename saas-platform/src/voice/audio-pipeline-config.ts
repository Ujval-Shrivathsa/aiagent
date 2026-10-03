/**
 * Live voice audio pipeline thresholds.
 *
 * Stages (do not conflate):
 *   1. raw telephony mu-law  — recording only
 *   2. denoised PCM          — HP + adaptive gate + gain (this module)
 *   3. speech detection      — classifyFrame + debounced gate + local VAD + Gemini AAD
 *   4. transcription         — Gemini inputAudioTranscription
 *   5. assistant generation  — Gemini Live AUDIO modality
 *
 * PERFORMANCE CONTRACT (final requirement — do not regress):
 *   - SPEECH-FIRST DETECTION: a caller turn STARTS only after ~60ms of
 *     consecutive speech-class frames (band-energy + flatness + crest
 *     evidence). Single noisy frames — doors, keyboard, one loud packet —
 *     can NEVER start a turn. This is the fix for "background noise
 *     triggers the agent".
 *   - SHARP HEARING: energy thresholds stay LOW (85 RMS floor-relative) and
 *     classification requires positive speech evidence, not high volume —
 *     normal and quiet speech are detected without shouting. This is the
 *     fix for "users must scream": the old floor tracked UP under sustained
 *     speech; the classification-driven floor now NEVER tracks up on
 *     speech-class frames.
 *   - RELIABLE turn-end over 8kHz telephony: ~250ms local VAD + ~250ms AAD
 *     commit. Do NOT shorten these for latency: an aggressive value commits
 *     half-spoken turns, the audio never transcribes, and the agent loops
 *     "I couldn't hear you" instead of listening.
 *   - Fast interruption: barge-in arms in ~150ms and only for speech-class
 *     frames, so room noise still cannot clear the agent's audio.
 *   - SILENCE: one availability-check line, then if the caller is still quiet
 *     10s later the call ends. Never an endless "are you still there?" loop.
 *   - NOISE NEVER REACHES THE MODEL: 'speech' and 'ambiguous' frames are
 *     forwarded at full volume (ambiguous is what protects very quiet speech
 *     starts); 'noise' frames are replaced with digital silence before they
 *     reach Gemini. The chunk is still SENT so the stream never looks stalled
 *     to the reconnect watchdog.
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
  // --- Noise-floor adaptation (classification-driven) ---
  floorSteadyRate: number;
  floorTransientRate: number;
  floorAiPlayingSteadyRate: number;
  floorAiPlayingTransientRate: number;
  floorSpeechRate: number;
  floorQuietPullMult: number;
  floorQuietPullRate: number;
  // --- Noise gate (barge-in eligibility only — audio is always forwarded) ---
  gateOpenMinRms: number;
  gateOpenMaxRms: number;
  gateFloorMult: number;
  gateCloseRatio: number;
  gateReleaseMs: number;
  bargeInMinRms: number;
  bargeInFloorMult: number;
  bargeInMinMs: number;
  /** Require the noise gate to be open before local barge-in fires. */
  bargeInRequireGateOpen: boolean;
  // --- Frame classification (speech vs noise vs ambiguous) ---
  speechScoreMin: number;
  speechAmbiguousScoreMin: number;
  speechMaxLowEnergyRatio: number;
  speechMaxFlatness: number;
  speechSilentFloorMult: number;
  // --- Debounced speech gate (turn START) ---
  speechGateStartMs: number;
  speechGateWindowMs: number;
  speechGateSpeakingToleranceMs: number;
  // --- Local VAD (turn END) ---
  vadEnergyMinRms: number;
  vadEnergyFloorMult: number;
  vadSilenceMs: number;
  // --- Gemini AAD ---
  aadSilenceDurationMs: number;
  aadPrefixPaddingMs: number;
  aadEndSensitivity: string;
  aadStartSensitivity: string;
  /** Nudge Gemini if no audio reply this long after customer speech ends. */
  responseWatchdogMs: number;
  voiceDebug: boolean;
};

export function loadAudioPipelineConfig(): AudioPipelineConfig {
  return {
    // Sharpest hearing: high fixed gain forwards even a whisper at full
    // strength to Gemini (never duck the caller's own speech).
    inputGain: num(process.env.VOICE_INPUT_GAIN, 4.5),
    noiseFloorMin: num(process.env.VOICE_NOISE_FLOOR_MIN, 30),
    noiseFloorMax: num(process.env.VOICE_NOISE_FLOOR_MAX, 750),
    // Floor adaptation: sustained noise (fan/AC) converges at 6%/frame (~1s
    // to converge); transients barely move it. SPEECH NEVER RAISES THE FLOOR —
    // enforced structurally in nextNoiseFloorRms (the old fixed-rate blend
    // tracked the floor up under a continuous speaker until only shouting
    // cleared the thresholds — the scream-trap). floorSpeechRate is kept for
    // env backward-compat only and is ignored by the adaptation.
    floorSteadyRate: num(process.env.VOICE_FLOOR_STEADY_RATE, 0.06),
    floorTransientRate: num(process.env.VOICE_FLOOR_TRANSIENT_RATE, 0.008),
    floorAiPlayingSteadyRate: num(process.env.VOICE_FLOOR_AI_STEADY_RATE, 0.012),
    floorAiPlayingTransientRate: num(process.env.VOICE_FLOOR_AI_TRANSIENT_RATE, 0.003),
    floorSpeechRate: num(process.env.VOICE_FLOOR_SPEECH_RATE, 0),
    floorQuietPullMult: num(process.env.VOICE_FLOOR_QUIET_PULL_MULT, 1.9),
    floorQuietPullRate: num(process.env.VOICE_FLOOR_QUIET_PULL_RATE, 0.07),
    // Gate: opens on speech-class frames above the floor-relative threshold;
    // eligibility signal for local barge-in ONLY.
    gateOpenMinRms: num(process.env.VOICE_GATE_OPEN_MIN_RMS, 85),
    gateOpenMaxRms: num(process.env.VOICE_GATE_OPEN_MAX_RMS, 1100),
    gateFloorMult: num(process.env.VOICE_GATE_FLOOR_MULT, 1.75),
    gateCloseRatio: num(process.env.VOICE_GATE_CLOSE_RATIO, 0.6),
    gateReleaseMs: num(process.env.VOICE_GATE_RELEASE_MS, 220),
    // Fast interruption: arms in ~150ms but only for speech-class frames —
    // TV/room noise still cannot clear AI audio. Absolute floor kept at 1700.
    bargeInMinRms: num(process.env.VOICE_BARGE_IN_MIN_RMS, 1700),
    bargeInFloorMult: num(process.env.VOICE_BARGE_IN_FLOOR_MULT, 6.5),
    bargeInMinMs: num(process.env.VOICE_BARGE_IN_MIN_MS, 150),
    bargeInRequireGateOpen: str(process.env.VOICE_BARGE_IN_REQUIRE_GATE, '1') !== '0',
    // Classification: positive evidence must clear 1.0 for 'speech';
    // low-band rumble (fan/AC/traffic) and flat-spectrum hiss (keyboard,
    // static) are NEGATIVE evidence. Ambiguous band keeps the frame
    // harmless-but-forwarded.
    speechScoreMin: num(process.env.VOICE_SPEECH_SCORE_MIN, 1.0),
    speechAmbiguousScoreMin: num(process.env.VOICE_SPEECH_AMBIGUOUS_MIN, 0.55),
    speechMaxLowEnergyRatio: num(process.env.VOICE_SPEECH_MAX_LOW_RATIO, 0.82),
    speechMaxFlatness: num(process.env.VOICE_SPEECH_MAX_FLATNESS, 0.78),
    speechSilentFloorMult: num(process.env.VOICE_SPEECH_SILENT_FLOOR_MULT, 1.1),
    // Debounced gate: ~3 consecutive speech frames (60ms) start a turn; the
    // candidate window forgives one diphthong gap; inside a turn, ≤140ms of
    // ambiguous frames never splits the turn. Onset cost is hidden inside
    // the AAD prefix padding — no perceived latency.
    speechGateStartMs: num(process.env.VOICE_SPEECH_GATE_START_MS, 40),
    speechGateWindowMs: num(process.env.VOICE_SPEECH_GATE_WINDOW_MS, 90),
    speechGateSpeakingToleranceMs: num(process.env.VOICE_SPEECH_GATE_TOLERANCE_MS, 140),
    // VAD start threshold ≈ half a quiet "yes" — soft speech still counts.
    // END-side only now: the START side is owned by the debounced gate.
    vadEnergyMinRms: num(process.env.VOICE_VAD_ENERGY_MIN_RMS, 85),
    vadEnergyFloorMult: num(process.env.VOICE_VAD_ENERGY_FLOOR_MULT, 1.45),
    // Turn-end budget — RESTORED to the proven-safe value.
    // 250ms local VAD + 250ms AAD. An aggressive 60ms version was tried for
    // latency and REGRESSED: on 8kHz telephony it committed half-spoken turns,
    // the fragmented audio never produced a transcript, and the agent looped
    // "I couldn't hear you" instead of listening. Correctness wins over ~130ms;
    // if this is ever retuned, watch the "couldn't hear" counter, not latency.
    vadSilenceMs: silenceMs(process.env.VOICE_VAD_SILENCE_MS, 250),
    aadSilenceDurationMs: silenceMs(process.env.VOICE_AAD_SILENCE_MS, 250),
    // Padding PRECEDES detected speech, so it is pre-roll, NOT added latency:
    // 120ms keeps the opening syllables of a soft Kannada reply inside the turn
    // instead of clipping them as pre-turn noise.
    aadPrefixPaddingMs: num(process.env.VOICE_AAD_PREFIX_PADDING_MS, 120),
    // HIGH end sensitivity = Gemini commits the turn promptly; start stays
    // HIGH so the very first syllable of a soft reply is picked up.
    aadEndSensitivity: str(process.env.VOICE_AAD_END_SENSITIVITY, 'END_SENSITIVITY_HIGH'),
    aadStartSensitivity: str(process.env.VOICE_AAD_START_SENSITIVITY, 'START_SENSITIVITY_HIGH'),
    // Recovery budget: nudge within ~0.7s of speech end, full recovery
    // ladder (nudge → escalate → regenerate) inside ~2s. See speech-recovery.ts.
    responseWatchdogMs: num(process.env.VOICE_RESPONSE_WATCHDOG_MS, 700),
    voiceDebug: str(process.env.VOICE_DEBUG, '') === '1' || str(process.env.LATENCY_DEBUG, '') === '1',
  };
}
