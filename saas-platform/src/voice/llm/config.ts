/**
 * LLM routing for the Sarvam voice stack (STT + TTS stay on Sarvam).
 * Gemini handles reasoning / multilingual replies; Sarvam is fallback.
 */

export type VoiceLlmProvider = 'gemini' | 'sarvam' | 'auto';

export function voiceLlmProvider(): VoiceLlmProvider {
  const raw = (process.env.VOICE_LLM_PROVIDER || 'auto').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'google') return 'gemini';
  if (raw === 'sarvam') return 'sarvam';
  return 'auto';
}

export function geminiApiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key || null;
}

/** Fast chat model — low TTFT, tool calling, strong multilingual reasoning. */
export function geminiChatModel(): string {
  return (process.env.VOICE_GEMINI_CHAT_MODEL || 'gemini-3.1-flash-lite').trim();
}

export function geminiChatModelFallback(): string {
  return (process.env.VOICE_GEMINI_CHAT_MODEL_FALLBACK || 'gemini-3.5-flash').trim();
}

export function resolveActiveLlmProvider(): 'gemini' | 'sarvam' {
  const pref = voiceLlmProvider();
  if (pref === 'sarvam') return 'sarvam';
  if (pref === 'gemini') {
    if (!geminiApiKey()) {
      console.warn('[VOICE LLM] VOICE_LLM_PROVIDER=gemini but GEMINI_API_KEY missing — using Sarvam');
      return 'sarvam';
    }
    return 'gemini';
  }
  // auto
  return geminiApiKey() ? 'gemini' : 'sarvam';
}

export function geminiMaxOutputTokens(): number {
  const n = Number(process.env.VOICE_GEMINI_MAX_TOKENS || process.env.SARVAM_MAX_TOKENS || 70);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 70;
}
