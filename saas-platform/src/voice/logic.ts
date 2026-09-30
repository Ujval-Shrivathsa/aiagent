import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import {
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  buildOutboundProjectReferenceContext,
  getOutboundGreetingInstruction,
  PDF_OPENING_KN,
  PDF_AREAS_LINE_KN,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE,
  buildOutboundHandoffTransferNudge,
  OUTBOUND_REPEAT_NUDGE,
  OUTBOUND_NO_REPEAT_NUDGE,
  looksLikeRepeatRequest,
  looksLikeThanksOnlyLine,
  looksLikeClosingGoodbye,
  isRedundantOutboundThanksTurn,
  looksLikeOpeningRestate,
  hasThanksClosing,
  looksLikeCustomerBusy,
  looksLikeAreasLine,
  looksLikeHandoffLine,
  looksLikeNotInterestedCloseLine,
  OUTBOUND_NOT_INTERESTED_CLOSE_KN,
  PDF_HANDOFF_LINE_KN,
  OUTBOUND_SILENCE_CHECK_NUDGE,
  OUTBOUND_SILENCE_RESUME_NUDGE,
  SILENCE_CHECK_AFTER_MS,
  SILENCE_CLOSE_AFTER_CHECK_MS,
  createOutboundSilenceState,
  armOutboundSilenceCheck,
  resetOutboundSilence,
  tickOutboundSilence,
  nextOutboundSilenceDeadline,
  type OutboundSilenceState,
  allowedLayoutsList,
  detectForbiddenLayoutMention,
} from '../voice/kannada-script';
import {
  allowsRepeatReplay,
  isDuplicateOutboundSpeech,
  registerOutboundSpeech,
} from '../voice/outbound-dedup';
import { CallCaptureSession } from '../voice/call-capture/session';
import { callLog } from '../voice/call-capture/logger';
import { loadAudioPipelineConfig } from '../voice/audio-pipeline-config';
import { takeCachedOutboundOpeningInstruction } from '../voice/opening-prewarm-cache';
import { buildLiveSpeechConfig, describeSpeechConfig, loadLiveSpeechSettings } from '../voice/tts/speech-config';
import { detectScriptLanguage } from '../voice/language/script-detect';
import {
  followLanguageFromUtterance,
  languageFollowSystemPrompt,
  ttsLanguageFor,
  createLanguageSwitchState,
  type LanguageSwitchState,
  type FollowLanguage,
} from '../voice/language/language-follow';
import { evaluateBargeIn, evaluateLocalSpeech } from '../voice/turn-policy';
import { analyzePcmFrame, isSpeechLike, shouldOpenGate } from '../voice/speech-likelihood';
import {
  armSpeechRecovery,
  cancelSpeechRecovery,
  createSpeechRecoveryState,
  disarmSpeechRecovery,
  loadRecoveryConfig,
  resolveSpeechRecoveryWithAiAudio,
  resolveSpeechRecoveryWithTranscript,
  speechRecoveryNudgeText,
  tickSpeechRecovery,
  type SpeechRecoveryState,
} from '../voice/speech-recovery';
import { LEAD_STATUS, outcomeFromFlags } from '../lib/lead-status';
import { generateCallSummary } from '../lib/call-summary';
import { ensureLeadForCall, outboundCallerId, phoneTail } from '../lib/lead-upsert';
import {
  markAnsweredByPhone,
  markCallCompletedByPhone,
  markOutcomeByPhone,
  transitionLeadsByPhone,
} from '../lib/lead-status-transitions';
// (customer-identity machinery removed — the final flow never addresses the caller by name.)
// (wait-policy layer removed — the flowchart's 5s/10s silence protocol replaces it.)
import { isMeaningfulCustomerUtterance, shouldAllowEndCall } from '../voice/end-call-guard';
import {
  isCustomerTurnSignal,
  isShortAffirmativeReply,
  looksLikeOpeningEcho,
} from '../voice/short-reply';

function parseHeaderBag(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  const str = raw?.extra_headers || raw?.extraHeaders;
  if (typeof str === 'string' && str.trim()) {
    for (const pair of str.split(/[;,]/)) {
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  } else if (str && typeof str === 'object') {
    for (const [k, v] of Object.entries(str)) out[k] = String(v ?? '');
  }
  return out;
}

// --- Normalize Plivo & Twilio WebSocket events to one internal format ---
function normalizeVoiceEvent(raw: any): any {
  const evt: string = raw.event || raw.type || 'media';
  const result: any = { event: evt };

  if (evt === 'start') {
    const start = raw.start || raw.Start || raw;
    const streamId = start.streamSid || start.streamId || start.CallUUID || start.callUuid || start.callSid || start.stream_sid;
    const params = start.customParameters || start.CustomParameters || start.extraHeaders || start.extra_headers || start.Parameters || {};
    const objectParams = typeof params === 'string' ? parseHeaderBag({ extra_headers: params }) : (params || {});
    const mergedParams = { ...parseHeaderBag(raw), ...objectParams, ...(raw.parameters || {}) };
    result.start = {
      streamSid: streamId,
      callSid: start.callSid || start.callId || start.CallUUID || start.callUuid || streamId,
      customParameters: mergedParams,
      isPlivo: Boolean(raw.extra_headers != null || start.streamId || start.callId),
    };
    return result;
  }

  if (evt === 'media' || evt === 'Media') {
    const media = raw.media || raw.Media || raw;
    result.media = {
      track: media.track || media.Track || raw.track || 'inbound',
      chunk: media.chunk || media.Chunk || raw.chunk || '0',
      timestamp: media.timestamp || media.Timestamp || raw.timestamp || Date.now(),
      payload: media.payload || media.Payload || raw.payload || '',
      contentType: media.contentType || media.content_type || 'audio/x-mulaw',
      sampleRate: media.sampleRate || media.sample_rate || 8000,
    };
    return result;
  }

  if (evt === 'stop' || evt === 'Stop' || evt === 'close' || evt === 'Close') {
    const stop = raw.stop || raw.Stop || raw;
    result.stop = {
      streamSid: stop.streamSid || stop.streamId || stop.CallUUID || stop.callSid || '',
      callSid: stop.callSid || stop.CallUUID || stop.callUuid || '',
    };
    result.event = 'stop';
    return result;
  }

  if (evt === 'connect' || evt === 'Connect') {
    return { event: 'connect', protocol: raw.protocol || raw.Protocol || '' };
  }

  return { ...raw, event: evt };
}

// --- Tools ---
const OUTBOUND_END_CALL_TOOL = {
  name: "endCall",
  description:
    "End the outbound call ONLY when: (1) the caller clearly said goodbye / asked to end, or " +
    "(2) the caller confirmed they are not interested (after the notInterested close line). " +
    "After delivering a scripted closing that includes 'Thank you.' exactly ONCE for the whole call, " +
    "call endCall in the SAME turn — if the closing already includes Thank you, do NOT say it again. " +
    "NEVER end the call because of silence, a quiet caller, short pauses, short replies, or a topic change — " +
    "silence ALWAYS means keep listening. The system will never ask you to end a call due to silence.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

// (setName tool removed — the final call flow never asks the caller's name.)

// Explicit "not interested" signal, separate from a generic endCall.
// Previously, endCall alone always defaulted the lead to "not - interested"
// unless an appointment or follow-up had been set — meaning any customer who
// got useful info and hung up without committing to either was silently
// mislabeled as not interested. Now endCall defaults to a neutral status,
// and this tool is the only thing that marks a lead not-interested.
const NOT_INTERESTED_TOOL = {
  name: "notInterested",
  description: "Call this when the customer explicitly and clearly says they are not interested in Alliance Square's plots. Do not call this just because the call is ending without a booking — only when they actively decline.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

// --- Audio Transcoding Helpers (G.711 mu-law) ---
const muLawToPcmTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xFF;
  let sign = (mu & 0x80) ? -1 : 1;
  let exponent = (mu & 0x70) >> 4;
  let data = mu & 0x0F;
  let pcm = ((data << 3) + 132) << exponent;
  muLawToPcmTable[i] = (pcm - 132) * sign;
}

function pcmToMuLaw(sample: number) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  let res = ~(sign | (exponent << 4) | mantissa);
  return res & 0xFF;
}

// Lead call lifecycle — see src/lib/lead-status.ts
const STATUS = LEAD_STATUS;

export async function setupGemini(ws: WebSocket, streamParams?: URLSearchParams) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  let audioSink: 'twilio' | 'plivo' = (process.env.VOICE_PROVIDER || 'twilio').toLowerCase() === 'plivo' ? 'plivo' : 'twilio';
  let streamSid: string | null = null;
  let capture: CallCaptureSession | null = null;
  let geminiSession: any = null;
  let pendingFullSystemInstruction = '';
  let transcriptCount = 0;
  let startTime = Date.now();
  let customerPhone: string | null = null;
  // Patient wait / silence state machine — see wait-policy.ts.
  // NEVER auto-end the call on silence; NEVER treat silence as not interested.
  // (wait-policy state removed — silence protocol only.)
  let fullTranscription: string = "";
  let isFirstResponse = true;
  let callInterested: boolean | null = null;
  // Outbound-only product: every media-stream session is an outbound cold call.
  // (Inbound flows were removed; the Plivo number hangs up on inbound calls.)
  const isOutboundCall = true;
  /** Single canonical name/gender/salutation object for this call. */
  // Name/identity machinery removed — the final flow never asks the caller's name.
  let outboundOpeningRepeatDone = false;
  let outboundGreetingSpoken = false;
  let outboundStayActiveNudgeSent = false;
  let outboundOpeningWaitTimer: NodeJS.Timeout | null = null;
  const OPENING_WAIT_MS = 7000;
  // Cold-call silence protocol (5s check / 10s close) — see kannada-script.ts.
  let outboundSilence: OutboundSilenceState = createOutboundSilenceState();
  let outboundSilenceTimer: NodeJS.Timeout | null = null;
  /** Timestamp of the caller's last transcript — diagnostics + quiet-window math. */
  let lastCustomerTranscriptAt = Date.now();
  /** When the CURRENT model turn's audio began — echo-safe interrupt proof window. */
  let currentModelTurnStartedAt = 0;
  // Set once ANY flowchart close line (not-interested / silence timeout) is delivered —
  // the agent is then hard-muted and the call hangs up.
  let outboundBusyCloseSent = false;
  const audioCfg = loadAudioPipelineConfig();
  const ttsSettings = loadLiveSpeechSettings();
  /** LANGUAGE FOLLOW — Kannada default; follows the caller's actual language. */
  let languageSwitchState: LanguageSwitchState = createLanguageSwitchState();
  let activeTtsLanguageCode: string =
    ttsSettings.languageCode && ttsSettings.languageCode !== 'auto'
      ? ttsSettings.languageCode
      : 'kn-IN';
  let pendingLanguageSwitchPrompt: string | null = null;
  const inputGain = audioCfg.inputGain;
  const voiceDebug = audioCfg.voiceDebug;
  const vadLog = (msg: string) => {
    if (voiceDebug) console.log(`[VAD] ${msg}`);
  };

  const HP_F0 = 120, HP_Q = 0.7071, HP_FS = 8000;
  const hpW = 2 * Math.PI * HP_F0 / HP_FS;
  const hpAlpha = Math.sin(hpW) / (2 * HP_Q);
  const hpA0 = 1 + hpAlpha;
  const HP_B0 = ((1 + Math.cos(hpW)) / 2) / hpA0;
  const HP_B1 = (-(1 + Math.cos(hpW))) / hpA0;
  const HP_B2 = HP_B0;
  const HP_A1 = (-2 * Math.cos(hpW)) / hpA0;
  const HP_A2 = (1 - hpAlpha) / hpA0;
  let hpX1 = 0, hpX2 = 0, hpY1 = 0, hpY2 = 0;

  let noiseFloorRms = 150;
  const NOISE_FLOOR_MIN = audioCfg.noiseFloorMin;
  const NOISE_FLOOR_MAX = audioCfg.noiseFloorMax;
  let gateOpen = false;
  let gateBelowSince: number | null = null;
  const GATE_OPEN_MIN_RMS = audioCfg.gateOpenMinRms;
  const GATE_OPEN_MAX_RMS = audioCfg.gateOpenMaxRms;
  const GATE_FLOOR_MULT = audioCfg.gateFloorMult;
  const GATE_CLOSE_RATIO = audioCfg.gateCloseRatio;
  const GATE_RELEASE_MS = audioCfg.gateReleaseMs;
  let lastUpsampleSample = 0;
  let lastGateLogAt = 0;
  let lastNoiseMetricLogAt = 0;

  const SCRATCH_SAMPLES = 3200;
  const scratchCleaned = new Int16Array(SCRATCH_SAMPLES);
  const scratchPcm16k = Buffer.allocUnsafe(SCRATCH_SAMPLES * 4);

  let aiPlaybackEndsAt = 0;
  /** Last frame with speech-like energy — stuck-VAD self-heal uses this. */
  let lastSpeechEnergyAt = 0;
  let bargeInStartedAt: number | null = null;
  let bargeInConfirmedAt = 0;
  const BARGE_IN_CONFIRM_TTL_MS = 2000;
  const BARGE_IN_MIN_RMS = audioCfg.bargeInMinRms;
  const BARGE_IN_FLOOR_MULT = audioCfg.bargeInFloorMult;
  const BARGE_IN_MIN_MS = audioCfg.bargeInMinMs;
  const BARGE_IN_REQUIRE_GATE = audioCfg.bargeInRequireGateOpen;
  const speechLikeConfig = {
    minCrestFactor: audioCfg.speechMinCrestFactor,
    minZeroCrossRate: audioCfg.speechMinZeroCrossRate,
    quietSpeechFloorMult: audioCfg.speechQuietFloorMult,
  };
  let suppressAiOutput = false;
  let suppressRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  // Speech-recovery ladder — single failsafe for "spoke but nothing happened".
  // See speech-recovery.ts: grace (waiting for STT) → answerGrace (waiting for AI
  // reply) → bounded nudges → hand over to the silence protocol.
  const recoveryCfg = loadRecoveryConfig();
  let speechRecovery: SpeechRecoveryState = createSpeechRecoveryState();
  let recoveryTickTimer: ReturnType<typeof setTimeout> | null = null;
  /** AI audio played since the caller's last speech-end — outbound dead-air guard. */
  let aiAudioSinceLastCustomerSpeech = false;
  const SUPPRESS_RECOVERY_MS = 400;
  let speakNudgeSentThisTurn = false;

  const LATENCY_DEBUG = process.env.LATENCY_DEBUG === '1';
  let streamConnectAt = 0;
  let speechEndAt = 0;
  let awaitingFirstAiAudio = false;
  const latLog = (label: string) => {
    if (!LATENCY_DEBUG) return;
    const sinceStream = streamConnectAt > 0 ? ` stream+${Date.now() - streamConnectAt}ms` : '';
    const delta = speechEndAt > 0 ? ` +${Date.now() - speechEndAt}ms` : '';
    console.log(`[LAT] ${label}${sinceStream}${delta}`);
  };

  // ---------- TEMP DEV DIAGNOSTICS (VOICE_DIAG=1 — remove after stabilizing) ----------
  const DIAG = process.env.VOICE_DIAG === '1';
  const diagLog = (msg: string) => {
    if (DIAG) console.log(`[DIAG] ${msg}`);
  };

  // ---------- EXPLICIT CALL STATE MACHINE ----------
  // CONNECTING → GREETING → LISTENING → USER_SPEAKING → PROCESSING → AGENT_SPEAKING → LISTENING …
  // The cycle ALWAYS returns to LISTENING. Silence NEVER moves the call toward ENDED —
  // the only exits are a real close (user no/goodbye), a completed transfer, or telephony end.
  type CallState =
    | 'CONNECTING'
    | 'GREETING'
    | 'LISTENING'
    | 'USER_SPEAKING'
    | 'PROCESSING'
    | 'AGENT_SPEAKING'
    | 'RECONNECTING'
    | 'ENDED';
  let callState: CallState = 'CONNECTING';
  const setCallState = (next: CallState, why = '') => {
    if (callState === next) return;
    console.log(`[STATE] ${callState} → ${next}${why ? ` (${why})` : ''}`);
    callState = next;
  };

  // Pipeline health counters (watchdog + diagnostics).
  let mediaFrameCount = 0;
  let droppedFramesNoSession = 0;
  let audioSentChunkCount = 0;
  let lastMediaFrameAt = Date.now();
  let lastAudioSentAt = 0;
  let consecutiveAudioSendFailures = 0;
  let vadSpeakingSince: number | null = null;
  let suppressSince: number | null = null;
  let geminiReconnectAttempts = 0;
  let reconnectScheduled = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectFn: (() => Promise<boolean>) | null = null;
  let sessionIsReconnect = false;
  let watchdogTimer: NodeJS.Timeout | null = null;
  let lastWatchdogNote = '';

  // New strict-script step tracking: areas delivered → interested handoff transfer.
  let outboundAreasLineDelivered = false;
  let outboundHandoffNudgeSent = false;
  let outboundNotInterestedNudgeSent = false;
  let outboundYesAskNameNudgeSent = false;
  let outboundLocationsNudgeSent = false;
  /** First name used to address the caller once they state it ("{name} ಸರ್"). */
  // (outboundCallerFirstName removed — no name step in the final flow.)
  let outboundTransferStarted = false;
  let outboundTransferRequested = false;
  let outboundCallUuid: string | null = null;
  let outboundThanksSpoken = false;
  let outboundNoRepeatNudgeSent = false;
  let outboundThanksHangupTimer: NodeJS.Timeout | null = null;
  let outboundHardMuteAfterClose = false;
  let outboundRepeatReplayPending = false;
  let lastOutboundTurnSuppressed = false;
  // (conversation memory removed — the fixed flowchart needs none.)
  const outboundSpokenChunks = new Set<string>();
  let lastForbiddenLayoutNudgeAt = 0;
  let customerClearGoodbye = false;
  let customerUtteranceCount = 0;
  let endCallInvoked = false;
  let projectReferenceInjected = false;
  let greetingAudioHeard = false;
  let deferredContextScheduled = false;
  let greetingRetrySent = false;
  let openingGreetingTurnFinished = false;
  let runtimeInstructionsInjected = false;
  let greetingSent = false;
  let openingQuestionSent = false;
  let fullCallGuideInjected = false;
  let geminiSessionOpened = false;
  /** True once ANY Gemini session has opened on this call (initial or reconnect). */
  let geminiEverConnected = false;
  let lastCustomerTranscript = '';

  let lastPlayedAiNorm = '';
  let lastPlayedAiRaw = '';
  let lastPlayedAiAt = 0;
  const AI_DEDUP_WINDOW_MS = 120_000;

  const normalizeAiDedup = (text: string) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  const isNearDuplicateAiTurn = (text: string): boolean => {
    const norm = normalizeAiDedup(text);
    if (norm.length < 14) return false;
    if (Date.now() - lastPlayedAiAt > AI_DEDUP_WINDOW_MS) return false;
    const prev = lastPlayedAiNorm;
    if (!prev || prev.length < 14) return false;
    const prefixLen = Math.min(28, norm.length, prev.length);
    if (prefixLen >= 14 && norm.slice(0, prefixLen) === prev.slice(0, prefixLen)) return true;
    const needle = prev.slice(0, Math.min(prev.length, 36));
    return needle.length >= 14 && norm.includes(needle);
  };

  const markAiTurnPlayed = (text: string) => {
    const raw = String(text || '').trim();
    if (raw) lastPlayedAiRaw = raw;
    const norm = normalizeAiDedup(text);
    if (norm.length >= 14) {
      lastPlayedAiNorm = norm;
      lastPlayedAiAt = Date.now();
    }
  };

  const injectSilentContext = (text: string, label: string) => {
    if (!geminiSession) return;
    const wrapped =
      `[SYSTEM CONTEXT — ${label}: background knowledge only. ` +
      `Do not read this block aloud or restart the greeting. ` +
      `When the customer speaks, reply with audio immediately.]:\n${text}`;
    try {
      if (typeof geminiSession.sendClientContent === 'function') {
        geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: wrapped }] }],
          turnComplete: false,
        });
      } else {
        geminiSession.sendRealtimeInput({ text: wrapped });
      }
    } catch (e: any) {
      console.error(`[GEMINI] Silent context inject failed (${label}):`, e?.message || e);
      throw e;
    }
  };

  const injectFullCallGuideIfReady = () => {
    if (fullCallGuideInjected || !isOutboundCall || !geminiSession || !pendingFullSystemInstruction.trim()) return;
    fullCallGuideInjected = true;
    try {
      injectSilentContext(pendingFullSystemInstruction, 'FULL CALL GUIDE');
      console.log('[GEMINI] Full outbound call guide delivered (post-intro).');
    } catch (e: any) {
      fullCallGuideInjected = false;
      console.error('[GEMINI] Full call guide inject failed:', e?.message || e);
    }
  };

  const injectRuntimeInstructionsIfReady = (runtimeText: string) => {
    if (runtimeInstructionsInjected || !geminiSession || !runtimeText.trim()) return;
    runtimeInstructionsInjected = true;
    try {
      injectSilentContext(runtimeText.trim(), 'RUNTIME RULES');
      console.log('[GEMINI] Runtime instructions delivered (deferred for fast intro).');
    } catch (e: any) {
      runtimeInstructionsInjected = false;
      console.error('[GEMINI] Runtime instruction inject failed:', e?.message || e);
    }
  };

  const sendClientTextTurn = (text: string) => {
    if (!geminiSession || !text.trim()) return;
    if (typeof geminiSession.sendClientContent === 'function') {
      geminiSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      });
    } else {
      geminiSession.sendRealtimeInput({ text });
    }
  };

  const injectDeferredContextAfterOpening = () => {
    if (deferredContextScheduled) return;
    deferredContextScheduled = true;
    setTimeout(() => {
      if (!geminiSession || outboundHardMuteAfterClose) return;
      console.log('[GEMINI] Injecting deferred context (after customer has spoken)');
      injectProjectReferenceIfReady();
    }, 400);
  };

  const injectProjectReferenceIfReady = () => {
    if (projectReferenceInjected || !geminiSession) return;
    projectReferenceInjected = true;
    try {
      injectSilentContext(buildOutboundProjectReferenceContext(), 'PROJECT REFERENCE');
      console.log('[GEMINI] Project reference delivered to session.');
    } catch (e: any) {
      projectReferenceInjected = false;
      console.error('[GEMINI] Project reference inject failed:', e?.message || e);
    }
  };

  const clearOpeningWait = () => {
    if (outboundOpeningWaitTimer) {
      clearTimeout(outboundOpeningWaitTimer);
      outboundOpeningWaitTimer = null;
    }
  };

  let openingSpeechInProgress = false;
  let openingGraceTimer: NodeJS.Timeout | null = null;
  const OPENING_SPEECH_GRACE_MS = 7000;

  // (context-interrupt / memory machinery removed — the model answers identity
  // or off-topic questions briefly from the system prompt and returns to the
  // current script step on its own.)

  const customerStartedAnsweringOpening = () => {
    if (!isOutboundCall || outboundOpeningRepeatDone) return;
    if (!outboundOpeningWaitTimer && !openingSpeechInProgress) return;
    clearOpeningWait();
    if (!openingSpeechInProgress) {
      openingSpeechInProgress = true;
      console.log("[GEMINI] Customer audio during opening wait — retry paused");
    }
    if (openingGraceTimer) clearTimeout(openingGraceTimer);
    openingGraceTimer = setTimeout(() => {
      openingGraceTimer = null;
      openingSpeechInProgress = false;
      if (!outboundOpeningRepeatDone && !vadIsSpeaking && customerUtteranceCount === 0) {
        console.log("[GEMINI] Opening speech produced no transcript — re-arming retry");
        armOpeningWait();
      }
    }, OPENING_SPEECH_GRACE_MS);
  };

  const customerAnsweredOpening = (raw?: string) => {
    if (!isOutboundCall) return;
    if (!raw) return;
    if (looksLikeOpeningEcho(raw) && !isShortAffirmativeReply(raw)) return;
    outboundOpeningRepeatDone = true;
    openingSpeechInProgress = false;
    if (openingGraceTimer) {
      clearTimeout(openingGraceTimer);
      openingGraceTimer = null;
    }
    clearOpeningWait();
  };

  const looksLikeOpeningDecline = (raw: string) =>
    /^(?:no+|nope|nah|not interested|not looking|ಇಲ್ಲ|ಬೇಡ)[.!?\s]*$/iu.test(String(raw || '').trim());

  /** Clear yes / interested signal from the caller (strict script steps 2B/3A). */
  const looksLikeInterestedYes = (raw: string): boolean => {
    const t = String(raw || '').trim().toLowerCase();
    if (!t) return false;
    if (looksLikeRepeatRequest(t)) return false;
    if (looksLikeOpeningDecline(t)) return false;
    if (/\b(not interested|not looking|no need|stop calling|don'?t call)\b/.test(t)) return false;
    return (
      /^(?:yes|yeah|yep|yup|sure|ok|okay|haan|han|ha|hā|ಹೌದು|ಸರಿ|sari|houda|hauda)[.!?\s]*$/iu.test(t) ||
      /\b(yes|yeah|sure|interested|looking|tell me|know more|want to know|ಹೌದು|ನೋಡ್ತಿದ್ದೀನಿ|ಬೇಕು)\b/.test(t)
    );
  };

  const keepOutboundActiveAfterOpeningYes = (raw: string) => {
    if (!isOutboundCall || outboundStayActiveNudgeSent) return;
    if (!isShortAffirmativeReply(raw) || looksLikeOpeningDecline(raw)) return;
    if (outboundAreasLineDelivered) return;
    outboundStayActiveNudgeSent = true;
    console.log('[GEMINI] Opening acknowledgment — locations line now');
    try {
      sendClientTextTurn(OUTBOUND_YES_LOCATIONS_NUDGE);
    } catch (e: any) {
      outboundStayActiveNudgeSent = false;
      console.error('[GEMINI] Stay-active after opening yes failed:', e?.message || e);
    }
  };

  const armOpeningWait = () => {
    outboundOpeningRepeatDone = true;
  };

  const clearWaitTick = () => {
    // No-op — wait-policy removed; kept so all call sites stay valid.
  };

  const sendWaitSystemPrompt = (text: string) => {
    if (!geminiSession) return;
    if (outboundHardMuteAfterClose || outboundTransferStarted) return;
    try {
      if (typeof geminiSession.sendClientContent === 'function') {
        geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        });
      } else {
        geminiSession.sendRealtimeInput({ text });
      }
    } catch (e: any) {
      console.error('[WAIT] Failed to send wait prompt:', e?.message || e);
    }
  };

  const scheduleWaitTick = () => {
    // No-op — wait-policy removed; the 5s/10s silence protocol owns all waiting.
  };

  const sendOutboundNoRepeatNudgeOnce = () => {
    if (!isOutboundCall || outboundNoRepeatNudgeSent || outboundHardMuteAfterClose) return;
    outboundNoRepeatNudgeSent = true;
    try {
      geminiSession?.sendRealtimeInput({ text: OUTBOUND_NO_REPEAT_NUDGE });
    } catch (e: any) {
      console.error('[GEMINI] No-repeat nudge failed:', e?.message || e);
    }
    setTimeout(() => {
      outboundNoRepeatNudgeSent = false;
    }, 4000);
  };

  const activateOutboundPostThanksMute = () => {
    if (!isOutboundCall || outboundThanksSpoken) return;
    outboundThanksSpoken = true;
    outboundHardMuteAfterClose = true;
    suppressAiOutput = true;
    if (suppressRecoveryTimer) {
      clearTimeout(suppressRecoveryTimer);
      suppressRecoveryTimer = null;
    }
    clearWaitTick();
    cancelRecovery();
    scheduleOutboundHangupAfterThanks();
  };

  const shouldSuppressOutboundTurn = (turnText: string): { suppress: boolean; reason?: string } => {
    const trimmed = String(turnText || '').trim();
    if (outboundHardMuteAfterClose) {
      return { suppress: true, reason: 'hard_mute_after_close' };
    }
    if (!trimmed) {
      return { suppress: false };
    }
    if (outboundThanksSpoken && isRedundantOutboundThanksTurn(trimmed, true)) {
      return { suppress: true, reason: 'redundant_thanks' };
    }
    if (trimmed.length < 8) {
      if (outboundThanksSpoken && looksLikeThanksOnlyLine(trimmed)) {
        return { suppress: true, reason: 'redundant_thanks' };
      }
      return { suppress: false };
    }
    if (
      outboundRepeatReplayPending &&
      allowsRepeatReplay(trimmed, lastPlayedAiRaw, true)
    ) {
      outboundRepeatReplayPending = false;
      return { suppress: false };
    }
    if (
      outboundTransferStarted &&
      turnText.length > 16 &&
      looksLikeHandoffLine(turnText)
    ) {
      return { suppress: true, reason: 'duplicate_handoff' };
    }
    // REPLY PRIORITY (anti-silence rule): a turn that directly answers FRESH
    // caller speech is NEVER muted by the dedup guards. They historically
    // silenced real replies — Kannada answers open with the same "ಹಾ ಸರ್ /
    // ಸರಿ ಸರ್" prefix (isNearDuplicateAiTurn), and follow-up answers reuse the
    // locations vocabulary (tokenContainment). Silence is far worse than an
    // imperfect repeat; the prompt-level no-repeat rule still applies.
    const freshReply = openingGreetingTurnFinished && Date.now() - lastCustomerTranscriptAt < 8000;
    if (
      !freshReply &&
      openingGreetingTurnFinished &&
      turnText.length > 12 &&
      // ONLY suppress a true restatement of the greeting intro (identity +
      // opening question together). The broader echo pattern also matches
      // legitimate follow-ups like "ಸೈಟ್ ನೋಡ್ತಿದೀರಾ — investment ನಾ building ನಾ?",
      // which silenced Priya right after the caller said yes.
      looksLikeOpeningRestate(turnText)
    ) {
      return { suppress: true, reason: 'duplicate_opening' };
    }
    if (!freshReply && isDuplicateOutboundSpeech(turnText, outboundSpokenChunks)) {
      return { suppress: true, reason: 'duplicate_spoken_line' };
    }
    if (!freshReply && turnText.length > 12 && isNearDuplicateAiTurn(turnText)) {
      return { suppress: true, reason: 'duplicate_recent_turn' };
    }
    return { suppress: false };
  };

  const playOutboundTurnIfNew = (parts: any[], turnText: string) => {
    const { suppress, reason } = shouldSuppressOutboundTurn(turnText);
    lastOutboundTurnSuppressed = suppress;
    if (suppress) {
      console.warn(
        `[GEMINI] Suppressing outbound repeat (${reason}): "${turnText.slice(0, 72)}..."`,
      );
      forceOutboundHangupIfClosing(`suppressed repeat (${reason})`);
      // STRICT no-repeat rule: tell the model the line is spent — in any wording.
      if (
        reason === 'duplicate_spoken_line' ||
        reason === 'duplicate_recent_turn' ||
        reason === 'duplicate_handoff' ||
        reason === 'duplicate_opening'
      ) {
        sendOutboundNoRepeatNudgeOnce();
      }
      return;
    }
    playGeminiAudioParts(parts);
    registerOutboundSpeech(turnText, outboundSpokenChunks);
    if (!outboundAreasLineDelivered && looksLikeAreasLine(turnText)) {
      outboundAreasLineDelivered = true;
      console.log('[GUARD] Areas line delivered — next yes goes to sales-team transfer');
    }
    if (!outboundTransferStarted && looksLikeHandoffLine(turnText)) {
      outboundTransferStarted = true;
      console.log('[GUARD] Handoff line delivered — starting sales-team transfer (no endCall)');
      startSalesTeamTransfer();
    }
    if (
      isOutboundCall &&
      (outboundBusyCloseSent ||
        hasThanksClosing(turnText) ||
        looksLikeClosingGoodbye(turnText))
    ) {
      // outboundThanksSpoken doubles as "closing delivered" (thanks close, busy
      // close, or silence close) — it hard-mutes the agent and schedules hangup.
      activateOutboundPostThanksMute();
    }
  };

  /**
   * Sales-team transfer after the INTERESTED handoff line.
   * Replaces the customer leg's XML with a Dial to PLIVO_TRANSFER_NUMBER via
   * Plivo's live-call transfer API — the AI stream ends, the caller is bridged
   * to the sales phone. Without PLIVO_TRANSFER_NUMBER the call stays open.
   */
  const startSalesTeamTransfer = () => {
    if (outboundTransferRequested) return;
    outboundTransferRequested = true;
    const transferTo = (process.env.PLIVO_TRANSFER_NUMBER || '').replace(/\D/g, '');
    const authId = process.env.PLIVO_AUTH_ID || '';
    const authToken = process.env.PLIVO_AUTH_TOKEN || '';
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    if (!transferTo || !authId || !authToken || !base || !outboundCallUuid) {
      console.log(
        `[TRANSFER] Skipped (transferNumber=${transferTo ? 'set' : 'missing'} callUuid=${outboundCallUuid ? 'yes' : 'no'} appUrl=${base ? 'yes' : 'no'}) — call stays open`,
      );
      return;
    }
    const transferUrl = `${base}/api/plivo/transfer-answer`;
    console.log(`[TRANSFER] Sales-team transfer: call=${outboundCallUuid} → ${transferTo}`);
    void fetch(`https://api.plivo.com/v1/Account/${authId}/Call/${outboundCallUuid}/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ legs: 'aleg', aleg_url: transferUrl, aleg_method: 'POST' }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Plivo transfer API ${r.status}: ${await r.text().catch(() => '')}`);
        console.log('[TRANSFER] Sales-team transfer accepted by Plivo');
      })
      .catch((e) => console.error('[TRANSFER] Transfer request failed:', e?.message || e));
  };

  const armWaitingForCustomer = () => {
    // No-op — removed; the 5s/10s silence protocol owns all waiting.
  };

  const handleCustomerTranscriptForWait = (_userText: string) => {
    // No-op — wait-policy removed.
  };

  let outputLeftover: Buffer = Buffer.alloc(0);
  let geminiPlaybackRate = 24000;
  let loggedFirstAudio = false;

  const sendPcmToTwilio = (pcm: Buffer, flush = false) => {
    if (!streamSid) return;
    // STUCK-VAD SELF-HEAL: vadIsSpeaking must never outlive the caller by more
    // than 3s — mic echo/noise once wedged it true and ALL agent audio was
    // dropped here forever (total silence). If no fresh speech energy arrived
    // recently, force-clear the flag so playback resumes.
    if (vadIsSpeaking && now2() - lastSpeechEnergyAt > 3_000) {
      vadLog('stuck vadIsSpeaking self-heal — no fresh speech energy for 3s');
      diagLog('vad STUCK >3s without energy → force LISTENING (audio un-mute)');
      vadIsSpeaking = false;
      vadSilenceStartedAt = null;
    }
    if (suppressAiOutput) {
      if (vadIsSpeaking || (bargeInConfirmedAt > 0 && Date.now() - bargeInConfirmedAt < 280)) {
        outputLeftover = Buffer.alloc(0);
        return;
      }
      allowAiOutput();
    }
    const samplesPerOut = Math.max(1, Math.round(geminiPlaybackRate / 8000));
    const groupBytes = samplesPerOut * 2;
    let combined = outputLeftover.length > 0 ? Buffer.concat([outputLeftover, pcm]) : pcm;
    if (flush && combined.length % groupBytes !== 0 && combined.length >= 2) {
      const pad = groupBytes - (combined.length % groupBytes);
      const last = combined.readInt16LE(combined.length - 2);
      const extra = Buffer.alloc(pad);
      for (let o = 0; o < pad; o += 2) extra.writeInt16LE(last, o);
      combined = Buffer.concat([combined, extra]);
    }
    const usableLength = combined.length - (combined.length % groupBytes);
    outputLeftover = flush ? Buffer.alloc(0) : combined.subarray(usableLength);
    if (usableLength < groupBytes) return;
    const muLawBuffer = Buffer.alloc(usableLength / groupBytes);
    for (let i = 0; i < muLawBuffer.length; i++) {
      const offset = i * groupBytes;
      let sum = 0;
      for (let s = 0; s < samplesPerOut; s++) sum += combined.readInt16LE(offset + s * 2);
      muLawBuffer[i] = pcmToMuLaw(Math.round(sum / samplesPerOut));
    }
    if (!loggedFirstAudio) {
      loggedFirstAudio = true;
      console.log(`[GEMINI] Streaming speech to ${audioSink} (${geminiPlaybackRate} Hz → 8 kHz mu-law)`);
    }
    capture?.onAiSpeakStart();
    capture?.onAiMuLaw(muLawBuffer);
    aiPlaybackEndsAt = Math.max(Date.now(), aiPlaybackEndsAt) + muLawBuffer.length / 8;
    if (awaitingFirstAiAudio) {
      awaitingFirstAiAudio = false;
      latLog('PLIVO_AUDIO_SENT (time-to-first-response-audio)');
    }
    const payload = muLawBuffer.toString("base64");
    if (audioSink === "plivo") {
      ws.send(JSON.stringify({
        event: "playAudio",
        media: {
          contentType: "audio/x-mulaw",
          sampleRate: 8000,
          payload,
        },
      }));
    } else {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
    }
  };

  const clearPlayback = () => {
    suppressAiOutput = true;
    capture?.onAiPlaybackCleared();
    outputLeftover = Buffer.alloc(0);
    aiPlaybackEndsAt = 0;
    bargeInStartedAt = null;
    if (suppressRecoveryTimer) clearTimeout(suppressRecoveryTimer);
    suppressRecoveryTimer = setTimeout(() => {
      if (outboundHardMuteAfterClose) return;
      if (suppressAiOutput && !vadIsSpeaking) {
        console.warn('[GEMINI] suppressAiOutput recovery — re-arming AI output');
        allowAiOutput();
      }
    }, SUPPRESS_RECOVERY_MS);
    if (audioSink === "plivo") {
      ws.send(JSON.stringify({ event: "clearAudio", streamId: streamSid }));
    } else {
      ws.send(JSON.stringify({ event: "clear", streamSid }));
    }
  };

  // ---------- Speech-recovery ladder (see speech-recovery.ts) ----------
  // (The old response-watchdog was removed; the ladder is the single failsafe.)

  /** Monotonic-ish wall clock for helpers declared before `now` exists. */
  const now2 = () => Date.now();

  const clearRecoveryTick = () => {
    if (recoveryTickTimer) {
      clearTimeout(recoveryTickTimer);
      recoveryTickTimer = null;
    }
  };

  const sendRecoveryNudge = (kind: 'ask_repeat' | 'reply_now', attempt: number) => {
    if (!geminiSession || outboundHardMuteAfterClose || endCallInvoked || outboundTransferStarted) return;
    try {
      geminiSession.sendRealtimeInput({ text: speechRecoveryNudgeText(kind, attempt) });
      console.warn(
        `[RECOVERY] ${kind === 'ask_repeat' ? 'No transcript' : 'No AI reply'} after caller speech — nudge #${attempt} sent`,
      );
    } catch (e: any) {
      console.error('[RECOVERY] Nudge failed:', e?.message || e);
    }
  };

  const scheduleRecoveryTick = () => {
    clearRecoveryTick();
    if (speechRecovery.stage === 'idle' || speechRecovery.armedAt == null) return;
    const now = Date.now();
    const waitingFor =
      speechRecovery.stage === 'grace' || speechRecovery.stage === 'answerGrace'
        ? recoveryCfg.transcriptGraceMs
        : recoveryCfg.escalateGraceMs;
    const delay = Math.max(60, speechRecovery.armedAt + waitingFor - now);
    recoveryTickTimer = setTimeout(() => {
      recoveryTickTimer = null;
      if (!geminiSession || endCallInvoked || outboundHardMuteAfterClose) return;
      // Caller is talking again, AI audio is playing, or output is suppressed —
      // none of these is a stuck state; let events resolve the ladder.
      if (vadIsSpeaking || suppressAiOutput || Date.now() < aiPlaybackEndsAt - 100) {
        scheduleRecoveryTick();
        return;
      }
      const decision = tickSpeechRecovery(speechRecovery, recoveryCfg, Date.now());
      speechRecovery = decision.state;
      if (decision.action === 'send_recovery_nudge') {
        sendRecoveryNudge(decision.kind, decision.attempt);
        scheduleRecoveryTick();
      } else if (decision.action === 'resume_after_exhausted') {
        // STABILITY RULE: the ladder NEVER hands off to a hangup. It ends in a
        // resume-and-listen: one short spoken line, then the quiet-caller
        // reprompt cycle takes over — the call stays open indefinitely.
        console.log('[RECOVERY] Ladder exhausted — resume-and-listen (call stays open)');
        if (isOutboundCall && !outboundThanksSpoken) {
          setTimeout(() => {
            if (!geminiSession || endCallInvoked || outboundTransferStarted || outboundHardMuteAfterClose) return;
            if (vadIsSpeaking || Date.now() < aiPlaybackEndsAt - 100) return;
            try {
              geminiSession.sendRealtimeInput({ text: OUTBOUND_SILENCE_RESUME_NUDGE });
              diagLog('recovery exhausted → resume nudge sent, back to LISTENING');
              console.log('[RECOVERY] Resume line sent — back to LISTENING');
            } catch (e: any) {
              console.error('[RECOVERY] Resume nudge failed:', e?.message || e);
              scheduleGeminiReconnect('recovery resume send failed');
            }
          }, 600);
          resetOutboundSilenceCycle();
          armOutboundSilenceAfterTurn();
        }
      }
    }, delay);
  };

  const armRecoveryAfterSpeechEnd = () => {
    if (isOutboundCall && outboundHardMuteAfterClose) return;
    if (endCallInvoked) return;
    // ECHO GUARD (do not remove — prevents spurious "please repeat" lines):
    // a speech end that lands while AI audio is STILL playing and was never
    // confirmed by loud sustained barge-in is the caller's mic picking up
    // Priya's own voice — not a customer turn. Only arm when playback has
    // finished, or when a real barge-in was confirmed within the TTL.
    const bargeConfirmed = Date.now() - bargeInConfirmedAt < BARGE_IN_CONFIRM_TTL_MS;
    if (Date.now() < aiPlaybackEndsAt - 50 && !bargeConfirmed) {
      // Speech ended while the agent was STILL talking with no loud barge-in:
      // the caller answering OVER the agent's audio (or mic echo). Recovery is
      // NOT dropped — it is armed to start AFTER playback ends (+1.2s grace).
      // If the caller's words were never transcribed, they still get the
      // ask-to-repeat nudge quickly instead of 9s of dead air.
      const startDelayMs = Math.max(1200, aiPlaybackEndsAt - Date.now() + 1200);
      speechRecovery = armSpeechRecovery(speechRecovery, Date.now() + startDelayMs);
      scheduleRecoveryTick();
      vadLog(`speech end during playback — recovery armed with ${startDelayMs}ms start delay (echo candidate)`);
      return;
    }
    speechRecovery = armSpeechRecovery(speechRecovery, Date.now());
    scheduleRecoveryTick();
  };

  const noteCustomerTranscriptForRecovery = () => {
    speechRecovery = resolveSpeechRecoveryWithTranscript(speechRecovery, Date.now());
    scheduleRecoveryTick();
  };

  const cancelRecovery = () => {
    speechRecovery = cancelSpeechRecovery(speechRecovery);
    clearRecoveryTick();
  };

  // The old response-watchdog was REPLACED by the speech-recovery ladder
  // (speech-recovery.ts): one unified failsafe covering both missed transcripts
  // and missing AI replies, with echo-guarded arming and bounded escalation.
  // Do not re-introduce a second recovery timer — double nudges cause repeats.

  const resetSpeakNudge = () => {
    speakNudgeSentThisTurn = false;
  };

  const nudgeSpeakNowIfNeeded = () => {
    // Disabled — immediate nudges made replies sound rushed/robotic.
    // Response watchdog (2.5s) handles genuine dead air instead.
  };

  const allowAiOutput = () => {
    suppressAiOutput = false;
    capture?.onAiRecordingAllow();
  };

  const hangupStream = () => {
    if (audioSink === "plivo") {
      ws.send(JSON.stringify({ event: "stop", streamId: streamSid }));
    } else {
      ws.send(JSON.stringify({ event: "stop", streamSid }));
    }
  };

  const completeAndHangupOutboundCall = async (reason: string) => {
    if (endCallInvoked) return;
    endCallInvoked = true;
    if (outboundThanksHangupTimer) {
      clearTimeout(outboundThanksHangupTimer);
      outboundThanksHangupTimer = null;
    }
    console.log(`[GEMINI] Ending outbound call (${reason})`);
    diagLog(`call TERMINATE reason="${reason}"`);
    setCallState('ENDED', reason);
    stopListeningWatchdog();
    clearGeminiReconnect();
    clearOutboundSilenceTimer();

    if (customerPhone) {
      try {
        const completed = await markCallCompletedByPhone(customerPhone);
        console.log(`[DB] Marked call completed for ${customerPhone} rows=${completed.count}`);
        const tail = customerPhone.replace(/\D/g, '').slice(-10);
        const leads = await prisma.lead.findMany({
          where: {
            phone: { contains: tail },
            status: STATUS.CALL_COMPLETED,
          },
        });
        for (const lead of leads) {
          const outcome = outcomeFromFlags({ interested: lead.interested });
          if (!outcome) continue;
          const r = await markOutcomeByPhone(customerPhone, outcome, {
            interested: lead.interested,
          });
          console.log(`[DB] Promoted ${customerPhone} call completed → ${outcome} rows=${r.count}`);
        }
      } catch (e) {
        console.error('[DB Error] Failed to mark call completed:', e);
      }
    }

    hangupStream();
    geminiSession?.close();
    ws.close();
  };

  const scheduleOutboundHangupAfterThanks = () => {
    if (!isOutboundCall || endCallInvoked) return;
    if (outboundThanksHangupTimer) clearTimeout(outboundThanksHangupTimer);
    const run = () => {
      outboundThanksHangupTimer = null;
      if (endCallInvoked || !outboundThanksSpoken) return;
      const playLeft = Math.max(0, aiPlaybackEndsAt - Date.now());
      if (playLeft > 60) {
        outboundThanksHangupTimer = setTimeout(run, playLeft + 80);
        return;
      }
      void completeAndHangupOutboundCall('thanks closing');
    };
    outboundThanksHangupTimer = setTimeout(run, 40);
  };

  const forceOutboundHangupIfClosing = (reason: string) => {
    if (!isOutboundCall || endCallInvoked) return;
    if (outboundThanksSpoken || outboundHardMuteAfterClose) {
      void completeAndHangupOutboundCall(reason);
    }
  };

  // ---------------------------------------------------------------------
  // GEMINI AUTO-RECONNECT — a live session dying must NEVER kill the call.
  // Preserves: streamSid, customerPhone, callUuid, transcript, language
  // state, script progress, capture session. After re-open: resends the
  // deferred context, speaks one short resume line, returns to LISTENING.
  // ---------------------------------------------------------------------
  const GEMINI_RECONNECT_BASE_MS = 800;
  const GEMINI_RECONNECT_MAX_MS = 5_000;
  const GEMINI_RECONNECT_MAX_ATTEMPTS = 8;

  const clearGeminiReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectScheduled = false;
  };

  const setReconnectFn = (fn: (() => Promise<boolean>) | null) => {
    reconnectFn = fn;
  };

  const scheduleGeminiReconnect = (reason: string) => {
    if (endCallInvoked || callState === 'ENDED') return;
    if (reconnectScheduled) {
      diagLog(`reconnect already scheduled (${reason}) — ignoring`);
      return;
    }
    reconnectScheduled = true;
    const attempt = geminiReconnectAttempts + 1;
    const delay = Math.min(GEMINI_RECONNECT_MAX_MS, GEMINI_RECONNECT_BASE_MS * attempt);
    console.warn(
      `[GEMINI] Reconnect #${attempt} scheduled in ${delay}ms — reason: ${reason} (phone line stays open)`,
    );
    diagLog(`reconnect scheduled attempt=${attempt} delay=${delay}ms reason=${reason}`);
    setCallState('RECONNECTING', reason);
    // Close the dead session so its handlers stop firing.
    try { geminiSession?.close(); } catch { /* already dead */ }
    geminiSession = null;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!reconnectFn) {
        console.error('[GEMINI] No reconnect fn wired — cannot restore session');
        reconnectScheduled = false;
        return;
      }
      reconnectFn()
        .then((ok) => {
          if (ok) {
            reconnectScheduled = false;
          } else if (geminiReconnectAttempts < GEMINI_RECONNECT_MAX_ATTEMPTS) {
            reconnectScheduled = false;
            scheduleGeminiReconnect('reconnect attempt failed');
          } else {
            console.error(
              '[GEMINI] Reconnect attempts exhausted — phone line stays open, audio queued; will keep retrying if caller speaks',
            );
            diagLog('reconnect EXHAUSTED — line stays open (never hang up)');
            reconnectScheduled = false;
            geminiReconnectAttempts = GEMINI_RECONNECT_MAX_ATTEMPTS - 1;
          }
        })
        .catch(() => {
          reconnectScheduled = false;
          if (geminiReconnectAttempts < GEMINI_RECONNECT_MAX_ATTEMPTS) {
            scheduleGeminiReconnect('reconnect attempt threw');
          }
        });
    }, delay);
  };

  // LISTENING WATCHDOG — detects a stalled pipeline (telephony frames flowing
  // but nothing reaching Gemini, or the system stuck outside LISTENING/USER_
  // SPEAKING too long) and RESTORES listening. Never ends the call.
  const LISTENING_WATCHDOG_MS = 12_000;
  const startListeningWatchdog = () => {
    stopListeningWatchdog();
    watchdogTimer = setInterval(() => {
      if (endCallInvoked || callState === 'ENDED') {
        stopListeningWatchdog();
        return;
      }
      const now = Date.now();
      const framesFlowing = now - lastMediaFrameAt < 5_000;
      if (!framesFlowing) return; // call likely over; telephony 'stop' will clean up.
      const note = `frames=${mediaFrameCount} sent=${audioSentChunkCount} state=${callState} ` +
        `reconnecting=${reconnectScheduled} lastSent=${lastAudioSentAt ? now - lastAudioSentAt : 'never'}ms ago`;
      const audioStalled = lastAudioSentAt === 0 || now - lastAudioSentAt > 8_000;
      const stateStuck =
        callState !== 'LISTENING' &&
        callState !== 'USER_SPEAKING' &&
        callState !== 'CONNECTING' &&
        callState !== 'GREETING' &&
        callState !== 'AGENT_SPEAKING' &&
        !reconnectScheduled;
      if (audioStalled && !reconnectScheduled) {
        console.warn(`[WATCHDOG] Audio→Gemini stalled (${note}) — reconnecting (line stays open)`);
        diagLog(`watchdog AUDIO_STALL ${note}`);
        scheduleGeminiReconnect('watchdog: audio pipeline stalled');
      } else if (stateStuck && note !== lastWatchdogNote) {
        lastWatchdogNote = note;
        console.warn(`[WATCHDOG] State outside LISTENING (${note}) — restoring LISTENING`);
        diagLog(`watchdog STATE_STUCK ${note} → LISTENING`);
        setCallState('LISTENING', 'watchdog restore');
      } else if (DIAG) {
        diagLog(`watchdog ok ${note}`);
      }
    }, 4_000);
  };

  const stopListeningWatchdog = () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const clearOutboundSilenceTimer = () => {
    if (outboundSilenceTimer) {
      clearTimeout(outboundSilenceTimer);
      outboundSilenceTimer = null;
    }
  };

  /** Meaningful customer speech — reset the silence cycle. */
  const resetOutboundSilenceCycle = () => {
    if (!isOutboundCall) return;
    outboundSilence = resetOutboundSilence();
    clearOutboundSilenceTimer();
  };

  const sendOutboundSilenceNudge = (text: string) => {
    if (!geminiSession || outboundHardMuteAfterClose || outboundTransferStarted) return;
    try {
      geminiSession.sendRealtimeInput({ text });
    } catch (e: any) {
      console.error('[SILENCE] Nudge failed:', e?.message || e);
    }
  };

  // SILENCE = KEEP LISTENING (permanent stability rule). The tick only ever
  // produces a soft availability-check line; the cycle re-arms forever. There
  // is NO close step and NO hangup on any amount of silence.
  const runOutboundSilenceTick = () => {
    outboundSilenceTimer = null;
    if (!geminiSession || endCallInvoked || outboundTransferStarted) return;
    if (vadIsSpeaking || Date.now() < aiPlaybackEndsAt - 100) {
      scheduleOutboundSilenceTick();
      return;
    }
    const now = Date.now();
    const tick = tickOutboundSilence(outboundSilence, now);
    outboundSilence = tick.state;
    if (tick.action === 'speak_check') {
      const quietSecs = Math.round((now - lastCustomerTranscriptAt) / 1000);
      console.log(`[SILENCE] ${quietSecs}s quiet — soft availability-check reprompt (call stays open)`);
      diagLog(`silence reprompt quiet=${quietSecs}s → LISTENING (no hangup ever)`);
      sendOutboundSilenceNudge(OUTBOUND_SILENCE_CHECK_NUDGE);
      // Re-arm the next quiet window — the loop NEVER terminates the call.
      scheduleOutboundSilenceTick();
    } else {
      scheduleOutboundSilenceTick();
    }
  };

  const scheduleOutboundSilenceTick = () => {
    if (!isOutboundCall || endCallInvoked || outboundHardMuteAfterClose) return;
    clearOutboundSilenceTimer();
    const deadline = nextOutboundSilenceDeadline(outboundSilence);
    if (deadline == null) return;
    const delay = Math.max(50, deadline - Date.now());
    outboundSilenceTimer = setTimeout(runOutboundSilenceTick, delay);
  };

  /** Agent finished a spoken turn → arm the soft quiet-caller reprompt cycle. */
  const armOutboundSilenceAfterTurn = () => {
    if (!isOutboundCall || outboundHardMuteAfterClose || endCallInvoked || outboundTransferStarted) return;
    outboundSilence = armOutboundSilenceCheck(Date.now());
    scheduleOutboundSilenceTick();
  };

  const playGeminiAudioParts = (parts: any[] | undefined) => {
    if (!parts) return;
    for (const part of parts) {
      const data = part.inlineData?.data || part.audio?.data;
      if (!data) continue;
      if (!greetingAudioHeard) {
        greetingAudioHeard = true;
        if (streamConnectAt > 0) {
          console.log(`[GEMINI] First greeting audio (+${Date.now() - streamConnectAt}ms from stream connect)`);
        }
        // FAST-RESPONSE PRE-WARM: inject deferred context NOW, while the opening
        // plays and the model is idle. By the time the customer answers, everything
        // is in-context — the reply starts immediately instead of waiting for
        // post-answer injection (the old multi-second stall).
        if (isOutboundCall) {
          injectDeferredContextAfterOpening();
        }
      }
      // Ladder guarantee: reply audio reached the caller — turn fully resolved.
      speechRecovery = resolveSpeechRecoveryWithAiAudio(speechRecovery);
      if (awaitingFirstAiAudio) latLog('GEMINI_FIRST_AUDIO');
      const mime = String(part.inlineData?.mimeType || part.audio?.mimeType || '');
      const rateMatch = mime.match(/rate=(\d+)/i);
      if (rateMatch) geminiPlaybackRate = parseInt(rateMatch[1], 10) || geminiPlaybackRate;
      sendPcmToTwilio(Buffer.from(data, "base64"));
    }
  };

  const VAD_ENERGY_MIN_RMS = audioCfg.vadEnergyMinRms;
  const VAD_ENERGY_FLOOR_MULT = audioCfg.vadEnergyFloorMult;
  const VAD_SILENCE_MS = audioCfg.vadSilenceMs;
  let vadIsSpeaking = false;
  let vadSilenceStartedAt: number | null = null;

  console.log(`[WS] Connected (Plivo). Waiting for start event...`);
  streamConnectAt = Date.now();
  console.log('[GEMINI] Outbound WS connected — intro latency clock started');

  ws.on('message', async (data: string) => {
    try {
      const rawMsg = JSON.parse(data);
      const msg = normalizeVoiceEvent(rawMsg);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        outboundCallUuid = msg.start.callSid || streamSid;
        if (msg.start.isPlivo) audioSink = 'plivo';
        const fromUrl: Record<string, string> = {};
        streamParams?.forEach((v, k) => {
          fromUrl[k] = v;
        });
        const customParams = { ...fromUrl, ...(msg.start.customParameters || {}) };
        const rawName =
          customParams.customerName ||
          customParams.CustomerName ||
          customParams.name ||
          '';
        const blacklistedNames = ['customer', 'contact', 'lead', 'unknown', 'null', 'undefined', 'unnamed', ''];
        const restoredName = String(rawName).replace(/_/g, ' ').trim();
        const hasValidName = restoredName && !blacklistedNames.includes(restoredName.toLowerCase());
        const customerName = hasValidName ? restoredName : '';
        const rawPhone =
          customParams.customerPhone ||
          streamParams?.get('customerPhone') ||
          '';
        const phoneDigits = String(rawPhone).replace(/\D/g, '');
        customerPhone = phoneDigits
          ? (phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`)
          : null;
        // Name/identity machinery removed — customerName is logged, never used for speech.
        void customerName;
        if (phoneDigits) {
          void ensureLeadForCall({
            phone: customerPhone!,
            name: customerName || undefined,
            calledFrom: outboundCallerId(),
            callStatus: LEAD_STATUS.ANSWERED,
          })
            .then((lead) => console.log(`[DB] Lead ensured for ${customerPhone} id=${lead?.id}`))
            .catch((e) => console.warn('[DB] ensureLeadForCall failed:', e));

          // (Lead-name lookup removed — the flow never addresses the caller by name.)
        }

        console.log(
          `[WS] Stream started: ${streamSid} | Phone: ${customerPhone || 'N/A'} | Outbound: ${isOutboundCall} | Sink: ${audioSink}`,
        );

        if (streamConnectAt === 0) {
          streamConnectAt = Date.now();
        }
        latLog('STREAM_CONNECT');

        const currentDateStr = new Date().toLocaleDateString('en-IN');
        const cachedOutboundInstruction = phoneDigits
          ? takeCachedOutboundOpeningInstruction(phoneDigits)
          : null;
        const activeSystemInstruction =
          cachedOutboundInstruction ??
          buildOutboundSystemInstruction(currentDateStr, undefined, { deferProjectReference: true });
        pendingFullSystemInstruction = activeSystemInstruction;
        const geminiSystemInstruction = buildOutboundFastConnectInstruction(currentDateStr);
        if (cachedOutboundInstruction) {
          console.log('[GEMINI] Using pre-cached outbound system instruction (answer URL warm)');
        }

        const runtimeInstructionBase = `
OUTBOUND SCRIPT STATE (STRICT) — KANNADA ONLY, NEVER English:
- Opening turn (already spoken): "${PDF_OPENING_KN}" — NEVER say it again, NEVER ask the caller's name (this flow has no name step).
- ONLY steps allowed now: NO / ಇಲ್ಲ / ಬೇಡ → close once ("${OUTBOUND_NOT_INTERESTED_CLOSE_KN}") + endCall SAME turn. INTERESTED → locations once ("${PDF_AREAS_LINE_KN}") then listen. INTERESTED IN A LOCATION (after locations) → transfer line ("${PDF_HANDOFF_LINE_KN}"), NO endCall — live transfer to sales team.
- LANGUAGE RULE (STRICT): Kannada is the default. Follow the language the CALLER is actually speaking — English, Marathi, Hindi — and stay in it until they switch back. Never switch on single loanwords or fillers. Natural conversational speech, never literal translation.
- NO NAME STEP: this flow never asks the caller's name. Never ask for it, never confirm it.
- ONE QUESTION ONLY (ABSOLUTE): the opening question is the ONLY question on this call. NEVER ask about investment / construction / purpose / budget, and never ask permission to transfer or continue.
- NEVER repeat any line, question, or closing twice on this call — reworded counts as a repeat. Say each script line in FULL once.
- NEVER echo the caller's words back before answering — one response per turn, no duplicate sentences.
- If the caller asks who you are or an unrelated question mid-call, answer briefly then return to the current script step.
- Internal messages (SYSTEM / nudge) are PRIVATE directives — never quote, mention, or refer to them in speech. Never say you "can only say" certain lines.
- NEVER ask permission to continue — after any reply, move to the next step naturally.
- Never say you are an AI or language model. You are a sales officer on a live call.
- "ಧನ್ಯವಾದ" is spoken EXACTLY ONCE per call — ONLY inside the transfer handoff line. The not-interested close NEVER contains it. The transfer line NEVER calls endCall.
- SILENCE = KEEP LISTENING (ABSOLUTE): silence NEVER ends this call. The system may send a private availability-check nudge after a quiet stretch — say the given short line ONCE, then keep listening. NEVER call endCall because the caller was silent, quiet, or slow to reply.
- SPEECH PACING: reply within ~100 MILLISECONDS (0.1s) after the caller stops — STRICT. Each turn is ONE smooth utterance at a calm pace — pause at commas, never mid-sentence, the full line in one breath, then a real pause while you listen. No long gaps, no word-by-word delivery.
- HEARING GUARANTEE (PERMANENT): every soft, short, or accented caller utterance is a REAL turn — respond immediately, never claim you cannot hear them, never ask them to speak louder. If a private nudge says words were not recognized, briefly acknowledge and ask them kindly to repeat ONCE ("ಒಂದು ಸಲ ಮತ್ತೆ ಹೇಳಿ"); if a nudge says they are waiting for your reply, speak now. The caller must never need to shout or repeat themselves twice.

CURRENT DATE: ${currentDateStr}
`;

        console.log(`[VOICE] Audio pipeline: gain=${inputGain} gateMin=${GATE_OPEN_MIN_RMS} gateRel=${GATE_RELEASE_MS}ms bargeMinRms=${BARGE_IN_MIN_RMS} bargeHold=${BARGE_IN_MIN_MS}ms vadSilence=${VAD_SILENCE_MS}ms aadSilence=${audioCfg.aadSilenceDurationMs}ms aadEnd=${audioCfg.aadEndSensitivity} aadStart=${audioCfg.aadStartSensitivity}`);
        console.log(
          `[VOICE] TTS: ${describeSpeechConfig(ttsSettings, activeTtsLanguageCode)} (Kannada-first — follows the caller's language)`,
        );

        let localSession: any = null;
        let pendingRuntimeInstruction = runtimeInstructionBase;

        const trySendOpening = () => {
          if (!geminiSession || !geminiSessionOpened || greetingSent) return;
          sendSpokenGreeting();
        };

        const sendSpokenGreeting = () => {
          if (!geminiSession || greetingSent) return;
          greetingSent = true;
          try {
            const greetingText: string = PDF_OPENING_KN;
            const instruction = getOutboundGreetingInstruction('kn');
            console.log(`[GEMINI] Sending opening greeting once (+${Date.now() - streamConnectAt}ms from stream)`);
            diagLog('greeting instruction sent → GREETING (audio already streaming to model)');
            setCallState('GREETING', 'opening sent');
            capture?.onAiText(greetingText);
            geminiSession.sendRealtimeInput({ text: instruction });
          } catch (greetErr) {
            greetingSent = false;
            console.error('[GEMINI] Failed to send greeting:', greetErr);
          }
        };

        // GEMINI SESSION LIFECYCLE — connectable + auto-reconnectable.
        // A dead session NEVER ends the phone call: scheduleGeminiReconnect()
        // re-opens a fresh session, restores context, speaks one resume line,
        // and returns to LISTENING.
        const geminiConnectOptions = {
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              thinkingConfig: { thinkingLevel: "minimal" } as any,
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  endOfSpeechSensitivity: audioCfg.aadEndSensitivity,
                  startOfSpeechSensitivity: audioCfg.aadStartSensitivity,
                  silenceDurationMs: audioCfg.aadSilenceDurationMs,
                  prefixPaddingMs: audioCfg.aadPrefixPaddingMs,
                } as any,
              },
              speechConfig: buildLiveSpeechConfig(ttsSettings, activeTtsLanguageCode) as any,
              systemInstruction: geminiSystemInstruction,
              tools: [
                {
                  functionDeclarations: [OUTBOUND_END_CALL_TOOL, NOT_INTERESTED_TOOL],
                },
              ],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                console.log(`[GEMINI] Session opened${sessionIsReconnect ? ' (RECONNECT)' : ''}! (+${Date.now() - streamConnectAt}ms from stream)`);
                diagLog(`session open ${sessionIsReconnect ? 'reconnect' : 'initial'}`);
                callLog('SUCCESS', 'GEMINI LIVE SESSION OPEN');
                geminiSessionOpened = true;
                geminiEverConnected = true;
                trySendOpening();
              },
              onerror: (err: any) => {
                const errMsg = err?.message || String(err);
                console.error("[GEMINI Error]:", err);
                diagLog(`session error: ${errMsg}`);
                callLog('ERROR', `GEMINI/STT ERROR: ${errMsg}`);
                capture?.onSttError(errMsg);
              },
              onmessage: async (response: any) => {
                if (response.serverContent?.interrupted) {
                  if (isOutboundCall && !openingGreetingTurnFinished) {
                    console.log('[GEMINI] Opening-phase interrupt ignored — keep intro playing');
                  } else {
                  // ANTI-ECHO CUTOFF: during agent playback the caller's mic
                  // carries the agent's own voice, which inflates vadIsSpeaking.
                  // Accepting vadIsSpeaking here let Gemini's SELF-echo interrupts
                  // cut agent audio mid-sentence ("agent goes silent"). A real
                  // interruption is proven by (a) a loud sustained local barge-in
                  // or (b) an input TRANSCRIPT — words only the caller could have
                  // spoken (their mic audio is what the model transcribes).
                  // Proof = a caller transcript that arrived DURING this model
                  // turn (words spoken over the agent's audio — never echo; the
                  // echo is the agent's OWN voice and is never transcribed as
                  // input). A stale pre-turn transcript does NOT count.
                  const transcriptProvesCaller =
                    currentModelTurnStartedAt > 0 &&
                    lastCustomerTranscriptAt >= currentModelTurnStartedAt;
                  const confirmedUserSpeech =
                    Date.now() - bargeInConfirmedAt < BARGE_IN_CONFIRM_TTL_MS ||
                    transcriptProvesCaller;
                  if (!confirmedUserSpeech) {
                    console.log(
                      `[GEMINI] Turn interrupted ignored — no confirmed user speech ` +
                        `(aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`,
                    );
                    diagLog(`interrupt IGNORED (echo guard) vad=${vadIsSpeaking}`);
                    return;
                  }
                  console.log(`[GEMINI] Turn interrupted — clearing playback (aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`);
                  diagLog(`interrupt CONFIRMED → clearPlayback (barge or transcript proof)`);
                  capture?.onAiSpeakEnd();
                  clearPlayback();
                  outputLeftover = Buffer.alloc(0);
                  vadIsSpeaking = true;
                  vadSilenceStartedAt = null;
                  return;
                  }
                }

                if (response.serverContent?.modelTurn?.parts) {
                  const turnText = response.serverContent.modelTurn.parts
                    .map((p: any) => p.text || '')
                    .join('')
                    .trim();
                  currentModelTurnStartedAt = Date.now();
                  setCallState('AGENT_SPEAKING', 'model turn audio');
                  if (isOutboundCall && outboundHardMuteAfterClose) {
                    lastOutboundTurnSuppressed = true;
                    console.warn('[GEMINI] Dropping outbound audio after first Thank you');
                    forceOutboundHangupIfClosing('audio after first thanks');
                  } else if (isOutboundCall) {
                    playOutboundTurnIfNew(response.serverContent.modelTurn.parts, turnText);
                  } else {
                    const duplicateRecent =
                      turnText.length > 12 && isNearDuplicateAiTurn(turnText);
                    if (duplicateRecent) {
                      console.warn(
                        `[GEMINI] Suppressing duplicate AI line — same content just spoken: "${turnText.slice(0, 60)}..."`,
                      );
                    } else {
                      playGeminiAudioParts(response.serverContent.modelTurn.parts);
                    }
                  }
                }
                if (response.serverContent?.turnComplete) {
                  sendPcmToTwilio(Buffer.alloc(0), true);
                  capture?.onAiTurnComplete();
                  capture?.onAiSpeakEnd();
                  resetSpeakNudge();
                  diagLog('tts turn_complete (AI turn fully delivered)');
                  const completedAiText = response.serverContent?.modelTurn?.parts
                    ?.map((p: any) => p.text || '')
                    .join('')
                    .trim();
                  if (completedAiText && !(isOutboundCall && lastOutboundTurnSuppressed)) {
                    markAiTurnPlayed(completedAiText);
                    if (
                      isOutboundCall &&
                      !outboundThanksSpoken &&
                      looksLikeNotInterestedCloseLine(completedAiText)
                    ) {
                      // The ONE flowchart close line (explicit NO) — mute + hang up
                      // after it plays. There is NO silence close anymore.
                      outboundBusyCloseSent = true;
                      clearOutboundSilenceTimer();
                      activateOutboundPostThanksMute();
                    }
                    if (isOutboundCall && hasThanksClosing(completedAiText)) {
                      // Not-interested thanks close (or goodbye close) delivered —
                      // hard-mute the agent and schedule the hangup.
                      activateOutboundPostThanksMute();
                    } else if (isOutboundCall && looksLikeHandoffLine(completedAiText)) {
                      // Handoff/transfer line delivered — start the sales-team
                      // transfer but do NOT mute or hang up: the call stays open
                      // while the caller is bridged to the sales number.
                      if (!outboundTransferStarted) {
                        outboundTransferStarted = true;
                        startSalesTeamTransfer();
                      }
                    }
                  }
                  lastOutboundTurnSuppressed = false;
                  if (!openingGreetingTurnFinished) {
                    openingGreetingTurnFinished = true;
                    openingQuestionSent = true;
                    latLog('OPENING_TURN_COMPLETE');
                    // OPENING → LISTENING with zero dead time: the media handler
                    // was already forwarding customer audio throughout the intro;
                    // the very next caller syllable starts the reply turn.
                    console.log('[GEMINI] Opening question spoken — actively LISTENING (no dead period)');
                    diagLog('opening complete → LISTENING (audio was forwarded during intro)');
                  } else if (!deferredContextScheduled && customerUtteranceCount > 0) {
                    injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
                    injectDeferredContextAfterOpening();
                  }
                  if (suppressAiOutput && !vadIsSpeaking && !outboundHardMuteAfterClose) {
                    allowAiOutput();
                  }
                  if (isOutboundCall && !outboundOpeningRepeatDone && openingGreetingTurnFinished) {
                    if (!outboundGreetingSpoken) {
                      outboundGreetingSpoken = true;
                      console.log("[GEMINI] Opening question spoken — waiting for a reply");
                    }
                    armOpeningWait();
                  }
                  if (isOutboundCall && !outboundThanksSpoken) {
                    armOutboundSilenceAfterTurn();
                  }
                  // LANGUAGE FOLLOW: deliver a queued language-switch prompt once AI audio ends.
                  if (pendingLanguageSwitchPrompt && Date.now() >= aiPlaybackEndsAt - 80) {
                    sendWaitSystemPrompt(pendingLanguageSwitchPrompt);
                    pendingLanguageSwitchPrompt = null;
                  }
                  if (isOutboundCall && outboundThanksSpoken && !endCallInvoked) {
                    scheduleOutboundHangupAfterThanks();
                  }
                }

                if (
                  false
                ) {
                  // (goodbye endCall fallback removed — handled by the not-interested path.)
                }

                if (response.serverContent?.modelTurn) {
                  transcriptCount++;
                  const aiText = response.serverContent.modelTurn.parts
                    .map((p: any) => p.text || "")
                    .join(" ");
                  if (aiText) {
                    fullTranscription += `AI: ${aiText}\n`;
                    capture?.onAiTranscriptChunk(aiText);

                    if (
                      isOutboundCall &&
                      /\b(language model|large language model|as an ai|i am an ai|i'm an ai|cannot help with that)\b/i.test(
                        aiText,
                      )
                    ) {
                      console.warn('[GUARD] Outbound AI broke character — nudging back to sales script');
                      geminiSession?.sendRealtimeInput({
                        text:
                          'SYSTEM (internal): You are a live Alliance Square sales officer. Never mention AI, chatbots, or language models. ' +
                          'Continue from the current step in the PDF script — do NOT repeat anything already said.',
                      });
                    }

                    const forbiddenLayout = detectForbiddenLayoutMention(aiText);
                    if (forbiddenLayout && Date.now() - lastForbiddenLayoutNudgeAt > 15000) {
                      lastForbiddenLayoutNudgeAt = Date.now();
                      console.warn(`[GUARD] AI mentioned forbidden layout "${forbiddenLayout}" — nudging.`);
                      geminiSession?.sendRealtimeInput({
                        text:
                          `REMINDER: "${forbiddenLayout}" is NOT an allowed project on this call. ` +
                          `ONLY discuss: ${allowedLayoutsList()}. Do not mention any other layout. ` +
                          `If the customer asked about it, say you don't have that project. Do NOT keep asking to call the Sales Manager.`,
                      });
                    }
                  }
                }

                const outTx = response.serverContent?.outputTranscription?.text
                  || response.serverContent?.outputAudioTranscription?.text;
                if (outTx) {
                  const lang = detectScriptLanguage(outTx);
                  if (voiceDebug || lang === 'kn' || lang === 'mixed') {
                    console.log(`[LANG] AI transcript lang=${lang} tts=${describeSpeechConfig(ttsSettings)} text="${String(outTx).slice(0, 80)}"`);
                  }
                  capture?.onAiTranscriptChunk(outTx);
                }

                if (response.serverContent?.inputTranscription?.text) {
                  const userText = response.serverContent.inputTranscription.text;
                  const userLang = detectScriptLanguage(userText);
                  console.log(`[LANG] Customer STT lang=${userLang} text="${String(userText).slice(0, 100)}"`);
                  lastCustomerTranscript = userText;
                  lastCustomerTranscriptAt = Date.now();
                  setCallState('PROCESSING', 'customer transcript arrived');
                  diagLog(`stt final lang=${userLang} chars=${userText.length} utteranceCount→${customerUtteranceCount + 1}`);
                  // Ladder guarantee #2: transcript arrived — switch to waiting
                  // for the AI's reply audio (a quiet "yes" that DID get through
                  // must still produce a reply; missing reply audio is recovered).
                  noteCustomerTranscriptForRecovery();
                  customerAnsweredOpening(userText);
                  resetOutboundSilenceCycle();
                  handleCustomerTranscriptForWait(userText);
                  // LANGUAGE FOLLOW: Kannada default — switch only when the caller
                  // clearly switches (English / Marathi / Hindi).
                  {
                    const before = languageSwitchState.language;
                    const followed = followLanguageFromUtterance(languageSwitchState, userText);
                    languageSwitchState = followed.state;
                    if (followed.language !== before) {
                      const newTts = ttsLanguageFor(followed.language);
                      console.log(
                        `[LANG] Caller language ${before} → ${followed.language} (tts=${newTts})`,
                      );
                      activeTtsLanguageCode = newTts;
                      const prompt = languageFollowSystemPrompt(followed.language);
                      if (Date.now() < aiPlaybackEndsAt - 120) {
                        pendingLanguageSwitchPrompt = prompt;
                      } else {
                        sendWaitSystemPrompt(prompt);
                      }
                    }
                  }

                  fullTranscription += `User: ${userText}\n`;
                  capture?.onCustomerTranscript(userText);
                  if (isMeaningfulCustomerUtterance(userText, looksLikeOpeningEcho)) {
                    customerUtteranceCount++;
                    injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
                    injectDeferredContextAfterOpening();
                  }
                  if (isShortAffirmativeReply(userText)) {
                    customerAnsweredOpening(userText);
                    keepOutboundActiveAfterOpeningYes(userText);
                  } else if (
                    openingGreetingTurnFinished &&
                    !outboundHardMuteAfterClose &&
                    !outboundStayActiveNudgeSent &&
                    !looksLikeInterestedYes(userText) &&
                    isCustomerTurnSignal(userText)
                  ) {
                    outboundStayActiveNudgeSent = true;
                    console.log('[GEMINI] Customer spoke after opening — prompting next script step');
                    try {
                      sendClientTextTurn(
                        `SYSTEM (internal): The customer replied: "${String(userText).trim().slice(0, 120)}". ` +
                          `Stay on this call. Do NOT hang up. Do NOT stay silent. Do NOT repeat the opening. ` +
                          `Continue the script from the NEXT step with spoken audio now.`,
                      );
                    } catch (e: any) {
                      outboundStayActiveNudgeSent = false;
                      console.error('[GEMINI] Continue-after-opening nudge failed:', e?.message || e);
                    }
                  }
                  {
                    if (outboundHardMuteAfterClose) {
                      forceOutboundHangupIfClosing('customer speech after close');
                    } else {
                    if (looksLikeRepeatRequest(userText)) {
                      console.log('[GUARD] Outbound repeat request — nudging to repeat previous message');
                      outboundRepeatReplayPending = true;
                      try {
                        geminiSession?.sendRealtimeInput({ text: OUTBOUND_REPEAT_NUDGE });
                      } catch (e: any) {
                        console.error('[GEMINI] Repeat nudge failed:', e?.message || e);
                      }
                    } else if (looksLikeInterestedYes(userText)) {
                      // FINAL FLOW: yes → locations; interested-in-location → transfer.
                      try {
                        if (outboundTransferStarted) {
                          // Transfer already in progress — stay silent.
                        } else if (outboundAreasLineDelivered && !outboundHandoffNudgeSent) {
                          outboundHandoffNudgeSent = true;
                          console.log('[GUARD] Interested in a location — sales-team transfer handoff');
                          geminiSession?.sendRealtimeInput({
                            text: buildOutboundHandoffTransferNudge(),
                          });
                          if (customerPhone) {
                            void markOutcomeByPhone(customerPhone, STATUS.INTERESTED, {
                              interested: true,
                              lastResponse: userText,
                            })
                              .then((r) => console.log(`[DB] Interested lead marked rows=${r.count}`))
                              .catch((e) => console.error('[DB Error] Failed to mark interested:', e));
                          }
                        } else if (!outboundAreasLineDelivered && !outboundLocationsNudgeSent && !outboundStayActiveNudgeSent) {
                          outboundLocationsNudgeSent = true;
                          console.log('[GUARD] Caller interested — locations line');
                          geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Interested-flow nudge failed:', e?.message || e);
                      }
                    } else if (
                      looksLikeOpeningDecline(userText) ||
                      /\b(not interested|not looking|stop calling|don'?t call|no need|ಬೇಡ|ಇಲ್ಲ)\b/i.test(userText) ||
                      looksLikeCustomerBusy(userText)
                    ) {
                      // FLOWCHART STEP 2A: NO (including busy / call-later) →
                      // the ONE close line + hangup. This is the only early exit.
                      try {
                        if (outboundThanksSpoken || outboundHardMuteAfterClose) {
                          forceOutboundHangupIfClosing('decline after close');
                        } else if (!outboundNotInterestedNudgeSent) {
                          outboundNotInterestedNudgeSent = true;
                          console.log('[GUARD] Customer said no — polite close + hangup');
                          clearOutboundSilenceTimer();
                          geminiSession?.sendRealtimeInput({ text: OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Not-interested close nudge failed:', e?.message || e);
                      }
                      if (customerPhone) {
                        void markOutcomeByPhone(customerPhone, STATUS.NOT_INTERESTED, {
                          interested: false,
                          lastResponse: userText,
                        })
                          .then((r) => console.log(`[DB] Not-interested set rows=${r.count}`))
                          .catch((e) => console.error('[DB Error] Failed to set not-interested:', e));
                      }
                    }
                    }
                  }
                  // (goodbye special-case removed — the caller's goodbye is just a NO:
                  // the classifier sends OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE + endCall.)

                  if (isFirstResponse && customerPhone) {
                    isFirstResponse = false;
                      const phone = customerPhone;
                    const lowerText = userText.toLowerCase();

                      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'site', 'plot', 'mysore', 'mysuru', 'looking', 'investment', 'build', 'house', 'residential', 'haan', 'han', 'beku', 'vadu', 'sari', 'ಹೌದು', 'ಬೇಕು'];
                      const notInterestedKeywords = ['no', 'not interested', 'not looking', 'stop', 'don\'t', 'busy', 'wrong number', 'nahi', 'beda', 'vaddu', 'alla'];

                    let interested: boolean | null = null;
                    if (interestedKeywords.some(kw => lowerText.includes(kw))) {
                      interested = true;
                    } else if (notInterestedKeywords.some(kw => lowerText.includes(kw))) {
                      interested = false;
                    }
                      callInterested = interested;

                      try {
                        void transitionLeadsByPhone(phone, STATUS.ANSWERED, {
                          interested,
                          lastResponse: userText,
                        }).then(async (r) => {
                          console.log(`[DB] First response tracked for ${phone}: answered (interested=${interested}) rows=${r.count}`);
                          if (interested === true) {
                            const outcome = await markOutcomeByPhone(phone, STATUS.INTERESTED, {
                              interested: true,
                              lastResponse: userText,
                            });
                            console.log(`[DB] Marked looking for lead rows=${outcome.count}`);
                          } else if (interested === false) {
                            const outcome = await markOutcomeByPhone(phone, STATUS.NOT_INTERESTED, {
                              interested: false,
                              lastResponse: userText,
                            });
                            console.log(`[DB] Marked not looking for lead rows=${outcome.count}`);
                          }
                        })
                          .catch((e) => console.error("[DB Error] Failed to track first response:", e));
                    } catch (e) {
                      console.error("[DB Error] Failed to track first response:", e);
                    }
                  }
                }

                if (response.toolCall) {
                  console.log("[GEMINI] Tool call received:", response.toolCall);
                  const toolResponses: any[] = [];
                  const batchHasNotInterested = response.toolCall.functionCalls.some(
                    (c: any) => c.name === 'notInterested',
                  );
                  for (const call of response.toolCall.functionCalls) {
                    if (call.name === "endCall") {
                      const currentTurnAiText = response.serverContent?.modelTurn?.parts
                        ?.map((p: any) => p.text || '')
                        .join(' ')
                        .trim() || '';
                      // FLOWCHART: a close line (the ONE close or a thank-you transfer
                      // line) must have been delivered before hangup. NOTE: there is NO
                      // silence close any more — silence can never satisfy this guard.
                      const closingSpoken =
                        outboundBusyCloseSent ||
                        looksLikeNotInterestedCloseLine(currentTurnAiText) ||
                        looksLikeNotInterestedCloseLine(lastPlayedAiRaw) ||
                        hasThanksClosing(currentTurnAiText) ||
                        hasThanksClosing(lastPlayedAiRaw) ||
                        outboundThanksSpoken;

                      // STRICT SCRIPT: after the interested handoff the call is a
                      // live transfer — endCall is forbidden; the line stays open.
                      if (outboundTransferStarted) {
                        console.warn('[GUARD] endCall blocked — call is transferring to sales team');
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            message:
                              'This call is being TRANSFERRED to the sales team. Do NOT call endCall. Stay silent on the line.',
                          },
                          id: call.id,
                        });
                        continue;
                      }

                      const endGuard = shouldAllowEndCall({
                        callDurationMs: Date.now() - startTime,
                        customerClearGoodbye,
                        customerUtteranceCount,
                        batchHasNotInterested,
                        isOutbound: isOutboundCall,
                        // (silenceTimeoutClose removed — silence NEVER authorizes endCall.)
                        busyCallbackClose:
                          isOutboundCall &&
                          (outboundBusyCloseSent ||
                            looksLikeNotInterestedCloseLine(currentTurnAiText) ||
                            looksLikeNotInterestedCloseLine(lastPlayedAiRaw)),
                      });
                      if (!endGuard.allow) {
                        console.warn(
                          `[GUARD] Blocked premature endCall (${endGuard.reason}) — ` +
                            `duration=${Math.round((Date.now() - startTime) / 1000)}s utterances=${customerUtteranceCount}`,
                        );
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            message:
                              'Do NOT end the call yet. The customer has not clearly finished. ' +
                              'Continue the conversation — ask one relevant question or wait silently. ' +
                              'Never hang up on silence or after only the opening.',
                          },
                          id: call.id,
                        });
                        continue;
                      }

                      if (isOutboundCall && !closingSpoken) {
                        console.warn('[GUARD] Blocked outbound endCall — no close line delivered yet');
                        diagLog(`endCall BLOCKED no_close_line utterances=${customerUtteranceCount}`);
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            message:
                              'Say the not-interested closing line ONCE ("' + OUTBOUND_NOT_INTERESTED_CLOSE_KN +
                              '") — then call endCall in the same turn.',
                          },
                          id: call.id,
                        });
                        continue;
                      }

                      console.log(`[GEMINI] End call tool allowed (${endGuard.reason}). Terminating call...`);
                      diagLog(`endCall ALLOWED reason=${endGuard.reason} → terminating`);
                      await new Promise((r) => setTimeout(r, 200));
                      await completeAndHangupOutboundCall(`endCall tool (${endGuard.reason})`);
                      continue;
                    }

                    if (call.name === "notInterested") {
                      console.log(`[GEMINI] Customer marked not interested`);
                      if (customerPhone) {
                        try {
                          const r = await markOutcomeByPhone(customerPhone, STATUS.NOT_INTERESTED, {
                            interested: false,
                          });
                          console.log(`[DB] Not-interested set for ${customerPhone} rows=${r.count}`);
                          toolResponses.push({ name: call.name, response: { success: true }, id: call.id });
                        } catch (e) {
                          console.error("[DB Error] Failed to set not-interested:", e);
                          toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                        }
                      } else {
                        toolResponses.push({ name: call.name, response: { success: false, error: "No phone number on file for this call — could not update lead status." }, id: call.id });
                      }
                      continue;
                    }

                    // (setName handler removed — the final call flow never asks the name.)

                    console.warn(`[GEMINI] Unhandled tool call reached fallback: ${call.name}`);
                    toolResponses.push({ name: call.name, response: { success: true }, id: call.id });
                  }
                  geminiSession.sendToolResponse({ functionResponses: toolResponses });
                }
              },
              onclose: async (event: any) => {
                console.log("[GEMINI] Session closed. Reason:", event?.reason || "No reason provided", "Code:", event?.code);
                const duration = Math.round((Date.now() - startTime) / 1000);
                if (!endCallInvoked && callState !== 'ENDED' && !outboundTransferStarted) {
                  console.warn(
                    '[GEMINI] Session closed mid-call — AUTO-RECONNECTING (phone line stays open)',
                  );
                  diagLog(`session closed mid-call code=${event?.code} reason=${event?.reason || 'none'} → reconnect`);
                  scheduleGeminiReconnect(`session closed: ${event?.reason || event?.code || 'unknown'}`);
                } else if (outboundTransferStarted) {
                  diagLog('session closed during transfer — expected, no reconnect');
                }
                // Save the summary ONLY when the call itself is over. A mid-call
                // reconnect keeps the conversation alive — the final close path
                // (telephony stop / allowed endCall) owns the final summary.
                if (endCallInvoked && duration > 3 && customerPhone) {
                  const tail = phoneTail(customerPhone);

                  try {
                    await ensureLeadForCall({
                      phone: customerPhone,
                      calledFrom: outboundCallerId(),
                      callStatus: LEAD_STATUS.CALL_COMPLETED,
                    });

                    const leadRow = await prisma.lead.findFirst({
                      where: { phone: { contains: tail } },
                      orderBy: { createdAt: 'desc' },
                      select: { interested: true },
                    });
                    const interestedFlag = callInterested ?? leadRow?.interested ?? null;

                    const finalSummary = await generateCallSummary({
                      durationSec: duration,
                      transcriptCount,
                      transcription: fullTranscription,
                      interested: interestedFlag,
                    });

                    await prisma.lead.updateMany({
                      where: { phone: { contains: tail } },
                      data: {
                        summary: finalSummary,
                        duration: String(duration),
                      },
                    });
                    console.log(`[DB] Call summary saved for ${customerPhone}`);
                  } catch (e) {
                    console.error("[DB Error] Failed to save summary:", e);
                  }
                }
              }
            },
        }; // end geminiConnectOptions

        const MAX_GEMINI_CONNECT_ATTEMPTS = 3;

        // RECONNECT IMPLEMENTATION — fresh session + restored state + resume line.
        setReconnectFn(async (): Promise<boolean> => {
          geminiReconnectAttempts++;
          for (let attempt = 1; attempt <= MAX_GEMINI_CONNECT_ATTEMPTS; attempt++) {
            try {
              if (attempt > 1) {
                await new Promise((r) => setTimeout(r, 1200 * (attempt - 1)));
              }
              console.log(`[GEMINI] Reconnect attempt ${geminiReconnectAttempts}.${attempt}...`);
              sessionIsReconnect = true;
              const freshSession = await ai.live.connect(geminiConnectOptions);
              geminiSession = freshSession;
              droppedFramesNoSession = 0;
              consecutiveAudioSendFailures = 0;
              // Restore ALL deferred context into the fresh session.
              try {
                injectSilentContext(pendingFullSystemInstruction, 'FULL CALL GUIDE');
                fullCallGuideInjected = true;
              } catch { fullCallGuideInjected = false; }
              try {
                injectSilentContext(buildOutboundProjectReferenceContext(), 'PROJECT REFERENCE');
                projectReferenceInjected = true;
              } catch { projectReferenceInjected = false; }
              runtimeInstructionsInjected = false;
              injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
              // One short resume line so the caller is never left in dead silence,
              // then straight back to LISTENING.
              try {
                geminiSession.sendRealtimeInput({ text: OUTBOUND_SILENCE_RESUME_NUDGE });
              } catch { /* next recovery tick retries */ }
              setCallState('LISTENING', 'reconnected — listening again');
              startListeningWatchdog();
              console.log(`[GEMINI] Reconnect OK (attempt ${geminiReconnectAttempts}) — context restored, resume line sent, LISTENING`);
              diagLog(`reconnect OK attempt=${geminiReconnectAttempts} → LISTENING`);
              return true;
            } catch (err) {
              console.error(`[GEMINI] Reconnect ${geminiReconnectAttempts}.${attempt} failed:`, err);
            }
          }
          return false;
        });

        // INITIAL CONNECT — on total failure, keep the line open and keep
        // retrying in the background. NEVER return the media stream to Plivo.
        let connected = false;
        for (let attempt = 1; attempt <= MAX_GEMINI_CONNECT_ATTEMPTS; attempt++) {
          try {
            if (attempt > 1) {
              console.warn(`[GEMINI] Retrying live connect (${attempt}/${MAX_GEMINI_CONNECT_ATTEMPTS})...`);
              await new Promise((r) => setTimeout(r, 1200 * (attempt - 1)));
            }
            localSession = await ai.live.connect(geminiConnectOptions);
            connected = true;
            break;
          } catch (err) {
            console.error(`[GEMINI] Connect attempt ${attempt} failed:`, err);
            if (attempt === MAX_GEMINI_CONNECT_ATTEMPTS) {
              callLog('ERROR', `GEMINI CONNECT FAILED: ${err instanceof Error ? err.message : String(err)}`);
              capture?.onSttError('Gemini live connect failed');
              console.warn('[GEMINI] Keeping phone line open — background reconnect scheduled (will NOT hang up).');
              diagLog('initial connect failed → background reconnect loop (line stays open)');
              scheduleGeminiReconnect('initial connect failed');
            }
          }
        }

        if (!connected || !localSession) {
          console.warn('[GEMINI] No live session yet — phone line open, background reconnect running.');
          return;
        }

        geminiSession = localSession;
        startListeningWatchdog();
        trySendOpening();

        capture = new CallCaptureSession({
          streamSid,
          phone: customerPhone,
          outbound: true,
        });

        if (customerPhone) {
          void markAnsweredByPhone(customerPhone)
            .then((r) => console.log(`[DB] Stream start → answered updated=${r.count}`))
            .catch((e) => console.error('[DB] mark answered failed:', e));
        }

      } else if (msg.event === 'media') {
        try {
          const muLawData = Buffer.from(msg.media.payload, "base64");
          capture?.onCustomerMuLaw(muLawData);
          mediaFrameCount++;
          lastMediaFrameAt = Date.now();
          if (DIAG && mediaFrameCount % 500 === 0) {
            diagLog(
              `audio-in frames=${mediaFrameCount} sent=${audioSentChunkCount} ` +
                `droppedNoSession=${droppedFramesNoSession} state=${callState} floor=${noiseFloorRms.toFixed(0)}`,
            );
          }
          if (!geminiSession) {
            // NEVER drop caller audio permanently. Two distinct windows:
            // (a) INITIAL CONNECT — the first ~4s while the Gemini session is
            //     still opening; these frames are EXPECTED — do NOT reconnect.
            // (b) SESSION DIED mid-call — schedule reconnect; forwarding
            //     resumes automatically once the fresh session opens.
            droppedFramesNoSession++;
            const inInitialConnect = !geminiEverConnected && Date.now() - startTime < 4_000;
            if (droppedFramesNoSession === 1 || droppedFramesNoSession % 250 === 0) {
              console.warn(
                `[GEMINI] Customer audio with NO live session (dropped=${droppedFramesNoSession}` +
                  `${inInitialConnect ? ', initial connect window — reconnect NOT needed' : ', session lost — reconnecting'})`,
              );
              diagLog(`audio-in WITHOUT session dropped=${droppedFramesNoSession} initialConnect=${inInitialConnect}`);
            }
            if (!endCallInvoked && !inInitialConnect) {
              scheduleGeminiReconnect('audio arrived with no session');
            }
            return;
          }
          const sampleCount = muLawData.length;
          // FORWARD ALL CUSTOMER AUDIO (including the opening question tail):
          // previously the opening phase dropped audio entirely — an early "yes"
          // over the question's last second was lost forever and the model never
          // heard it. Audio is ALWAYS forwarded now — the inbound stream is fully
          // independent of playback and NEVER pauses after the opening, after an
          // AI turn, or while the agent is speaking. Only barge-in/playback
          // clearing stay gated during the intro.
          const cleaned = sampleCount <= SCRATCH_SAMPLES ? scratchCleaned : new Int16Array(sampleCount);
          for (let i = 0; i < sampleCount; i++) {
            const x = muLawToPcmTable[muLawData[i]];
            const y = HP_B0 * x + HP_B1 * hpX1 + HP_B2 * hpX2 - HP_A1 * hpY1 - HP_A2 * hpY2;
            hpX2 = hpX1; hpX1 = x;
            hpY2 = hpY1; hpY1 = y;
            const s = y > 32767 ? 32767 : y < -32768 ? -32768 : Math.round(y);
            cleaned[i] = s;
          }
          const frame = analyzePcmFrame(cleaned, sampleCount);
          const rms = frame.rms;
          const now = Date.now();
          const speechLike = isSpeechLike({
            ...frame,
            noiseFloorRms,
            config: speechLikeConfig,
          });

          const aiPlaying = now < aiPlaybackEndsAt;
          // Opening phase: keep the noise-floor/gate/VAD logic but never let
          // it clear the intro — local barge-in and playback clearing are
          // gated off until the opening question has fully played.
          const openingPhase = isOutboundCall && !openingGreetingTurnFinished;
          if (rms < noiseFloorRms * 2) {
            noiseFloorRms += (rms - noiseFloorRms) * 0.07;
          } else if (aiPlaying && !speechLike && rms < noiseFloorRms * 5) {
            noiseFloorRms += (rms - noiseFloorRms) * 0.016;
          } else if (aiPlaying && rms < noiseFloorRms * 4.5) {
            noiseFloorRms += (rms - noiseFloorRms) * 0.0015;
          } else {
            noiseFloorRms += (rms - noiseFloorRms) * 0.003;
          }
          if (noiseFloorRms < NOISE_FLOOR_MIN) noiseFloorRms = NOISE_FLOOR_MIN;
          if (noiseFloorRms > NOISE_FLOOR_MAX) noiseFloorRms = NOISE_FLOOR_MAX;

          const gateOpenRms = Math.min(GATE_OPEN_MAX_RMS, Math.max(GATE_OPEN_MIN_RMS, noiseFloorRms * GATE_FLOOR_MULT));
          const gateCloseRms = gateOpenRms * GATE_CLOSE_RATIO;
          const quietOpenRms = Math.max(GATE_OPEN_MIN_RMS * 0.72, noiseFloorRms * 1.28);
          const wasGateOpen = gateOpen;
          if (shouldOpenGate({ rms, gateOpenRms, gateCloseRms, quietOpenRms, gateOpen, speechLike })) {
            gateOpen = true;
            gateBelowSince = null;
          } else if (gateOpen && rms < gateCloseRms && !speechLike) {
            if (gateBelowSince === null) {
              gateBelowSince = now;
            } else if (now - gateBelowSince >= GATE_RELEASE_MS) {
              gateOpen = false;
              gateBelowSince = null;
            }
          }
          if (voiceDebug && wasGateOpen !== gateOpen && now - lastGateLogAt > 250) {
            lastGateLogAt = now;
            vadLog(
              `gate ${gateOpen ? 'OPEN' : 'CLOSE'} rms=${rms.toFixed(0)} thrOpen=${gateOpenRms.toFixed(0)} ` +
                `speechLike=${speechLike} crest=${frame.crestFactor.toFixed(1)} floor=${noiseFloorRms.toFixed(0)}`,
            );
          }
          if (voiceDebug && now - lastNoiseMetricLogAt > 5000) {
            lastNoiseMetricLogAt = now;
            vadLog(
              `metrics floor=${noiseFloorRms.toFixed(0)} rms=${rms.toFixed(0)} gate=${gateOpen ? 'open' : 'closed'} ` +
                `speechLike=${speechLike} zcr=${frame.zeroCrossRate.toFixed(3)} aiPlaying=${now < aiPlaybackEndsAt}`,
            );
          }
          const effectiveGain = inputGain;

          const pcmBuffer = sampleCount <= SCRATCH_SAMPLES ? scratchPcm16k : Buffer.allocUnsafe(sampleCount * 4);
          for (let i = 0; i < sampleCount; i++) {
            let cur = Math.round(cleaned[i] * effectiveGain);
            if (cur > 32767) cur = 32767; else if (cur < -32768) cur = -32768;
            const mid = (lastUpsampleSample + cur) >> 1;
            pcmBuffer.writeInt16LE(mid, i * 4);
            pcmBuffer.writeInt16LE(cur, i * 4 + 2);
            lastUpsampleSample = cur;
        }
        try {
            const payloadB64 = pcmBuffer.subarray(0, sampleCount * 4).toString("base64");
            geminiSession.sendRealtimeInput({
              audio: {
                data: payloadB64,
                mimeType: 'audio/pcm;rate=16000',
              }
            });
            // Continuous streaming telemetry: this MUST keep incrementing for the
            // whole call. If it stalls while Plivo frames keep arriving, the
            // pipeline is broken and the reconnect/watchdog restores it.
            audioSentChunkCount++;
            lastAudioSentAt = Date.now();
            consecutiveAudioSendFailures = 0;
            if (DIAG && audioSentChunkCount % 500 === 1) {
              diagLog(
                `audio→gemini chunk #${audioSentChunkCount} ${sampleCount * 4}B pcm16k ` +
                  `state=${callState} vad=${vadIsSpeaking ? 'speaking' : 'quiet'}`,
              );
            }

            const bargeInRms = Math.max(BARGE_IN_MIN_RMS, noiseFloorRms * BARGE_IN_FLOOR_MULT);
            const bargeDecision = speechLike && !openingPhase
              ? evaluateBargeIn({
                  now,
                  aiPlaybackEndsAt,
                  rms,
                  bargeInRms,
                  gateOpen,
                  requireGateOpen: BARGE_IN_REQUIRE_GATE,
                  bargeInStartedAt,
                  minHoldMs: BARGE_IN_MIN_MS,
                })
              : { action: 'reset' as const, startedAt: null };
            if (bargeDecision.action === 'arm') {
              bargeInStartedAt = bargeDecision.startedAt;
            } else if (bargeDecision.action === 'fire') {
              console.log(
                `[VAD] Local barge-in — clearing AI playback ` +
                  `(rms=${rms.toFixed(0)} thr=${bargeInRms.toFixed(0)} hold=${BARGE_IN_MIN_MS}ms gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`
              );
              bargeInConfirmedAt = Date.now();
              capture?.onAiSpeakEnd();
              clearPlayback();
              bargeInStartedAt = null;
            } else if (bargeDecision.action === 'reset') {
              if (bargeInStartedAt !== null && voiceDebug) {
                vadLog(`barge-in reset (rms=${rms.toFixed(0)} thr=${bargeInRms.toFixed(0)} gateOpen=${gateOpen})`);
              }
              bargeInStartedAt = null;
            } else {
              bargeInStartedAt = bargeDecision.startedAt;
            }

            const vadEnergyThr = Math.max(VAD_ENERGY_MIN_RMS, noiseFloorRms * VAD_ENERGY_FLOOR_MULT);
            const speechEnergy =
              rms > vadEnergyThr && (speechLike || rms > vadEnergyThr * 1.45);
            if (speechEnergy) {
              lastSpeechEnergyAt = now;
            }
            const speechDecision = evaluateLocalSpeech({
              vadIsSpeaking,
              speechEnergy,
              now,
              silenceStartedAt: vadSilenceStartedAt,
              silenceMs: VAD_SILENCE_MS,
            });
            if (speechDecision.event === 'start') {
              vadIsSpeaking = true;
              vadSilenceStartedAt = null;
              vadSpeakingSince = now;
              resetSpeakNudge();
              // Caller is speaking — any pending recovery is obsolete; the new turn owns the state.
              speechRecovery = disarmSpeechRecovery(speechRecovery);
              clearRecoveryTick();
              capture?.onCustomerSpeakStart();
              console.log(
                `[VAD] Customer speech START rms=${rms.toFixed(0)} thr=${vadEnergyThr.toFixed(0)} floor=${noiseFloorRms.toFixed(0)}`
              );
              diagLog(
                `vad START rms=${rms.toFixed(0)} thr=${vadEnergyThr.toFixed(0)} gate=${gateOpen ? 'open' : 'closed'} state→USER_SPEAKING`,
              );
              setCallState('USER_SPEAKING', 'local VAD start');
              customerStartedAnsweringOpening();
              latLog('AUDIO_IN (customer speech start)');
              clearWaitTick();
            } else if (speechDecision.event === 'silence_arm') {
              vadSilenceStartedAt = speechDecision.silenceStartedAt;
            } else if (speechDecision.event === 'end') {
                vadIsSpeaking = false;
                vadSilenceStartedAt = null;
              capture?.onCustomerSpeakEnd();
              allowAiOutput();
              speechEndAt = now;
              awaitingFirstAiAudio = true;
              const spokeMs = vadSpeakingSince != null ? now - vadSpeakingSince : 0;
              console.log(
                `[VAD] Customer speech END after ${speechDecision.pausedFor}ms silence (spoke≈${spokeMs}ms vadSilenceMs=${VAD_SILENCE_MS} aadSilenceMs=${audioCfg.aadSilenceDurationMs})`
              );
              diagLog(`vad END spoke≈${spokeMs}ms → PROCESSING (awaiting transcript/AAD commit)`);
              setCallState('PROCESSING', 'customer speech end');
              latLog('GEMINI_AUDIO_SENT (local speech end; AAD owns turn commit)');
              nudgeSpeakNowIfNeeded();
              aiAudioSinceLastCustomerSpeech = false;
              // Ladder guarantee #1: every confirmed speech end arms recovery.
              armRecoveryAfterSpeechEnd();
              if (
                false
              ) {
                // (wait-policy removed)
              }
            } else if (speechDecision.event === 'none') {
              vadIsSpeaking = speechDecision.vadIsSpeaking;
              vadSilenceStartedAt = speechDecision.silenceStartedAt;
            }
        } catch (e: any) {
          consecutiveAudioSendFailures++;
          console.error(
            `[GEMINI] Failed to send audio (#${consecutiveAudioSendFailures}): ${e.message} — scheduling reconnect, line stays open`,
          );
          diagLog(`audio send FAILED #${consecutiveAudioSendFailures} err=${e.message}`);
          capture?.onSttError(e.message || 'audio send failed');
          if (consecutiveAudioSendFailures >= 2) {
            scheduleGeminiReconnect(`audio send failed x${consecutiveAudioSendFailures}: ${e.message}`);
          }
        }
        } catch (decodeErr: any) {
          callLog('ERROR', `INVALID AUDIO PACKET: ${decodeErr?.message || decodeErr}`);
        }
      } else if (msg.event === 'stop') {
        process.stdout.write(`\n[WS] Call stopped by Plivo/telephony — reason=telephony_stop\n`);
        diagLog('telephony stop event → finalizing');
        setCallState('ENDED', 'telephony stop');
        cancelRecovery();
        stopListeningWatchdog();
        clearOutboundSilenceTimer();
        clearGeminiReconnect();
        void capture?.finalize();
        capture = null;
        geminiSession?.close();
      }
    } catch (e) {
      console.error("[WS Message Error]:", e);
      callLog('ERROR', `MEDIA STREAM ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  ws.on('error', (err) => {
    callLog('ERROR', `WEBSOCKET ERROR: ${err?.message || err}`);
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed');
    setCallState('ENDED', 'telephony websocket closed');
    stopListeningWatchdog();
    clearGeminiReconnect();
    clearOutboundSilenceTimer();
    clearWaitTick();
    clearRecoveryTick();
    clearOutboundSilenceTimer();
    if (outboundOpeningWaitTimer) clearTimeout(outboundOpeningWaitTimer);
    if (outboundThanksHangupTimer) clearTimeout(outboundThanksHangupTimer);
    if (openingGraceTimer) clearTimeout(openingGraceTimer);
    void capture?.finalize();
    capture = null;
    geminiSession?.close();
  });
}