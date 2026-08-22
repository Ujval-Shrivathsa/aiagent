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
 * sarvam-30b is deprecated — use 105b-conversations (quality + tool calling).
 */
export function sarvamChatModel(): string {
  const raw = (process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations').trim();
  if (/sarvam-30b/i.test(raw)) {
    console.warn('[SARVAM] sarvam-30b is deprecated — using sarvam-105b-conversations');
    return 'sarvam-105b-conversations';
  }
  return raw || 'sarvam-105b-conversations';
}

/** Prefer realtime STT for voice agents (partials + fast VAD). */
export function sarvamSttModel(): string {
  return (process.env.SARVAM_STT_MODEL || 'saaras:v3-realtime').trim();
}

export function sarvamTtsModel(): string {
  return (process.env.SARVAM_TTS_MODEL || 'bulbul:v3').trim();
}

/**
 * Language-aware Bulbul speaker (CER-ranked for kn/en).
 * Override: SARVAM_TTS_SPEAKER (both), or SARVAM_TTS_SPEAKER_KN / _EN.
 */
export function sarvamTtsSpeaker(language?: 'kn-IN' | 'en-IN'): string {
  const shared = (process.env.SARVAM_TTS_SPEAKER || '').trim().toLowerCase();
  if (language === 'en-IN') {
    return (process.env.SARVAM_TTS_SPEAKER_EN || shared || 'ishita').trim().toLowerCase();
  }
  // kn-IN default: ishita (top Kannada female); neha also strong
  return (process.env.SARVAM_TTS_SPEAKER_KN || shared || 'ishita').trim().toLowerCase();
}

export function sarvamTtsPace(language?: 'kn-IN' | 'en-IN'): number {
  const envKey = language === 'en-IN' ? 'SARVAM_TTS_PACE_EN' : 'SARVAM_TTS_PACE_KN';
  const raw = process.env[envKey] || process.env.SARVAM_TTS_PACE;
  const fallback = language === 'en-IN' ? 1.05 : 1.0;
  const n = Number(raw || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2, Math.max(0.5, n));
}

export function sarvamTtsTemperature(language?: 'kn-IN' | 'en-IN'): number {
  const envKey = language === 'en-IN' ? 'SARVAM_TTS_TEMPERATURE_EN' : 'SARVAM_TTS_TEMPERATURE_KN';
  const raw = process.env[envKey] || process.env.SARVAM_TTS_TEMPERATURE;
  // kn-IN: slightly warmer for natural everyday prosody (still phone-clear)
  const fallback = language === 'en-IN' ? 0.45 : 0.68;
  const n = Number(raw || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0.01, n));
}

/** Synthesize at 22050 Hz (Ishita/kn production default) → resample to 8 kHz µ-law. */
export function sarvamTtsSampleRate(): 8000 | 16000 | 22050 | 24000 {
  const n = Number(process.env.SARVAM_TTS_SAMPLE_RATE || 22050);
  if (n === 24000 || n === 22050 || n === 16000 || n === 8000) return n as any;
  return 22050;
}

/** TTS WebSocket min buffer — Sarvam rejects values below ~50 (422 closes the socket). */
export function sarvamTtsMinBuffer(): number {
  const n = Number(process.env.SARVAM_TTS_MIN_BUFFER || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(50, Math.floor(n));
}

/** Max completion tokens for spoken turns (short = faster TTFA). */
export function sarvamMaxTokens(): number {
  const n = Number(process.env.SARVAM_MAX_TOKENS || 70);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 70;
}

/** Legacy STT language — kn-IN for Mysuru (unknown often mislabels Kannada as bn/hi). */
export function sarvamSttLanguage(): string {
  return (process.env.SARVAM_STT_LANGUAGE || 'kn-IN').trim();
}

/** Realtime STT end-of-utterance silence (ms). */
export function sarvamSttSilenceMs(): number {
  const n = Number(process.env.SARVAM_STT_SILENCE_MS || 350);
  return Number.isFinite(n) && n >= 200 ? Math.floor(n) : 350;
}

/**
 * Legacy VAD silence window (frames @ 8 kHz ≈ 64ms each).
 * ~7 frames ≈ 450ms — listens through short pauses without feeling sluggish.
 */
export function sarvamSttNegativeFrames(): number {
  const n = Number(process.env.SARVAM_STT_NEGATIVE_FRAMES || 7);
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : 7;
}

/** Try realtime STT first (streaming + faster endpointing); legacy fallback on 401. */
export function useSarvamRealtimeStt(): boolean {
  const raw = String(process.env.SARVAM_STT_REALTIME ?? '1').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

/** Pre-speech ring buffer (20ms frames) — keeps ~600ms for barge-in word capture. */
export function sttPrerollFrames(): number {
  const n = Number(process.env.SARVAM_STT_PREROLL_FRAMES || 30);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}
