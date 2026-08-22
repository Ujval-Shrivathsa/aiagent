/**
 * Trim LLM context for voice latency — full callguide stays in memory for Sarvam fallback,
 * but Gemini gets a bounded window so TTFT stays low on phone calls.
 */
import type { VoiceChatMessage } from './hybrid-chat';

const DEFAULT_MAX_SYSTEM_CHARS = Number(process.env.VOICE_LLM_MAX_SYSTEM_CHARS || 18000);
const DEFAULT_MAX_TURNS = Number(process.env.VOICE_LLM_MAX_TURNS || 14);

export function trimSystemInstructionForVoice(raw: string): string {
  const max = Number.isFinite(DEFAULT_MAX_SYSTEM_CHARS) ? DEFAULT_MAX_SYSTEM_CHARS : 18000;
  const text = (raw || '').trim();
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    '\n\n[Voice latency trim: earlier reference omitted. Use live data + conversation history.]'
  );
}

/** Keep core system + recent turns only for Gemini requests. */
export function compactMessagesForGemini(messages: VoiceChatMessage[]): VoiceChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const maxTurns = Number.isFinite(DEFAULT_MAX_TURNS) ? DEFAULT_MAX_TURNS : 14;

  const coreSystem = system.slice(0, 1).map((m) => ({
    ...m,
    content: trimSystemInstructionForVoice(m.content),
  }));
  const dynamicSystem = system.slice(1).slice(-2);

  return [...coreSystem, ...dynamicSystem, ...rest.slice(-maxTurns)];
}
