/**
 * Hybrid voice stack: Sarvam STT → Gemini/Sarvam LLM → Bulbul TTS.
 * Plivo/Twilio media stays µ-law 8 kHz; STT gets PCM s16le; TTS returns µ-law.
 *
 * Revert full Gemini Live: set VOICE_STACK=gemini and restart.
 */
import type { WebSocket } from 'ws';
import { prisma } from '../../lib/prisma';
import { fetchLiveSiteData, formatLiveDataForPrompt } from '../../lib/live-site-data';
import { buildInboundSystemInstruction, getGreeting as getInboundGreeting } from '../Inbound/index';
import { buildOutboundSystemInstruction } from '../Outbound/index';
import { buildOutboundKannadaOpeningBeats } from '../kannada-style';
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
  languageSwitchSystemPrompt,
  resolveNextConversationLanguage,
  type ConversationLanguage,
} from '../language/conversation-language';
import { evaluateBargeIn } from '../turn-policy';
import { SttRingBuffer } from '../stt-ring-buffer';
import { VOICE_SPOKEN_OUTPUT_RULES } from '../voice-spoken-rules';
import {
  getSarvamClient,
  sarvamApiKey,
  sarvamChatModel,
  sarvamMaxTokens,
  sarvamSttLanguage,
  sarvamSttModel,
  sarvamSttNegativeFrames,
  sarvamSttSilenceMs,
  sttPrerollFrames,
  useSarvamRealtimeStt,
} from './config';
import { muLawByteToPcm, muLawBufferToPcm16le } from './mulaw';
import { SarvamConvertStreamPlayer, ttsConvertStreamConfig } from './tts-convert-stream';
import { normalizeVoiceEvent } from './normalize-event';
import { prepareTtsText, takeSpeakableChunks } from './tts-text';
import {
  logTurnLatency,
  markFirstPlayout,
  markFirstToken,
  markFirstTtsEnqueue,
  markSpeechEnd,
  markSttFinal,
  type TurnLatency,
} from './latency';
import { streamVoiceChatTurn } from '../llm/hybrid-chat';
import { resolveActiveLlmProvider } from '../llm/config';
import { SARVAM_TOOLS } from './tools';

const STATUS = LEAD_STATUS;
const MAX_HISTORY_MESSAGES = 24;

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

export async function setupSarvam(ws: WebSocket, streamParams?: URLSearchParams) {
  const client = getSarvamClient();
  let audioSink: 'twilio' | 'plivo' =
    (process.env.VOICE_PROVIDER || 'twilio').toLowerCase() === 'plivo' ? 'plivo' : 'twilio';
  let streamSid: string | null = null;
  let capture: CallCaptureSession | null = null;
  let sttSocket: any = null;
  const ttsPlayer = new SarvamConvertStreamPlayer(client);
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
  /** User speech while a turn is in flight — process after current reply. */
  let pendingUserText: string | null = null;
  let endCallInvoked = false;
  let suppressAiOutput = false;
  let aiPlaybackEndsAt = 0;
  let bargeInStartedAt: number | null = null;
  /** Block barge-in / clear while the opening line is still speaking. */
  let openingSpeechInProgress = false;
  let loggedFirstPlivoAudio = false;
  /** Active turn latency tracker (STT→first audio). */
  let turnLatency: TurnLatency | null = null;
  /** Media-stream clock for opening TTFA (<500ms target). */
  let openingCallT0: number | null = null;
  /** Hold telephony audio until STT socket is open (avoids dropped first words). */
  let sttReady = false;
  const sttAudioQueue: Buffer[] = [];
  const STT_QUEUE_MAX = 80; // ~1.6s of 20ms frames
  const messages: ChatMessage[] = [];

  /** Active turn abort — stops LLM/TTS when user barges in. */
  let activeTurnAbort: AbortController | null = null;
  let lastSpeechEndAt: number | null = null;
  const sttRing = new SttRingBuffer(sttPrerollFrames());
  let sttMode: 'realtime' | 'legacy' = 'realtime';

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

  const abortActiveTurn = () => {
    if (activeTurnAbort) {
      activeTurnAbort.abort();
      activeTurnAbort = null;
    }
    ttsPlayer.cancel();
    suppressAiOutput = true;
  };

  const clearPlayback = () => {
    // Never cut the opening, and never clear while we still expect AI audio on the line
    // unless the caller has held barge-in (handled by evaluateBargeIn with a high threshold).
    if (openingSpeechInProgress) return;
    abortActiveTurn();
    capture?.onAiPlaybackCleared();
    aiPlaybackEndsAt = 0;
    bargeInStartedAt = null;
    sttRing.replay((frame) => feedStt(frame));
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

  /** Wait until queued Plivo µ-law should have finished playing (plus small cushion). */
  const waitForPlaybackDrain = async (cushionMs = 120) => {
    const wait = aiPlaybackEndsAt - Date.now() + cushionMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 20000)));
  };

  const sendMuLawToPhone = (muLaw: Buffer) => {
    if (!streamSid || suppressAiOutput || muLaw.length === 0) return;
    if (turnLatency) markFirstPlayout(turnLatency);
    if (openingCallT0 != null && !loggedFirstPlivoAudio) {
      console.log(`[SARVAM] Opening first playAudio +${Date.now() - openingCallT0}ms`);
    }
    capture?.onAiSpeakStart();
    capture?.onAiMuLaw(muLaw);
    aiPlaybackEndsAt = Math.max(Date.now(), aiPlaybackEndsAt) + muLaw.length / 8;
    const payload = muLaw.toString('base64');
    if (audioSink === 'plivo') {
      if (!loggedFirstPlivoAudio) {
        loggedFirstPlivoAudio = true;
        console.log(`[SARVAM] First playAudio → plivo (${muLaw.length} bytes µ-law)`);
      }
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

  const logTtsConfig = () => {
    const cfg = ttsConvertStreamConfig(ttsLanguageCode);
    console.log(
      `[SARVAM TTS] convertStream model=${cfg.model} speaker=${cfg.speaker} lang=${cfg.language_code} pace=${cfg.pace} rate=${cfg.speech_sample_rate}`,
    );
  };

  const ttsHandlers = (signal?: AbortSignal) => ({
    signal,
    onMuLaw: (muLaw: Buffer) => sendMuLawToPhone(muLaw),
    onFirstAudio: () => {
      if (turnLatency) markFirstTtsEnqueue(turnLatency);
    },
  });

  const trimMessageHistory = () => {
    if (messages.length <= MAX_HISTORY_MESSAGES) return;
    const system = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    messages.length = 0;
    messages.push(...system.slice(0, 3), ...rest.slice(-(MAX_HISTORY_MESSAGES - 3)));
  };

  /** Speak one phrase via Sarvam convertStream (Ishita @ 22050 → 8 kHz µ-law). */
  const speakChunkNow = (text: string, opts?: { logText?: boolean }) => {
    const trimmed = prepareTtsText(text, ttsLanguageCode);
    if (!trimmed || closed) return;
    if (opts?.logText !== false) {
      capture?.onAiText(trimmed);
      fullTranscription += `AI: ${trimmed}\n`;
      transcriptCount++;
    }
    allowAiOutput();
    void ttsPlayer.speak(trimmed, ttsLanguageCode, ttsHandlers(activeTurnAbort?.signal ?? undefined));
  };

  const speakText = async (text: string): Promise<void> => {
    const trimmed = prepareTtsText(text, ttsLanguageCode);
    if (!trimmed || closed) return;
    capture?.onAiText(trimmed);
    fullTranscription += `AI: ${trimmed}\n`;
    transcriptCount++;
    allowAiOutput();
    await ttsPlayer.speak(trimmed, ttsLanguageCode, ttsHandlers());
    await ttsPlayer.whenIdle();
    capture?.onAiTurnComplete();
    capture?.onAiSpeakEnd();
  };

  /** Speak opening as one continuous TTS stream (avoids gaps between micro-phrases). */
  const speakOutboundOpening = async (
    identity: CustomerIdentity | null,
    callT0: number,
  ) => {
    const { intro, ask } = buildOutboundKannadaOpeningBeats(identity);
    const full = prepareTtsText(`${intro}. ${ask}`.replace(/\s+/g, ' ').trim(), ttsLanguageCode);
    console.log(`[SARVAM] Opening (single stream): ${full}`);

    allowAiOutput();
    if (closed || !full) return;

    capture?.onAiText(full);
    fullTranscription += `AI: ${full}\n`;
    transcriptCount++;
    console.log(`[SARVAM] Opening phrase queued +${Date.now() - callT0}ms`);
    await ttsPlayer.speak(full, ttsLanguageCode, ttsHandlers());
    await ttsPlayer.whenIdle();
    capture?.onAiTurnComplete();
    capture?.onAiSpeakEnd();
  };

  const speakInboundOpening = async (greeting: string, callT0: number) => {
    allowAiOutput();
    if (closed) return;
    const trimmed = prepareTtsText(greeting, ttsLanguageCode);
    if (!trimmed) return;
    capture?.onAiText(trimmed);
    fullTranscription += `AI: ${trimmed}\n`;
    transcriptCount++;
    console.log(`[SARVAM] Opening phrase queued +${Date.now() - callT0}ms`);
    await ttsPlayer.speak(trimmed, ttsLanguageCode, ttsHandlers());
    await ttsPlayer.whenIdle();
    capture?.onAiTurnComplete();
    capture?.onAiSpeakEnd();
  };

  const applyLanguageFromTranscript = (text: string) => {
    const resolved = resolveNextConversationLanguage(conversationLanguage, text);
    if (resolved.switched) {
      conversationLanguage = resolved.language;
      ttsLanguageCode = languageCodeForConversation(resolved.language);
      console.log(`[SARVAM] Language → ${conversationLanguage} tts=${ttsLanguageCode}`);
      logTtsConfig();
      // Lightweight routing — no extra model hop; steers the next chat turn only.
      messages.push({
        role: 'system',
        content: languageSwitchSystemPrompt(resolved.language),
      });
      trimMessageHistory();
    } else if (resolved.language !== conversationLanguage) {
      conversationLanguage = resolved.language;
      ttsLanguageCode = languageCodeForConversation(resolved.language);
      logTtsConfig();
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
    const text = (userText || '').trim();
    if (!text || closed || endCallInvoked) return;
    if (turnBusy) {
      pendingUserText = pendingUserText ? `${pendingUserText} ${text}` : text;
      console.log(`[SARVAM] Queued user speech while busy: "${text.slice(0, 60)}"`);
      return;
    }
    turnBusy = true;
    const turnStart = Date.now();
    turnLatency = { turnStart };
    if (lastSpeechEndAt != null) markSpeechEnd(turnLatency, lastSpeechEndAt);
    markSttFinal(turnLatency);
    const turnAbort = new AbortController();
    activeTurnAbort = turnAbort;
    try {
      messages.push({ role: 'user', content: text });
      trimMessageHistory();
      let loops = 0;
      while (loops < 4 && !endCallInvoked && !turnAbort.signal.aborted) {
        loops++;

        let contentBuf = '';
        let streamBuf = '';
        let toolCalls: any[] | undefined;
        let skipSpeech = false;

        if (!closed) logTtsConfig();

        for await (const event of streamVoiceChatTurn({
          messages,
          language: conversationLanguage,
          sarvamClient: client,
          signal: turnAbort.signal,
        })) {
          if (turnAbort.signal.aborted) break;

          if (event.type === 'tool_pending') {
            skipSpeech = true;
            streamBuf = '';
            continue;
          }

          if (event.type === 'token') {
            if (skipSpeech) continue;
            if (turnLatency) markFirstToken(turnLatency);
            contentBuf += event.delta;
            streamBuf += event.delta;
            const { ready, rest } = takeSpeakableChunks(streamBuf, {
              allowEarlyPhrase: false,
              minPhraseChars: conversationLanguage === 'kn' ? 20 : 24,
              kannadaSafe: conversationLanguage === 'kn',
            });
            streamBuf = rest;
            for (const piece of ready) {
              if (turnAbort.signal.aborted) break;
              if (turnLatency) markFirstTtsEnqueue(turnLatency);
              speakChunkNow(piece);
            }
          } else if (event.type === 'done') {
            toolCalls = event.toolCalls;
            if (!contentBuf && event.content) contentBuf = event.content;
          }
        }

        if (turnAbort.signal.aborted) break;

        if (streamBuf.trim() && !toolCalls?.length && !skipSpeech) {
          if (turnLatency) markFirstTtsEnqueue(turnLatency);
          speakChunkNow(streamBuf);
          streamBuf = '';
        }

        const content = prepareTtsText(contentBuf, ttsLanguageCode);
        const cleanToolCalls = toolCalls?.filter(Boolean);

        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: cleanToolCalls || undefined,
        });

        // Do NOT block on full TTS playback — agent must stay listenable (barge-in + STT).
        if (cleanToolCalls?.length) {
          await ttsPlayer.whenIdle();
        }

        if (cleanToolCalls?.length) {
          const toolMsgs = await runTools(cleanToolCalls);
          messages.push(...toolMsgs);
          if (endCallInvoked) break;
          continue;
        }
        break;
      }
      if (turnLatency) {
        logTurnLatency(turnLatency, `lang=${conversationLanguage} llm=${resolveActiveLlmProvider()}`);
      }
    } catch (e: any) {
      console.error('[SARVAM LLM]', e?.message || e);
      callLog('ERROR', `SARVAM LLM ERROR: ${e?.message || e}`);
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
      if (activeTurnAbort === turnAbort) activeTurnAbort = null;
      turnLatency = null;
      turnBusy = false;
      if (pendingUserText && !closed && !endCallInvoked) {
        const queued = pendingUserText;
        pendingUserText = null;
        void chatTurn(queued);
      }
    }
  };

  const feedStt = (muLawData: Buffer) => {
    if (!sttSocket || !sttReady) {
      if (sttAudioQueue.length < STT_QUEUE_MAX) sttAudioQueue.push(Buffer.from(muLawData));
      return;
    }
    try {
      if (sttMode === 'realtime') {
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
      // Avoid log spam when socket briefly flaps
      if (!/not open/i.test(String(e?.message || e))) {
        console.error('[SARVAM] STT send failed:', e?.message || e);
      }
    }
  };

  const flushSttAudioQueue = () => {
    while (sttAudioQueue.length && sttReady && sttSocket) {
      const chunk = sttAudioQueue.shift();
      if (chunk) feedStt(chunk);
    }
  };

  const onFinalTranscript = async (transcript: string, languageCode?: string | null) => {
    const text = (transcript || '').trim();
    if (!text || text.length < 1) return;
    // Ignore punctuation-only / empty script noise
    if (!/[\u0C80-\u0CFFa-zA-Z0-9\u0900-\u097F]/.test(text)) return;

    if (turnBusy) {
      console.log(`[SARVAM] User spoke during agent turn — abort & queue: "${text.slice(0, 80)}"`);
      abortActiveTurn();
      clearPlayback();
      pendingUserText = pendingUserText ? `${pendingUserText} ${text}` : text;
      return;
    }

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
      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'plot', 'haan', 'beku', 'sari', 'ಹೌದು', 'ಸರಿ'];
      const notInterestedKeywords = ['no', 'not interested', 'stop', 'busy', 'nahi', 'beda', 'ಬೇಡ'];
      let interested: boolean | null = null;
      if (interestedKeywords.some((kw) => lower.includes(kw)) || /ಹೌದು|ಸರಿ|ಬೇಕು/.test(text)) interested = true;
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
    sttReady = false;
    const lang = sarvamSttLanguage();
    const negFrames = sarvamSttNegativeFrames();
    sttSocket = await client.speechToTextStreaming.connect({
      'language-code': lang as any,
      model: 'saaras:v3' as any,
      mode: 'transcribe',
      input_audio_codec: 'pcm_s16le',
      sample_rate: '8000',
      // Fine VAD: high sensitivity alone ends speech in ~128ms — too choppy for Kannada.
      high_vad_sensitivity: 'false',
      vad_signals: 'true',
      flush_signal: 'true',
      negative_frames_window: String(negFrames),
      negative_speech_threshold: '0.4',
    } as any);
    await sttSocket.waitForOpen();
    sttSocket.on('message', (msg: any) => {
      if (msg?.type === 'data' && msg?.data?.transcript) {
        void onFinalTranscript(msg.data.transcript, msg.data.language_code);
      } else if (msg?.type === 'events') {
        const signal = msg?.data?.signal_type;
        if (signal === 'START_SPEECH') {
          capture?.onCustomerSpeakStart();
          if (Date.now() < aiPlaybackEndsAt && !openingSpeechInProgress) {
            console.log('[SARVAM] Barge-in via STT speech start');
            clearPlayback();
          }
        } else if (signal === 'END_SPEECH') {
          lastSpeechEndAt = Date.now();
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
    sttReady = true;
    flushSttAudioQueue();
    callLog('SUCCESS', 'SARVAM STT LEGACY SESSION OPEN');
    console.log(
      `[SARVAM] STT legacy connected (pcm_s16le @ 8kHz lang=${lang} vadFrames=${negFrames})`,
    );
  };

  const connectStt = async () => {
    if (!useSarvamRealtimeStt()) {
      await connectSttLegacy();
      return;
    }
    try {
      sttMode = 'realtime';
      sttSocket = await client.speechToTextRealtimeStreaming.connect({
        language_code: sarvamSttLanguage() === 'unknown' ? 'auto' : sarvamSttLanguage(),
        model: 'saaras:v3-realtime',
        mode: 'transcribe',
        endpointing: 'vad',
        encoding: 'mulaw',
        sample_rate: '8000',
        silence_duration_ms: String(sarvamSttSilenceMs()),
        prefix_padding_ms: '160',
        min_speech_duration_ms: '180',
        'Api-Subscription-Key': sarvamApiKey(),
      } as any);
      await sttSocket.waitForOpen();
      let fellBack = false;
      const fallbackLegacy = async (reason: string) => {
        if (fellBack || closed) return;
        fellBack = true;
        sttReady = false;
        console.warn(`[SARVAM] Realtime STT unusable (${reason}) — falling back to legacy`);
        callLog('RECONNECT', `SARVAM STT REALTIME FALLBACK: ${reason}`);
        try {
          sttSocket?.close?.();
        } catch {
          /* ignore */
        }
        sttSocket = null;
        try {
          await connectSttLegacy();
        } catch (e: any) {
          console.error('[SARVAM] Legacy STT fallback failed:', e?.message || e);
        }
      };

      sttSocket.on('message', (msg: any) => {
        const ev = msg?.event;
        if (ev === 'transcript.final' && msg?.text) {
          void onFinalTranscript(String(msg.text), msg.language);
        } else if (ev === 'vad.speech_start') {
          capture?.onCustomerSpeakStart();
          if (Date.now() < aiPlaybackEndsAt && !openingSpeechInProgress) {
            console.log('[SARVAM] Barge-in via STT speech start');
            clearPlayback();
          }
        } else if (ev === 'vad.speech_end') {
          lastSpeechEndAt = Date.now();
          capture?.onCustomerSpeakEnd();
          allowAiOutput();
        } else if (ev === 'error') {
          console.error('[SARVAM STT realtime]', msg);
          callLog('ERROR', `SARVAM STT REALTIME ERROR: ${JSON.stringify(msg)}`);
          const code = String(msg?.code || '');
          const text = String(msg?.message || msg?.error || 'stt error');
          capture?.onSttError(text);
          if (
            msg?.is_fatal ||
            code === 'invalid_subscription_key' ||
            /invalid subscription key/i.test(text)
          ) {
            void fallbackLegacy(code || text);
          }
        }
      });
      sttReady = true;
      flushSttAudioQueue();
      callLog('SUCCESS', 'SARVAM STT REALTIME SESSION OPEN');
      console.log(
        `[SARVAM] STT realtime connected (mulaw @ 8kHz, silence=${sarvamSttSilenceMs()}ms model=${sarvamSttModel()})`,
      );
    } catch (err: any) {
      console.warn('[SARVAM] Realtime STT failed — falling back to legacy:', err?.message || err);
      await connectSttLegacy();
    }
  };

  const initTts = () => {
    logTtsConfig();
    callLog('SUCCESS', 'SARVAM TTS convertStream ready (bulbul:v3 / ishita)');
  };

  ws.on('message', async (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const msg = normalizeVoiceEvent(raw);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        if (msg.start.isPlivo) audioSink = 'plivo';
        // Always prefer Plivo playAudio when provider is plivo (start payload varies).
        if ((process.env.VOICE_PROVIDER || '').toLowerCase() === 'plivo') audioSink = 'plivo';

        const fromUrl: Record<string, string> = {};
        streamParams?.forEach((v, k) => {
          fromUrl[k] = v;
        });
        const customParams = { ...fromUrl, ...(msg.start.customParameters || {}) };
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

        const callT0 = Date.now();
        const greetingIdentity = customerIdentity.customer_name_normalized
          ? customerIdentity
          : null;

        // STT in background — TTS is per-phrase convertStream (no persistent socket).
        initTts();
        const sttPromise = connectStt().catch((err: any) => {
          console.error('[SARVAM] STT connect failed (non-fatal for opening):', err?.message || err);
        });
        const liveDataPromise = withTimeout(fetchLiveSiteData(), 1200);

        // Build system prompt while TTS connects (does not block first audio).
        const currentDateStr = new Date().toLocaleDateString('en-IN');
        let systemInstruction = isOutboundCall
          ? buildOutboundSystemInstruction(currentDateStr, greetingIdentity)
          : buildInboundSystemInstruction(currentDateStr, greetingIdentity);
        systemInstruction += `\n\n${formatIdentityContext(customerIdentity)}\n`;
        systemInstruction += `\n\n${VOICE_SPOKEN_OUTPUT_RULES}\n`;
        systemInstruction +=
          `\nVOICE STACK: Sarvam ears (Saaras STT) + ${resolveActiveLlmProvider()} brain + Bulbul TTS.\n` +
          'Pipeline: streaming STT → streaming LLM → streaming TTS. Replies must be speech-ready.\n';
        console.log(`[SARVAM] LLM provider: ${resolveActiveLlmProvider()}`);
        messages.length = 0;
        messages.push({ role: 'system', content: systemInstruction });

        try {
          await sttPromise.catch(() => {});
        } catch {
          /* opening already attempted */
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

        openingSpeechInProgress = true;
        openingCallT0 = callT0;
        try {
          if (isOutboundCall) {
            await speakOutboundOpening(greetingIdentity, callT0);
          } else {
            const greeting = getInboundGreeting(greetingIdentity);
            console.log(`[SARVAM] Speaking inbound greeting → ${audioSink}: ${greeting.slice(0, 80)}…`);
            await speakInboundOpening(greeting, callT0);
          }
        } finally {
          openingSpeechInProgress = false;
          openingCallT0 = null;
          allowAiOutput();
        }

        // STT should be up (or still connecting); opening already playing/done.
        void sttPromise;
      } else if (msg.event === 'media') {
        const muLawData = Buffer.from(msg.media.payload, 'base64');
        capture?.onCustomerMuLaw(muLawData);
        sttRing.push(muLawData);

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
          // Barge-in during agent speech — tuned for phone echo vs real voice
          bargeInRms: 1400,
          gateOpen: true,
          requireGateOpen: false,
          bargeInStartedAt,
          minHoldMs: 180,
        });
        if (barge.action === 'arm') bargeInStartedAt = barge.startedAt;
        else if (barge.action === 'fire') {
          if (!openingSpeechInProgress) {
            console.log(`[SARVAM] Barge-in clear (rms=${rms.toFixed(0)})`);
            clearPlayback();
          }
          bargeInStartedAt = null;
        } else if (barge.action === 'reset') bargeInStartedAt = null;
        else bargeInStartedAt = barge.startedAt;

        feedStt(muLawData);
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
          ttsPlayer.cancel();
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
      ttsPlayer.cancel();
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
