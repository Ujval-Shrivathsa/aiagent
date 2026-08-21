/**
 * Sarvam voice stack: Saaras STT → Sarvam chat LLM → Bulbul TTS.
 * Plivo/Twilio media stays µ-law 8 kHz; STT gets PCM s16le; TTS returns µ-law.
 *
 * Revert: set VOICE_STACK=gemini and restart.
 */
import type { WebSocket } from 'ws';
import { prisma } from '../../lib/prisma';
import { fetchLiveSiteData, formatLiveDataForPrompt } from '../../lib/live-site-data';
import { buildInboundSystemInstruction, getGreeting as getInboundGreeting } from '../Inbound/index';
import { buildOutboundSystemInstruction, getGreeting as getOutboundGreeting } from '../Outbound/index';
import { CallCaptureSession } from '../call-capture/session';
import { callLog } from '../call-capture/logger';
import { LEAD_STATUS, outcomeFromFlags } from '../../lib/lead-status';
import {
  markAnsweredByPhone,
  markCallCompletedByPhone,
  markOutcomeByPhone,
  transitionLeadsByPhone,
} from '../../lib/lead-status-transitions';
import {
  emptyIdentity,
  formatIdentityContext,
  resolveCustomerIdentity,
  type CustomerIdentity,
} from '../customer-identity';
import { detectScriptLanguage } from '../language/script-detect';
import {
  languageCodeForConversation,
  resolveNextConversationLanguage,
  type ConversationLanguage,
} from '../language/conversation-language';
import { evaluateBargeIn } from '../turn-policy';
import {
  getSarvamClient,
  sarvamApiKey,
  sarvamChatModel,
  sarvamMaxTokens,
  sarvamSttModel,
  sarvamSttSilenceMs,
  sarvamTtsMinBuffer,
  sarvamTtsModel,
  sarvamTtsPace,
  sarvamTtsSpeaker,
  useSarvamRealtimeStt,
} from './config';
import { muLawByteToPcm, muLawBufferToPcm16le, pcm16leBufferToMuLaw } from './mulaw';
import { normalizeVoiceEvent } from './normalize-event';
import { SARVAM_TOOLS } from './tools';

const STATUS = LEAD_STATUS;
const MAX_HISTORY_MESSAGES = 24;

/** Split on sentence boundaries for early TTS (Kannada danda + Latin punct). */
function takeCompleteSentences(buffer: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buffer;
  const re = /[.!?।\n]+[\s]*/g;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = re.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const piece = buffer.slice(last, end).trim();
    if (piece) ready.push(piece);
    last = end;
  }
  rest = buffer.slice(last);
  return { ready, rest };
}

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: any[] }
  | { role: 'tool'; content: string; tool_call_id: string };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
  });
}

export async function setupSarvam(ws: WebSocket, _streamParams?: URLSearchParams) {
  const client = getSarvamClient();
  let audioSink: 'twilio' | 'plivo' =
    (process.env.VOICE_PROVIDER || 'twilio').toLowerCase() === 'plivo' ? 'plivo' : 'twilio';
  let streamSid: string | null = null;
  let capture: CallCaptureSession | null = null;
  let sttSocket: any = null;
  let ttsSocket: any = null;
  let transcriptCount = 0;
  let startTime = Date.now();
  let customerPhone: string | null = null;
  let fullTranscription = '';
  let isFirstResponse = true;
  let isOutboundCall = false;
  let customerIdentity: CustomerIdentity = emptyIdentity();
  let conversationLanguage: ConversationLanguage = 'kn';
  let ttsLanguageCode: 'kn-IN' | 'en-IN' = 'kn-IN';
  let closed = false;
  let turnBusy = false;
  let endCallInvoked = false;
  let suppressAiOutput = false;
  let aiPlaybackEndsAt = 0;
  let bargeInStartedAt: number | null = null;
  const messages: ChatMessage[] = [];

  let sttMode: 'realtime' | 'legacy' = 'realtime';

  /** Single TTS completion waiter (SDK allows only one `on('message')` handler). */
  let ttsWaiter: { resolve: () => void; timer: NodeJS.Timeout } | null = null;

  const hangupStream = () => {
    try {
      if (audioSink === 'plivo') {
        ws.send(JSON.stringify({ event: 'stop', streamId: streamSid }));
      } else {
        ws.send(JSON.stringify({ event: 'stop', streamSid }));
      }
    } catch {
      /* ignore */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  const clearPlayback = () => {
    suppressAiOutput = true;
    capture?.onAiPlaybackCleared();
    aiPlaybackEndsAt = 0;
    bargeInStartedAt = null;
    if (!streamSid) return;
    try {
      if (audioSink === 'plivo') {
        ws.send(JSON.stringify({ event: 'clearAudio', streamId: streamSid }));
      } else {
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
      }
    } catch {
      /* ignore */
    }
  };

  const allowAiOutput = () => {
    suppressAiOutput = false;
    capture?.onAiRecordingAllow();
  };

  const sendMuLawToPhone = (muLaw: Buffer) => {
    if (!streamSid || suppressAiOutput || muLaw.length === 0) return;
    capture?.onAiSpeakStart();
    capture?.onAiMuLaw(muLaw);
    aiPlaybackEndsAt = Math.max(Date.now(), aiPlaybackEndsAt) + muLaw.length / 8;
    const payload = muLaw.toString('base64');
    if (audioSink === 'plivo') {
      ws.send(
        JSON.stringify({
          event: 'playAudio',
          media: {
            contentType: 'audio/x-mulaw',
            sampleRate: 8000,
            payload,
          },
        }),
      );
    } else {
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
    }
  };

  const configureTts = () => {
    if (!ttsSocket) return;
    ttsSocket.configureConnection({
      speaker: sarvamTtsSpeaker(),
      language_code: ttsLanguageCode,
      speech_sample_rate: 8000,
      output_audio_codec: 'mulaw',
      pace: sarvamTtsPace(),
      min_buffer_size: sarvamTtsMinBuffer(),
      max_chunk_length: 120,
    });
  };

  const trimMessageHistory = () => {
    if (messages.length <= MAX_HISTORY_MESSAGES) return;
    const system = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    messages.length = 0;
    messages.push(...system.slice(0, 3), ...rest.slice(-(MAX_HISTORY_MESSAGES - 3)));
  };

  const onTtsMessage = (msg: any) => {
    if (msg?.type === 'audio' && msg?.data?.audio) {
      const raw = Buffer.from(msg.data.audio, 'base64');
      const codec = String(msg.data.content_type || '').toLowerCase();
      let muLaw: Buffer;
      if (codec.includes('linear') || codec.includes('l16') || codec.includes('pcm')) {
        muLaw = pcm16leBufferToMuLaw(raw);
      } else {
        muLaw = raw;
      }
      sendMuLawToPhone(muLaw);
    } else if (msg?.type === 'event' && msg?.data?.event_type === 'final') {
      if (ttsWaiter) {
        clearTimeout(ttsWaiter.timer);
        const done = ttsWaiter.resolve;
        ttsWaiter = null;
        capture?.onAiTurnComplete();
        capture?.onAiSpeakEnd();
        done();
      }
    } else if (msg?.type === 'error') {
      console.error('[SARVAM TTS]', msg.data);
      if (ttsWaiter) {
        clearTimeout(ttsWaiter.timer);
        const done = ttsWaiter.resolve;
        ttsWaiter = null;
        done();
      }
    }
  };

  /** Queue text to TTS without waiting (for streamed LLM sentences). */
  const enqueueTts = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !ttsSocket) return;
    allowAiOutput();
    try {
      ttsSocket.convert(trimmed);
    } catch (e: any) {
      console.error('[SARVAM TTS] convert failed:', e?.message || e);
    }
  };

  const flushTtsAndWait = async (): Promise<void> => {
    if (!ttsSocket) return;
    return new Promise((resolve) => {
      if (ttsWaiter) {
        clearTimeout(ttsWaiter.timer);
        ttsWaiter.resolve();
      }
      const timer = setTimeout(() => {
        ttsWaiter = null;
        capture?.onAiTurnComplete();
        capture?.onAiSpeakEnd();
        resolve();
      }, 20000);
      ttsWaiter = { resolve, timer };
      try {
        ttsSocket.flush();
      } catch (e: any) {
        console.error('[SARVAM TTS] flush failed:', e?.message || e);
        clearTimeout(timer);
        ttsWaiter = null;
        resolve();
      }
    });
  };

  const speakText = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || !ttsSocket) return;
    capture?.onAiText(trimmed);
    fullTranscription += `AI: ${trimmed}\n`;
    transcriptCount++;
    allowAiOutput();
    configureTts();
    // Prefer short chunks for lower first-byte latency
    const { ready, rest } = takeCompleteSentences(trimmed + ' ');
    const parts = ready.length ? ready : [trimmed];
    if (rest.trim()) parts.push(rest.trim());
    for (const part of parts) enqueueTts(part);
    await flushTtsAndWait();
  };

  const applyLanguageFromTranscript = (text: string) => {
    const resolved = resolveNextConversationLanguage(conversationLanguage, text);
    if (resolved.switched || resolved.language !== conversationLanguage) {
      conversationLanguage = resolved.language;
      ttsLanguageCode = languageCodeForConversation(resolved.language);
      console.log(`[SARVAM] Language → ${conversationLanguage} tts=${ttsLanguageCode}`);
      configureTts();
    }
  };

  const runTools = async (toolCalls: any[]): Promise<ChatMessage[]> => {
    const toolMessages: ChatMessage[] = [];
    for (const call of toolCalls || []) {
      const name = call?.function?.name || call?.name;
      const id = call?.id || `tool_${Date.now()}`;
      let args: any = {};
      try {
        args =
          typeof call?.function?.arguments === 'string'
            ? JSON.parse(call.function.arguments || '{}')
            : call?.function?.arguments || {};
      } catch {
        args = {};
      }

      let result: any = { success: true };

      if (name === 'endCall') {
        endCallInvoked = true;
        console.log('[SARVAM] endCall');
        if (customerPhone) {
          try {
            await markCallCompletedByPhone(customerPhone);
            const tail = customerPhone.replace(/\D/g, '').slice(-10);
            const leads = await prisma.lead.findMany({
              where: { phone: { contains: tail }, status: STATUS.CALL_COMPLETED },
            });
            for (const lead of leads) {
              const outcome = outcomeFromFlags({ interested: lead.interested });
              if (outcome) {
                await markOutcomeByPhone(customerPhone, outcome, { interested: lead.interested });
              }
            }
          } catch (e) {
            console.error('[SARVAM] endCall DB error:', e);
          }
        }
        result = { success: true, message: 'Call ending' };
        setTimeout(() => {
          hangupStream();
        }, isOutboundCall ? 700 : 200);
      } else if (name === 'notInterested') {
        console.log('[SARVAM] notInterested');
        if (customerPhone) {
          await markOutcomeByPhone(customerPhone, STATUS.NOT_INTERESTED, { interested: false });
        }
        result = { success: true };
      } else if (name === 'bookAppointment') {
        const dateTime = args.dateTime;
        console.log('[SARVAM] bookAppointment', dateTime);
        try {
          const when = new Date(dateTime);
          if (Number.isNaN(when.getTime())) throw new Error('invalid date');
          const mins = when.getHours() * 60 + when.getMinutes();
          if (mins < 10 * 60 || mins > 17 * 60 + 30) {
            result = {
              success: false,
              message: 'Site visits only between 10:00 and 17:30. Ask for another time.',
            };
          } else if (customerPhone) {
            await transitionLeadsByPhone(customerPhone, STATUS.VISIT_SCHEDULED, {
              interested: true,
              appointmentAt: when,
            });
            result = { success: true, appointmentAt: when.toISOString() };
          }
        } catch {
          result = { success: false, message: 'Invalid dateTime' };
        }
      } else if (name === 'setFollowUp') {
        console.log('[SARVAM] setFollowUp', args.reason);
        if (customerPhone) {
          await transitionLeadsByPhone(customerPhone, STATUS.FOLLOW_UP, {
            interested: true,
            lastResponse: args.reason || 'follow up',
          });
        }
        result = { success: true };
      } else if (name === 'setName') {
        customerIdentity = resolveCustomerIdentity({
          previous: customerIdentity,
          rawName: args.name,
          source: 'user_spoken',
          explicitTitle: args.title,
          maritalStatus: args.maritalStatus,
          preferFirstNameOnly: Boolean(args.preferFirstNameOnly),
        });
        console.log('[SARVAM] setName', customerIdentity.customer_name_normalized);
        if (customerPhone && customerIdentity.customer_name_normalized) {
          void prisma.lead
            .updateMany({
              where: { phone: { contains: customerPhone.replace(/\D/g, '').slice(-10) } },
              data: { name: customerIdentity.customer_name_normalized },
            })
            .catch(() => {});
        }
        result = { success: true, identity: formatIdentityContext(customerIdentity) };
      }

      toolMessages.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(result),
      });
    }
    return toolMessages;
  };

  const chatTurn = async (userText: string) => {
    if (turnBusy || closed || endCallInvoked) return;
    turnBusy = true;
    const turnStart = Date.now();
    try {
      messages.push({ role: 'user', content: userText });
      trimMessageHistory();
      let loops = 0;
      while (loops < 4 && !endCallInvoked) {
        loops++;
        configureTts();

        // Stream tokens → speak complete sentences ASAP (lower time-to-first-audio).
        const stream = await client.chat.completions({
          model: sarvamChatModel() as any,
          messages: messages as any,
          tools: SARVAM_TOOLS as any,
          tool_choice: 'auto' as any,
          temperature: 0.25,
          max_tokens: sarvamMaxTokens(),
          reasoning_effort: null as any,
          stream: true,
        } as any);

        let contentBuf = '';
        let spokenBuf = '';
        let toolCalls: any[] | undefined;
        let firstTokenAt = 0;

        for await (const chunk of stream as AsyncIterable<any>) {
          const delta = chunk?.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.tool_calls?.length) {
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
              if (tc.function?.arguments) {
                toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
          if (typeof delta.content === 'string' && delta.content) {
            if (!firstTokenAt) {
              firstTokenAt = Date.now();
              console.log(`[SARVAM] LLM first token +${firstTokenAt - turnStart}ms`);
            }
            contentBuf += delta.content;
            const { ready, rest } = takeCompleteSentences(contentBuf);
            if (ready.length) {
              for (const sentence of ready) {
                if (!spokenBuf) {
                  capture?.onAiText(sentence);
                  fullTranscription += `AI: ${sentence}`;
                  transcriptCount++;
                } else {
                  fullTranscription += ` ${sentence}`;
                  capture?.onAiText(sentence);
                }
                spokenBuf += (spokenBuf ? ' ' : '') + sentence;
                enqueueTts(sentence);
              }
              contentBuf = rest;
            }
          }
        }

        const leftover = contentBuf.trim();
        if (leftover) {
          if (!spokenBuf) {
            capture?.onAiText(leftover);
            fullTranscription += `AI: ${leftover}\n`;
            transcriptCount++;
          } else {
            fullTranscription += ` ${leftover}\n`;
            capture?.onAiText(leftover);
          }
          spokenBuf += (spokenBuf ? ' ' : '') + leftover;
          enqueueTts(leftover);
        } else if (spokenBuf) {
          fullTranscription += '\n';
        }

        const content = spokenBuf.trim() || leftover;
        const cleanToolCalls = toolCalls?.filter(Boolean);

        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: cleanToolCalls || undefined,
        });

        if (spokenBuf) await flushTtsAndWait();

        if (cleanToolCalls?.length) {
          const toolMsgs = await runTools(cleanToolCalls);
          messages.push(...toolMsgs);
          if (endCallInvoked) break;
          continue;
        }
        break;
      }
      console.log(`[SARVAM] Turn done +${Date.now() - turnStart}ms`);
    } catch (e: any) {
      console.error('[SARVAM LLM]', e?.message || e);
      callLog('ERROR', `SARVAM LLM ERROR: ${e?.message || e}`);
      // Fallback non-streaming if stream fails
      try {
        const res: any = await client.chat.completions({
          model: sarvamChatModel() as any,
          messages: messages as any,
          tools: SARVAM_TOOLS as any,
          tool_choice: 'auto' as any,
          temperature: 0.25,
          max_tokens: sarvamMaxTokens(),
          reasoning_effort: null as any,
        } as any);
        const msg = res?.choices?.[0]?.message;
        if (msg?.content) await speakText(msg.content);
      } catch (e2: any) {
        console.error('[SARVAM LLM fallback]', e2?.message || e2);
      }
    } finally {
      turnBusy = false;
    }
  };

  const onFinalTranscript = async (transcript: string, languageCode?: string | null) => {
    const text = (transcript || '').trim();
    if (!text || text.length < 2) return;
    const lang = detectScriptLanguage(text);
    console.log(
      `[SARVAM STT] lang=${lang} detected=${languageCode || '?'} text="${text.slice(0, 120)}"`,
    );
    fullTranscription += `User: ${text}\n`;
    capture?.onCustomerTranscript(text);
    applyLanguageFromTranscript(text);

    if (isFirstResponse && customerPhone) {
      isFirstResponse = false;
      const lower = text.toLowerCase();
      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'plot', 'haan', 'beku', 'sari'];
      const notInterestedKeywords = ['no', 'not interested', 'stop', 'busy', 'nahi', 'beda'];
      let interested: boolean | null = null;
      if (interestedKeywords.some((kw) => lower.includes(kw))) interested = true;
      else if (notInterestedKeywords.some((kw) => lower.includes(kw))) interested = false;
      void transitionLeadsByPhone(customerPhone, STATUS.ANSWERED, {
        interested,
        lastResponse: text,
      }).catch(() => {});
    }

    await chatTurn(text);
  };

  const connectSttLegacy = async () => {
    sttMode = 'legacy';
    sttSocket = await client.speechToTextStreaming.connect({
      'language-code': 'unknown',
      model: 'saaras:v3' as any,
      mode: 'transcribe',
      input_audio_codec: 'pcm_s16le',
      sample_rate: '8000',
      high_vad_sensitivity: 'true',
      vad_signals: 'true',
      flush_signal: 'true',
    } as any);
    await sttSocket.waitForOpen();
    sttSocket.on('message', (msg: any) => {
      if (msg?.type === 'data' && msg?.data?.transcript) {
        void onFinalTranscript(msg.data.transcript, msg.data.language_code);
      } else if (msg?.type === 'events') {
        const signal = msg?.data?.signal_type;
        if (signal === 'START_SPEECH') {
          capture?.onCustomerSpeakStart();
          if (Date.now() < aiPlaybackEndsAt) clearPlayback();
        } else if (signal === 'END_SPEECH') {
          capture?.onCustomerSpeakEnd();
          allowAiOutput();
          try {
            sttSocket?.flush?.();
          } catch {
            /* ignore */
          }
        }
      } else if (msg?.type === 'error') {
        console.error('[SARVAM STT]', msg.data);
        callLog('ERROR', `SARVAM STT ERROR: ${JSON.stringify(msg.data)}`);
        capture?.onSttError(String(msg?.data?.error || 'stt error'));
      }
    });
    callLog('SUCCESS', 'SARVAM STT LEGACY SESSION OPEN');
    console.log('[SARVAM] STT legacy connected (pcm_s16le @ 8kHz)');
  };

  const connectStt = async () => {
    if (!useSarvamRealtimeStt()) {
      await connectSttLegacy();
      return;
    }
    try {
      sttMode = 'realtime';
      sttSocket = await client.speechToTextRealtimeStreaming.connect({
        language_code: 'auto',
        model: 'saaras:v3-realtime',
        mode: 'transcribe',
        endpointing: 'vad',
        encoding: 'mulaw',
        sample_rate: '8000',
        silence_duration_ms: String(sarvamSttSilenceMs()),
        prefix_padding_ms: '120',
        min_speech_duration_ms: '120',
        'Api-Subscription-Key': sarvamApiKey(),
      } as any);
      await sttSocket.waitForOpen();
      sttSocket.on('message', (msg: any) => {
        const ev = msg?.event;
        if (ev === 'transcript.final' && msg?.text) {
          void onFinalTranscript(String(msg.text), msg.language);
        } else if (ev === 'vad.speech_start') {
          capture?.onCustomerSpeakStart();
          if (Date.now() < aiPlaybackEndsAt) clearPlayback();
        } else if (ev === 'vad.speech_end') {
          capture?.onCustomerSpeakEnd();
          allowAiOutput();
        } else if (ev === 'error') {
          console.error('[SARVAM STT realtime]', msg);
          callLog('ERROR', `SARVAM STT REALTIME ERROR: ${JSON.stringify(msg)}`);
          capture?.onSttError(String(msg?.message || msg?.error || 'stt error'));
        }
      });
      callLog('SUCCESS', 'SARVAM STT REALTIME SESSION OPEN');
      console.log(
        `[SARVAM] STT realtime connected (mulaw @ 8kHz, silence=${sarvamSttSilenceMs()}ms model=${sarvamSttModel()})`,
      );
    } catch (err: any) {
      console.warn('[SARVAM] Realtime STT failed — falling back to legacy:', err?.message || err);
      await connectSttLegacy();
    }
  };

  const connectTts = async () => {
    ttsSocket = await client.textToSpeechStreaming.connect({
      model: sarvamTtsModel() as any,
      send_completion_event: 'true',
    } as any);
    await ttsSocket.waitForOpen();
    ttsSocket.on('message', onTtsMessage);
    configureTts();
    callLog('SUCCESS', 'SARVAM TTS SESSION OPEN');
    console.log(`[SARVAM] TTS connected (speaker=${sarvamTtsSpeaker()} lang=${ttsLanguageCode})`);
  };

  ws.on('message', async (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const msg = normalizeVoiceEvent(raw);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        if (msg.start.isPlivo) audioSink = 'plivo';
        const customParams = msg.start.customParameters || {};
        const isOutbound =
          customParams.isOutbound === 'true' ||
          customParams.direction === 'outbound' ||
          customParams.outbound === 'true';
        isOutboundCall = isOutbound;

        const restoredName = customParams.customerName || '';
        const hasValidName =
          restoredName &&
          restoredName !== 'Customer' &&
          restoredName !== 'Unknown' &&
          !/^\+?\d[\d\s-]{6,}$/.test(restoredName);
        customerIdentity = hasValidName
          ? resolveCustomerIdentity({
              rawName: restoredName,
              source: isOutbound ? 'campaign' : 'crm',
            })
          : emptyIdentity();

        const rawPhone = customParams.customerPhone || '';
        const phoneDigits = String(rawPhone).replace(/\D/g, '');
        customerPhone = phoneDigits
          ? phoneDigits.length === 10
            ? `+91${phoneDigits}`
            : `+${phoneDigits}`
          : null;

        console.log(
          `[SARVAM] Stream started: ${streamSid} | Name: ${customerIdentity.customer_name_normalized || 'N/A'} | Phone: ${customerPhone || 'N/A'} | Outbound: ${isOutboundCall}`,
        );
        callLog('SUCCESS', `SARVAM CALL START outbound=${isOutboundCall}`);

        capture = new CallCaptureSession({
          streamSid,
          phone: customerPhone,
          outbound: isOutboundCall,
        });

        if (customerPhone) {
          void markAnsweredByPhone(customerPhone).catch(() => {});
        }

        const currentDateStr = new Date().toLocaleDateString('en-IN');
        const greetingIdentity = customerIdentity.customer_name_normalized
          ? customerIdentity
          : null;
        let systemInstruction = isOutboundCall
          ? buildOutboundSystemInstruction(currentDateStr, greetingIdentity)
          : buildInboundSystemInstruction(currentDateStr, greetingIdentity);
        systemInstruction += `\n\n${formatIdentityContext(customerIdentity)}\n`;
        systemInstruction +=
          '\nVOICE STACK: Sarvam realtime STT+LLM+TTS. Keep every reply to 1–2 short spoken sentences. Start in Kannada (kn-IN). Prefer low latency over long explanations.\n';

        messages.length = 0;
        messages.push({ role: 'system', content: systemInstruction });

        // Connect STT/TTS in parallel; inject live data without blocking greeting long.
        const liveDataPromise = withTimeout(fetchLiveSiteData(), 1200);
        try {
          await Promise.all([connectStt(), connectTts()]);
        } catch (err: any) {
          console.error('[SARVAM] Failed to connect STT/TTS:', err?.message || err);
          callLog('ERROR', `SARVAM CONNECT FAILED: ${err?.message || err}`);
          hangupStream();
          return;
        }

        liveDataPromise.then((liveData) => {
          if (!liveData) return;
          const section = formatLiveDataForPrompt(liveData);
          messages.push({
            role: 'system',
            content: `LIVE INVENTORY/PRICING DATA (silent context — do not read aloud):\n${section}`,
          });
          console.log('[SARVAM] Live site data injected');
        });

        const greeting = isOutboundCall
          ? getOutboundGreeting(greetingIdentity)
          : getInboundGreeting(greetingIdentity);
        console.log('[SARVAM] Speaking opening greeting');
        await speakText(greeting);
      } else if (msg.event === 'media') {
        const muLawData = Buffer.from(msg.media.payload, 'base64');
        capture?.onCustomerMuLaw(muLawData);

        let sumSq = 0;
        for (let i = 0; i < muLawData.length; i++) {
          const s = muLawByteToPcm(muLawData[i]);
          sumSq += s * s;
        }
        const rms = muLawData.length ? Math.sqrt(sumSq / muLawData.length) : 0;
        const barge = evaluateBargeIn({
          now: Date.now(),
          aiPlaybackEndsAt,
          rms,
          bargeInRms: 900,
          gateOpen: true,
          requireGateOpen: false,
          bargeInStartedAt,
          minHoldMs: 180,
        });
        if (barge.action === 'arm') bargeInStartedAt = barge.startedAt;
        else if (barge.action === 'fire') {
          clearPlayback();
          bargeInStartedAt = null;
        } else if (barge.action === 'reset') bargeInStartedAt = null;
        else bargeInStartedAt = barge.startedAt;

        if (sttSocket) {
          try {
            if (sttMode === 'realtime') {
              // Realtime path accepts telephony µ-law directly — skip PCM upsample.
              sttSocket.sendRealtimeAudioInput({
                event: 'audio_input',
                audio: muLawData.toString('base64'),
              });
            } else {
              const pcm = muLawBufferToPcm16le(muLawData);
              sttSocket.transcribe({
                audio: pcm.toString('base64'),
                sample_rate: 8000,
                encoding: 'audio/wav',
              });
            }
          } catch (e: any) {
            console.error('[SARVAM] STT send failed:', e?.message || e);
          }
        }
      } else if (msg.event === 'stop') {
        console.log('[SARVAM] Call stopped');
        closed = true;
        void capture?.finalize();
        capture = null;
        try {
          sttSocket?.close?.();
        } catch {
          /* ignore */
        }
        try {
          ttsSocket?.close?.();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.error('[SARVAM WS Message Error]:', e);
    }
  });

  ws.on('close', () => {
    closed = true;
    void capture?.finalize();
    capture = null;
    try {
      sttSocket?.close?.();
    } catch {
      /* ignore */
    }
    try {
      ttsSocket?.close?.();
    } catch {
      /* ignore */
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (duration > 3 && customerPhone && fullTranscription.trim()) {
      void (async () => {
        try {
          const groqApiKey = process.env.GROQ_API_KEY;
          if (!groqApiKey) return;
          const summaryPrompt = `Summarize this AI sales call (2-3 sentences, professional). Conversation:\n${fullTranscription}\nSUMMARY:`;
          const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${groqApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [
                { role: 'system', content: 'You summarize real-estate calls.' },
                { role: 'user', content: summaryPrompt },
              ],
              temperature: 0.5,
              max_tokens: 400,
            }),
          });
          const groqData: any = await groqResponse.json();
          const aiSummary =
            groqData.choices?.[0]?.message?.content?.trim() || 'Summary unavailable.';
          const finalSummary = `Call: ${duration}s. AI Turns: ${transcriptCount}.\n\n${aiSummary}`;
          await prisma.lead.updateMany({
            where: { phone: { contains: customerPhone!.replace(/\D/g, '').slice(-10) } },
            data: { summary: finalSummary },
          });
        } catch (e) {
          console.error('[SARVAM] summary save failed:', e);
        }
      })();
    }
  });

  ws.on('error', (err) => {
    callLog('ERROR', `WEBSOCKET ERROR: ${err?.message || err}`);
  });
}
