/**
 * TTS / speech-output configuration for Gemini Live.
 *
 * Separation of concerns:
 * - Gemini system prompts (kannada-style + callguides) produce short, natural
 *   spoken Kannada text / intent.
 * - This module configures the Live native-audio voice. There is no separate
 *   SSML / phoneme TTS stage on Live — pronunciation quality depends on
 *   script-first Kannada in the prompt + a calm multilingual voice.
 *
 * Native-audio models auto-select language (incl. kn). Do not hard-code en-IN
 * (that biased Kannada toward English phonology).
 *
 * Env:
 *   VOICE_TTS_VOICE_NAME=Kore|Aoede|Leda|...  (calm female default: Kore)
 *   VOICE_TTS_LANGUAGE_CODE=auto|kn-IN|en-IN
 */

export type LiveSpeechConfig = {
  voiceName: string;
  /** When null, language is left to the native-audio model (recommended). */
  languageCode: string | null;
  provider: 'gemini-live-native';
  /** Documented delivery target for operators — Live API has no pitch/rate SSML. */
  deliveryNotes: string;
};

export function loadLiveSpeechSettings(): LiveSpeechConfig {
  const voiceName = (process.env.VOICE_TTS_VOICE_NAME || 'Kore').trim() || 'Kore';
  const raw = (process.env.VOICE_TTS_LANGUAGE_CODE || '').trim();
  const languageCode =
    !raw || raw.toLowerCase() === 'auto' ? null : raw;
  return {
    voiceName,
    languageCode,
    provider: 'gemini-live-native',
    deliveryNotes:
      'Calm understated delivery via prompt (warmth~6.5 confidence~7.5 energy~5.5). ' +
      'No SSML rate/pitch on Live — keep Gemini replies short so pacing stays natural.',
  };
}

/** Shape expected by @google/genai live.connect speechConfig. */
export function buildLiveSpeechConfig(settings: LiveSpeechConfig = loadLiveSpeechSettings()): Record<string, unknown> {
  const speechConfig: Record<string, unknown> = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName } },
  };
  if (settings.languageCode) {
    speechConfig.languageCode = settings.languageCode;
  }
  return speechConfig;
}

export function describeSpeechConfig(settings: LiveSpeechConfig = loadLiveSpeechSettings()): string {
  const lang = settings.languageCode || 'auto (native multilingual, includes kn)';
  return `provider=${settings.provider} voice=${settings.voiceName} language=${lang}`;
}
