/**
 * Hybrid voice LLM: Gemini (reasoning) with Sarvam fallback.
 * Used by the Sarvam voice stack — STT/TTS remain on Sarvam.
 */
import { GoogleGenAI } from '@google/genai';
import type { SarvamAIClient } from 'sarvamai';
import type { ConversationLanguage } from '../language/conversation-language';
import { sarvamChatModel, sarvamMaxTokens } from '../sarvam/config';
import { SARVAM_TOOLS } from '../sarvam/tools';
import {
  geminiApiKey,
  geminiChatModel,
  geminiChatModelFallback,
  geminiMaxOutputTokens,
  resolveActiveLlmProvider,
} from './config';
import { compactMessagesForGemini } from './context';
import { GEMINI_VOICE_TOOLS } from './gemini-tools';

export type VoiceChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: VoiceToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type VoiceToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type VoiceChatStreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_pending' }
  | { type: 'done'; content: string; toolCalls?: VoiceToolCall[]; provider: 'gemini' | 'sarvam' };

export type StreamVoiceChatOptions = {
  messages: VoiceChatMessage[];
  language: ConversationLanguage;
  sarvamClient: SarvamAIClient;
  signal?: AbortSignal;
};

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function splitSystemAndContents(messages: VoiceChatMessage[]): {
  systemInstruction: string;
  contents: Array<{ role: string; parts: any[] }>;
} {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content.trim());
  const systemInstruction = systemParts.join('\n\n');
  const contents: Array<{ role: string; parts: any[] }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts: any[] = [];
      if (msg.content?.trim()) parts.push({ text: msg.content });
      for (const tc of msg.tool_calls || []) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({
          functionCall: {
            id: tc.id,
            name: tc.function.name,
            args,
          },
        });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    if (msg.role === 'tool') {
      let response: Record<string, unknown> = {};
      try {
        response = JSON.parse(msg.content || '{}');
      } catch {
        response = { result: msg.content };
      }
      const name =
        messages
          .flatMap((m) => (m.role === 'assistant' ? m.tool_calls || [] : []))
          .find((tc) => tc.id === msg.tool_call_id)?.function.name || 'tool';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { id: msg.tool_call_id, name, response } }],
      });
    }
  }

  return { systemInstruction, contents };
}

function mergeGeminiFunctionCalls(
  acc: Map<string, VoiceToolCall>,
  parts: any[] | undefined,
): void {
  for (const part of parts || []) {
    const fc = part?.functionCall;
    if (!fc?.name) continue;
    const id = String(fc.id || `tool_${fc.name}_${acc.size}`);
    const existing = acc.get(id);
    if (!existing) {
      acc.set(id, {
        id,
        type: 'function',
        function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) },
      });
    } else {
      try {
        const prev = JSON.parse(existing.function.arguments || '{}');
        existing.function.arguments = JSON.stringify({ ...prev, ...(fc.args || {}) });
      } catch {
        existing.function.arguments = JSON.stringify(fc.args || {});
      }
    }
  }
}

async function* streamGeminiChat(opts: StreamVoiceChatOptions): AsyncGenerator<VoiceChatStreamEvent> {
  const key = geminiApiKey();
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const ai = new GoogleGenAI({ apiKey: key });
  const compact = compactMessagesForGemini(opts.messages);
  const { systemInstruction, contents } = splitSystemAndContents(compact);
  const temperature = opts.language === 'en' ? 0.35 : 0.52;
  const maxOutputTokens = geminiMaxOutputTokens();

  const models = [geminiChatModel(), geminiChatModelFallback()].filter(
    (m, i, arr) => m && arr.indexOf(m) === i,
  );

  let lastErr: unknown = null;
  for (const model of models) {
    if (isAborted(opts.signal)) return;
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: GEMINI_VOICE_TOOLS }],
          temperature,
          maxOutputTokens,
        },
      });

      let contentBuf = '';
      const toolAcc = new Map<string, VoiceToolCall>();
      let toolPending = false;

      for await (const chunk of stream) {
        if (isAborted(opts.signal)) return;
        mergeGeminiFunctionCalls(toolAcc, chunk.candidates?.[0]?.content?.parts);
        if (toolAcc.size && !toolPending) {
          toolPending = true;
          yield { type: 'tool_pending' };
        }
        if (toolPending) continue;
        const delta = chunk.text || '';
        if (delta) {
          contentBuf += delta;
          yield { type: 'token', delta };
        }
      }

      const toolCalls = toolAcc.size ? Array.from(toolAcc.values()) : undefined;
      yield { type: 'done', content: contentBuf, toolCalls, provider: 'gemini' };
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[VOICE LLM] Gemini ${model} failed:`, (e as Error)?.message || e);
    }
  }
  throw lastErr || new Error('Gemini chat failed');
}

async function* streamSarvamChat(opts: StreamVoiceChatOptions): AsyncGenerator<VoiceChatStreamEvent> {
  const compact = compactMessagesForGemini(opts.messages);
  const stream = await opts.sarvamClient.chat.completions({
    model: sarvamChatModel() as any,
    messages: compact as any,
    tools: SARVAM_TOOLS as any,
    tool_choice: 'auto' as any,
    temperature: opts.language === 'en' ? 0.35 : 0.48,
    max_tokens: sarvamMaxTokens(),
    reasoning_effort: null as any,
    stream: true,
  } as any);

  let contentBuf = '';
  let toolCalls: VoiceToolCall[] | undefined;
  let toolPending = false;

  for await (const chunk of stream as AsyncIterable<any>) {
    if (isAborted(opts.signal)) return;
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.tool_calls?.length) {
      if (!toolPending) {
        toolPending = true;
        yield { type: 'tool_pending' };
      }
      toolCalls = toolCalls || [];
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? toolCalls.length;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || `tool_${Date.now()}_${idx}`,
            type: 'function',
            function: { name: tc.function?.name || '', arguments: '' },
          };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (typeof delta.content === 'string' && delta.content) {
      if (toolPending) continue;
      contentBuf += delta.content;
      yield { type: 'token', delta: delta.content };
    }
  }

  const cleanToolCalls = toolCalls?.filter(Boolean);
  yield {
    type: 'done',
    content: contentBuf,
    toolCalls: cleanToolCalls?.length ? cleanToolCalls : undefined,
    provider: 'sarvam',
  };
}

/**
 * Stream one assistant turn. Uses Gemini when configured; falls back to Sarvam on error.
 */
export async function* streamVoiceChatTurn(
  opts: StreamVoiceChatOptions,
): AsyncGenerator<VoiceChatStreamEvent> {
  const provider = resolveActiveLlmProvider();
  if (provider === 'gemini') {
    try {
      yield* streamGeminiChat(opts);
      return;
    } catch (e) {
      console.warn('[VOICE LLM] Gemini failed — falling back to Sarvam:', (e as Error)?.message || e);
    }
  }
  yield* streamSarvamChat(opts);
}
