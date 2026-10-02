/**
 * TTS / speech-output configuration for Gemini Live.
 *
 * Separation of concerns:
 * - Gemini system prompts (kannada-script.ts + the delivery rules) shape HOW
 *   the voice sounds — that is the only prosody control this API exposes.
 * - This module configures the Live native-audio voice, the language code, and
 *   the behavioural flags that make the model sound like a person.
 *
 * WHY KANNADA IS "auto" AND NOT "kn-IN":
 * Google's documented Live/TTS language list has 29 locales (ta-IN, te-IN,
 * mr-IN, hi-IN, en-IN, ...) and Kannada is NOT one of them. Sending `kn-IN` is
 * accepted with HTTP 200 but is silently ignored — we verified this by
 * synthesizing the same Kannada line under kn-IN / ta-IN / omitted and getting
 * byte counts within run-to-run noise. The model detects Kannada from the
 * script on its own, which is exactly the behaviour we want.
 * Sending nothing is therefore BOTH correct and better: the native-audio model
 * then follows the caller's language naturally instead of being pinned.
 *
 * Env:
 *   VOICE_TTS_VOICE_NAME=Kore|Despina|Vindemiatrix|...  (see voice-lab/)
 *   VOICE_TTS_VOICE_NAME_EN=...  (optional English voice; defaults to same)
 *   VOICE_TTS_LANGUAGE_CODE=auto|kn-IN|en-IN|mr-IN|hi-IN (auto = native)
 *   VOICE_AFFECTIVE_DIALOG=1     (UNSUPPORTED on this model — see note below)
 *   VOICE_LLM_TEMPERATURE=1.0    (wording variety without inventing facts)
 *
 * WHY enableAffectiveDialog IS OFF BY DEFAULT:
 * `gemini-3.1-flash-live-preview` REJECTS that flag — the session is refused at
 * setup with gRPC code 1007 "Request contains an invalid argument", and the call
 * produces zero audio. Verified by probing each flag in isolation. The same is
 * true of `proactivity.proactiveAudio`. Both are great features and both are
 * worth turning back on the moment the model is upgraded to one that accepts
 * them — but enabling either today takes the whole voice down, so they stay
 * gated behind env vars that default OFF.
 */

export type LiveSpeechConfig = {
  voiceName: string;
  voiceNameEn: string;
  /** null = leave language to the native-audio model. The correct default. */
  languageCode: string | null;
  provider: 'gemini-live-native';
  /** Lets the model detect caller emotion and adapt delivery to it. */
  affectiveDialog: boolean;
  /** Small nudge for phrasing variety; guarded by the never-invent-facts rules. */
  temperature: number;
  deliveryNotes: string;
};

/**
 * Kannada has no documented Live locale, so it is served by the model's native
 * multilingual detection rather than a languageCode. Anything Kannada-ish, plus
 * the literal "auto", normalizes to null (send nothing).
 */
export function normalizeLiveLanguageCode(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === 'auto') return null;
  // Kannada is auto-detected — see the note at the top of this file.
  if (v === 'kn' || v === 'kn-in' || v.startsWith('kn-')) return null;
  return (raw as string).trim();
}

function readFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return !/^(0|false|off|no|disabled)$/i.test(raw.trim());
}

export function loadLiveSpeechSettings(): LiveSpeechConfig {
  const voiceName = (process.env.VOICE_TTS_VOICE_NAME || 'Kore').trim() || 'Kore';
  const voiceNameEn =
    (process.env.VOICE_TTS_VOICE_NAME_EN || voiceName).trim() || voiceName;
  const languageCode = normalizeLiveLanguageCode(process.env.VOICE_TTS_LANGUAGE_CODE);

  const tempRaw = Number(process.env.VOICE_LLM_TEMPERATURE);
  const temperature = Number.isFinite(tempRaw) ? Math.min(1.4, Math.max(0.5, tempRaw)) : 1.0;

  return {
    voiceName,
    voiceNameEn,
    languageCode,
    provider: 'gemini-live-native',
    // A cold caller who sounds tired should meet a Priya who softens, and an
    // excited caller a brighter one. Off by default ONLY because this model
    // rejects the flag (see header). Emotion adaptation is therefore carried
    // by the prompt instead — see VOICE_DELIVERY in kannada-script.ts.
    affectiveDialog: readFlag('VOICE_AFFECTIVE_DIALOG', false),
    temperature,
    deliveryNotes:
      'Warm, close-mic, unhurried phone delivery — shaped by the prompt, since the ' +
      'Live API exposes no rate/pitch/SSML. Natural spoken Kannada, complete ' +
      'sentences, real breaths, audible smile. Voice: see voice-lab/ for the A/B.',
  };
}

/** Shape expected by @google/genai live.connect speechConfig. */
export function buildLiveSpeechConfig(
  settings: LiveSpeechConfig = loadLiveSpeechSettings(),
  languageOverride?: string | null,
): Record<string, unknown> {
  const lang =
    languageOverride === undefined
      ? settings.languageCode
      : normalizeLiveLanguageCode(languageOverride);
  const voice =
    lang === 'en-IN' || lang === 'en-US' || lang === 'en'
      ? settings.voiceNameEn
      : settings.voiceName;
  const speechConfig: Record<string, unknown> = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
  };
  // Kannada (and "auto") send NO languageCode on purpose — see file header.
  if (lang) {
    speechConfig.languageCode = lang;
  }
  return speechConfig;
}

/**
 * Behavioural flags merged into the Live session config. Split out from
 * buildLiveSpeechConfig because these are not speech settings — they change how
 * the model *behaves*, and are tuned separately from the voice.
 *
 * Only keys the model actually accepts are emitted. An unsupported key does not
 * degrade gracefully here: the whole session is refused at setup with code 1007
 * and the call goes silent, so the gates below are deliberate, not decorative.
 */
export function buildLiveVoiceBehaviorConfig(
  settings: LiveSpeechConfig = loadLiveSpeechSettings(),
): Record<string, unknown> {
  const config: Record<string, unknown> = { temperature: settings.temperature };
  // Verified rejected by gemini-3.1-flash-live-preview — keep gated.
  if (settings.affectiveDialog) config.enableAffectiveDialog = true;
  return config;
}

export function describeSpeechConfig(
  settings: LiveSpeechConfig = loadLiveSpeechSettings(),
  languageOverride?: string | null,
): string {
  const lang =
    languageOverride === undefined
      ? settings.languageCode || 'auto (native multilingual)'
      : normalizeLiveLanguageCode(languageOverride) || 'auto (native multilingual)';
  return (
    `provider=${settings.provider} voice=${settings.voiceName} language=${lang} ` +
    `affective=${settings.affectiveDialog ? 'on' : 'off'} temp=${settings.temperature}`
  );
}