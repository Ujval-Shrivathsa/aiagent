/**
 * TTS / speech-output configuration for Gemini Live.
 *
 * Separation of concerns:
 * - Gemini system prompts (kannada-style + callguides) produce short, natural
 *   spoken Kannada text / intent.
 * - This module configures the Live native-audio voice + languageCode.
 *
 * Default: kn-IN so every new call starts in Kannada-capable TTS.
 * Conversation language tracker switches to en-IN (and back) from STT.
 *
 * Env:
 *   VOICE_TTS_VOICE_NAME=Kore|Sulafat|Aoede|Achernar|...  (default: Kore — original Priya voice)
 *   VOICE_TTS_LANGUAGE_CODE=auto|kn-IN|en-IN  (default: auto — best for Kannada+English mix)
 *   VOICE_TTS_VOICE_NAME_EN=...  (optional English voice; defaults to same)
 */

export type LiveSpeechConfig = {
  voiceName: string;
  voiceNameEn: string;
  /** When null, language is left to the native-audio model. Prefer kn-IN for new calls. */
  languageCode: string | null;
  provider: 'gemini-live-native';
  /** Documented delivery target for operators — Live API has no pitch/rate SSML. */
  deliveryNotes: string;
};

export function loadLiveSpeechSettings(): LiveSpeechConfig {
  const voiceName = (process.env.VOICE_TTS_VOICE_NAME || 'Kore').trim() || 'Kore';
  const voiceNameEn =
    (process.env.VOICE_TTS_VOICE_NAME_EN || voiceName).trim() || voiceName;
  const raw = (process.env.VOICE_TTS_LANGUAGE_CODE || 'kn-IN').trim();
  const languageCode =
    !raw || raw.toLowerCase() === 'auto' ? null : raw;
  return {
    voiceName,
    voiceNameEn,
    languageCode,
    provider: 'gemini-live-native',
    deliveryNotes:
      'Warm, calm, unhurried phone delivery via prompt. Natural Kanglish mix. ' +
      'Complete sentences — never rushed or clipped. Voice: Kore (override with VOICE_TTS_VOICE_NAME; Sulafat = warmer).',
  };
}

/** Shape expected by @google/genai live.connect speechConfig. */
export function buildLiveSpeechConfig(
  settings: LiveSpeechConfig = loadLiveSpeechSettings(),
  languageOverride?: string | null,
): Record<string, unknown> {
  const lang =
    languageOverride === undefined ? settings.languageCode : languageOverride;
  const voice =
    lang === 'en-IN' || lang === 'en-US' || lang === 'en'
      ? settings.voiceNameEn
      : settings.voiceName;
  const speechConfig: Record<string, unknown> = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
  };
  if (lang) {
    speechConfig.languageCode = lang;
  }
  return speechConfig;
}

export function describeSpeechConfig(
  settings: LiveSpeechConfig = loadLiveSpeechSettings(),
  languageOverride?: string | null,
): string {
  const lang =
    languageOverride === undefined
      ? settings.languageCode || 'auto (native multilingual)'
      : languageOverride || 'auto';
  return `provider=${settings.provider} voice=${settings.voiceName} language=${lang}`;
}
