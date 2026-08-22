/**
 * Voice brain selector.
 *
 *   VOICE_STACK=sarvam  → Sarvam STT + hybrid LLM (Gemini/Sarvam) + Bulbul TTS (default)
 *   VOICE_STACK=gemini  → Gemini Live native audio (previous default)
 *
 * Revert anytime by setting VOICE_STACK=gemini and restarting the server.
 */
export type VoiceStack = 'sarvam' | 'gemini';

export function getVoiceStack(): VoiceStack {
  const raw = (process.env.VOICE_STACK || 'sarvam').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'google') return 'gemini';
  return 'sarvam';
}
