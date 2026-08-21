import { SarvamAIClient } from 'sarvamai';

export function sarvamApiKey(): string {
  const key = (process.env.SARVAM_API_KEY || process.env.SARVAM_API_SUBSCRIPTION_KEY || '').trim();
  if (!key) {
    throw new Error('SARVAM_API_KEY is missing — set it in saas-platform/.env');
  }
  return key;
}

export function getSarvamClient(): SarvamAIClient {
  return new SarvamAIClient({ apiSubscriptionKey: sarvamApiKey() });
}

/**
 * Chat model for live voice.
 * Default: conversations-tuned 105B. For lower latency set SARVAM_CHAT_MODEL=sarvam-30b.
 */
export function sarvamChatModel(): string {
  return (process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations').trim();
}

/** Prefer realtime STT for voice agents (partials + fast VAD). */
export function sarvamSttModel(): string {
  return (process.env.SARVAM_STT_MODEL || 'saaras:v3-realtime').trim();
}

export function sarvamTtsModel(): string {
  return (process.env.SARVAM_TTS_MODEL || 'bulbul:v3').trim();
}

/** Female Kannada-friendly default for Bhoomi. */
export function sarvamTtsSpeaker(): string {
  return (process.env.SARVAM_TTS_SPEAKER || 'ishita').trim().toLowerCase();
}

/** Slightly brisk default for phone clarity / latency. */
export function sarvamTtsPace(): number {
  const n = Number(process.env.SARVAM_TTS_PACE || 1.08);
  return Number.isFinite(n) && n > 0 ? n : 1.08;
}

/** TTS WebSocket min buffer — Sarvam rejects values below ~50 (422 closes the socket). */
export function sarvamTtsMinBuffer(): number {
  const n = Number(process.env.SARVAM_TTS_MIN_BUFFER || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(50, Math.floor(n));
}

/** Max completion tokens for spoken turns (keep short). */
export function sarvamMaxTokens(): number {
  const n = Number(process.env.SARVAM_MAX_TOKENS || 160);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 160;
}

/** Realtime STT end-of-utterance silence (ms). */
export function sarvamSttSilenceMs(): number {
  const n = Number(process.env.SARVAM_STT_SILENCE_MS || 400);
  return Number.isFinite(n) && n >= 200 ? Math.floor(n) : 400;
}

export function useSarvamRealtimeStt(): boolean {
  const model = sarvamSttModel().toLowerCase();
  if (model.includes('realtime')) return true;
  return String(process.env.SARVAM_STT_REALTIME || '1') !== '0';
}
