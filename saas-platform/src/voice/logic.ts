import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import { fetchLiveSiteData, formatLiveDataForPrompt } from '../lib/live-site-data';
import { buildInboundSystemInstruction, getGreeting as getInboundGreeting, getInboundGreetingInstruction } from '../voice/Inbound/index';
import { buildOutboundSystemInstruction, buildOutboundFastConnectInstruction, buildOutboundProjectReferenceContext, getOutboundGreetingInstruction, PDF_OPENING, PDF_PURPOSE_QUESTION, looksLikeRepeatRequest, looksLikeInvestmentPitchYes, INVESTMENT_PITCH_PENDING_QUESTION, looksLikeManagerCallbackQuestion, OUTBOUND_REPEAT_NUDGE, OUTBOUND_INVESTMENT_YES_CLOSE_NUDGE, OUTBOUND_MANAGER_CALLBACK_NUDGE, OUTBOUND_MANAGER_CALLBACK_END_ONLY_NUDGE, OUTBOUND_NO_REPEAT_NUDGE, looksLikeSalesManagerCallbackLine, looksLikeThanksOnlyLine, looksLikeClosingGoodbye, isRedundantOutboundThanksTurn, OUTBOUND_THANKS_BEFORE_END_NUDGE, hasThanksClosing, looksLikeIdentityQuestion, looksLikeContextInterrupt, deriveOutboundConversationMemory, buildOutboundIdentityAnswerNudge, buildOutboundOffTopicAnswerNudge, buildOutboundResumeNudge, type OutboundConversationMemory } from '../voice/Outbound/index';
import { loadOpeningConfig } from '../voice/opening-config';
import {
  allowsRepeatReplay,
  isDuplicateOutboundSpeech,
  registerOutboundSpeech,
} from '../voice/outbound-dedup';
import { CallCaptureSession } from '../voice/call-capture/session';
import { callLog } from '../voice/call-capture/logger';
import { loadAudioPipelineConfig } from '../voice/audio-pipeline-config';
import { allowedLayoutsList, detectForbiddenLayoutMention } from '../voice/allowed-layouts';
import { SPOKEN_PRICING_RUNTIME_REMINDER } from '../voice/spoken-pricing';
import { PHRASE_FIXES_RUNTIME } from '../voice/phrase-fixes';
import { takeCachedOutboundOpeningInstruction } from '../voice/opening-prewarm-cache';
import { buildLiveSpeechConfig, describeSpeechConfig, loadLiveSpeechSettings } from '../voice/tts/speech-config';
import { detectScriptLanguage } from '../voice/language/script-detect';
import {
  languageCodeForConversation,
  languageSwitchSystemPrompt,
  resolveNextConversationLanguage,
  type ConversationLanguage,
  type LanguageSwitchState,
} from '../voice/language/conversation-language';
import { KANNADA_THROUGHOUT_RULES } from '../voice/kannada-style';
import { evaluateBargeIn, evaluateLocalSpeech } from '../voice/turn-policy';
import { analyzePcmFrame, isSpeechLike, shouldOpenGate } from '../voice/speech-likelihood';
import { LEAD_STATUS, outcomeFromFlags } from '../lib/lead-status';
import { generateCallSummary } from '../lib/call-summary';
import { ensureLeadForCall, outboundCallerId, phoneTail } from '../lib/lead-upsert';
import {
  markAnsweredByPhone,
  markCallCompletedByPhone,
  markOutcomeByPhone,
  transitionLeadsByPhone,
} from '../lib/lead-status-transitions';
import {
  emptyIdentity,
  formatIdentityContext,
  kannadaHonorific,
  resolveCustomerIdentity,
  type CustomerIdentity,
} from '../voice/customer-identity';
import {
  beginWaitingForCustomer,
  classifyCustomerWhileWaiting,
  createWaitingState,
  enterCustomerRequestedWait,
  loadWaitConfig,
  nextWaitDeadline,
  onMeaningfulCustomerSpeech,
  tickWait,
  type HonorificKn,
  type WaitingState,
} from '../voice/wait-policy';
import { isMeaningfulCustomerUtterance, shouldAllowEndCall } from '../voice/end-call-guard';
import {
  CUSTOMER_QUESTION_ANSWER_NUDGE,
  looksLikeCustomerQuestion,
  looksLikeSiteDetailRequest,
  SITE_DETAIL_ANSWER_NUDGE,
} from '../voice/customer-question';
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

// --- Small helper: race a promise against a timeout, never rejecting ---
// Used so a slow/hanging live-data source can never stall call setup.
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

// --- Tools ---
const END_CALL_TOOL = {
  name: "endCall",
  description: "End the call ONLY when the customer has CLEARLY said they want to finish — e.g. bye, goodbye, thank you for your time, thanks that's all, I'm done, that's all I needed, you can end the call, or an equivalent clear goodbye in any language. Also allowed after completing a busy/callback-later script the customer requested, OR in the SAME turn immediately after notInterested when they clearly declined. NEVER call this because of elapsed time, silence, pauses, short replies (okay/hmm/hello alone), topic changes, incomplete answers, or because the opening question was asked. If unsure, do NOT end the call.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const OUTBOUND_END_CALL_TOOL = {
  name: "endCall",
  description:
    "End the outbound call after delivering a scripted closing that includes 'Thank you.' exactly ONCE for the whole call. " +
    "If the closing script already includes Thank you, do NOT say Thank you again — call endCall in the SAME turn. " +
    "Do NOT end because of silence alone.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const BOOK_APPOINTMENT_TOOL = {
  name: "bookAppointment",
  description: "Book a site-visit appointment. Only use this if they agree on a specific date and time within the preferred site-visit window of 10:00 AM to 5:30 PM.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      dateTime: {
        type: Type.STRING,
        description: "The ISO 8601 date and time for the appointment (e.g. 2024-04-16T10:30:00). Must be between 10:00 and 17:30 local time.",
      },
    },
    required: ["dateTime"],
  },
};

const SET_FOLLOW_UP_TOOL = {
  name: "setFollowUp",
  description:
    "Mark a Sales Manager / sales-team follow-up ONLY after the customer clearly asks for or agrees to a manager callback. Never call this just because you offered once and they stayed silent.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: "The reason for the follow-up (e.g., 'not sure of date', 'needs to discuss with family').",
      },
    },
    required: ["reason"],
  },
};

const SET_NAME_TOOL = {
  name: "setName",
  description:
    "Update the customer's name and optional form of address once they provide it or correct it. " +
    "Pass the exact name they said (do not substitute a dictionary name). " +
    "If they said Mr/Mrs/Ms/Dr/Prof/Er/CA, pass title. " +
    "If they say they are married / prefer Mrs., set maritalStatus=married. " +
    "If they say 'just call me <name>', set preferFirstNameOnly=true.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "The customer's actual name as spoken (may include a title prefix).",
      },
      title: {
        type: Type.STRING,
        description: "Optional explicit title: Mr., Mrs., Ms., Dr., Prof., Er., or CA.",
      },
      maritalStatus: {
        type: Type.STRING,
        description: "Optional: married | unmarried | unknown. Use married only when stated or CRM-confirmed.",
      },
      preferFirstNameOnly: {
        type: Type.BOOLEAN,
        description: "True when the customer asks to be addressed by first name only (no Mr/Mrs/Ms).",
      },
    },
    required: ["name"],
  },
};

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
  const waitCfg = loadWaitConfig();
  let waitingState: WaitingState = createWaitingState();
  let waitTickTimer: NodeJS.Timeout | null = null;
  let fullTranscription: string = "";
  let isFirstResponse = true;
  let callInterested: boolean | null = null;
  let isOutboundCall = false;
  /** Single canonical name/gender/salutation object for this call. */
  let customerIdentity: CustomerIdentity = emptyIdentity();
  let outboundOpeningRepeatDone = false;
  let outboundGreetingSpoken = false;
  let outboundStayActiveNudgeSent = false;
  let outboundOpeningWaitTimer: NodeJS.Timeout | null = null;
  const OPENING_WAIT_MS = 7000;
  const OPENING_QUESTION = PDF_OPENING;
  const audioCfg = loadAudioPipelineConfig();
  const ttsSettings = loadLiveSpeechSettings();
  /** Track reply language — every new call starts Kannada / Kanglish. */
  let conversationLanguage: ConversationLanguage = 'kn';
  let languageSwitchState: LanguageSwitchState = { englishStreak: 0 };
  let activeTtsLanguageCode: 'kn-IN' | 'en-IN' | null = ttsSettings.languageCode as 'kn-IN' | 'en-IN' | null;
  let pendingLanguageSwitchPrompt: string | null = null;
  const inputGain = audioCfg.inputGain;
  const voiceDebug = audioCfg.voiceDebug;
  const vadLog = (msg: string) => {
    if (voiceDebug) console.log(`[VAD] ${msg}`);
  };

  // --- Live input noise suppression: lightweight per-packet DSP on the
  //     EXISTING telephony stream (Plivo mu-law 8kHz mono). No ML model, no
  //     second pipeline, zero added buffering.
  //
  //     1) Biquad high-pass @100Hz (Q=0.707): removes mains hum (50Hz +
  //        harmonics), handling rumble, and line thump far better than the old
  //        6Hz DC blocker, while leaving telephony speech (300–3400Hz) intact.
  //     2) Adaptive noise-floor gate: thresholds ride above the measured floor
  //        so quiet callers keep a low open threshold; fan/AC/TV lines get a
  //        higher one. Closed = duck (never hard-mute) so quiet Kannada
  //        onsets still reach Gemini. ---
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

  let noiseFloorRms = 150;       // per-call estimate of the line's background level
  const NOISE_FLOOR_MIN = audioCfg.noiseFloorMin;
  const NOISE_FLOOR_MAX = audioCfg.noiseFloorMax;
  let gateOpen = false;
  let gateBelowSince: number | null = null;
  const GATE_OPEN_MIN_RMS = audioCfg.gateOpenMinRms;
  const GATE_OPEN_MAX_RMS = audioCfg.gateOpenMaxRms;
  const GATE_FLOOR_MULT = audioCfg.gateFloorMult;
  const GATE_CLOSE_RATIO = audioCfg.gateCloseRatio;
  const GATE_RELEASE_MS = audioCfg.gateReleaseMs;
  // Gate thresholds used for barge-in / VAD only — caller audio is sent at full gain.
  let lastUpsampleSample = 0;      // continuity for linear-interpolation upsampling
  let lastGateLogAt = 0;
  let lastNoiseMetricLogAt = 0;

  // Preallocated scratch buffers — the media handler runs every ~20ms, so we
  // avoid per-packet allocations (Plivo packets are 160 bytes; 3200 samples =
  // 400ms of headroom for oversized packets).
  const SCRATCH_SAMPLES = 3200;
  const scratchCleaned = new Int16Array(SCRATCH_SAMPLES);
  const scratchPcm16k = Buffer.allocUnsafe(SCRATCH_SAMPLES * 4);

  // Local barge-in: require sustained speech well above the noise floor (and
  // usually an open gate) so TV blips / keyboard clicks don't clear AI audio.
  let aiPlaybackEndsAt = 0;
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
  // After barge-in / Gemini `interrupted`, keep dropping model audio until the
  // customer finishes speaking. Without this, late TTS chunks for the aborted
  // turn are still sent to Plivo AND the stereo recorder — AI talks over the
  // customer in the WAV for the rest of that overlap (and can skew sync).
  let suppressAiOutput = false;
  let suppressRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let responseWatchdog: ReturnType<typeof setTimeout> | null = null;
  const RESPONSE_WATCHDOG_MS = audioCfg.responseWatchdogMs;
  const SUPPRESS_RECOVERY_MS = 400;
  let speakNudgeSentThisTurn = false;

  // Dev-only latency instrumentation (set LATENCY_DEBUG=1). Marks:
  // AUDIO_IN (speech start) → GEMINI_AUDIO_SENT (turn committed) →
  // GEMINI_FIRST_AUDIO (first model audio) → PLIVO_AUDIO_SENT (first chunk out).
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

  // Heuristic, best-effort tracking of "ask once" offers made by the model,
  // as a code-side backstop on top of the prompt's own "track internally"
  // instruction (which relies purely on the model's own memory and can slip
  // in a long or interrupted call). This is not a hard guarantee — it can
  // only react after the model has already said something — but it lets us
  // send a corrective nudge if it looks like the model is about to repeat an
  // offer it already made.
  let siteVisitOfferDetected = false;
  let followUpOfferDetected = false;
  let outboundManagerCallbackDelivered = false;
  let outboundManagerCallbackNudgeSent = false;
  let outboundManagerCallbackEndNudgeSent = false;
  let outboundInvestmentYesNudgeSent = false;
  let outboundThanksSpoken = false;
  let outboundThanksNudgeSent = false;
  let outboundSilentEndNudgeSent = false;
  let outboundNoRepeatNudgeSent = false;
  let outboundThanksHangupTimer: NodeJS.Timeout | null = null;
  let outboundHardMuteAfterClose = false;
  let outboundRepeatReplayPending = false;
  let lastOutboundTurnSuppressed = false;
  let outboundConversationMemory: OutboundConversationMemory | null = null;
  const outboundSpokenChunks = new Set<string>();
  const openingCfg = loadOpeningConfig();
  let lastForbiddenLayoutNudgeAt = 0;
  let customerClearGoodbye = false;
  let customerUtteranceCount = 0;
  let endCallInvoked = false;
  let goodbyeEndCallNudgeSent = false;
  // Includes Kannada site-visit phrasings (ಸೈಟ್ ವಿಸಿಟ್ / ವಿಸಿಟ್ ಮಾಡ...) so the
  // repeat-offer guard also works when the call is happening in Kannada.
  let pendingLiveData: Awaited<ReturnType<typeof fetchLiveSiteData>> | null = null;
  let liveDataInjected = false;
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
  let lastCustomerTranscript = '';

  /** Suppress back-to-back duplicate AI lines (e.g. nudge + natural reply saying the same thing). */
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
      `[SYSTEM CONTEXT — ${label} — SILENT ONLY: absorb as background knowledge. ` +
      `Do NOT speak, do NOT read aloud, do NOT repeat the greeting, do NOT start a new turn. ` +
      `Stay quiet and wait for the customer]:\n${text}`;
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
      if (!geminiSession) return;
      console.log('[GEMINI] Injecting deferred context (after opening turn complete)');
      injectProjectReferenceIfReady();
      if (!isOutboundCall) {
        injectLiveDataIfReady();
      }
    }, 600);
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

  const injectLiveDataIfReady = () => {
    if (liveDataInjected || !geminiSession || !pendingLiveData) return;
    // Never inject during the opening greeting — it cancels Gemini audio output.
    if (!greetingAudioHeard && !deferredContextScheduled) return;
    liveDataInjected = true;
    const liveDataSection = formatLiveDataForPrompt(pendingLiveData);
    try {
      injectSilentContext(
        `LIVE INVENTORY/PRICING DATA:\n${liveDataSection}`,
        'LIVE SITE DATA',
      );
      console.log("[GEMINI] Live site data delivered to session.");
    } catch (e: any) {
      liveDataInjected = false;
      console.error("[GEMINI] Live site data inject failed:", e?.message || e);
    }
  };

  const clearOpeningWait = () => {
    if (outboundOpeningWaitTimer) {
      clearTimeout(outboundOpeningWaitTimer);
      outboundOpeningWaitTimer = null;
    }
  };

  // BUGFIX (duplicate opening question): the retry used to be cancelled only
  // by an inputTranscription, which lags real speech by 2–5s — so the repeat
  // could fire while the customer was mid-answer. Now the local VAD cancels
  // the retry the moment speech energy starts. If that sound turns out not to
  // produce a transcript within a grace window (noise, a cough), the retry is
  // re-armed so a genuinely unanswered opening still gets its single repeat.
  let openingSpeechInProgress = false;
  let openingGraceTimer: NodeJS.Timeout | null = null;
  const OPENING_SPEECH_GRACE_MS = 7000;

  const noteOutboundCustomerAnswer = (userText: string) => {
    if (!isOutboundCall || !outboundConversationMemory) return;
    const t = String(userText || '').trim().toLowerCase();
    if (
      isShortAffirmativeReply(userText) &&
      outboundConversationMemory.pendingQuestion === PDF_OPENING
    ) {
      outboundConversationMemory = {
        ...outboundConversationMemory,
        topic: 'investment vs build a house (customer confirmed they are looking)',
        pendingQuestion: PDF_PURPOSE_QUESTION,
      };
      return;
    }
    if (/\binvestment\b/i.test(t)) {
      outboundConversationMemory = {
        topic: 'investment projects on Hunsur Road and T. Narasipura Road',
        pendingQuestion: INVESTMENT_PITCH_PENDING_QUESTION,
        lastAiUtterance: outboundConversationMemory.lastAiUtterance,
      };
      return;
    }
    if (/\b(build|house|construction)\b/i.test(t)) {
      outboundConversationMemory = {
        topic: 'building a house immediately — Srirampura project',
        pendingQuestion: 'whether they want details about the Srirampura project',
        lastAiUtterance: outboundConversationMemory.lastAiUtterance,
      };
    }
  };

  const handleOutboundContextInterrupt = (userText: string) => {
    if (
      !looksLikeContextInterrupt(userText, {
        skipRepeat: looksLikeRepeatRequest,
        skipManager: looksLikeManagerCallbackQuestion,
      })
    ) {
      return;
    }
    if (!outboundConversationMemory?.pendingQuestion && customerUtteranceCount < 2) return;
    console.log('[GUARD] Outbound context interrupt — answer then resume prior topic');
    try {
      const answerNudge = looksLikeIdentityQuestion(userText)
        ? buildOutboundIdentityAnswerNudge(openingCfg.companyName)
        : buildOutboundOffTopicAnswerNudge();
      geminiSession?.sendRealtimeInput({ text: answerNudge });
      if (outboundConversationMemory) {
        geminiSession?.sendRealtimeInput({
          text: buildOutboundResumeNudge(outboundConversationMemory),
        });
      }
    } catch (e: any) {
      console.error('[GEMINI] Context resume nudge failed:', e?.message || e);
    }
  };

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
    injectLiveDataIfReady();
  };

  const looksLikeOpeningDecline = (raw: string) =>
    /^(?:no+|nope|nah|not interested|not looking|ಇಲ್ಲ|ಬೇಡ)[.!?\s]*$/iu.test(String(raw || '').trim());

  /** After opening "yes", keep the session live and ask the purpose question once. */
  const keepOutboundActiveAfterOpeningYes = (raw: string) => {
    if (!isOutboundCall || outboundStayActiveNudgeSent) return;
    if (!isShortAffirmativeReply(raw) || looksLikeOpeningDecline(raw)) return;
    outboundStayActiveNudgeSent = true;
    console.log('[GEMINI] Opening yes — staying on the call and asking purpose question');
    try {
      sendClientTextTurn(
        `SYSTEM (internal): The customer said YES they are looking for a site. Stay on this call. ` +
          `Do NOT hang up. Do NOT stay silent. Do NOT say thank you yet. ` +
          `Ask EXACTLY once now: "${PDF_PURPOSE_QUESTION}" then WAIT for their answer.`,
      );
    } catch (e: any) {
      outboundStayActiveNudgeSent = false;
      console.error('[GEMINI] Stay-active after opening yes failed:', e?.message || e);
    }
  };

  const armOpeningWait = () => {
    // Opening question retry disabled — it caused the agent to repeat lines aloud.
    outboundOpeningRepeatDone = true;
  };

  const currentHonorific = (): HonorificKn => {
    const h = kannadaHonorific(customerIdentity);
    if (h === 'ಸರ್' || h === 'ಮ್ಯಾಡಮ್') return h;
    return 'ಸರ್';
  };

  const clearWaitTick = () => {
    if (waitTickTimer) {
      clearTimeout(waitTickTimer);
      waitTickTimer = null;
    }
  };

  const sendWaitSystemPrompt = (text: string) => {
    if (!geminiSession) return;
    if (isOutboundCall && outboundHardMuteAfterClose) return;
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

  const applyCustomerLanguageFromTranscript = (userText: string) => {
    if (isOutboundCall) return; // Outbound: English-only — never switch TTS or prompts
    const resolved = resolveNextConversationLanguage(
      conversationLanguage,
      userText,
      languageSwitchState,
    );
    languageSwitchState = resolved.state;
    if (!resolved.switched) return;
    const prev = conversationLanguage;
    conversationLanguage = resolved.language;
    activeTtsLanguageCode = languageCodeForConversation(conversationLanguage);
    console.log(
      `[LANG] Conversation language ${prev} → ${conversationLanguage} ` +
        `(tts=${activeTtsLanguageCode ?? 'auto'}, reason=${resolved.decision.reason})`,
    );
    const prompt =
      `${languageSwitchSystemPrompt(conversationLanguage)} ` +
      `SYSTEM TTS LANGUAGE TARGET: ${activeTtsLanguageCode ?? 'auto (Kanglish — Kannada frame + English site names/sizes/prices)'}.`;
    // Do not interrupt AI mid-sentence — defer until playback drains.
    if (Date.now() < aiPlaybackEndsAt - 120) {
      pendingLanguageSwitchPrompt = prompt;
      return;
    }
    sendWaitSystemPrompt(prompt);
  };

  const flushPendingLanguageSwitch = () => {
    if (!pendingLanguageSwitchPrompt) return;
    if (Date.now() < aiPlaybackEndsAt - 80) return;
    sendWaitSystemPrompt(pendingLanguageSwitchPrompt);
    pendingLanguageSwitchPrompt = null;
  };

  const scheduleWaitTick = () => {
    clearWaitTick();
    const now = Date.now();
    const deadline = nextWaitDeadline(waitingState, waitCfg, now);
    if (deadline == null) return;
    const delay = Math.max(50, deadline - now);
    waitTickTimer = setTimeout(() => {
      waitTickTimer = null;
      if (!geminiSession) return;
      if (vadIsSpeaking) {
        // Customer may be mid-utterance — don't fire availability check yet.
        waitTickTimer = setTimeout(() => scheduleWaitTick(), 400);
        return;
      }
      // Still playing TTS — push the silence clock until playback finishes.
      const playLeft = aiPlaybackEndsAt - Date.now();
      if (playLeft > 80 && waitingState.reason === 'normal_wait') {
        waitingState = beginWaitingForCustomer(waitingState, Date.now() + playLeft);
        scheduleWaitTick();
        return;
      }
      const { state, decision } = tickWait(waitingState, waitCfg, Date.now(), currentHonorific());
      waitingState = state;
      if (decision.action === 'availability_check') {
        console.log(
          `[WAIT] Availability check #${waitingState.availability_check_count}/${waitCfg.maxAvailabilityChecks}: "${decision.spokenLine}"`,
        );
        sendWaitSystemPrompt(decision.systemPrompt);
      } else if (decision.action === 'grace_callback') {
        console.log(`[WAIT] Grace callback nudge (silence ≠ not interested): "${decision.spokenLine}"`);
        sendWaitSystemPrompt(decision.systemPrompt);
      } else if (decision.action === 'requested_wait_expired') {
        console.log('[WAIT] Customer-requested wait ended — resuming normal listening (no immediate check)');
      }
      scheduleWaitTick();
    }, delay);
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
    clearResponseWatchdog();
    scheduleOutboundHangupAfterThanks();
  };

  const shouldSuppressOutboundTurn = (turnText: string): { suppress: boolean; reason?: string } => {
    const trimmed = String(turnText || '').trim();
    if (!isOutboundCall) {
      return { suppress: false };
    }
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
      outboundManagerCallbackDelivered &&
      turnText.length > 16 &&
      (looksLikeSalesManagerCallbackLine(turnText) || isDuplicateOutboundSpeech(turnText, outboundSpokenChunks))
    ) {
      return { suppress: true, reason: 'duplicate_manager_callback' };
    }
    if (
      openingGreetingTurnFinished &&
      turnText.length > 12 &&
      looksLikeOpeningEcho(turnText)
    ) {
      return { suppress: true, reason: 'duplicate_opening' };
    }
    if (isDuplicateOutboundSpeech(turnText, outboundSpokenChunks)) {
      return { suppress: true, reason: 'duplicate_spoken_line' };
    }
    if (turnText.length > 12 && isNearDuplicateAiTurn(turnText)) {
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
      return;
    }
    playGeminiAudioParts(parts);
    registerOutboundSpeech(turnText, outboundSpokenChunks);
    if (looksLikeSalesManagerCallbackLine(turnText)) {
      outboundManagerCallbackDelivered = true;
    }
    if (
      isOutboundCall &&
      (hasThanksClosing(turnText) || looksLikeClosingGoodbye(turnText))
    ) {
      activateOutboundPostThanksMute();
    }
  };

  const sendOutboundManagerCallbackEndOnlyNudgeOnce = () => {
    if (!isOutboundCall || outboundManagerCallbackEndNudgeSent || outboundHardMuteAfterClose) return;
    if (outboundThanksSpoken) {
      forceOutboundHangupIfClosing('manager callback already closed');
      return;
    }
    outboundManagerCallbackEndNudgeSent = true;
    try {
      geminiSession?.sendRealtimeInput({
        text: OUTBOUND_MANAGER_CALLBACK_END_ONLY_NUDGE,
      });
    } catch (e: any) {
      console.error('[GEMINI] Manager callback end-only nudge failed:', e?.message || e);
    }
  };

  /** Agent finished speaking → WAITING_FOR_CUSTOMER (after TTS drains). */
  const armWaitingForCustomer = () => {
    if (isOutboundCall && outboundHardMuteAfterClose) return;
    // Outbound: never treat pre-opening silence as "customer unavailable".
    if (isOutboundCall && !openingGreetingTurnFinished) return;
    if (isOutboundCall && !outboundOpeningRepeatDone && !outboundGreetingSpoken) {
      return;
    }
    // Opening has its own ~4s one-shot retry — don't stack a 5s availability check on top.
    if (isOutboundCall && !outboundOpeningRepeatDone) {
      return;
    }
    const now = Date.now();
    const playLeft = Math.max(0, aiPlaybackEndsAt - now);
    const silenceStart = now + playLeft;
    waitingState = beginWaitingForCustomer(waitingState, silenceStart);
    console.log(
      `[WAIT] WAITING_FOR_CUSTOMER reason=${waitingState.reason} ` +
        `(availability after ${waitCfg.availabilityCheckAfterMs}ms unexplained silence)`,
    );
    scheduleWaitTick();
  };

  const handleCustomerTranscriptForWait = (userText: string) => {
    if (!isCustomerTurnSignal(userText)) return;
    const classified = classifyCustomerWhileWaiting(userText, waitCfg);
    if (classified.kind === 'wait_request') {
      waitingState = enterCustomerRequestedWait(
        waitingState,
        classified.wait.durationMs,
        Date.now(),
      );
      console.log(
        `[WAIT] CUSTOMER_REQUESTED_WAIT ${classified.wait.durationMs}ms ` +
          `(${classified.wait.kind}) phrase="${classified.wait.phrase}" — skipping 5s availability check`,
      );
      scheduleWaitTick();
      return;
    }
    waitingState = onMeaningfulCustomerSpeech(waitingState, Date.now());
    clearWaitTick();
  };
  const SITE_VISIT_OFFER_PATTERN =
    /site\s*visit|visit\s*the\s*(plot|layout|site)|come\s*(and\s*)?(see|visit)|shall\s*(we|i)\s*(book|schedule|arrange).*visit|ಸೈಟ್\s*ವಿಸಿಟ್|ವಿಸಿಟ್\s*ಮಾಡ|ಸೈಟ್\s*ನೋಡ|visit\s*ಮಾಡ್ಬೇಕಾ|visit\s*fix\s*ಮಾಡ/i;
  const FOLLOW_UP_OFFER_PATTERN =
    /sales\s*(manager|team)\s*(contact|call|reach|callback)?|someone\s*(from\s*our\s*team\s*)?(will\s*)?(call|contact)\s*you|can\s*i\s*(call|arrange|connect).*(manager|sales)|shall\s*i\s*(call|arrange).*(manager|sales)|manager\s*(call|callback)|callback\s*(from\s*)?(the\s*)?(sales\s*)?manager|Sales\s*Manager\s*callback|manager\s*ಕಾಲ್|ಕಾಲ್\s*ಮಾಡ್ಲಾ|ಕಾಲ್\s*ಮಾಡೋಣ|callback\s*arrange|ಸೇಲ್ಸ್\s*ಮ್ಯಾನೇಜರ್|ಮ್ಯಾನೇಜರ್.*ಕಾಲ್|ಕಾಲ್\s*ಬ್ಯಾಕ್/i;
  // Clear goodbye / finished signals — must match the END THE CALL prompt rules.
  // Keep this conservative: do NOT match bare "okay", "thanks", or "hmm".
  const CUSTOMER_GOODBYE_PATTERN = /\b(bye|goodbye|good\s*bye|i'?m\s+done|that'?s\s+all(\s+i\s+needed)?|thanks?,?\s+that'?s\s+all|thank\s+you\s+for\s+your\s+time|you\s+can\s+end\s+(the\s+)?call|end\s+the\s+call)\b|ಸಾಕು|ಬೈ|ವಿದಾಯ|ಧನ್ಯವಾದ.*ಸಾಕು/i;

  // --- Anti-aliasing / boundary-safe downsample state (24kHz Gemini audio -> 8kHz Twilio mu-law) ---
  let outputLeftover: Buffer = Buffer.alloc(0);
  let geminiPlaybackRate = 24000;
  let loggedFirstAudio = false;

  const sendPcmToTwilio = (pcm: Buffer, flush = false) => {
    if (!streamSid) return;
    // Drop late/aborted-turn audio so the phone and the recording stay aligned.
    if (suppressAiOutput) {
      outputLeftover = Buffer.alloc(0);
      return;
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
    // 8 samples per ms at 8kHz — extend the "still audible on the phone" clock
    // by the duration of this queued chunk (generation outpaces playback).
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

  const clearResponseWatchdog = () => {
    if (responseWatchdog) {
      clearTimeout(responseWatchdog);
      responseWatchdog = null;
    }
  };

  const armResponseWatchdog = () => {
    clearResponseWatchdog();
    responseWatchdog = setTimeout(() => {
      if (!geminiSession) return;
      if (suppressAiOutput) return;
      if (isOutboundCall && outboundHardMuteAfterClose) return;
      if (Date.now() < aiPlaybackEndsAt - 100) return;
      console.warn('[GUARD] No AI response after customer speech — nudging model');
      geminiSession.sendRealtimeInput({
        text:
          'SYSTEM: The customer spoke but you have not replied with audio yet. ' +
          'Reply now in a warm, natural tone — complete 1–2 flowing sentences, then listen. ' +
          'Do not restart the greeting. Do not speak internal system labels aloud.',
      });
    }, RESPONSE_WATCHDOG_MS);
  };

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
      }
      clearResponseWatchdog();
      if (awaitingFirstAiAudio) latLog('GEMINI_FIRST_AUDIO');
      const mime = String(part.inlineData?.mimeType || part.audio?.mimeType || '');
      const rateMatch = mime.match(/rate=(\d+)/i);
      if (rateMatch) geminiPlaybackRate = parseInt(rateMatch[1], 10) || geminiPlaybackRate;
      sendPcmToTwilio(Buffer.from(data, "base64"));
    }
  };

  // Debounced — previously this ran a full clearTimeout+setTimeout on every
  // single 'media' WebSocket event (~50x/second while the customer is
  // talking), which is unnecessary timer churn on the event loop during
  // exactly the part of the call where responsiveness matters most.
  // Local VAD is for capture/logging and re-arming AI after barge-in — Gemini
  // AAD owns turn-end. Silence window is intentionally longer than AAD so we
  // don't declare "customer finished" on a breath.
  const VAD_ENERGY_MIN_RMS = audioCfg.vadEnergyMinRms;
  const VAD_ENERGY_FLOOR_MULT = audioCfg.vadEnergyFloorMult;
  const VAD_SILENCE_MS = audioCfg.vadSilenceMs;
  let vadIsSpeaking = false;
  let vadSilenceStartedAt: number | null = null;

  console.log(`[WS] Connected (Twilio/Plivo). Waiting for start event...`);
  const earlyIsOutbound = String(streamParams?.get('isOutbound') || '').toLowerCase() === 'true';
  if (earlyIsOutbound) {
    streamConnectAt = Date.now();
    console.log('[GEMINI] Outbound WS connected — intro latency clock started');
  }
  console.log(
    `[WAIT] Config: checkAfter=${waitCfg.availabilityCheckAfterMs}ms maxChecks=${waitCfg.maxAvailabilityChecks} ` +
      `nextDelay=${waitCfg.nextCheckDelayMs}ms holdOn=${waitCfg.holdOnMs}ms justAMinute=${waitCfg.justAMinuteMs}ms`,
  );

  ws.on('message', async (data: string) => {
    try {
      const rawMsg = JSON.parse(data);
      const msg = normalizeVoiceEvent(rawMsg);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        if (msg.start.isPlivo) audioSink = 'plivo';
        const fromUrl: Record<string, string> = {};
        streamParams?.forEach((v, k) => {
          fromUrl[k] = v;
        });
        const customParams = { ...fromUrl, ...(msg.start.customParameters || {}) };
        const isOutbound = String(customParams.isOutbound || '').toLowerCase() === 'true';
        isOutboundCall = isOutbound;
        const rawName =
          customParams.customerName ||
          customParams.CustomerName ||
          customParams.name ||
          '';
        const blacklistedNames = ['customer', 'contact', 'lead', 'unknown', 'null', 'undefined', 'unnamed', ''];
        // Plivo extraHeaders may use underscores for spaces — restore for speech.
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
        customerIdentity = customerName
          ? resolveCustomerIdentity({
              rawName: customerName,
              source: isOutbound ? 'campaign' : 'crm',
            })
          : emptyIdentity();
        if (phoneDigits) {
          void ensureLeadForCall({
            phone: customerPhone!,
            name: customerName || undefined,
            calledFrom: outboundCallerId(),
            callStatus: LEAD_STATUS.ANSWERED,
          })
            .then((lead) => console.log(`[DB] Lead ensured for ${customerPhone} id=${lead?.id}`))
            .catch((e) => console.warn('[DB] ensureLeadForCall failed:', e));

          void prisma.lead
            .findFirst({
              where: { phone: { contains: phoneDigits.slice(-10) } },
              orderBy: { createdAt: 'desc' },
              select: { name: true },
            })
            .then((lead) => {
              const leadName = lead?.name?.trim() || '';
              if (leadName && !blacklistedNames.includes(leadName.toLowerCase())) {
                customerIdentity = resolveCustomerIdentity({
                  rawName: leadName,
                  source: 'campaign',
                });
                console.log(`[IDENTITY] Using lead name from DB: ${leadName}`);
              }
            })
            .catch((e) => console.warn('[IDENTITY] Lead name lookup failed:', e));
        }

        console.log(
          `[WS] Stream started: ${streamSid} | Name: ${customerIdentity.customer_name_normalized || 'N/A'} | ` +
            `Gender: ${customerIdentity.customer_gender}@${customerIdentity.customer_gender_confidence.toFixed(2)} | ` +
            `Salutation: ${customerIdentity.customer_salutation || 'none'} | ` +
            `Spoken: ${customerIdentity.spoken_address || 'n/a'} | Phone: ${customerPhone || 'N/A'} | Outbound: ${isOutboundCall} | Sink: ${audioSink}`,
        );

        if (streamConnectAt === 0) {
          streamConnectAt = Date.now();
        }
        latLog('STREAM_CONNECT');

        const currentDateStr = new Date().toLocaleDateString('en-IN');
        const greetingIdentity = customerIdentity.customer_name_normalized
          ? customerIdentity
          : null;
        const cachedOutboundInstruction =
          isOutboundCall && phoneDigits ? takeCachedOutboundOpeningInstruction(phoneDigits) : null;
        const activeSystemInstruction = isOutboundCall
          ? (cachedOutboundInstruction ??
            buildOutboundSystemInstruction(currentDateStr, greetingIdentity, { deferProjectReference: true }))
          : buildInboundSystemInstruction(currentDateStr, greetingIdentity);
        pendingFullSystemInstruction = activeSystemInstruction;
        const geminiSystemInstruction = isOutboundCall
          ? buildOutboundFastConnectInstruction(currentDateStr)
          : activeSystemInstruction;
        if (cachedOutboundInstruction) {
          console.log('[GEMINI] Using pre-cached outbound system instruction (answer URL warm)');
        }
        if (isOutboundCall) {
          console.log('[GEMINI] Fast-connect prompt for intro (full guide deferred until first audio)');
        }

        const liveDataPromise = withTimeout(fetchLiveSiteData(), 1200);

        const runtimeInstructionBase = isOutboundCall
          ? `
OUTBOUND PDF FLOW REMINDER:
- Opening: "${PDF_OPENING}" — one sentence, then wait.
- Follow the PDF scripts exactly. Indian English only.
- NEVER repeat any line, question, or closing twice on this call. Say each script line in FULL once.
- If the customer asks who you are or another unrelated question mid-call, answer briefly then return to the previous topic naturally.
- Pronounce Hunsur per /ˌhʊnəˈsuːru/, T. Narasipura per /tiː ˌnʌrəsiˈpʊrə/, Srirampura as "shree-raam-poo-ra".
- Never say you are an AI or language model. You are a sales officer on a live call.
- End with "Thank you." EXACTLY ONCE in the closing line, then call endCall. Never say Thank you a second time.

CURRENT DATE: ${currentDateStr}
`
          : `
TOOL USAGE NOTES:
- If the customer clearly and explicitly says they are not interested, call the notInterested tool.
- If they agree on a specific date/time between 10:00 AM and 5:30 PM (preferred site-visit window), call bookAppointment.
- If they're interested but unsure of timing, call setFollowUp.
- If they explicitly ask for a callback later (busy/driving), follow the BUSY / DRIVING / CALL BACK LATER script, then call endCall.
- endCall ONLY when the customer clearly wants to hang up (bye / goodbye / thank you for your time / thanks that's all / I'm done / that's all I needed / you can end the call / clear equivalent in any language), OR after finishing a busy/callback-later script they requested, OR in the same turn immediately after notInterested when they clearly declined. NEVER call endCall because a few minutes have passed, for silence, pauses, "okay"/"hmm"/"hello" alone, topic changes, or incomplete answers. Never hang up right after the opening question.

LANGUAGE REMINDER: ${KANNADA_THROUGHOUT_RULES}
${PHRASE_FIXES_RUNTIME}
KANNADA REMINDER: Calm Mysuru local sales professional. EVERY reply in Kanglish unless customer clearly switched to English (explicit request or two full English turns). Always say "site" not "plot". One question per turn ONLY. Natural budget/loan English loanwords inside Kannada sentences OK. No excitement or drama. After a question, STOP and listen. Only the five PDF projects. Office 10–7; site visits 10–5:30.
NO INVENTION: Never invent that the customer asked for a site visit, booking, or any question they did not ask. Never say "sure / that's great / wonderful" about something they did not say. NEVER guess or invent the customer's name (no "Mohan", "Ramesh", etc.) unless CANONICAL CUSTOMER IDENTITY lists a verified name — if unknown, do not use any name. If unclear, ask one short clarification in Kannada and WAIT.
PROJECT FACTS REMINDER: ONLY these layouts: ${allowedLayoutsList()}. Never Jeevan Vihar, Dhatri Square, Dr. Daya Nagar, or any other project. CNM Apex = South-facing only at ₹5,450/sqft (not North). Booking amount = ₹59,000. Agreement amount / maintenance cost-duration → Sales Manager discusses if needed — do NOT keep asking to call the manager.
MANAGER/SITE-VISIT REMINDER: Never repeatedly ask "can I call the manager?" or offer site visit. Manager/callback offer at most ONCE per call, then silence until the customer asks. Site visit ONLY when the customer asks.
LISTENING REMINDER: Never speak over the customer. Short replies (houda, haudu, ha, sari, ok, ಹೌದು, ಸರಿ, ಹೇಳಿ) are REAL turns — always reply with warm Mysuru Kanglish; never stay silent. Allow natural pauses inside a sentence. If they interrupt, stop immediately. Opening: Speak → ONE question → Stop → Listen.
VOICE REMINDER: Speak CLEARLY — unhurried, every word audible, natural pauses. Short messages: 1–2 sentences default. Never rush, clip, or monologue. Long answers ONLY for site detail requests.
ANSWER REMINDER: Direct questions — short Kanglish answer (1–2 sentences). Site DETAIL requests ONLY — full facts in 4–8 clear sentences, NO question that turn. Never pad short answers with extra pitch.
${SPOKEN_PRICING_RUNTIME_REMINDER}
SILENCE REMINDER: After a question, wait. Do not fill silence. If the customer says wait / hold on / ಒಂದು ನಿಮಿಷ / ಸ್ವಲ್ಪ wait ಮಾಡಿ, respect that and do NOT ask if they are still there during their wait. Only brief availability checks come from system "AVAILABILITY CHECK:" messages after unexplained silence — never treat silence as not interested or hang-up.

CURRENT DATE: ${currentDateStr}

${formatIdentityContext(customerIdentity)}
`;

        const fastOpeningBlock = isOutboundCall ? '' : `\nFAST OPENING: Speak the greeting once within 0.5 seconds. No preamble. Do not repeat.\n`;

        console.log(`[VOICE] Audio pipeline: gain=${inputGain} gateMin=${GATE_OPEN_MIN_RMS} gateRel=${GATE_RELEASE_MS}ms bargeMinRms=${BARGE_IN_MIN_RMS} bargeHold=${BARGE_IN_MIN_MS}ms vadSilence=${VAD_SILENCE_MS}ms aadSilence=${audioCfg.aadSilenceDurationMs}ms aadEnd=${audioCfg.aadEndSensitivity} aadStart=${audioCfg.aadStartSensitivity}`);
        conversationLanguage = isOutboundCall ? 'en' : 'kn';
        languageSwitchState = { englishStreak: 0 };
        activeTtsLanguageCode = isOutboundCall
          ? 'en-IN'
          : ((ttsSettings.languageCode as 'kn-IN' | 'en-IN' | null) ?? 'kn-IN');
        console.log(
          `[VOICE] TTS: ${describeSpeechConfig(ttsSettings, activeTtsLanguageCode)} (${isOutboundCall ? 'Indian English outbound' : 'Kanglish-first'})`,
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
            const greetingName = customerIdentity.customer_name_normalized ? customerIdentity : null;
            const greetingText: string = isOutboundCall
              ? PDF_OPENING
              : getInboundGreeting(greetingName?.customer_name_normalized ?? null);
            const instruction = isOutboundCall
              ? getOutboundGreetingInstruction()
              : getInboundGreetingInstruction(greetingName);
            console.log(`[GEMINI] Sending opening greeting once (+${Date.now() - streamConnectAt}ms from stream)`);
            capture?.onAiText(greetingText);
            sendClientTextTurn(getOutboundGreetingInstruction());
          } catch (greetErr) {
            greetingSent = false;
            console.error('[GEMINI] Failed to send greeting:', greetErr);
          }
        };

        const geminiConnectOptions = {
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              thinkingConfig: { thinkingLevel: "minimal" } as any,
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  // Tolerate breaths/hesitations: longer silence + low end/start
                  // sensitivity. Tunable via VOICE_AAD_* env vars.
                  endOfSpeechSensitivity: audioCfg.aadEndSensitivity,
                  startOfSpeechSensitivity: audioCfg.aadStartSensitivity,
                  silenceDurationMs: audioCfg.aadSilenceDurationMs,
                  prefixPaddingMs: audioCfg.aadPrefixPaddingMs,
                } as any,
              },
              // Kannada-first: kn-IN for the opening; follow customer language via prompts.
              speechConfig: buildLiveSpeechConfig(ttsSettings, activeTtsLanguageCode) as any,
              systemInstruction: `${geminiSystemInstruction}${fastOpeningBlock}`,
              tools: [
                {
                  functionDeclarations: isOutboundCall
                    ? [OUTBOUND_END_CALL_TOOL, SET_NAME_TOOL, NOT_INTERESTED_TOOL]
                    : [END_CALL_TOOL, BOOK_APPOINTMENT_TOOL, SET_NAME_TOOL, SET_FOLLOW_UP_TOOL, NOT_INTERESTED_TOOL],
                },
              ],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                console.log(`[GEMINI] Session opened! (+${Date.now() - streamConnectAt}ms from stream)`);
                callLog('SUCCESS', 'GEMINI LIVE SESSION OPEN');
                geminiSessionOpened = true;
                trySendOpening();
              },
              onerror: (err: any) => {
                const msg = err?.message || String(err);
                console.error("[GEMINI Error]:", err);
                callLog('ERROR', `GEMINI/STT ERROR: ${msg}`);
                capture?.onSttError(msg);
              },
              onmessage: async (response: any) => {
                if (response.serverContent?.interrupted) {
                  if (isOutboundCall && !openingGreetingTurnFinished) {
                    console.log('[GEMINI] Opening-phase interrupt ignored — keep intro playing');
                  } else {
                  const confirmedUserSpeech =
                    Date.now() - bargeInConfirmedAt < BARGE_IN_CONFIRM_TTL_MS ||
                    vadIsSpeaking;
                  if (!confirmedUserSpeech) {
                    console.log(
                      `[GEMINI] Turn interrupted ignored — no confirmed user speech ` +
                        `(aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`,
                    );
                    return;
                  }
                  console.log(`[GEMINI] Turn interrupted — clearing playback (aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`);
                  capture?.onAiSpeakEnd();
                  clearPlayback();
                  outputLeftover = Buffer.alloc(0);
                  vadIsSpeaking = true;
                  vadSilenceStartedAt = null;
                  return;
                  }
                }

                // Play audio first so speech starts without waiting on DB/tools.
                if (response.serverContent?.modelTurn?.parts) {
                  const turnText = response.serverContent.modelTurn.parts
                    .map((p: any) => p.text || '')
                    .join('')
                    .trim();
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
                  const completedAiText = response.serverContent?.modelTurn?.parts
                    ?.map((p: any) => p.text || '')
                    .join('')
                    .trim();
                  if (completedAiText && !(isOutboundCall && lastOutboundTurnSuppressed)) {
                    markAiTurnPlayed(completedAiText);
                    if (isOutboundCall) {
                      outboundConversationMemory = deriveOutboundConversationMemory(
                        completedAiText,
                        outboundConversationMemory,
                      );
                    }
                    if (isOutboundCall && hasThanksClosing(completedAiText)) {
                      activateOutboundPostThanksMute();
                      if (looksLikeSalesManagerCallbackLine(completedAiText)) {
                        outboundManagerCallbackDelivered = true;
                      }
                    } else if (isOutboundCall && looksLikeSalesManagerCallbackLine(completedAiText)) {
                      outboundManagerCallbackDelivered = true;
                    }
                  }
                  lastOutboundTurnSuppressed = false;
                  if (!openingGreetingTurnFinished) {
                    openingGreetingTurnFinished = true;
                    openingQuestionSent = true;
                    latLog('OPENING_TURN_COMPLETE');
                    // Outbound: do not inject "stay quiet" context here — that
                    // made the agent go silent after the customer said yes.
                    if (!isOutboundCall) {
                      injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
                      injectDeferredContextAfterOpening();
                    }
                  } else if (!isOutboundCall && !deferredContextScheduled) {
                    injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
                    injectDeferredContextAfterOpening();
                  } else if (!deferredContextScheduled) {
                    injectDeferredContextAfterOpening();
                  }
                  // If the aborted turn finished after barge-in and the customer
                  // is already quiet, re-arm output for the next reply.
                  if (suppressAiOutput && !vadIsSpeaking && !outboundHardMuteAfterClose) {
                    allowAiOutput();
                  }
                  if (isOutboundCall && !outboundOpeningRepeatDone && openingGreetingTurnFinished) {
                    if (!outboundGreetingSpoken) {
                      outboundGreetingSpoken = true;
                      console.log("[GEMINI] Opening question spoken — waiting ~4s for a reply");
                    }
                    armOpeningWait();
                  }
                  // Patient listening: do not re-prompt Gemini until unexplained silence
                  // or an availability-check deadline (see wait-policy).
                  armWaitingForCustomer();
                  flushPendingLanguageSwitch();
                  if (isOutboundCall && outboundThanksSpoken && !endCallInvoked) {
                    scheduleOutboundHangupAfterThanks();
                  }
                }

                if (
                  response.serverContent?.turnComplete &&
                  customerClearGoodbye &&
                  !endCallInvoked &&
                  !goodbyeEndCallNudgeSent &&
                  !(isOutboundCall && outboundHardMuteAfterClose)
                ) {
                  goodbyeEndCallNudgeSent = true;
                  console.warn("[GUARD] Customer goodbye detected but endCall not called — hanging up or nudging.");
                  if (isOutboundCall && outboundThanksSpoken) {
                    forceOutboundHangupIfClosing('customer goodbye after thanks');
                  } else {
                    geminiSession?.sendRealtimeInput({
                      text: isOutboundCall
                        ? 'SYSTEM: The customer wants to end the call. Say "Thank you." ONCE only, then IMMEDIATELY call endCall. Do not say Thank you again.'
                        : "SYSTEM: The customer clearly indicated they want to end the call. Say ONE short closing thank-you if you have not already, then IMMEDIATELY call the endCall tool. Do not ask another question."
                    });
                  }
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

                    // Best-effort "ask once" backstop — see comment at the
                    // top of the file. Only fires a corrective nudge on an
                    // actual detected repeat, so it doesn't add overhead on
                    // the common (non-repeating) path.
                    if (SITE_VISIT_OFFER_PATTERN.test(aiText)) {
                      if (siteVisitOfferDetected) {
                        console.warn("[GUARD] Site visit appears to have been offered more than once — sending corrective nudge.");
                        geminiSession?.sendRealtimeInput({
                          text:
                            "SYSTEM: STOP offering site visit. You already mentioned it. Do NOT ask again. " +
                            "Stay quiet about visits until the customer asks to visit. Continue with facts or wait.",
                        });
                      }
                      siteVisitOfferDetected = true;
                    }
                    if (FOLLOW_UP_OFFER_PATTERN.test(aiText)) {
                      if (followUpOfferDetected && !outboundHardMuteAfterClose) {
                        console.warn("[GUARD] Manager/callback offered more than once — sending corrective nudge.");
                        if (isOutboundCall) {
                          sendOutboundManagerCallbackEndOnlyNudgeOnce();
                        } else {
                          geminiSession?.sendRealtimeInput({
                            text:
                              "SYSTEM: STOP asking to call the Sales Manager / arrange callback. You already offered ONCE. " +
                              "Do NOT say 'can I call the manager' again. Stay quiet about manager/callback until the CUSTOMER asks. " +
                              "Answer with known project facts or wait for their next question.",
                          });
                        }
                      }
                      followUpOfferDetected = true;
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
                  customerAnsweredOpening(userText);
                  handleCustomerTranscriptForWait(userText);
                  applyCustomerLanguageFromTranscript(userText);
                  armResponseWatchdog();
                  // FIX: previously this unconditionally sent a "clear"
                  // event (wiping Priya's outbound audio buffer) on EVERY
                  // transcribed fragment, not just genuine interruptions —
                  // meaning a stray/misheard fragment while Priya was
                  // mid-sentence could clip her off. "clear" is now only
                  // sent from the serverContent.interrupted branch above,
                  // which reflects an actual detected interruption.

                  fullTranscription += `User: ${userText}\n`;
                  capture?.onCustomerTranscript(userText);
                  if (isMeaningfulCustomerUtterance(userText, looksLikeOpeningEcho)) {
                    customerUtteranceCount++;
                  }
                  if (isShortAffirmativeReply(userText)) {
                    customerAnsweredOpening(userText);
                    keepOutboundActiveAfterOpeningYes(userText);
                  }
                  if (isOutboundCall) {
                    if (outboundHardMuteAfterClose) {
                      forceOutboundHangupIfClosing('customer speech after close');
                    } else {
                    noteOutboundCustomerAnswer(userText);
                    if (looksLikeRepeatRequest(userText)) {
                      console.log('[GUARD] Outbound repeat request — nudging to repeat previous message');
                      outboundRepeatReplayPending = true;
                      try {
                        if (outboundManagerCallbackDelivered) {
                          sendOutboundManagerCallbackEndOnlyNudgeOnce();
                        } else {
                          geminiSession?.sendRealtimeInput({ text: OUTBOUND_REPEAT_NUDGE });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Repeat nudge failed:', e?.message || e);
                      }
                    } else if (
                      looksLikeInvestmentPitchYes(userText) &&
                      outboundConversationMemory?.pendingQuestion === INVESTMENT_PITCH_PENDING_QUESTION
                    ) {
                      console.log('[GUARD] Outbound investment pitch yes — closing with PDF investment yes script');
                      try {
                        if (outboundThanksSpoken) {
                          forceOutboundHangupIfClosing('investment yes after close');
                        } else if (!outboundInvestmentYesNudgeSent) {
                          outboundInvestmentYesNudgeSent = true;
                          geminiSession?.sendRealtimeInput({ text: OUTBOUND_INVESTMENT_YES_CLOSE_NUDGE });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Investment yes close nudge failed:', e?.message || e);
                      }
                    } else if (looksLikeManagerCallbackQuestion(userText)) {
                      console.log('[GUARD] Outbound more-details / manager-callback — closing with Sales Manager script');
                      try {
                        if (outboundManagerCallbackDelivered && outboundThanksSpoken) {
                          forceOutboundHangupIfClosing('more details after close');
                        } else if (outboundManagerCallbackDelivered) {
                          scheduleOutboundHangupAfterThanks();
                        } else if (!outboundManagerCallbackNudgeSent) {
                          outboundManagerCallbackNudgeSent = true;
                          geminiSession?.sendRealtimeInput({ text: OUTBOUND_MANAGER_CALLBACK_NUDGE });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Manager callback nudge failed:', e?.message || e);
                      }
                    } else {
                      handleOutboundContextInterrupt(userText);
                    }
                    }
                  } else if (looksLikeCustomerQuestion(userText)) {
                    console.log(`[GUARD] Customer question detected — ensuring project context + answer nudge`);
                    if (greetingAudioHeard || deferredContextScheduled) {
                      injectProjectReferenceIfReady();
                      injectLiveDataIfReady();
                    }
                    const nudge = looksLikeSiteDetailRequest(userText)
                      ? SITE_DETAIL_ANSWER_NUDGE
                      : CUSTOMER_QUESTION_ANSWER_NUDGE;
                    try {
                      geminiSession?.sendRealtimeInput({ text: nudge });
                    } catch (e: any) {
                      console.error('[GEMINI] Question answer nudge failed:', e?.message || e);
                    }
                  }
                  if (CUSTOMER_GOODBYE_PATTERN.test(userText)) {
                    customerClearGoodbye = true;
                    console.log(`[GUARD] Clear customer goodbye detected: "${userText.trim()}"`);
                  }

                  if (isFirstResponse && customerPhone) {
                      isFirstResponse = false;
                      const lowerText = userText.toLowerCase();

                      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'site', 'plot', 'mysore', 'mysuru', 'looking', 'investment', 'build', 'house', 'residential', 'haan', 'han', 'beku', 'vadu', 'sari', 'ಹೌದು', 'ಬೇಕು'];
                      const notInterestedKeywords = ['no', 'not interested', 'not looking', 'stop', 'don\'t', 'busy', 'wrong number', 'nahi', 'beda', 'vaddu', 'alla'];

                      // During the live call stay on `answered`. Only set the
                      // interested flag / lastResponse; outcomes are applied by
                      // tools or after endCall → call completed.
                      let interested: boolean | null = null;
                      if (interestedKeywords.some(kw => lowerText.includes(kw))) {
                        interested = true;
                      } else if (notInterestedKeywords.some(kw => lowerText.includes(kw))) {
                        interested = false;
                      }
                      callInterested = interested;

                      try {
                        void transitionLeadsByPhone(customerPhone, STATUS.ANSWERED, {
                          interested,
                          lastResponse: userText,
                        }).then(async (r) => {
                          console.log(`[DB] First response tracked for ${customerPhone}: answered (interested=${interested}) rows=${r.count}`);
                          if (interested === true) {
                            const outcome = await markOutcomeByPhone(customerPhone, STATUS.INTERESTED, {
                              interested: true,
                              lastResponse: userText,
                            });
                            console.log(`[DB] Marked looking for lead rows=${outcome.count}`);
                          } else if (interested === false) {
                            const outcome = await markOutcomeByPhone(customerPhone, STATUS.NOT_INTERESTED, {
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
                      const closingSpoken =
                        hasThanksClosing(currentTurnAiText) ||
                        hasThanksClosing(lastPlayedAiRaw) ||
                        outboundThanksSpoken;

                      const endGuard = shouldAllowEndCall({
                        callDurationMs: Date.now() - startTime,
                        customerClearGoodbye,
                        customerUtteranceCount,
                        batchHasNotInterested,
                        isOutbound: isOutboundCall,
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
                        console.warn('[GUARD] Blocked outbound endCall — no Thanks in closing line yet');
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            message:
                              'Say "Thank you." to the customer ONCE only — do not repeat it. ' +
                              'Then call endCall in the same turn.',
                          },
                          id: call.id,
                        });
                        if (!outboundThanksNudgeSent && !outboundThanksSpoken && !outboundHardMuteAfterClose) {
                          outboundThanksNudgeSent = true;
                          try {
                            geminiSession?.sendRealtimeInput({ text: OUTBOUND_THANKS_BEFORE_END_NUDGE });
                          } catch (e: any) {
                            console.error('[GEMINI] Thanks-before-end nudge failed:', e?.message || e);
                          }
                        } else if (outboundThanksSpoken) {
                          void completeAndHangupOutboundCall('endCall after thanks already spoken');
                        }
                        continue;
                      }

                      console.log(`[GEMINI] End call tool allowed (${endGuard.reason}). Terminating call...`);
                      if (isOutboundCall) {
                        await new Promise((r) => setTimeout(r, 200));
                        await completeAndHangupOutboundCall(`endCall tool (${endGuard.reason})`);
                        continue;
                      }

                      endCallInvoked = true;

                      const otherTools = response.toolCall.functionCalls.filter(
                        (c: any) => c.name !== "endCall" && c.name !== "notInterested",
                      );
                      if (otherTools.length > 0) {
                        console.log("[GEMINI] endCall skipped because other tools are present:", otherTools.map((t: any) => t.name));
                        endCallInvoked = false;
                        toolResponses.push({ name: call.name, response: { success: false, message: "Please complete other actions before ending the call." }, id: call.id });
                        continue;
                      }

                      if (customerPhone) {
                        try {
                          // Conversation finished → call completed, then promote
                          // to a known outcome from the interested flag when set.
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
                          console.error("[DB Error] Failed to mark call completed:", e);
                        }
                      }
                      hangupStream();
                      geminiSession?.close();
                      ws.close();
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

                    if (call.name === "bookAppointment") {
                      const { dateTime } = call.args;
                      console.log(`[GEMINI] Booking appointment for ${dateTime}`);
                      if (!customerPhone) {
                        toolResponses.push({ name: call.name, response: { success: false, error: "No phone number on file for this call — could not save the appointment. Ask the customer to confirm their number, or let them know the sales team will follow up to confirm the booking." }, id: call.id });
                        continue;
                      }
                      try {
                        let parsedDate = new Date(dateTime);

                        if (isNaN(parsedDate.getTime())) {
                          console.error(`[GEMINI] Invalid date format provided: ${dateTime}`);
                          toolResponses.push({
                            name: call.name,
                            response: {
                              success: false,
                              error: "Invalid date format. Please provide a valid ISO 8601 date string (YYYY-MM-DDTHH:mm:ss). Site visits are preferably scheduled between 10:00 AM and 5:30 PM. Please re-book within 10:00–17:30 IST."
                            },
                            id: call.id
                          });
                          continue;
                        }

                        const hours = parsedDate.getHours();
                        const minutes = parsedDate.getMinutes();
                        const minutesOfDay = hours * 60 + minutes;
                        // Project-Specific Content: preferred site-visit window 10:00 AM – 5:30 PM
                        const WINDOW_START_MIN = 10 * 60;
                        const WINDOW_END_MIN = 17 * 60 + 30;
                        const outsideWindow = minutesOfDay < WINDOW_START_MIN || minutesOfDay > WINDOW_END_MIN;

                        if (outsideWindow) {
                          console.warn(`[GEMINI] Appointment time ${dateTime} is OUTSIDE 10:00–17:30 site-visit window. Rejecting.`);
                          toolResponses.push({
                            name: call.name,
                            response: {
                              success: false,
                              error: `Requested appointment time (${parsedDate.toLocaleTimeString('en-IN')}) is outside our preferred site visit window of 10:00 AM to 5:30 PM (office hours are 10:00 AM to 7:00 PM). Please ask the customer for a new time between 10:00 AM and 5:30 PM on the same day or another day.`
                            },
                            id: call.id
                          });
                          continue;
                        }

                        const r = await markOutcomeByPhone(customerPhone, STATUS.VISIT_SCHEDULED, {
                          appointmentTime: parsedDate,
                          interested: true,
                        });
                        console.log(`[DB] Appointment booked for ${customerPhone} at ${dateTime} rows=${r.count}`);
                        toolResponses.push({ name: call.name, response: { success: true, message: `Appointment booked for ${dateTime} (within preferred site-visit window 10:00 AM–5:30 PM). Status updated to visit scheduled.` }, id: call.id });
                      } catch (e) {
                        console.error("[DB Error] Failed to book appointment:", e);
                        toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                      }
                      continue;
                    }

                    if (call.name === "setFollowUp") {
                      const { reason } = call.args;
                      console.log(`[GEMINI] Setting follow up for ${reason}`);
                      if (!customerPhone) {
                        toolResponses.push({ name: call.name, response: { success: false, error: "No phone number on file for this call — could not save the follow-up." }, id: call.id });
                        continue;
                      }
                      try {
                        const r = await markOutcomeByPhone(customerPhone, STATUS.FOLLOW_UP, {
                          interested: true,
                        });
                        console.log(`[DB] Follow up set for ${customerPhone} (Reason: ${reason}) rows=${r.count}`);
                        toolResponses.push({ name: call.name, response: { success: true, message: `Follow up set. Status updated to follow up.` }, id: call.id });
                      } catch (e) {
                        console.error("[DB Error] Failed to set follow up:", e);
                        toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                      }
                      continue;
                    }

                    if (call.name === "setName") {
                      const {
                        name,
                        title,
                        maritalStatus,
                        preferFirstNameOnly,
                      } = call.args as {
                        name: string;
                        title?: string;
                        maritalStatus?: string;
                        preferFirstNameOnly?: boolean;
                      };
                      const proposed = String(name || '').trim();
                      const recent = `${lastCustomerTranscript}\n${fullTranscription}`.toLowerCase();
                      const nameHeard =
                        proposed.length >= 2 && recent.includes(proposed.toLowerCase());
                      if (!nameHeard) {
                        console.warn(
                          `[GUARD] setName rejected — "${proposed}" not clearly heard from customer`,
                        );
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            message:
                              'Only call setName when the customer clearly stated their name in this call. Do not guess names.',
                          },
                          id: call.id,
                        });
                        continue;
                      }
                      console.log(`[GEMINI] Setting name to ${proposed} title=${title || ''} marital=${maritalStatus || ''}`);
                      customerIdentity = resolveCustomerIdentity({
                        rawName: proposed,
                        source: 'user_spoken',
                        explicitTitle: title ?? null,
                        maritalStatus:
                          maritalStatus === 'married' || maritalStatus === 'unmarried'
                            ? maritalStatus
                            : null,
                        preferFirstNameOnly: preferFirstNameOnly === true,
                        previous: customerIdentity,
                      });
                      const saveName =
                        customerIdentity.customer_name_normalized || String(name).trim();
                      // Push canonical identity so TTS/prompt layers do not re-guess gender.
                      try {
                        const identityNote = formatIdentityContext(customerIdentity);
                        if (typeof geminiSession.sendClientContent === 'function') {
                          geminiSession.sendClientContent({
                            turns: [{ role: 'user', parts: [{ text: identityNote }] }],
                            turnComplete: false,
                          });
                        } else if (geminiSession) {
                          geminiSession.sendRealtimeInput({ text: identityNote });
                        }
                      } catch (idErr) {
                        console.error('[GEMINI] Failed to push identity context:', idErr);
                      }
                      if (!customerPhone) {
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: true,
                            message: `Name noted as ${saveName} (no phone on file — session only).`,
                            identity: {
                              formal_display_name: customerIdentity.formal_display_name,
                              spoken_address: customerIdentity.spoken_address,
                              customer_salutation: customerIdentity.customer_salutation,
                              customer_gender: customerIdentity.customer_gender,
                            },
                          },
                          id: call.id,
                        });
                        continue;
                      }
                      const cleanPhone = customerPhone.replace(/\D/g, '');
                      try {
                        await prisma.lead.updateMany({
                          where: { phone: { contains: cleanPhone.slice(-10) } },
                          data: { name: saveName },
                        });
                        console.log(
                          `[DB] Name updated for ${customerPhone}: ${saveName} | ` +
                            `display=${customerIdentity.formal_display_name} spoken=${customerIdentity.spoken_address}`,
                        );
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: true,
                            message: `Name updated to ${saveName}. Formal: ${customerIdentity.formal_display_name}. Spoken: ${customerIdentity.spoken_address}.`,
                            identity: {
                              formal_display_name: customerIdentity.formal_display_name,
                              spoken_address: customerIdentity.spoken_address,
                              customer_salutation: customerIdentity.customer_salutation,
                              customer_gender: customerIdentity.customer_gender,
                            },
                          },
                          id: call.id,
                        });
                      } catch (e) {
                        console.error("[DB Error] Failed to update name:", e);
                        toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                      }
                      continue;
                    }

                    console.warn(`[GEMINI] Unhandled tool call reached fallback: ${call.name}`);
                    toolResponses.push({ name: call.name, response: { success: true }, id: call.id });
                  }
                  geminiSession.sendToolResponse({ functionResponses: toolResponses });
                }
              },
              onclose: async (event: any) => {
                console.log("[GEMINI] Session closed. Reason:", event?.reason || "No reason provided", "Code:", event?.code);
                if (!endCallInvoked) {
                  console.warn(
                    '[GEMINI] Unexpected session close mid-call — phone line stays open. ' +
                      'Customer may hear silence until they hang up.',
                  );
                }
                const duration = Math.round((Date.now() - startTime) / 1000);

                if (duration > 3 && customerPhone) {
                  const cleanPhone = customerPhone.replace(/\D/g, '');
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
        };

        const MAX_GEMINI_CONNECT_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_GEMINI_CONNECT_ATTEMPTS; attempt++) {
          try {
            if (attempt > 1) {
              console.warn(`[GEMINI] Retrying live connect (${attempt}/${MAX_GEMINI_CONNECT_ATTEMPTS})...`);
              await new Promise((r) => setTimeout(r, 1200 * (attempt - 1)));
            }
            localSession = await ai.live.connect(geminiConnectOptions);
            break;
          } catch (err) {
            console.error(`[GEMINI] Connect attempt ${attempt} failed:`, err);
            if (attempt === MAX_GEMINI_CONNECT_ATTEMPTS) {
              callLog('ERROR', `GEMINI CONNECT FAILED: ${err instanceof Error ? err.message : String(err)}`);
              capture?.onSttError('Gemini live connect failed');
              console.warn('[GEMINI] Keeping phone line open — will NOT hang up on connect failure.');
              return;
            }
          }
        }

        if (!localSession) {
          console.warn('[GEMINI] No live session — keeping phone line open.');
          return;
        }

        geminiSession = localSession;
        trySendOpening();

        capture = new CallCaptureSession({
          streamSid,
          phone: customerPhone,
          outbound: isOutboundCall,
        });

        if (customerPhone) {
          void markAnsweredByPhone(customerPhone)
            .then((r) => console.log(`[DB] Stream start → answered updated=${r.count}`))
            .catch((e) => console.error('[DB] mark answered failed:', e));
        }

        liveDataPromise.then((liveData) => {
          if (!liveData) {
            console.warn("[GEMINI] Live site data unavailable or timed out — continuing with static layout list only.");
            return;
          }
          pendingLiveData = liveData;
          if (greetingAudioHeard || deferredContextScheduled) {
            injectLiveDataIfReady();
          }
        });

      } else if (msg.event === 'media') {
        try {
          const muLawData = Buffer.from(msg.media.payload, "base64");
          capture?.onCustomerMuLaw(muLawData);
          if (!geminiSession) return;
          // Outbound: agent speaks first — do not send caller audio to Gemini until opening finishes.
          if (isOutboundCall && !openingGreetingTurnFinished) return;
          // Do NOT reset wait/silence timers on raw media — fan/TV/keyboard must
          // not count as a customer response. Only meaningful STT does.
          const sampleCount = muLawData.length;
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

          // 2) Adaptive noise-floor: track background quickly; during AI playback
          //    raise floor on steady non-speech (TV / fan) so it does not open the gate.
          const aiPlaying = now < aiPlaybackEndsAt;
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

          // 3) Gate: speech-like opens (quiet voice); steady loud noise alone does not.
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
          // Full gain to Gemini always — ducking quiet caller audio hurt STT.
          // Gate / speech-like metrics are for local barge-in and VAD only.
          const effectiveGain = inputGain;

          // 4) Gain + 8k→16k upsample via linear interpolation into
          //    preallocated scratch (duplication added imaging artifacts that
          //    hurt recognition in noise; interpolation is one add per sample).
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
            // Forwarded immediately — one packet in, one packet out, no
            // utterance buffering anywhere on this path.
            geminiSession.sendRealtimeInput({
              audio: {
                data: pcmBuffer.subarray(0, sampleCount * 4).toString("base64"),
                mimeType: 'audio/pcm;rate=16000',
              }
            });

            // Local barge-in: sustained speech-like voice well above floor — not TV/fan.
            const bargeInRms = Math.max(BARGE_IN_MIN_RMS, noiseFloorRms * BARGE_IN_FLOOR_MULT);
            const bargeDecision = speechLike
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
              resetSpeakNudge();
              capture?.onCustomerSpeakStart();
              console.log(
                `[VAD] Customer speech START rms=${rms.toFixed(0)} thr=${vadEnergyThr.toFixed(0)} floor=${noiseFloorRms.toFixed(0)}`
              );
              customerStartedAnsweringOpening();
              latLog('AUDIO_IN (customer speech start)');
              // Pause availability deadlines while local VAD hears speech energy
              // (STT still owns resetting wait state — noise alone won't clear it).
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
              console.log(
                `[VAD] Customer speech END after ${speechDecision.pausedFor}ms silence (vadSilenceMs=${VAD_SILENCE_MS} aadSilenceMs=${audioCfg.aadSilenceDurationMs})`
              );
              latLog('GEMINI_AUDIO_SENT (local speech end; AAD owns turn commit)');
              nudgeSpeakNowIfNeeded();
              armResponseWatchdog();
              // If STT never arrived (noise spike), keep waiting from a fresh silence clock
              // unless the customer already requested an explicit wait window.
              if (
                waitingState.is_waiting &&
                waitingState.reason !== 'customer_requested_wait'
              ) {
                waitingState = beginWaitingForCustomer(waitingState, Date.now());
                scheduleWaitTick();
              } else if (waitingState.reason === 'customer_requested_wait') {
                scheduleWaitTick();
              }
            } else if (speechDecision.event === 'none') {
              vadIsSpeaking = speechDecision.vadIsSpeaking;
              vadSilenceStartedAt = speechDecision.silenceStartedAt;
            }
          } catch (e: any) {
            console.error("[GEMINI] Failed to send audio:", e.message);
            capture?.onSttError(e.message || 'audio send failed');
          }
        } catch (decodeErr: any) {
          callLog('ERROR', `INVALID AUDIO PACKET: ${decodeErr?.message || decodeErr}`);
        }
      } else if (msg.event === 'stop') {
        process.stdout.write('\n[WS] Call stopped by Twilio/Plivo\n');
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
    clearWaitTick();
    if (outboundOpeningWaitTimer) clearTimeout(outboundOpeningWaitTimer);
    if (outboundThanksHangupTimer) clearTimeout(outboundThanksHangupTimer);
    if (openingGraceTimer) clearTimeout(openingGraceTimer);
    void capture?.finalize();
    capture = null;
    geminiSession?.close();
  });
}