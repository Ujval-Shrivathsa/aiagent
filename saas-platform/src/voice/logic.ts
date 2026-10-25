import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import {
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  buildOutboundProjectReferenceContext,
  getOutboundGreetingInstruction,
  PDF_OPENING_KN,
  PDF_OPENING_EN,
  PDF_AREAS_LINE_KN,
  PDF_AREAS_LINE_EN,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE,
  buildOutboundHandoffTransferNudge,
  buildOutboundCallbackTimeNudge,
  buildOutboundCallbackOutsideWindowNudge,
  PDF_THANKS_CLOSE_KN,
  PDF_INTERESTED_CLOSE_KN,
  PDF_INTERESTED_CLOSE_EN,
  CALLBACK_OUTSIDE_WINDOW_LINE_KN,
  OUTBOUND_NO_REPEAT_NUDGE,
  looksLikeRepeatRequest,
  looksLikeRepeatLastLine,
  routeCallerQuestion,
  sideQuestionsMoveToClose,
  buildRepeatLastLineTurn,
  buildSideAnswerTurn,
  buildCallbackLaterTurn,
  looksLikeNameClarification,
  looksLikeThanksOnlyLine,
  looksLikeClosingGoodbye,
  isRedundantOutboundThanksTurn,
  looksLikeOpeningRestate,
  hasThanksClosing,
  looksLikeCustomerBusy,
  looksLikeAreasLine,
  looksLikeHandoffLine,
  looksLikeNotInterestedCloseLine,
  looksLikeEchoConfirmQuestion,
  looksLikeFutureSitePitch,
  looksLikeStutteredClose,
  shouldDropRepeatedThanksInTurn,
  looksLikeCantHearLine,
  extractCallerName,
  looksLikeAnswerToSiteQuestion,
  OUTBOUND_THANKS_FALLBACK_NUDGE,
  OUTBOUND_CLEAN_CLOSE_NUDGE,
  buildOutboundRepeatQuestionNudge,
  buildOutboundLocationInterestNudge,
  detectOutboundLocality,
  OUTBOUND_CANNOT_ANSWER_NUDGE,
  OUTBOUND_SILENCE_GOODBYE_NUDGE,
  OUTBOUND_SILENCE_CHECK_NUDGE,
  looksLikeCannotAnswerLine,
  OUTBOUND_NOT_INTERESTED_CLOSE_KN,
  SILENCE_GOODBYE_LINE_KN,
  looksLikeSilenceCheckEcho,
  looksLikeSpokenNameQuestion,
  nameQuestionAudioGate,
  promptLeaksNameQuestionExample,
  OUTBOUND_SILENCE_CANCELLED_NUDGE,
  shouldHoldSilenceClose,
  shouldCancelPendingSilenceClose,
  SILENCE_CLOSE_AFTER_CHECK_MS,
  createOutboundSilenceState,
  armOutboundSilenceCheck,
  resetOutboundSilence,
  tickOutboundSilence,
  nextOutboundSilenceDeadline,
  postThanksHangupAction,
  OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS,
  type OutboundSilenceState,
  allowedLayoutsList,
  detectForbiddenLayoutMention,
} from '../voice/kannada-script';
import {
  agentToldCallerToRepeat,
  callerReallyInterrupted,
  reviewCallerTurn,
} from './turn-verifier';
import {
  allowsRepeatReplay,
  isDuplicateOutboundSpeech,
  repeatsSentenceWithinTurn,
  registerOutboundSpeech,
} from '../voice/outbound-dedup';
import { CallCaptureSession } from '../voice/call-capture/session';
import { forwardFrameToModel } from './noise-duck';
import { callLog } from '../voice/call-capture/logger';
import { loadAudioPipelineConfig } from '../voice/audio-pipeline-config';
import { takeCachedOutboundOpeningInstruction } from '../voice/opening-prewarm-cache';
import {
  buildLiveSpeechConfig,
  buildLiveVoiceBehaviorConfig,
  describeSpeechConfig,
  loadLiveSpeechSettings,
} from '../voice/tts/speech-config';
import { detectScriptLanguage } from '../voice/language/script-detect';
import {
  followLanguageFromUtterance,
  languageFollowSystemPrompt,
  ttsLanguageFor,
  createLanguageSwitchState,
  type LanguageSwitchState,
  type FollowLanguage,
} from '../voice/language/language-follow';
import { evaluateBargeIn, evaluateLocalSpeech, greetingListenOpen, mayClearCallerAudio } from '../voice/turn-policy';
import {
  buildRecallContext,
  createCallMemory,
  rememberAgentLine,
  rememberCallerLine,
  setCallStep,
  setKnownCaller,
} from './call-memory';
import {
  acknowledgementPoolFor,
  acknowledgementSeed,
  buildToneDirective,
  chooseListeningBeat,
  createRecentSpoken,
  DEFAULT_ACK_WORD_KN as DEFAULT_ACK_WORD,
  detectCallerSignal,
  pickUnspoken,
} from './conversation-naturalness';
import {
  absorbVolunteeredNeeds,
  buildNeedQuestionNudge,
  buildNeedQuestionRetryNudge,
  buildNeedsContext,
  createNeedsChecklist,
  markNeedAsked,
  needsAnswer,
  needsPersistFields,
  needsSummaryLine,
  nextUnaskedNeed,
  recordNeedAnswer,
  type NeedId,
  type NeedsChecklist,
} from './needs-checklist';
import {
  createCallTelemetry,
  opaqueCallId,
  publishCall,
  recordAck,
  recordAgentTurn,
  recordBargeIn,
  recordCallerSpeechEnd,
  recordEnd,
  recordLanguageSwitch,
  recordLateReplyRescue,
  recordRepair,
  recordSilenceCheck,
  summarize,
} from './call-telemetry';
import {
  parseCallbackTime,
  spokenTimeLabel,
  looksLikeCallbackTimeRequest,
  requestedMinutesOfDay,
  isWithinCallbackWindow,
  CALLBACK_WINDOW_LABEL,
} from '../voice/callback-time';
import {
  analyzePcmFrame,
  classifyFrame,
  createSpeechGateState,
  updateSpeechGate,
  nextNoiseFloorRms,
  DEFAULT_NOISE_FLOOR,
  DEFAULT_SPEECH_CLASSIFY,
  DEFAULT_SPEECH_GATE,
  type NoiseFloorConfig,
  type SpeechClassifyConfig,
} from '../voice/speech-likelihood';
import {
  armBargeReplyRecovery,
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
  isLikelySttNoise,
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
// Exported for tests: the CallUUID capture here is what makes the remote
// hangup possible, and it silently regressed once already.
export function normalizeVoiceEvent(raw: any): any {
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
      // The bare Plivo CallUUID, kept separate from callSid: callSid falls back
      // to the stream id, and the hangup API needs the real CallUUID.
      // Plivo's start event names it `callId` — without that key here the UUID
      // was never captured and the call could never be hung up remotely.
      callUuid: start.CallUUID || start.callUuid || start.callId || start.callSid || '',
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
    "YOU END THIS CALL. Call endCall only after the whole closing sentence has been spoken in this turn. " +
    "The line stays up until that sentence finishes playing. Never call endCall on a yes by itself. " +
    "Call it when: (1) the caller clearly said goodbye / asked to end, " +
    "(2) the caller confirmed they are not interested (after the notInterested close line), " +
    "(3) the caller is interested in a location and you JUST spoke the sales-team closing line " +
    "('the sales team will call you') plus the thank-you line, or " +
    "(4) the caller has not answered your 'are you still there?' check and is still silent. " +
    "'Thank you' is spoken at most ONCE per call. " +
    "A yes ends on '" + PDF_THANKS_CLOSE_KN + "' together with the sales-manager line. " +
    "A no ends on '" + OUTBOUND_NOT_INTERESTED_CLOSE_KN + "'. " +
    "That close is the LAST thing you say: say it ONCE, then call endCall in that same turn. " +
    "NEVER end the call because of a short pause, a short reply, or a topic change — that is not a close.",
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

/**
 * Records the callback window the caller agreed to. The sales team is reachable
 * 10am–7pm only, so this is how the promise becomes something the team can
 * actually act on instead of living only in a recording.
 *
 * `timeOfDay` is 24-hour "HH:MM" because a 12-hour string is ambiguous without
 * a reliable meridiem from the model; `day` is kept to today/tomorrow because
 * that is the only range this flow promises.
 */
const SET_CALLBACK_TIME_TOOL = {
  name: "setCallbackTime",
  description:
    "Record the callback time the customer agreed to. ONLY call this for a time inside " +
    "10am-7pm that the customer actually agreed to. If the customer asks for a time outside " +
    "10am-7pm, do NOT call this — tell them the time is not possible, that the sales team is " +
    "available 10am to 7pm, and offer another day or a call soon. Do not call this if they " +
    "gave no specific time.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      day: {
        type: Type.STRING,
        enum: ["today", "tomorrow"],
        description: "Which day they asked for.",
      },
      timeOfDay: {
        type: Type.STRING,
        description: "24-hour local time they agreed to, HH:MM, between 10:00 and 19:00.",
      },
    },
    required: ["timeOfDay"],
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

export async function setupGemini(
  ws: WebSocket,
  streamParams?: URLSearchParams,
  connection?: { publicBaseUrl?: string },
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  let audioSink: 'twilio' | 'plivo' = (process.env.VOICE_PROVIDER || 'twilio').toLowerCase() === 'plivo' ? 'plivo' : 'twilio';
  // The PUBLIC origin of THIS websocket handshake, e.g. https://priya-voice-agent.onrender.com.
  // The hangup API hands Plivo a URL (aleg_url) that Plivo then fetches, so it
  // must be the address Plivo can actually reach. Trusting an env var alone
  // left the hangup dead whenever VOICE_SERVER_URL was unset or stale in the
  // Render dashboard, and nothing in the call flow revealed it. The Host /
  // X-Forwarded-Proto of the handshake are always correct, so the env var is
  // now only a fallback.
  let handshakeBase = (connection?.publicBaseUrl || '').replace(/\/$/, '');
  let streamSid: string | null = null;
/** Real Plivo CallUUID (not the stream id) — required to hang the call up. */
let plivoCallUuid: string | null = null;
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
  // The sales script below is outbound only. An inbound stream is refused.
  let isOutboundCall = false;
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
  /**
   * How many times THIS silence cycle has held its window because the caller was
   * speaking. A count, not a one-shot flag: the tick runs again after every hold,
   * and the single grace window meant a caller who answered at 3–5s spent it and
   * was then talked over by the next tick.
   */
  let outboundSilenceDefers = 0;
  /** When the silence goodbye was sent — a late caller reply cancels this close. */
  let outboundSilenceGoodbyeSentAt = 0;
  /**
   * Last time the LOCAL VAD saw the caller produce a turn (start or end). The
   * transcript lags the audio by a beat, so this is the only signal available
   * in the gap between "the caller stopped talking" and "their words arrived".
   */
  let lastCallerVoiceAt = 0;
  /** When the caller's current speech span began (for speech-duration telemetry). */
  let callerVoiceSpanStartedAt = 0;
  /** Timestamp of the caller's last transcript — diagnostics + quiet-window math. */
  let lastCustomerTranscriptAt = Date.now();
  /**
   * Per-call telemetry. Counts and millisecond latencies only — no name, no
   * number, no transcript (see call-telemetry.ts). It exists so "she was silent
   * after my name" and "she talked over me" stop being opinions: every repair,
   * barge-in, silence recovery and late-reply rescue is now countable, and the
   * summary is published on the existing read-only diagnostic endpoint.
   */
  let telemetry = createCallTelemetry(opaqueCallId(null), Date.now());
  /** When the caller's last confirmed speech span ENDED — the latency origin. */
  let callerSpeechEndedAt = 0;
  /** When the current agent turn's first audio byte was written to the caller. */
  let agentTurnFirstAudioAt = 0;
  /** When the CURRENT model turn's audio began — echo-safe interrupt proof window. */
  let currentModelTurnStartedAt = 0;
  // Set once ANY flowchart close line (not-interested / silence timeout) is delivered —
  // the agent is then hard-muted and the call hangs up.
  let outboundBusyCloseSent = false;
  const audioCfg = loadAudioPipelineConfig();
  const ttsSettings = loadLiveSpeechSettings();
  /** LANGUAGE FOLLOW — Kannada default; follows the caller's actual language. */
  let languageSwitchState: LanguageSwitchState = createLanguageSwitchState();
  // null = send NO languageCode. Kannada has no documented Live locale, so the
  // native-audio model detects it from the script (see tts/speech-config.ts).
  let activeTtsLanguageCode: string | null =
    ttsSettings.languageCode ?? ttsLanguageFor(languageSwitchState.language);
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
  // Classification-driven floor adaptation (see speech-likelihood.ts):
  // sustained noise converges fast, transients barely move the floor, and
  // SPEECH never raises it (the old fixed-rate blend was the scream-trap).
  const FLOOR_CFG: NoiseFloorConfig = {
    ...DEFAULT_NOISE_FLOOR,
    steadyRate: audioCfg.floorSteadyRate,
    transientRate: audioCfg.floorTransientRate,
    aiPlayingSteadyRate: audioCfg.floorAiPlayingSteadyRate,
    aiPlayingTransientRate: audioCfg.floorAiPlayingTransientRate,
    speechRate: audioCfg.floorSpeechRate,
    quietPullMult: audioCfg.floorQuietPullMult,
    quietPullRate: audioCfg.floorQuietPullRate,
    min: NOISE_FLOOR_MIN,
    max: NOISE_FLOOR_MAX,
  };
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
  // When the LAST piece of agent audio was written to the caller. The
  // post-thanks hangup needs this to tell "the audio has finished" from "the
  // transcript got here first and the rest of the sentence is still arriving".
  let lastAiAudioAt = 0;
  /** Last frame with speech-like energy — stuck-VAD self-heal uses this. */
  let lastSpeechEnergyAt = 0;
  let bargeInStartedAt: number | null = null;
  let bargeInConfirmedAt = 0;
  /** Set when the caller actually cuts the agent off. Cleared once we arm the reply. */
  let oweBargeReply = false;
  const BARGE_IN_CONFIRM_TTL_MS = 2000;
  const BARGE_IN_MIN_RMS = audioCfg.bargeInMinRms;
  const BARGE_IN_FLOOR_MULT = audioCfg.bargeInFloorMult;
  const BARGE_IN_MIN_MS = audioCfg.bargeInMinMs;
  const BARGE_IN_REQUIRE_GATE = audioCfg.bargeInRequireGateOpen;
  // Speech-first frame classification config (positive evidence required —
  // see speech-likelihood.ts). Replaces the old crest/ZCR-only isSpeechLike.
  const CLASSIFY_CFG: SpeechClassifyConfig = {
    ...DEFAULT_SPEECH_CLASSIFY,
    speechScoreMin: audioCfg.speechScoreMin,
    ambiguousScoreMin: audioCfg.speechAmbiguousScoreMin,
    maxLowEnergyRatio: audioCfg.speechMaxLowEnergyRatio,
    maxFlatnessSpeech: audioCfg.speechMaxFlatness,
    silentFloorMult: audioCfg.speechSilentFloorMult,
  };
  // Debounced gate: N consecutive speech-class frames required to START a
  // caller turn — single noisy frames (door, keyboard, loud packet) can no
  // longer fire USER_SPEAKING.
  const GATE_CFG = {
    ...DEFAULT_SPEECH_GATE,
    startConsecutiveMs: audioCfg.speechGateStartMs,
    candidateWindowMs: audioCfg.speechGateWindowMs,
    speakingToleranceMs: audioCfg.speechGateSpeakingToleranceMs,
  };
  let speechGate = createSpeechGateState();
  let sustainedNoiseFrames = 0;
  let lastClassLogAt = 0;
  let lastClassCounts = { speech: 0, ambiguous: 0, noise: 0, silent: 0 };
  /** Caller frames replaced with digital silence before reaching Gemini. */
  let duckedNoiseFrames = 0;
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
  /** Output transcripts arrive one word at a time. The locations line only matches once they are joined. */
  let outboundAiAccum = '';
  /** The prompt or nudge most recently sent to the model, for the name-gate log. */
  let lastModelPrompt = '(none yet)';
  const noteModelPrompt = (text: string) => {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    if (!flat) return;
    lastModelPrompt = flat.slice(0, 180);
  };
  const logNameGate = (outcome: 'played' | 'dropped', text: string) => {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    if (!flat) return;
    const matched =
      looksLikeSpokenNameQuestion(flat) || looksLikeSpokenNameQuestion(outboundAiAccum);
    const shown = flat.replace(/"/g, "'").slice(0, 300);
    const prompt = lastModelPrompt.replace(/"/g, "'");
    console.log(`[NAME-GATE] ${outcome} matched=${matched} text="${shown}" prompt="${prompt}"`);
  };
  const rememberModelPrompt = (session: any) => {
    if (!session || session.__nameGateWrapped) return session;
    const origRealtime =
      typeof session.sendRealtimeInput === 'function' ? session.sendRealtimeInput.bind(session) : null;
    const origClient =
      typeof session.sendClientContent === 'function' ? session.sendClientContent.bind(session) : null;
    if (origRealtime) {
      session.sendRealtimeInput = (payload: any) => {
        if (payload && typeof payload.text === 'string') noteModelPrompt(payload.text);
        return origRealtime(payload);
      };
    }
    if (origClient) {
      session.sendClientContent = (payload: any) => {
        const t = payload?.turns?.[0]?.parts?.[0]?.text;
        if (typeof t === 'string') noteModelPrompt(t);
        return origClient(payload);
      };
    }
    session.__nameGateWrapped = true;
    return session;
  };
  /**
   * True once a PLAYED turn actually carried the projects line. Delivered means
   * the engine SENT the nudge; heard means the caller got it. The difference is
   * what keeps a dropped name-step turn from skipping the caller past the
   * projects and straight into the close.
   */
  let outboundAreasLineHeard = false;
  let outboundHandoffNudgeSent = false;
  let outboundNotInterestedNudgeSent = false;
  let outboundYesAskNameNudgeSent = false;
  let outboundLocationsNudgeSent = false;
  /** Callback-time handling: at most one confirm and one refusal per call. */
  let outboundCallbackTimeNudgeSent = false;
  let outboundCallbackRefusedNudgeSent = false;
  /**
   * The agreed callback time has already been written to the lead record.
   *
   * The model does not reliably emit setCallbackTime even when it agrees to the
   * time out loud, so the engine — which detected the request and checked the
   * window itself — writes it directly. Without this the customer hears a
   * promise ("we'll call at 7") that the sales team never receives.
   */
  let outboundCallbackPersisted = false;
  let outboundCallbackPersistedAt: Date | null = null;

  /**
   * Write an agreed, window-checked callback time to the lead record. Called
   * from the code path that CONFIRMS the time, so the promise the customer
   * hears is always backed by a record — the model's setCallbackTime tool call
   * is a backstop, not the only way this gets saved.
   */
  const persistAgreedCallbackTime = async (at: Date, lastResponse: string) => {
    if (outboundCallbackPersisted) return;
    outboundCallbackPersisted = true;
    outboundCallbackPersistedAt = at;
    if (!customerPhone) {
      console.warn('[DB] No phone on file — callback time not stored');
      return;
    }
    try {
      const r = await transitionLeadsByPhone(customerPhone, STATUS.INTERESTED, {
        interested: true,
        appointmentTime: at,
        lastResponse,
      });
      console.log(`[DB] Callback time stored from engine rows=${r.count} at=${at.toISOString()}`);
      diagLog(`callback stored (engine) rows=${r.count}`);
    } catch (e: any) {
      console.error('[DB Error] Failed to store callback time:', e?.message || e);
      // Allow the model's own tool call to retry rather than leaving it lost.
      outboundCallbackPersisted = false;
    }
  };
  /** First name used to address the caller once they state it ("{name} ಸರ್"). */
  // (outboundCallerFirstName removed — no name step in the final flow.)
  let outboundTransferStarted = false;
  let outboundCallUuid: string | null = null;
  let outboundThanksSpoken = false;
  let outboundNoRepeatNudgeSent = false;
  let outboundThanksHangupTimer: NodeJS.Timeout | null = null;
  /**
   * The sales-team line and the thank-you sometimes arrive as TWO model turns.
   * Muting on the sales line alone swallowed the thank-you, leaving the caller
   * on a dead-but-open line while the model improvised a sign-off. So when the
   * close is incomplete we do NOT mute — we FORCE the missing thank-you once and
   * keep an absolute deadline that ends the call no matter what.
   */
  let outboundThanksFallbackSent = false;
  let outboundThanksFallbackTimer: NodeJS.Timeout | null = null;
  /** The close was stuttered and replaced with one clean close — only once. */
  let outboundCleanCloseSent = false;
  /**
   * A thank-you has already been SPOKEN inside the CURRENT model turn.
   *
   * One Gemini turn streams as SEVERAL `modelTurn` messages and every one of
   * them plays its audio the moment it arrives, while the mute only arms on
   * `turnComplete`. So a turn of "ಧನ್ಯವಾದ ... ಧನ್ಯವಾದ ... ಧನ್ಯವಾದ" passed the
   * per-message stutter detector and the caller heard the thank-you three times.
   * This flag stops the second one dead.
   */
  let outboundThanksPlayedInTurn = false;
  /** Name flow: asked once, captured once, then addressed by name for the call. */
  let outboundNameAsked = false;
  let outboundNameQuestionCut = false;
  /** True only for the rest of a turn that asked the caller's name. Cleared on turnComplete so the next real line still plays. */
  let blockNameQuestionAudio = false;
  /** Audio held until the transcript shows this turn is not a name question. */
  let heldOutboundAudioParts: any[] = [];
  let nameGateTimer: ReturnType<typeof setTimeout> | null = null;
  /** The blocked turn never reached the locations line, so that line is sent once the name question has ended. */
  let nameQuestionNeedsRedirect = false;
  /** Set by the second-pass check. A repeat-ask from Priya is dropped unless the caller asked to hear the line. */
  let lastCallerIntent = 'other';
  let blockUnwantedRepeatAsk = false;
  let repeatAskCorrectionPending = false;
  let outboundCallerName: string | null = null;
  let outboundCallerHonorific = ''; // OWNER RULE: no title until a name is captured
  /**
   * ACKNOWLEDGEMENT SELECTOR. The business content of the name step is fixed —
   * ONE short Kannada word that carries the caller's name, then the areas line.
   * What was NOT fixed was WHICH word, so every call in every campaign got the
   * identical beat and that is exactly how a scripted agent sounds. This picks
   * from a small curated set, deterministically, and never hands back a phrase
   * already used on this call. If the set ever misbehaves, ACK_LEGACY_ONLY
   * pins the original single word — that is the rollback, not a code revert.
   */
  let outboundAckGuard = createRecentSpoken(4);
  let outboundAckCount = 0;
  const ACK_LEGACY_ONLY = /^(1|true|yes|on)$/i.test(
    String(process.env.OUTBOUND_ACK_LEGACY_ONLY || ''),
  );
  const nextAckWord = (): string => {
    // ROLLBACK SWITCH. If the curated set ever misbehaves on a live campaign,
    // OUTBOUND_ACK_LEGACY_ONLY=1 pins the owner's original single word on the
    // very next call — an env change, not a code revert, because this is a
    // production phone line and the fix has to be faster than a deploy.
    if (ACK_LEGACY_ONLY) return DEFAULT_ACK_WORD;
    // Rotated by this call's opaque id, so two different callers do not both
    // hear the same opening beat — while a single call stays fully
    // reproducible. See acknowledgementPoolFor: a fresh no-repeat guard alone
    // always returned the first phrase, which is how every call ended up
    // sounding templated while the tests stayed green.
    const chosen = pickUnspoken(
      outboundAckGuard,
      (v: string) => v,
      acknowledgementPoolFor(acknowledgementSeed(telemetry.callId)),
    );
    outboundAckGuard = chosen.guard;
    outboundAckCount += 1;
    telemetry = recordAck(telemetry, chosen.pick === DEFAULT_ACK_WORD && outboundAckCount > 1);
    return chosen.pick;
  };
  let outboundNamePersisted = false;
  let outboundNameDeclined = false;
  /** The ask → capture → site-question sequence has completed (once per call). */
  let outboundNameStepDone = false;
  /**
   * THE NEEDS CHECKLIST — the agent's to-do list for this call.
   *
   * The pinned five steps told the sales team WHO was interested and almost
   * nothing about WHAT the caller needs, so the employee had to re-ask the two
   * qualifying questions the caller had just answered to a machine. This state
   * holds those two answers (purpose, preferred locality) so they reach the lead
   * record and the dashboard instead of dying in a transcript.
   *
   * Every rule — never re-ask, skip what they volunteered, never block the
   * close, one question open at a time — lives as a pure helper in
   * needs-checklist.ts. This closure only decides WHEN to speak.
   */
  let needsChecklist: NeedsChecklist = createNeedsChecklist();
  /** The item we are waiting for an answer to, or null when nothing is open. */
  let openNeed: NeedId | null = null;
  /** Listening beats already used on this call — never the same sound twice. */
  const listeningBeatsUsed: string[] = [];
  /**
   * "I couldn't hear you" is said AT MOST ONCE per call. Poor transcription
   * re-armed the recovery ladder on every speech end, so the agent asked the
   * caller to repeat over and over and stopped listening. After the one ask we
   * simply keep listening and never nag again.
   */
  let outboundCantHearSaid = false;
  // OWNER DECISION 2: "I can't hear you" repeats the SAME question once, slower.
  // Sent at most once per call — a bad line must never become a repeat loop.
  let outboundRepeatAskSent = false;
  // OWNER DECISION 5: an answer Priya genuinely cannot give ends with the sales
  // team, offered once.
  let outboundCannotAnswerNudgeSent = false;
  // The last line we actually spoke, so a repeat can quote the SAME question
  // back instead of inventing a new one.
  let outboundLastSpokenLine = '';
  // The last CLOSE the agent actually spoke, read from the audio transcription.
  // The session is AUDIO-only, so the model turn carries no text and every
  // detector built on it saw an empty string — which is why the model's own
  // endCall was always rejected as "no close line delivered yet".
  let outboundSpokenCloseText = '';
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
  let pendingLocationsAfterGreeting = false;
  let playScriptAudioNow = false;
  let deferredContextScheduled = false;
  let greetingSentAt = 0;
  /** The question she is on. A repeat resends this; a side answer returns to it. */
  let lastPinnedSpokenLine = PDF_OPENING_KN;
  let sideQuestionCount = 0;
  let openingGreetingTurnFinished = false;
  /** Model finished generating the opening. Playback may still be running. */
  let openingTurnComplete = false;
  let greetingHoldStartedAt = 0;
  let greetingListenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Safety only: a greeting that never arrives must not leave the caller unheard. */
  const GREETING_LISTEN_HOLD_CAP_MS = 20_000;
  const GREETING_AUDIO_GIVE_UP_MS = 6_000;
  let runtimeInstructionsInjected = false;
  let greetingSent = false;
  let openingTurnSealed = false;
  /** True only after the site question itself has been played, not a prefix of it. */
  let openingQuestionAudioPlayed = false;
  /** True after the locations line's own turn has finished. Mid-line audio must not be dropped as a repeat. */
  let areasLineTurnSealed = false;
  const openingQuestionSpoken = (text: string) => /ನೋಡ.{0,16}ರಾ|looking for a site/i.test(text);
  /** Opening audio is held until the question is in it, then played as one piece. */
  let openingHold: Buffer[] = [];
  let openingReleased = false;
  let openingContinueSent = false;
  let locationsHold: Buffer[] = [];
  let locationsReleased = false;
  let locationsRetrySent = false;
  const locationsTextBad = (text: string) =>
    /ರಿಂಗ್|ಜೆ\s*ಪಿ|ಜೆಪಿ|ಇಲವಾಲ|ವಿಜಯ|ಬೋಗಾದಿ|ದತ್ತ|ದಟ್ಟ|ಪ್ಲಾಟ್|ಬಡಾವಣೆ|ಹೂಟ|[A-Za-z]{3,}|ring road|jp nagar/i.test(text);
  const locationsTextReady = (text: string) => {
    const s = text.replace(/[\s\u200c\u200d]/g, '');
    return (
      s.includes('ಹುಣಸೂರ') &&
      s.includes('ನರಸೀಪುರ') &&
      s.includes('ನಂಜನಗೂಡ') &&
      /ಓಕೆ|ಯಾವುದಾದರೂ/.test(s) &&
      !locationsTextBad(text)
    );
  };
  /** A real transcript that is not the three roads. An empty one is just late. */
  const locationsTextPartial = (text: string) =>
    text.replace(/[\s\u200c\u200d]/g, '').length >= 12 && !locationsTextReady(text);
  let openingQuestionSent = false;
  let fullCallGuideInjected = false;
  let geminiSessionOpened = false;
  /** True once ANY Gemini session has opened on this call (initial or reconnect). */
  let geminiEverConnected = false;
  let lastCustomerTranscript = '';
  /** What the caller has already said and heard — survives a Gemini reconnect. */
  let callMemory = createCallMemory();

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

  const replayLastPinnedLine = () => {
    if (outboundRepeatAskSent || endCallInvoked || outboundHardMuteAfterClose) return;
    outboundRepeatAskSent = true;
    const line = lastPinnedSpokenLine || PDF_OPENING_KN;
    console.log('[CALL] repeat last line');
    try {
      sendClientTextTurn(buildRepeatLastLineTurn(line));
    } catch (e: any) {
      outboundRepeatAskSent = false;
      console.error('[CALL] repeat send failed:', e?.message || e);
    }
  };

  const answerSideQuestion = (route: 'who' | 'why' | 'where' | 'defer' | 'robot', callerText: string) => {
    if (endCallInvoked || outboundHardMuteAfterClose) return;
    if (sideQuestionsMoveToClose(sideQuestionCount)) {
      console.log('[CALL] side-question cap — moving to the close');
      try {
        sendClientTextTurn(buildOutboundHandoffTransferNudge());
      } catch (e: any) {
        console.error('[CALL] close after side-question cap failed:', e?.message || e);
      }
      return;
    }
    sideQuestionCount += 1;
    console.log(`[CALL] side question ${route} (${sideQuestionCount}/${2})`);
    try {
      sendClientTextTurn(buildSideAnswerTurn(route, callerText, lastPinnedSpokenLine || PDF_OPENING_KN));
    } catch (e: any) {
      sideQuestionCount = Math.max(0, sideQuestionCount - 1);
      console.error('[CALL] side-answer send failed:', e?.message || e);
    }
  };

  const askCallbackLater = () => {
    if (endCallInvoked || outboundHardMuteAfterClose) return;
    if (sideQuestionsMoveToClose(sideQuestionCount)) {
      console.log('[CALL] side-question cap — moving to the close');
      try {
        sendClientTextTurn(buildOutboundHandoffTransferNudge());
      } catch (e: any) {
        console.error('[CALL] close after callback cap failed:', e?.message || e);
      }
      return;
    }
    sideQuestionCount += 1;
    console.log(`[CALL] callback later (${sideQuestionCount}/2)`);
    try {
      sendClientTextTurn(buildCallbackLaterTurn());
    } catch (e: any) {
      sideQuestionCount = Math.max(0, sideQuestionCount - 1);
      console.error('[CALL] callback-later send failed:', e?.message || e);
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
    // Places and pinned lines are already in the one session system instruction.
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

  /**
   * The CALLER says they cannot hear us. This is a hearing problem, not a new
   * answer: it must repeat the previous question and must NEVER advance the
   * flow. Treating it as an ordinary reply is what let "I can't hear" skip the
   * name step and jump straight to the projects.
   */
  const looksLikeCallerCannotHear = (raw: string): boolean =>
    /(can'?t hear|could ?n'?t hear|couldn'?t hear|cannot hear|not hearing|don'?t hear|not audible|ಕೇಳುತ್ತಿಲ್ಲ|ಅರೆಯುತ್ತಿಲ್ಲ)/i.test(String(raw || ''));

  /** The caller is giving a reason they ARE looking — a plot, site or locality. */
  const looksLikeCallerStatesInterest = (raw: string): boolean =>
    /\b(plot|site|land|house|flat|property|investment|looking for|interested in|hunsur|nagar|layout|mysuru|mysore|badami|sayyaji|gudi|road)\b/i.test(
      String(raw || ''),
    );

  /**
   * An explicit refusal.
   *
   * Shared by the interest classifier and the needs checklist so the two can
   * never disagree about what a "no" is: a reply that declines must reach its
   * own close branch, and must never be swallowed as an answer to a checklist
   * question with the caller's "no" recorded as "not stated".
   */
  const looksLikeNotInterested = (raw: string): boolean =>
    /\b(not interested|no need|stop calling|don'?t call|busy|wrong number|not looking|not want|don'?t want|not now|another number)\b/i.test(
      String(raw || ''),
    );

  /**
   * OWNER DECISION 3: naming a locality or saying what they are looking for IS
   * interest — "I want a plot in Hunsur" is the clearest interested answer there
   * is, and it was being read as the DECLINE close. A decline only counts when
   * it actually contains a refusal.
   */
  const callerSoundsInterested = (raw: string): boolean => {
    const t = String(raw || '');
    if (looksLikeCallerCannotHear(t)) return false;
    if (looksLikeOpeningDecline(t)) return false;
    if (looksLikeNotInterested(t)) return false;
    return looksLikeInterestedYes(t) || looksLikeCallerStatesInterest(t);
  };

  const keepOutboundActiveAfterOpeningYes = (raw: string) => {
    if (!isOutboundCall || outboundStayActiveNudgeSent) return;
    if (!isShortAffirmativeReply(raw) || looksLikeOpeningDecline(raw)) return;
    // A yes to the opening already sent the locations. This backup only fires
    // if that line has not gone out yet.
    if (outboundAreasLineDelivered || !outboundNameStepDone || outboundLocationsNudgeSent) return;
    outboundStayActiveNudgeSent = true;
    console.log('[GEMINI] Interested after the projects — interest question now');
    try {
      playScriptAudioNow = true;
      sendClientTextTurn(OUTBOUND_YES_LOCATIONS_NUDGE);
    } catch (e: any) {
      outboundStayActiveNudgeSent = false;
      console.error('[GEMINI] Stay-active after opening yes failed:', e?.message || e);
    }
  };

  /**
   * Stores a name only if one was volunteered. This call never asks for one.
   */
  const persistCallerName = async (name: string) => {
    if (outboundNamePersisted || !customerPhone) return;
    outboundNamePersisted = true;
    try {
      const tail = customerPhone.replace(/\D/g, '').slice(-10);
      const updated = await prisma.lead.updateMany({
        where: { phone: { contains: tail } },
        data: { name },
      });
      console.log(`[DB] Saved caller name "${name}" on ${updated.count} lead row(s)`);
    } catch (e: any) {
      console.error('[DB Error] Failed to save caller name:', e?.message || e);
    }
  };

  /**
   * After a yes to the opening, send the locations line. Never ask for a name.
   */
  const handleNameStep = (userText: string): boolean => {
    if (!isOutboundCall || outboundNameStepDone) return false;
    if (outboundHardMuteAfterClose || outboundTransferStarted) return false;
    const raw = String(userText || '').trim();
    if (!raw) return false;

    // FLOW: the opening already asked "are you looking for a site in Mysuru?".
    // Only a YES to that moves us on — any other reply is handled normally.
    // A hearing complaint is NOT an answer to the name question. OWNER DECISION
    // 2: repeat the SAME question once, slower, and stay on this step — reading
    // it as a reply is what skipped the name and jumped to the projects.
    // They did not hear the NAME question, or they asked for it again. Say that
    // question once more and stay here. A clarification is not a name, and it
    // is not permission to move on to the projects.
    if (outboundNameAsked && looksLikeNameClarification(raw)) {
      console.log('[NAME] Unclear reply — this call does not ask for a name, repeating the locations');
      diagLog('unclear reply → locations, do not ask a name');
      outboundNameStepDone = true;
      outboundLocationsNudgeSent = true;
      playScriptAudioNow = true;
      geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
      armOutboundStepAudioGuard('the locations', OUTBOUND_YES_LOCATIONS_NUDGE);
      return true;
    }

    if (looksLikeCallerCannotHear(raw)) {
      if (outboundRepeatAskSent) return false;
      outboundRepeatAskSent = true;
      console.log('[HEARING] Caller could not hear — repeating the SAME question, slower');
      diagLog('caller cannot hear → repeat once, slower');
      geminiSession?.sendRealtimeInput({ text: buildOutboundRepeatQuestionNudge(outboundLastSpokenLine) });
      return true;
    }

    if (!outboundNameAsked) {
      if (isLikelySttNoise(raw)) return false;
      if (looksLikeOpeningDecline(raw)) return false;
      if (looksLikeCustomerBusy(raw)) return false;
      // A yes to "are you looking for a site in Mysuru?" goes to the three
      // locations — or, if they already named Hunsur / Narasipura / Nanjangudu,
      // acknowledge that place and go to the sales-manager close. No name ask.
      if (!isShortAffirmativeReply(raw) && !looksLikeAnswerToSiteQuestion(raw)) return false;
      outboundNameAsked = true;
      outboundNameStepDone = true;
      outboundLocationsNudgeSent = true;
      const namedPlace = detectOutboundLocality(raw);
      if (namedPlace) {
        outboundAreasLineDelivered = true;
        outboundHandoffNudgeSent = true;
        console.log(
          `[GEMINI] Answered the site question with ${namedPlace} ("${raw.slice(0, 40)}") — location fact + close`,
        );
        diagLog(`yes + ${namedPlace} → location fact + sales close`);
        const nudge = buildOutboundLocationInterestNudge(namedPlace);
        geminiSession?.sendRealtimeInput({ text: nudge });
        armOutboundStepAudioGuard('location interest', nudge);
        return true;
      }
      console.log(
        `[GEMINI] Answered the site question ("${raw.slice(0, 40)}") — locations now`,
      );
      diagLog('yes → locations');
      playScriptAudioNow = true;
      geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
      armOutboundStepAudioGuard('the locations', OUTBOUND_YES_LOCATIONS_NUDGE);
      return true;
    }
    // A bare "ಹೌದು"/"yes" is an ECHO of our own name question, not an answer to
    // it. Treating it as a name step answer jumped straight to the projects
    // without ever asking, which is what made the flow sound scrambled.
    if (isShortAffirmativeReply(raw) && !outboundNameDeclined && !extractCallerName(raw)) {
      return false;
    }

    // A later reply is never a name. This call does not ask for one. If the
    // locations have not gone out yet, say them now.
    outboundNameStepDone = true;
    if (!outboundLocationsNudgeSent) {
      outboundLocationsNudgeSent = true;
      console.log('[NAME] Reply after the opening — locations, not a name');
      playScriptAudioNow = true;
      geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
      armOutboundStepAudioGuard('the locations', OUTBOUND_YES_LOCATIONS_NUDGE);
    }
    return true;
  };

  /**
   * ==========================================================================
   *   THE NEEDS CHECKLIST — the two questions asked before the close
   * ==========================================================================
   *
   * Two items, in this order, and only after the areas line has landed:
   *   (a) what they need the plot for — investment, or to build a home;
   *   (b) which area they are looking in.
   *
   * They are the two answers that decide which project the sales employee opens
   * with. Anything the caller has already volunteered is SKIPPED, nothing is
   * ever asked twice, and an unanswered item never stops the call from closing —
   * those rules are pure helpers in needs-checklist.ts.
   *
   * The checklist is NOT a sixth step: the opening, the name question, the areas
   * line, the sales-team line and the thank-you are untouched, and this block
   * cannot fire before the caller has heard what we have.
   */

  /** ONE listening beat per turn at most — the human backchannel. */
  const nextListeningBeat = (): string => {
    const beat = chooseListeningBeat({
      variantIndex: listeningBeatsUsed.length,
      avoid: listeningBeatsUsed,
    });
    if (beat) listeningBeatsUsed.push(beat);
    return beat;
  };

  /**
   * Ask the next unasked checklist item.
   *
   * Returns true when a question was spoken — the turn now belongs to the
   * checklist — and false when there is nothing left to ask, which is the
   * caller's signal to send the pinned sales-team close.
   */
  const askNextNeedOrHandoff = (): boolean => {
    if (outboundHardMuteAfterClose || outboundTransferStarted) return false;
    // No session, no question: an item is only marked ASKED once it has actually
    // been handed to a live session. Marking it without speaking would consume
    // the question silently and leave the caller never having heard it.
    if (!geminiSession) return false;
    // A question that is already out and unanswered is NEVER put again, and the
    // call is never closed over it either: the caller is mid-answer, and closing
    // there would hang up on their sentence. The reply resolves it — every reply
    // does, even one we cannot read — so this window closes on the next turn.
    if (openNeed) return true;
    const next = nextUnaskedNeed(needsChecklist);
    if (!next) return false;
    needsChecklist = markNeedAsked(needsChecklist, next);
    openNeed = next;
    const beat = nextListeningBeat();
    console.log(
      `[NEEDS] asking "${next}"${beat ? ` (beat "${beat}")` : ''} asked=${needsChecklist.asked.join(',')}`,
    );
    diagLog(`needs → ask ${next}`);
    try {
      geminiSession?.sendRealtimeInput({
        text: buildNeedQuestionNudge(next, {
          acquired: outboundCallerName,
          ackWord: beat || undefined,
        }),
      });
      // Dead-air guarantee, the same contract as every other question the call
      // asks: if this turn produces no audio at all, re-issue it.
      armOutboundStepAudioGuard(
        'the needs question',
        buildNeedQuestionRetryNudge(next, { acquired: outboundCallerName }),
      );
    } catch (e: any) {
      console.error('[NEEDS] question nudge failed:', e?.message || e);
      // Do not lose the item: leave it open so a later turn can ask it again.
      openNeed = null;
      return false;
    }
    return true;
  };

  /**
   * The pinned sales-team close, plus the lead write that goes with it.
   *
   * Shared by the interested branch and by the checklist's final turn, so the
   * close is byte-identical wherever it is reached from and the caller can never
   * be left in dead air after answering the last checklist question.
   */
  const sendOutboundHandoffClose = (lastResponse: string): void => {
    if (outboundHandoffNudgeSent || outboundHardMuteAfterClose || outboundTransferStarted) return;
    outboundHandoffNudgeSent = true;
    console.log('[CALL] yes to locations — speaking the Kannada close, then hang up after it plays');
    diagLog('needs complete → close');
    try {
      geminiSession?.sendRealtimeInput({
        text: withTone(buildOutboundHandoffTransferNudge()),
      });
    } catch (e: any) {
      console.error('[NEEDS] handoff after the checklist failed:', e?.message || e);
    }
    callMemory = setCallStep(callMemory, 'closing');
    if (customerPhone) {
      void markOutcomeByPhone(customerPhone, STATUS.INTERESTED, {
        interested: true,
        lastResponse,
      })
        .then((r) => console.log(`[DB] Interested lead marked rows=${r.count}`))
        .catch((e) => console.error('[DB Error] Failed to mark interested:', e));
    }
  };

  /**
   * The checklist's turn handler — the sibling of handleNameStep.
   *
   * Returns true when the checklist has taken this caller turn, so the generic
   * "continue from the next step" nudges cannot fire on top of it.
   */
  const handleNeedsStep = (userText: string): boolean => {
    // Never ask for a name. Capture purpose/locality only when the caller
    // volunteers them, so the sales team gets what they need without extra questions.
    needsChecklist = absorbVolunteeredNeeds(needsChecklist, userText);
    return false;
  };

  const armOpeningWait = () => {
    outboundOpeningRepeatDone = true;
  };

  /**
   * Opening playback is uninterruptible. Caller audio is silenced until this
   * fires, which is only once the greeting has finished playing (or the hold
   * cap expires with nothing left on the line).
   */
  let greetingListenSettlePending = false;
  const releaseGreetingListening = () => {
    if (greetingListenTimer) {
      clearTimeout(greetingListenTimer);
      greetingListenTimer = null;
    }
    if (openingGreetingTurnFinished || !isOutboundCall || endCallInvoked) return;
    const now = Date.now();
    if (greetingHoldStartedAt === 0) greetingHoldStartedAt = now;
    const open = greetingListenOpen({
      isOutbound: isOutboundCall,
      turnComplete: openingTurnComplete,
      audioHeard: greetingAudioHeard,
      now,
      playbackEndsAt: aiPlaybackEndsAt,
      holdStartedAt: greetingHoldStartedAt,
      holdCapMs: greetingAudioHeard ? GREETING_LISTEN_HOLD_CAP_MS : GREETING_AUDIO_GIVE_UP_MS,
    });
    if (!open) {
      greetingListenSettlePending = false;
      const playbackLeft = aiPlaybackEndsAt - now;
      const delay =
        greetingAudioHeard && openingTurnComplete && playbackLeft > 0
          ? playbackLeft + 40
          : 400;
      greetingListenTimer = setTimeout(releaseGreetingListening, Math.min(delay, 1000));
      return;
    }
    // The last word is still in the phone buffer for a beat after our
    // playback clock hits zero. Keep the caller muted through that beat.
    // No greeting audio means there is nothing left in the buffer.
    if (greetingAudioHeard && !greetingListenSettlePending) {
      greetingListenSettlePending = true;
      greetingListenTimer = setTimeout(releaseGreetingListening, 600);
      return;
    }
    if (!greetingAudioHeard) {
      console.warn('[CALL] no greeting audio 6s after send — opening listening');
    }
    openingGreetingTurnFinished = true;
    openingQuestionSent = true;
    // Anything the caller said over the greeting was muted to the model and
    // must not become the first "reply" once listening opens.
    lastCustomerTranscript = '';
    lastCustomerTranscriptAt = Date.now();
    bargeInStartedAt = null;
    bargeInConfirmedAt = 0;
    vadIsSpeaking = false;
    vadSilenceStartedAt = null;
    speechGate = createSpeechGateState();
    console.log('[GEMINI] Greeting playback finished — listening');
    diagLog('greeting playback complete → LISTENING');
    if (!outboundGreetingSpoken) {
      outboundGreetingSpoken = true;
      console.log('[GEMINI] Opening question spoken — waiting for a reply');
    }
    if (!outboundOpeningRepeatDone) armOpeningWait();
    armOutboundSilenceAfterTurn();
    injectDeferredContextAfterOpening();
    if (pendingLocationsAfterGreeting && !outboundLocationsNudgeSent && !endCallInvoked) {
      pendingLocationsAfterGreeting = false;
      outboundNameAsked = true;
      outboundNameStepDone = true;
      outboundLocationsNudgeSent = true;
      playScriptAudioNow = true;
      console.log('[CALL] greeting finished — speaking the locations');
      try {
        geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
      } catch (e: any) {
        outboundLocationsNudgeSent = false;
        console.error('[CALL] locations after greeting failed:', e?.message || e);
      }
    }
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
    // The thank-you is the ONLY clean end of this call. Recording it here means
    // the diagnostics can tell "reached the designed close" from "was cut off",
    // which is the difference between a good call and a broken one.
    if (telemetry.endReason === 'none') {
      telemetry = recordEnd(telemetry, 'thank_you_close', Date.now());
      publishCall(summarize(telemetry));
    }
    suppressAiOutput = true;
    if (suppressRecoveryTimer) {
      clearTimeout(suppressRecoveryTimer);
      suppressRecoveryTimer = null;
    }
    clearWaitTick();
    cancelRecovery();
    scheduleOutboundHangupAfterThanks();
  };

  // Absolute cap on an incomplete close. If the forced thank-you never comes
  // back, the call still ends — silence beats an endless "consider us later".
  const OUTBOUND_THANKS_FALLBACK_DEADLINE_MS = 12_000;

  const armOutboundThanksFallback = () => {
    if (!isOutboundCall || endCallInvoked || outboundThanksSpoken) return;
    if (outboundThanksFallbackTimer) return;
    console.log(
      '[GUARD] Sales-team close delivered WITHOUT the thank-you — forcing the thank-you line',
    );
    if (!outboundThanksFallbackSent) {
      outboundThanksFallbackSent = true;
      try {
        geminiSession?.sendRealtimeInput({ text: OUTBOUND_THANKS_FALLBACK_NUDGE });
      } catch (e: any) {
        console.error('[GEMINI] Thanks fallback nudge failed:', e?.message || e);
      }
    }
    outboundThanksFallbackTimer = setTimeout(() => {
      outboundThanksFallbackTimer = null;
      if (endCallInvoked || outboundThanksSpoken) return;
      console.warn('[GUARD] Thanks fallback deadline hit — ending the call anyway');
      activateOutboundPostThanksMute();
    }, OUTBOUND_THANKS_FALLBACK_DEADLINE_MS);
  };

  /**
   * The sales-team line ENDS the call, but only once the thank-you has actually
   * been spoken. If both landed in one utterance we mute immediately (as
   * before); if the model split them we must NOT mute here — that is exactly
   * what swallowed the thank-you and left the line open and repeating.
   */
  const handleSalesTeamCloseSpoken = (turnText: string) => {
    if (!isOutboundCall || outboundTransferStarted) return;
    if (!outboundAreasLineDelivered) {
      console.log('[GUARD] Close before the locations line — staying on the call');
      return;
    }
    outboundTransferStarted = true;
    callMemory = setCallStep(callMemory, 'closing');
    outboundBusyCloseSent = true;
    clearOutboundSilenceTimer();
    if (hasThanksClosing(turnText) || outboundThanksPlayedInTurn || looksLikeHandoffLine(turnText)) {
      outboundThanksPlayedInTurn = true;
      console.log('[GUARD] Sales-team close spoken — ending after this line plays');
      if (!outboundThanksSpoken) activateOutboundPostThanksMute();
    } else {
      armOutboundThanksFallback();
    }
  };

  const shouldSuppressOutboundTurn = (turnText: string): { suppress: boolean; reason?: string } => {
    const trimmed = String(turnText || '').trim();
    if (outboundHardMuteAfterClose) {
      return { suppress: true, reason: 'hard_mute_after_close' };
    }
    if (!trimmed) {
      return { suppress: false };
    }
    // The opening is one line. Nothing in it is a repeat until that line has
    // finished, or the question is cut and a "don't repeat" nudge makes her
    // start the same line again.
    if (!openingGreetingTurnFinished) {
      if (looksLikeSpokenNameQuestion(trimmed)) {
        return { suppress: true, reason: 'name_question' };
      }
      return { suppress: false };
    }
    if (looksLikeAreasLine(trimmed) && !areasLineTurnSealed) {
      return { suppress: false };
    }
    if (looksLikeSpokenNameQuestion(trimmed)) {
      return { suppress: true, reason: 'name_question' };
    }
    // ECHO-CONFIRM: "did you say yes sir?" stalls the flow and reads as a
    // machine. Drop the audio; the caller advances to the next script step.
    if (looksLikeEchoConfirmQuestion(trimmed)) {
      return { suppress: true, reason: 'echo_confirm' };
    }
    // INVENTED SIGN-OFF: "if you want a site in the future please consider
    // Alliance Square" is the DECLINE close only. On the interested path it is
    // an improvised line that repeated forever, so it is dropped outright.
    // (looksLikeFutureSitePitch never fires on a turn carrying the sales-team
    // line, and the decline path keeps its own wording.)
    if (!outboundNotInterestedNudgeSent && looksLikeFutureSitePitch(trimmed)) {
      return { suppress: true, reason: 'future_pitch' };
    }
    // OWNER DECISION 5: the agent hit a wall — it could not hear the caller, or
    // the answer is outside what it knows. Never let it improvise an answer and
    // never leave the caller on the line: offer the sales team and end there.
    if (!outboundCannotAnswerNudgeSent && looksLikeCannotAnswerLine(trimmed)) {
      return { suppress: true, reason: 'cannot_answer' };
    }
    // The forced thank-you is the ONE line this call must never lose to a
    // dedup guard, or the caller is left on a dead line after the sales pitch.
    if (outboundThanksFallbackSent && hasThanksClosing(trimmed)) {
      return { suppress: false };
    }
    // NEVER nag: after the single "I couldn't hear you" the agent must stop
    // asking and just listen, however poor the line is.
    if (outboundCantHearSaid && looksLikeCantHearLine(trimmed)) {
      return { suppress: true, reason: 'cant_hear_repeat' };
    }
    // A turn that repeats itself ("...same thing. ...same thing.") is dropped so
    // the caller never hears one sentence twice. NEVER applied to a close: if
    // that turn carried the only sales-team line or thank-you, muting it would
    // silence the close and strand the call.
    if (
      repeatsSentenceWithinTurn(trimmed) &&
      !looksLikeHandoffLine(trimmed) &&
      !hasThanksClosing(trimmed) &&
      !looksLikeNotInterestedCloseLine(trimmed)
    ) {
      return { suppress: true, reason: 'duplicate_within_turn' };
    }
    // STUTTERED CLOSE: the caller heard the thank-you repeated several times.
    // Every audio part of one turn plays before the mute arms, so the only way
    // to guarantee it is heard ONCE is to drop the turn and re-send a single
    // clean close.
    if (!outboundCleanCloseSent && looksLikeStutteredClose(trimmed)) {
      return { suppress: true, reason: 'stuttered_close' };
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

  /**
   * TONE STRATEGY. The caller's PERSONALITY never changes and their PACE never
   * changes; what flexes is the length and shape of the reply. A caller pressed
   * for time gets a shorter sentence, a caller who did not follow gets the same
   * point in plainer words, a caller who sounds irritated gets one brief line.
   *
   * It is attached to the NEXT nudge rather than injected on its own, so it can
   * never become an extra turn, an extra question, or an interruption of a step
   * the caller is already answering.
   */
  let pendingToneDirective = '';
  const noteCallerSignal = (raw: string) => {
    const signal = detectCallerSignal(raw);
    const directive = buildToneDirective(signal);
    if (directive) {
      pendingToneDirective = directive;
      console.log(`[TONE] caller signal "${signal}" → next reply is length-adapted`);
    }
  };
  /** Consume the pending directive exactly once, so it cannot stack up. */
  const takeToneDirective = (): string => {
    const d = pendingToneDirective;
    pendingToneDirective = '';
    return d;
  };
  /**
   * Attach the pending tone strategy to a nudge. It is APPENDED, never
   * substituted, so the business instruction in the nudge is untouched and the
   * strategy can only make the same reply shorter or plainer.
   */
  const withTone = (nudge: string): string => {
    const directive = takeToneDirective();
    if (!directive) return nudge;
    return `${nudge}\n\n${directive}`;
  };

  const playOutboundTurnIfNew = (parts: any[], turnText: string) => {
    // A name question is never played. The flag covers the rest of that turn
    // only; turnComplete clears it so the locations line (or whatever comes
    // next) is not dropped with it.
    if (
      (blockNameQuestionAudio || blockUnwantedRepeatAsk) &&
      !looksLikeAreasLine(turnText) &&
      !looksLikeHandoffLine(turnText) &&
      !hasThanksClosing(turnText) &&
      !looksLikeNotInterestedCloseLine(turnText) &&
      !looksLikeClosingGoodbye(turnText)
    ) {
      lastOutboundTurnSuppressed = true;
      return;
    }
    // The thank-you has already been spoken in THIS turn and this message says
    // it again. That is the "repeats the thank-you a few times" complaint, and
    // the mute cannot save us here — it arms on turnComplete, long after these
    // chunks have played. Drop the repeat and cut the call now.
    if (shouldDropRepeatedThanksInTurn(outboundThanksPlayedInTurn, turnText)) {
      lastOutboundTurnSuppressed = true;
      console.warn(
        `[GUARD] Dropping the thank-you repeated inside one turn: "${turnText.slice(0, 72)}"`,
      );
      diagLog('thanks repeated within turn → dropped, ending the call');
      activateOutboundPostThanksMute();
      return;
    }
    const { suppress, reason } = shouldSuppressOutboundTurn(turnText);
    lastOutboundTurnSuppressed = suppress;
    if (suppress) {
      console.warn(
        `[GEMINI] Suppressing outbound repeat (${reason}): "${turnText.slice(0, 72)}..."`,
      );
      forceOutboundHangupIfClosing(`suppressed repeat (${reason})`);
      // Dropped echo-confirm, invented sign-off and self-repeating turns: do NOT
      // leave the caller in dead air — push the next real script step instead.
      // A repeat the caller can hear is the complaint ("it keeps repeating
      // itself"), but a dropped turn with nothing after it is WORSE, so every
      // dropped repeat must be followed by the next real line.
      if (
        reason === 'echo_confirm' ||
        reason === 'future_pitch' ||
        reason === 'duplicate_within_turn' ||
        reason === 'name_question'
      ) {
        console.log(`[GUARD] Stalled/repeated turn dropped (${reason}) — waiting for the caller`);
        return;
      }
      if (reason === 'cannot_answer') {
        // OWNER DECISION 5: hand the caller to the sales team, then end.
        outboundCannotAnswerNudgeSent = true;
        console.log('[GUARD] Agent cannot answer — offering the sales team, then ending');
        diagLog('cannot answer → sales-team transfer + endCall');
        geminiSession?.sendRealtimeInput({ text: OUTBOUND_CANNOT_ANSWER_NUDGE });
        return;
      }
      // A stuttered close is dropped and replaced by ONE clean close, so the
      // caller hears the sales line and the thank-you exactly once each.
      if (reason === 'stuttered_close') {
        outboundCleanCloseSent = true;
        console.warn('[GUARD] Stuttered close dropped — re-sending ONE clean close');
        diagLog('stuttered close → single clean close');
        geminiSession?.sendRealtimeInput({ text: OUTBOUND_CLEAN_CLOSE_NUDGE });
        return;
      }
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
    outboundLastSpokenLine = turnText;
    if (turnText && looksLikeOpeningRestate(turnText)) {
      lastPinnedSpokenLine = /[\u0C80-\u0CFF]/.test(turnText) ? PDF_OPENING_KN : PDF_OPENING_EN;
    } else if (turnText && looksLikeAreasLine(turnText)) {
      lastPinnedSpokenLine = /[\u0C80-\u0CFF]/.test(turnText) ? PDF_AREAS_LINE_KN : PDF_AREAS_LINE_EN;
    }
    registerOutboundSpeech(turnText, outboundSpokenChunks);
    if (hasThanksClosing(turnText)) {
      // Remember it for the rest of THIS turn so a repeat chunk can be dropped.
      outboundThanksPlayedInTurn = true;
    }
    if (!outboundCantHearSaid && looksLikeCantHearLine(turnText)) {
      // Our one and only "I couldn't hear you" — after this the agent just
      // listens, whatever the line quality is.
      outboundCantHearSaid = true;
      console.log('[HEARING] Said the one-and-only "couldn\'t hear you" — never again');
      diagLog('cant-hear line spoken once → recovery now replies instead of asking');
    }
    if (!outboundAreasLineDelivered && looksLikeAreasLine(turnText)) {
      outboundAreasLineDelivered = true;
      callMemory = setCallStep(callMemory, 'projects');
      console.log('[GUARD] Areas line delivered — next yes goes to sales-team transfer');
    }
    if (!outboundAreasLineHeard && looksLikeAreasLine(turnText)) {
      outboundAreasLineHeard = true;
    }
    if (!outboundTransferStarted && looksLikeHandoffLine(turnText)) {
      // SALES-TEAM CLOSING: the "sales team will call you" line ENDS the call,
      // but the thank-you has to be spoken first — muting here is what used to
      // swallow it and leave the caller on an open, repeating line.
      console.log('[GUARD] Sales-team closing line delivered');
      handleSalesTeamCloseSpoken(turnText);
    }
    if (
      isOutboundCall &&
      // Excluded once the sales-team close is spoken: its thank-you still owes
      // the caller a line, so the blanket mute must not fire.
      // outboundBusyCloseSent is set when the goodbye is REQUESTED, before any
      // of that audio exists. Muting on the flag cut the goodbye after "ಸರ್, ನೀವು".
      !outboundTransferStarted &&
      (hasThanksClosing(turnText) || looksLikeClosingGoodbye(turnText))
    ) {
      // The close often starts with the thank-you and still has more to say.
      // Mute on turn complete, after this turn's audio is queued.
      outboundThanksPlayedInTurn = true;
    }
  };

  // (Live sales-team transfer removed — the interested path now speaks the
  // sales-team closing line and the call ENDS; the team calls the customer back.)

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
      speechGate = createSpeechGateState();
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
      if (audioSink === 'plivo') console.log('[CALL] first playAudio to Plivo');
    }
    capture?.onAiSpeakStart();
    capture?.onAiMuLaw(muLawBuffer);
    if (isOutboundCall && !openingGreetingTurnFinished && !openingReleased) {
      openingHold.push(muLawBuffer);
      // Held audio is still audio. The dead-air guard must not re-send the line
      // while this buffer is waiting for the rest of the sentence.
      lastAiAudioAt = Date.now();
      clearOutboundStepAudioGuard();
      if (openingQuestionSpoken(outboundAiAccum) || openingHold.reduce((n, b) => n + b.length, 0) >= 8 * 8000) {
        releaseOpeningAudio();
      }
      return;
    }
    if (isOutboundCall && !locationsReleased && (playScriptAudioNow || locationsHold.length > 0)) {
      locationsHold.push(muLawBuffer);
      lastAiAudioAt = Date.now();
      clearOutboundStepAudioGuard();
      if (locationsTextBad(outboundAiAccum)) {
        locationsHold = [];
        return;
      }
      if (locationsTextReady(outboundAiAccum)) releaseLocationsAudio();
      return;
    }
    aiPlaybackEndsAt = Math.max(Date.now(), aiPlaybackEndsAt) + muLawBuffer.length / 8;
    lastAiAudioAt = Date.now();
    // The step is on the line — its dead-air guard has nothing left to repair.
    clearOutboundStepAudioGuard();
    // Latency evidence: how long after the caller stopped did we first speak.
    if (!agentTurnFirstAudioAt) {
      agentTurnFirstAudioAt = Date.now();
      const waited = callerSpeechEndedAt ? agentTurnFirstAudioAt - callerSpeechEndedAt : 0;
      telemetry = recordAgentTurn(
        telemetry,
        currentModelTurnStartedAt ? agentTurnFirstAudioAt - currentModelTurnStartedAt : 0,
        0,
      );
      if (waited > 0) {
        console.log(`[LATENCY] caller stopped → first agent audio ${waited}ms`);
      }
    }
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

  const releaseOpeningAudio = () => {
    if (openingReleased) return;
    const buf = openingHold.length ? Buffer.concat(openingHold) : Buffer.alloc(0);
    openingHold = [];
    if (!buf.length) return;
    openingReleased = true;
    openingQuestionAudioPlayed = true;
    // The line is already on the phone. Listening opens when that playback
    // ends, even if the model never sends the end of its turn.
    openingTurnComplete = true;
    aiPlaybackEndsAt = Date.now() + buf.length / 8;
    lastAiAudioAt = Date.now();
    console.log(`[CALL] Opening played as one line (${(buf.length / 8000).toFixed(1)}s)`);
    for (let i = 0; i < buf.length; i += 1600) {
      const payload = buf.subarray(i, Math.min(buf.length, i + 1600)).toString('base64');
      if (audioSink === 'plivo') {
        ws.send(JSON.stringify({
          event: 'playAudio',
          media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload },
        }));
      } else {
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
      }
    }
    releaseGreetingListening();
  };

  const releaseLocationsAudio = () => {
    if (locationsReleased) return;
    const buf = locationsHold.length ? Buffer.concat(locationsHold) : Buffer.alloc(0);
    locationsHold = [];
    if (!buf.length) return;
    locationsReleased = true;
    aiPlaybackEndsAt = Math.max(Date.now(), aiPlaybackEndsAt) + buf.length / 8;
    lastAiAudioAt = Date.now();
    console.log(`[CALL] Locations played as one line (${(buf.length / 8000).toFixed(1)}s)`);
    for (let i = 0; i < buf.length; i += 1600) {
      const payload = buf.subarray(i, Math.min(buf.length, i + 1600)).toString('base64');
      if (audioSink === 'plivo') {
        ws.send(JSON.stringify({
          event: 'playAudio',
          media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload },
        }));
      } else {
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
      }
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
    // We have already asked the caller to repeat once. From now on the ladder
    // must NEVER ask again — it just answers, so a poor line can never turn
    // into "I couldn't hear you" on repeat.
    const effectiveKind: 'ask_repeat' | 'reply_now' =
      kind === 'ask_repeat' && outboundCantHearSaid ? 'reply_now' : kind;
    if (effectiveKind === 'ask_repeat') {
      console.log('[RECOVERY] Words not recognized — staying silent, not asking them to repeat');
      return;
    }
    try {
      geminiSession.sendRealtimeInput({ text: speechRecoveryNudgeText(effectiveKind, attempt) });
      console.warn(
        `[RECOVERY] ${kind === 'ask_repeat' ? 'No transcript' : 'No AI reply'} after caller speech — nudge #${attempt} sent` +
          (effectiveKind !== kind ? ' (repeat-ask suppressed — already asked once)' : ''),
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
        console.log('[RECOVERY] Ladder exhausted — staying silent (call stays open)');
        if (isOutboundCall && !outboundThanksSpoken) {
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
    const bargeConfirmed =
      oweBargeReply || Date.now() - bargeInConfirmedAt < BARGE_IN_CONFIRM_TTL_MS;
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
    if (bargeConfirmed) {
      oweBargeReply = false;
      speechRecovery = armBargeReplyRecovery(speechRecovery, Date.now());
    } else {
      speechRecovery = armSpeechRecovery(speechRecovery, Date.now());
    }
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
      // Plivo has NO "stop" output event (its outputs are playAudio, checkpoint,
      // clearAudio, sendDTMF), so sending one was silently ignored. clearAudio
      // drops anything still queued for playback; ending the CALL is the REST
      // hangup below. Twilio does use a "stop" message.
      ws.send(JSON.stringify({ event: "clearAudio", streamId: streamSid }));
    } else {
      ws.send(JSON.stringify({ event: "stop", streamSid }));
    }
  };

  /**
   * Stop the MEDIA STREAM is not the same as hanging up the CALL.
   * Plivo keeps the call leg connected until the call itself is hung up via the
   * REST API, so stopping the stream (and closing our websocket) left the caller
   * on a silent, open line — which is exactly "it doesn't end the call".
   * The CallUUID arrives in the Plivo start event; without it this is a no-op
   * and the stream-stop path still runs as before.
   */
  /**
   * The public origin Plivo can call back on. The websocket handshake we are
   * literally inside is proof of that address; the env vars are only a
   * fallback for the case where the handshake carried nothing usable.
   */
  const resolvePublicBase = (): string =>
    handshakeBase ||
    (process.env.VOICE_SERVER_URL || '').replace(/\/$/, '') ||
    (process.env.APP_URL || '').replace(/\/$/, '');

  /**
   * Ask Plivo whether the leg is actually gone. An ACCEPTED hangup request is
   * NOT proof the call ended: Plivo fetches aleg_url asynchronously and runs
   * the response as Plivo XML, so a 2xx can still leave the caller on a silent
   * but OPEN line — which is exactly the reported bug.
   */
  const plivoCallHasEnded = async (authId: string, authHeader: string, uuid: string): Promise<boolean> => {
    try {
      const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/${uuid}/`, {
        headers: { Authorization: authHeader },
      });
      if (!res.ok) return false;
      const body: any = await res.json().catch(() => ({}));
      return Boolean(body?.end_time);
    } catch {
      return false;
    }
  };

  /**
   * End the CALL, not just the media stream.
   *
   * Measured against the live API (scripts/probe-hangup-api.mjs):
   *  - `{status:'hangup'}` is rejected 400 "aleg_url must be present".
   *  - Plivo ends a leg from our XML and records hangup_source "Answer XML"
   *    with cause 4000 (PROBE A). A leg the handset ends records "Callee".
   * So each spelling is tried in escalating order and VERIFIED against the
   * call's own CDR, retrying the primary spelling once, rather than trusting a
   * single accepted request.
   */
  const hangupCallLegViaPlivoApi = async (reason: string): Promise<boolean> => {
    // Published to /api/plivo/hangup-status. The host's logs cannot be read from
    // the outside, and until this existed a call that never ended was
    // indistinguishable from a hangup that was never even attempted.
    const noteHangupDiag = (patch: Record<string, unknown>) => {
      const g = globalThis as any;
      g.__plivoHangup = { ...(g.__plivoHangup || {}), ...patch, at: new Date().toISOString() };
    };
    noteHangupDiag({ triggered: true, reason });
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN || '';
    if (!authId || !authToken) {
      console.error('[PLIVO] PLIVO_AUTH_ID/PLIVO_AUTH_TOKEN missing on this server — cannot hang up');
      return false;
    }
    const authHeader = `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`;

    const alegUrl = `${resolvePublicBase()}/api/plivo/hangup`;
    if (!/^https:\/\//i.test(alegUrl)) {
      console.error(`[PLIVO] No public https base URL for the hangup (resolved "${alegUrl}") — cannot hang up`);
      return false;
    }

    // The real CallUUID first, the stream id as a rescue (a wrong id only 404s).
    const candidates = [plivoCallUuid, streamSid].filter(
      (v, i, a): v is string => Boolean(v) && a.indexOf(v) === i,
    );
    noteHangupDiag({ alegUrl, candidates: candidates.length });
    if (candidates.length === 0) {
      console.error('[PLIVO] No call identifier captured — cannot hang up');
      return false;
    }

    // Escalating spellings of the same goal: hand Plivo the <Hangup/> URL, then
    // the same with an explicit GET verb, then the bare DELETE as a last resort.
    const mechanisms = [
      { name: 'POST {aleg_url}', method: 'POST', body: { aleg_url: alegUrl } as any },
      { name: 'POST {aleg_url, aleg_method:GET}', method: 'POST', body: { aleg_url: alegUrl, aleg_method: 'GET' } as any },
      { name: 'DELETE /Call/{uuid}/', method: 'DELETE', body: undefined as any },
    ];

    const plan: Array<{ uuid: string; mech: (typeof mechanisms)[number] }> = [];
    for (const uuid of candidates) for (const mech of mechanisms) plan.push({ uuid, mech });
    // One retry of the primary spelling: a lost aleg_url fetch should not leave
    // the caller on an open line.
    plan.push({ uuid: candidates[0], mech: mechanisms[0] });

    for (let i = 0; i < plan.length; i++) {
      const { uuid, mech } = plan[i];
      if (i === plan.length - 1) await new Promise((r) => setTimeout(r, 1_500));
      try {
        const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/${uuid}/`, {
          method: mech.method,
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: mech.body ? JSON.stringify(mech.body) : undefined,
        });
        if (!res.ok) {
          noteHangupDiag({ lastMechanism: mech.name, lastStatus: res.status });
          console.warn(`[PLIVO] hangup ${mech.name} uuid=${uuid} status=${res.status} (${reason})`);
        } else {
          noteHangupDiag({ lastMechanism: mech.name, lastStatus: res.status });
        }
      } catch (e: any) {
        console.error(`[PLIVO] hangup ${mech.name} uuid=${uuid} threw:`, e?.message || e);
      }
      // Accepted != ended. Only the CDR proves the leg is gone.
      if (await plivoCallHasEnded(authId, authHeader, uuid)) {
        console.log(`[PLIVO] CALL ENDED uuid=${uuid} via ${mech.name} aleg_url=${alegUrl} (${reason})`);
        noteHangupDiag({ ended: true, via: mech.name, uuid });
        return true;
      }
    }

    console.error(
      `[PLIVO] HANGUP FAILED (${reason}): tried ${plan.length} spellings across ${candidates.length} id(s), aleg_url=${alegUrl}. The caller may be left on an open line.`,
    );
    noteHangupDiag({ ended: false, attempts: plan.length });
    return false;
  };

  const completeAndHangupOutboundCall = async (reason: string) => {
    if (endCallInvoked) return;
    endCallInvoked = true;
    if (outboundThanksHangupTimer) {
      clearTimeout(outboundThanksHangupTimer);
      outboundThanksHangupTimer = null;
    }
    if (outboundCloseDeadlineTimer) {
      clearTimeout(outboundCloseDeadlineTimer);
      outboundCloseDeadlineTimer = null;
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

    // Actually terminate the CALL, then tidy the stream up. Without the API
    // call above this only stopped the audio and the caller stayed connected.
    await hangupCallLegViaPlivoApi(reason);
    hangupStream();
    geminiSession?.close();
    ws.close();
  };

  /**
   * STRICT END RULE (owner-specified): the call ends the moment the thank-you
   * has finished playing. It does NOT wait on the model to remember endCall —
   * that wait is exactly what let the thank-you be said again and again. The
   * model's own endCall uses this same wait — a fixed delay there clipped the
   * last word. The ceiling is 1s after the last audio of the close has settled. The value itself
   * lives in postThanksHangupAction(), which only returns it once the audio of
   * the thank-you has finished — see OUTBOUND_THANKS_AUDIO_SETTLE_MS for why
   * waiting for the audio matters.
   */

  const scheduleOutboundHangupAfterThanks = () => {
    if (!isOutboundCall || endCallInvoked) return;
    if (outboundThanksHangupTimer) clearTimeout(outboundThanksHangupTimer);
    if (outboundThanksFallbackTimer) clearTimeout(outboundThanksFallbackTimer);
    const audioWaitDeadline = Date.now() + OUTBOUND_THANKS_AUDIO_WAIT_CAP_MS;
    const run = () => {
      outboundThanksHangupTimer = null;
      if (endCallInvoked || !outboundThanksSpoken) return;
      // Wait until the thank-you has ACTUALLY finished playing before the 1
      // second starts. A transcript can arrive before the audio of the same
      // sentence, so hanging up off the transcript alone cut the caller's
      // thank-you off mid-word. postThanksHangupAction() holds this until the
      // audio has drained AND has been quiet for the settle window, then returns
      // the 1s the owner asked for. The wait is capped, so a stream that never
      // settles can still never hold the call open.
      const decision = postThanksHangupAction({
        playbackEndsAt: aiPlaybackEndsAt,
        lastAudioAt: lastAiAudioAt,
        now: Date.now(),
        waitDeadline: audioWaitDeadline,
      });
      if (decision.action === 'wait') {
        outboundThanksHangupTimer = setTimeout(run, decision.retryInMs);
        return;
      }
      // The close has finished playing. Give the model a beat to call endCall,
      // then end the line regardless — exactly one thank-you, then gone.
      outboundThanksHangupTimer = setTimeout(() => {
        outboundThanksHangupTimer = null;
        if (endCallInvoked || !outboundThanksSpoken) return;
        console.warn('[GUARD] Strict end rule — thank-you fully played, hanging up 1s later');
        void completeAndHangupOutboundCall('strict end rule after thank-you');
      }, decision.retryInMs);
    };
    outboundThanksHangupTimer = setTimeout(run, 40);
  };

  /**
 * A closing line has been SPOKEN. The call is over — it just may not know it
 * yet.
 *
 * The mute and its 1.2s backstop are the normal path, but they both depend on
 * the same in-memory state, so anything that interrupts them leaves the caller
 * on a silent but OPEN line with no way out. This is an independent deadline
 * armed off the fact that a close was spoken, not off the mute: if the call is
 * somehow still up, it is ended anyway. Silent-but-open is the worst possible
 * outcome for the person we called.
 */
const OUTBOUND_CLOSE_DEADLINE_MS = 25_000;
let outboundCloseDeadlineTimer: NodeJS.Timeout | null = null;

const armOutboundCloseDeadline = (reason: string, ms = OUTBOUND_CLOSE_DEADLINE_MS) => {
  if (!isOutboundCall || endCallInvoked) return;
  if (outboundCloseDeadlineTimer) return;
  outboundCloseDeadlineTimer = setTimeout(() => {
    outboundCloseDeadlineTimer = null;
    if (endCallInvoked || !isOutboundCall) return;
    console.warn(
      `[GUARD] Still connected ${Math.round(ms / 1000)}s after the close (${reason}) — ending the call now`,
    );
    diagLog(`close deadline hit after ${reason} → terminating`);
    void completeAndHangupOutboundCall(`close deadline after ${reason}`);
  }, ms);
};

const clearOutboundCloseDeadline = () => {
  if (outboundCloseDeadlineTimer) {
    clearTimeout(outboundCloseDeadlineTimer);
    outboundCloseDeadlineTimer = null;
  }
};

const forceOutboundHangupIfClosing = (reason: string) => {
    if (!isOutboundCall || endCallInvoked) return;
    if (outboundThanksSpoken || outboundHardMuteAfterClose) {
      // Do not cut the line while the thank-you is still in the playback buffer.
      // The scheduled hangup waits until that audio has finished, then 1s.
      if (outboundThanksHangupTimer) return;
      console.log(`[GUARD] Close in progress (${reason}) — hangup waits for thank-you playback + 1s`);
      scheduleOutboundHangupAfterThanks();
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
    outboundSilenceDefers = 0;
    clearOutboundSilenceTimer();
  };

  const sendOutboundSilenceNudge = (text: string) => {
    if (text === OUTBOUND_SILENCE_CHECK_NUDGE) {
      console.log('[SILENCE] Caller quiet — staying silent and listening');
      return;
    }
    if (!geminiSession || outboundHardMuteAfterClose || outboundTransferStarted) return;
    try {
      geminiSession.sendRealtimeInput({ text });
    } catch (e: any) {
      console.error('[SILENCE] Nudge failed:', e?.message || e);
    }
  };

  // SILENCE = one check line, then end the call if nobody answers it.
  const OUTBOUND_SILENCE_SPEECH_GRACE_MS = 3_000;
  /** Upper bound on how many times ONE silence cycle may hold for late caller speech. */
  const OUTBOUND_SILENCE_MAX_DEFERS = 4;
  const runOutboundSilenceTick = () => {
    outboundSilenceTimer = null;
    if (!geminiSession || endCallInvoked || outboundTransferStarted) return;
    if (vadIsSpeaking || Date.now() < aiPlaybackEndsAt - 100) {
      scheduleOutboundSilenceTick();
      return;
    }
    const now = Date.now();
    // NEVER cut off a caller who is talking, and never end a call over somebody
    // who has JUST started talking again. This tick used to run the instant the
    // VAD turn ENDED — exactly when their transcript is still in flight — so the
    // goodbye played and hard-muted the agent over somebody who had just spoken,
    // and they heard nothing back. Caller voice OR speech-class energy inside the
    // grace window holds the close; the hold is renewable (bounded) rather than a
    // single shot, so a reply that arrives at 3–5s is still answered.
    if (
      shouldHoldSilenceClose({
        now,
        lastCallerVoiceAt,
        lastSpeechEnergyAt,
        graceMs: OUTBOUND_SILENCE_SPEECH_GRACE_MS,
        defersUsed: outboundSilenceDefers,
        maxDefers: OUTBOUND_SILENCE_MAX_DEFERS,
      })
    ) {
      outboundSilenceDefers += 1;
      console.log(
        `[SILENCE] Caller voice in the last ${Math.round(OUTBOUND_SILENCE_SPEECH_GRACE_MS / 1000)}s — ` +
          `holding the close (${outboundSilenceDefers}/${OUTBOUND_SILENCE_MAX_DEFERS})`,
      );
      diagLog(`silence close DEFERRED — caller speaking (${outboundSilenceDefers})`);
      outboundSilence = {
        reason: outboundSilence.checksSpoken > 0 ? 'checked' : 'listening',
        deadline: now + SILENCE_CLOSE_AFTER_CHECK_MS,
        checksSpoken: outboundSilence.checksSpoken,
      };
      scheduleOutboundSilenceTick();
      return;
    }
    const tick = tickOutboundSilence(outboundSilence, now);
    outboundSilence = tick.state;
    if (tick.action === 'speak_check') {
      const quietSecs = Math.round((now - lastCustomerTranscriptAt) / 1000);
      console.log(`[SILENCE] ${quietSecs}s quiet — staying silent, not asking them to speak`);
      diagLog(`silence check quiet=${quietSecs}s → stay silent nudge`);
      // The check is not spoken. Counting it anyway reached the goodbye and
      // hung up on a caller who was still on the line.
      outboundSilence = armOutboundSilenceCheck(Date.now(), 0);
      scheduleOutboundSilenceTick();
    } else if (tick.action === 'close_silence' && customerUtteranceCount === 0) {
      console.log('[SILENCE] Caller has not been heard yet — staying on the line');
      outboundSilence = armOutboundSilenceCheck(Date.now(), 0);
      scheduleOutboundSilenceTick();
    } else if (tick.action === 'close_silence') {
      // The check line went unanswered. Say ONE short goodbye, then drop the
      // line. Cutting someone off in total silence with no word at all is
      // abrupt; speaking a SECOND time is what produced the endless repeat. So
      // this is a single exit line — never another question.
      const quietSecs = Math.round((now - lastCustomerTranscriptAt) / 1000);
      console.log(`[SILENCE] ${quietSecs}s quiet after the check line — goodbye, then ending the call`);
      diagLog(`silence close quiet=${quietSecs}s → goodbye + ENDING`);
      outboundBusyCloseSent = true;
      // Authorises the model's own endCall for this goodbye turn.
      outboundSpokenCloseText = 'silence goodbye';
      // Marks the close as cancellable — a late caller reply cancels this
      // hangup. KEEP THIS ADJACENT to the line above: telemetry is best-effort
      // and must never sit between the close line and the cancellability marker
      // (verify-late-reply.mjs asserts the two are neighbours).
      outboundSilenceGoodbyeSentAt = Date.now();
      if (telemetry.endReason === 'none') {
        telemetry = recordEnd(telemetry, 'silence_goodbye', now);
        publishCall(summarize(telemetry));
      }
      clearOutboundStepAudioGuard();
      sendOutboundSilenceNudge(OUTBOUND_SILENCE_GOODBYE_NUDGE);
      // Independent deadline: if the goodbye is never heard, or the transcript
      // never confirms its thanks, the call still ends instead of sitting open.
      armOutboundCloseDeadline('silence goodbye', 9_000);
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
    // This runs after EVERY agent turn, INCLUDING the turns that spoke the check
    // lines. Carrying `checksSpoken` through is what keeps the SCHEDULE real:
    // without it that own turn downgraded the state back to 'listening' with a
    // count of 0, so 5s later the engine asked a caller who had just heard the
    // question a THIRD time.
    outboundSilence = armOutboundSilenceCheck(Date.now(), outboundSilence.checksSpoken);
    outboundSilenceDefers = 0;
    scheduleOutboundSilenceTick();
  };

  /**
   * LATE REPLY CANCELLATION — "if we are silent and I speak at 3–5s, before the
   * call ends, she must still respond".
   *
   * Once the silence ladder has sent its goodbye the call is seconds from
   * dropping, and a caller who speaks at exactly that moment used to be hung up
   * on mid-sentence. Their voice, or their transcript, now cancels the close:
   * the close deadline is cleared, the endCall authorisation is withdrawn, the
   * silence ladder is reset, and the model is told plainly that the call is NOT
   * over and to answer them.
   *
   * Cancellation is refused once the thank-you has been spoken — from that point
   * the hangup is committed and the agent is hard-muted, so there is nothing left
   * to answer with.
   */
  const cancelSilenceCloseIfCallerSpeaks = (source: string) => {
    if (!isOutboundCall || endCallInvoked) return;
    if (
      !shouldCancelPendingSilenceClose({
        goodbyeSentAt: outboundSilenceGoodbyeSentAt,
        thanksSpoken: outboundThanksSpoken,
        hardMute: outboundHardMuteAfterClose,
        transferStarted: outboundTransferStarted,
      })
    ) {
      return;
    }
    outboundSilenceGoodbyeSentAt = 0;
    outboundBusyCloseSent = false;
    outboundSpokenCloseText = '';
    clearOutboundCloseDeadline();
    cancelRecovery();
    console.log(
      `[SILENCE] Caller spoke again (${source}) — goodbye CANCELLED, answering them now`,
    );
    // The single most important conversational save in the engine: a human who
    // answers late still gets answered. Counted so it can never silently rot.
    telemetry = recordLateReplyRescue(telemetry);
    diagLog(`silence goodbye CANCELLED (${source}) → caller gets a reply`);
    resetOutboundSilenceCycle();
    armOutboundSilenceAfterTurn();
    try {
      geminiSession?.sendRealtimeInput({ text: OUTBOUND_SILENCE_CANCELLED_NUDGE });
    } catch (e: any) {
      console.error('[SILENCE] Cancel nudge failed:', e?.message || e);
    }
  };

  /**
   * SPEAK GUARD — every step nudge (the name question, the projects line) is
   * followed by this guard. If NO agent audio has reached the caller a couple of
   * seconds later — nothing was generated, the turn was dropped by a dedup guard,
   * or the audio was muted before a single chunk played — the step is re-issued,
   * so a step can never end in dead air. That is exactly the failure the owner
   * heard as "after I said my name, she did not speak at all".
   *
   * It is NOT a second recovery ladder: it fires only when the caller has heard
   * nothing at all for that step, it never speaks a different line, and it gives
   * up after a small number of attempts.
   */
  const OUTBOUND_STEP_AUDIO_GUARD_MS = 2_600;
  const OUTBOUND_STEP_AUDIO_GUARD_MAX = 2;
  let outboundStepAudioGuard: NodeJS.Timeout | null = null;

  const clearOutboundStepAudioGuard = () => {
    if (outboundStepAudioGuard) {
      clearTimeout(outboundStepAudioGuard);
      outboundStepAudioGuard = null;
    }
  };

  const armOutboundStepAudioGuard = (label: string, retryText: string, attempt = 1) => {
    clearOutboundStepAudioGuard();
    const armedAt = Date.now();
    outboundStepAudioGuard = setTimeout(() => {
      outboundStepAudioGuard = null;
      if (!isOutboundCall || endCallInvoked) return;
      if (outboundHardMuteAfterClose || outboundThanksSpoken || outboundTransferStarted) return;
      if (!geminiSession) return;
      // A dropped turn never reaches the caller, so it does not count as her
      // having spoken — the step is still unanswered.
      if (lastAiAudioAt > armedAt && !lastOutboundTurnSuppressed) return;
      // The caller is mid-sentence: their turn owns the reply, not this guard.
      if (vadIsSpeaking) return;
      console.warn(
        `[SPEAK-GUARD] No agent audio ${OUTBOUND_STEP_AUDIO_GUARD_MS}ms after ${label} — ` +
          `re-issuing it (attempt ${attempt}/${OUTBOUND_STEP_AUDIO_GUARD_MAX})`,
      );
      diagLog(`speak-guard ${label} → dead air, re-issuing step (attempt ${attempt})`);
      telemetry = recordRepair(telemetry);
      try {
        geminiSession.sendRealtimeInput({ text: retryText });
      } catch (e: any) {
        console.error('[SPEAK-GUARD] Retry nudge failed:', e?.message || e);
        return;
      }
      if (attempt < OUTBOUND_STEP_AUDIO_GUARD_MAX) {
        armOutboundStepAudioGuard(label, retryText, attempt + 1);
      }
    }, OUTBOUND_STEP_AUDIO_GUARD_MS);
  };

  const playGeminiAudioParts = (parts: any[] | undefined) => {
    if (!parts) return;
    for (const part of parts) {
      const data = part.inlineData?.data || part.audio?.data;
      if (!data) continue;
      if (!greetingAudioHeard) {
        greetingAudioHeard = true;
        console.log('[CALL] first Gemini audio chunk');
        if (streamConnectAt > 0) {
          console.log(`[GEMINI] First greeting audio (+${Date.now() - streamConnectAt}ms from stream connect)`);
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

  const clearNameGateTimer = () => {
    if (!nameGateTimer) return;
    clearTimeout(nameGateTimer);
    nameGateTimer = null;
  };

  const clearCallerAudio = () => {
    if (
      !mayClearCallerAudio({
        openingFinished: openingGreetingTurnFinished,
        transcriptIsNameQuestion: looksLikeSpokenNameQuestion(outboundAiAccum),
      })
    ) {
      console.log('[GEMINI] Greeting still playing — not clearing audio');
      return;
    }
    outputLeftover = Buffer.alloc(0);
    aiPlaybackEndsAt = 0;
    capture?.onAiPlaybackCleared();
    if (!streamSid) return;
    if (audioSink === 'plivo') {
      ws.send(JSON.stringify({ event: 'clearAudio', streamId: streamSid }));
    } else {
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    }
  };

  /** Drop every sound from a turn that asked for the caller's name. Nothing from that turn is played. */
  const discardNameQuestionAudio = () => {
    clearNameGateTimer();
    heldOutboundAudioParts = [];
    if (!outboundAreasLineHeard) nameQuestionNeedsRedirect = true;
    if (!blockNameQuestionAudio) {
      blockNameQuestionAudio = true;
      outboundNameQuestionCut = true;
      console.warn('[GUARD] Name question blocked — the caller is never asked their name');
      diagLog('name question audio dropped');
      clearCallerAudio();
    }
    // The bad turn is dropped. Do not speak the next line until the caller answers.
  };

  const flushHeldOutboundAudio = () => {
    clearNameGateTimer();
    const parts = heldOutboundAudioParts;
    heldOutboundAudioParts = [];
    if (parts.length) playOutboundTurnIfNew(parts, outboundAiAccum);
  };

  /**
   * After the greeting, do not send audio until the transcript shows this turn
   * is not a name question. The opening itself plays immediately.
   * CRITICAL: never flush while the gate is still "hold" — that used to leak
   * "what is your name / ನಿಮ್ಮ ಹೆಸರು" before the transcript caught up.
   */
  const nameGateOpts = () => ({ areasDelivered: outboundAreasLineDelivered });

  const logGate = (decision: 'play' | 'hold' | 'drop', reason: string) => {
    const snippet = outboundAiAccum.replace(/\s+/g, ' ').trim().slice(0, 80);
    console.log(`[CALL] gate ${decision} reason=${reason}${snippet ? ` text="${snippet}"` : ''}`);
  };

  const gateOutboundAudio = (parts: any[]) => {
    if (!openingGreetingTurnFinished || outboundHardMuteAfterClose) {
      if (
        !outboundHardMuteAfterClose &&
        openingTurnSealed &&
        openingQuestionAudioPlayed &&
        !playScriptAudioNow
      ) {
        logGate('drop', 'second_opening');
        return;
      }
      logGate('play', !openingGreetingTurnFinished ? 'opening' : 'hard_mute');
      playOutboundTurnIfNew(parts, outboundAiAccum);
      if (!openingQuestionAudioPlayed && openingQuestionSpoken(outboundAiAccum)) {
        openingQuestionAudioPlayed = true;
      }
      return;
    }
    if (playScriptAudioNow || looksLikeAreasLine(outboundAiAccum)) {
      logGate('play', 'locations');
      playOutboundTurnIfNew(parts, outboundAiAccum);
      return;
    }
    // Any name ask is an instant drop — for the whole call, not only once.
    if (
      blockNameQuestionAudio ||
      looksLikeSpokenNameQuestion(outboundAiAccum) ||
      nameQuestionAudioGate(outboundAiAccum, nameGateOpts()) === 'drop'
    ) {
      logGate('drop', 'name_question');
      discardNameQuestionAudio();
      return;
    }
    heldOutboundAudioParts.push(...parts);
    if (nameQuestionAudioGate(outboundAiAccum, nameGateOpts()) === 'release') {
      logGate('play', 'script_line');
      flushHeldOutboundAudio();
      return;
    }
    if (nameGateTimer) return;
    const suspicious =
      /^(?:ನಿಮ್ಮ|ನೀವು\s*ಯಾರ|what\b|may i\b|could i\b|can i\b|who am\b|tell me\b|how (?:should|do)\b|naam\b|aapka\b|आपका|नाम|hesaru|nimma)/i.test(
        outboundAiAccum.trim(),
      );
    logGate('hold', suspicious ? 'suspicious_prefix' : 'waiting_for_transcript');
    // Wait for enough transcript. On timeout: drop if still suspicious;
    // before locations, never flush a held turn that is not a proven script line.
    nameGateTimer = setTimeout(() => {
      nameGateTimer = null;
      const gate = nameQuestionAudioGate(outboundAiAccum, nameGateOpts());
      if (blockNameQuestionAudio || gate === 'drop' || looksLikeSpokenNameQuestion(outboundAiAccum)) {
        logGate('drop', 'name_question_after_wait');
        discardNameQuestionAudio();
        return;
      }
      if (gate === 'release') {
        logGate('play', 'script_line_after_wait');
        flushHeldOutboundAudio();
        return;
      }
      if (suspicious) {
        logGate('drop', 'suspicious_prefix_after_wait');
        discardNameQuestionAudio();
        return;
      }
      logGate('hold', 'until_turn_complete');
      // Still hold until turnComplete — do not play unknown audio before locations.
    }, suspicious ? 900 : 650);
  };

  const releaseNameGateFromTranscript = () => {
    if (!heldOutboundAudioParts.length && !nameGateTimer) return;
    const gate = nameQuestionAudioGate(outboundAiAccum, nameGateOpts());
    if (gate === 'drop' || looksLikeSpokenNameQuestion(outboundAiAccum)) {
      discardNameQuestionAudio();
      return;
    }
    if (gate === 'release') flushHeldOutboundAudio();
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
    // Only trust a real Plivo CallUUID — a stream id would make the hangup API
    // 404 and silently leave the caller connected.
    if (msg.start.isPlivo && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$/i.test(String(msg.start.callUuid || ''))) {        plivoCallUuid = msg.start.callUuid;
        telemetry = { ...telemetry, callId: opaqueCallId(plivoCallUuid) };
      console.log('[PLIVO] CallUUID captured — the call leg can be hung up via the API');
    }
        if (msg.start.isPlivo) audioSink = 'plivo';
        const fromUrl: Record<string, string> = {};
        streamParams?.forEach((v, k) => {
          fromUrl[k] = v;
        });
        const customParams = { ...fromUrl, ...(msg.start.customParameters || {}) };
        const outboundFlag = String(
          customParams.isOutbound || customParams.IsOutbound || '',
        ).toLowerCase();
        isOutboundCall = outboundFlag === 'true' || outboundFlag === '1';
        if (!isOutboundCall) {
          console.log('[WS] Inbound stream refused — the script is outbound only');
          try {
            ws.close();
          } catch { /* already closing */ }
          return;
        }
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
        let activeSystemInstruction =
          cachedOutboundInstruction ??
          buildOutboundSystemInstruction(currentDateStr, undefined, { deferProjectReference: true });
        // Refuse any stale cached prompt that still embeds a name-question example.
        if (cachedOutboundInstruction && promptLeaksNameQuestionExample(cachedOutboundInstruction)) {
          console.warn('[OPENING-CACHE] Rejected cached instruction — contained a name-question example');
          activeSystemInstruction = buildOutboundSystemInstruction(currentDateStr, undefined, {
            deferProjectReference: true,
          });
        }
        pendingFullSystemInstruction = activeSystemInstruction;
        const geminiSystemInstruction = buildOutboundFastConnectInstruction(currentDateStr);
        noteModelPrompt(geminiSystemInstruction);
        if (cachedOutboundInstruction && activeSystemInstruction === cachedOutboundInstruction) {
          console.log('[GEMINI] Using pre-cached outbound system instruction (answer URL warm)');
        }


        console.log(`[VOICE] Audio pipeline: gain=${inputGain} class=${audioCfg.speechScoreMin}score gateStart=${audioCfg.speechGateStartMs}ms floorMax=${NOISE_FLOOR_MAX} gateRel=${GATE_RELEASE_MS}ms bargeMinRms=${BARGE_IN_MIN_RMS} bargeHold=${BARGE_IN_MIN_MS}ms vadSilence=${VAD_SILENCE_MS}ms aadSilence=${audioCfg.aadSilenceDurationMs}ms aadEnd=${audioCfg.aadEndSensitivity} aadStart=${audioCfg.aadStartSensitivity}`);
        console.log(
          `[VOICE] TTS: ${describeSpeechConfig(ttsSettings, activeTtsLanguageCode)} (Kannada-first — follows the caller's language)`,
        );

        let localSession: any = null;
        let pendingRuntimeInstruction = '';

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
            console.log('[CALL] greeting sent');
            diagLog('greeting instruction sent → GREETING (caller audio held until playback ends; interruptions ignored)');
            setCallState('GREETING', 'opening sent');
            capture?.onAiText(greetingText);
            lastPinnedSpokenLine = PDF_OPENING_KN;
            geminiSession.sendRealtimeInput({ text: instruction });
            if (greetingHoldStartedAt === 0) greetingHoldStartedAt = Date.now();
            if (greetingSentAt === 0) greetingSentAt = Date.now();
            releaseGreetingListening();
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
              // Behavioural "sounds like a person" flags — affective dialog lets
              // the model read the caller's mood and adapt; temperature buys
              // wording variety so lines are never identical call to call.
              ...buildLiveVoiceBehaviorConfig(ttsSettings),
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
                  functionDeclarations: [OUTBOUND_END_CALL_TOOL, NOT_INTERESTED_TOOL, SET_CALLBACK_TIME_TOOL],
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
                const earlyOutTx = String(
                  response.serverContent?.outputTranscription?.text
                  || response.serverContent?.outputAudioTranscription?.text
                  || ''
                ).trim();
                let outboundTranscriptFolded = false;
                if (isOutboundCall && earlyOutTx && !outboundHardMuteAfterClose) {
                  outboundAiAccum = `${outboundAiAccum} ${earlyOutTx}`.trim();
                  outboundTranscriptFolded = true;
                  const matchedNameAsk =
                    looksLikeSpokenNameQuestion(earlyOutTx) ||
                    looksLikeSpokenNameQuestion(outboundAiAccum);
                  if (matchedNameAsk) {
                    logNameGate('dropped', earlyOutTx);
                    discardNameQuestionAudio();
                  } else {
                    logNameGate(blockNameQuestionAudio ? 'dropped' : 'played', earlyOutTx);
                  }
                }
                if (response.serverContent?.interrupted) {
                  if (isOutboundCall && !openingGreetingTurnFinished) {
                    // Do not return: the same message may still carry greeting
                    // audio parts. Only skip the cut-off — finish the intro.
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
                  const transcriptProvesCaller = callerReallyInterrupted(
                    lastCustomerTranscript,
                    outboundLastSpokenLine,
                  );
                  const confirmedUserSpeech = transcriptProvesCaller;
                  if (!confirmedUserSpeech || Date.now() < aiPlaybackEndsAt + 1200) {
                    console.log(
                      `[VERIFY] Keeping the line — caller has not taken over ` +
                        `(aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking})`,
                    );
                    diagLog('interrupt refused — finish the line');
                    return;
                  }
                  console.log(`[GEMINI] Turn interrupted — clearing playback (aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`);
                  diagLog(`interrupt CONFIRMED → clearPlayback (barge or transcript proof)`);
                  oweBargeReply = true;
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
                    const tailStillPlaying = postThanksHangupAction({
                      playbackEndsAt: aiPlaybackEndsAt,
                      lastAudioAt: lastAiAudioAt,
                      now: Date.now(),
                    }).action === 'wait';
                    if (tailStillPlaying) {
                      // The last syllable can arrive after the thank-you text.
                      // Play it straight through. playOutboundTurnIfNew would
                      // drop it, because the mute is already on.
                      playGeminiAudioParts(response.serverContent.modelTurn.parts);
                    } else {
                      lastOutboundTurnSuppressed = true;
                      console.warn('[GEMINI] Dropping outbound audio after thank-you playback finished');
                    }
                    if (!outboundThanksHangupTimer) scheduleOutboundHangupAfterThanks();
                  } else if (isOutboundCall) {
                    gateOutboundAudio(response.serverContent.modelTurn.parts);
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
                  const gateAtEnd = nameQuestionAudioGate(outboundAiAccum, nameGateOpts());
                  const nameTurn =
                    blockNameQuestionAudio ||
                    gateAtEnd === 'drop' ||
                    looksLikeSpokenNameQuestion(outboundAiAccum);
                  // A turn that never cleared the name gate must not play — hold
                  // at end-of-turn with a name-ask prefix is treated as a drop.
                  const stillHeldSuspicious =
                    gateAtEnd === 'hold' &&
                    /(?:ನಿಮ್ಮ|ಹೆಸರು|what\b.*name|may i\b|who am i|naam|आपका|नाम|hesaru)/i.test(
                      outboundAiAccum,
                    );
                  if (nameTurn || stillHeldSuspicious) {
                    logGate('drop', nameTurn ? 'name_question_turn_end' : 'suspicious_turn_end');
                    heldOutboundAudioParts = [];
                    clearNameGateTimer();
                    if (!outboundAreasLineHeard) nameQuestionNeedsRedirect = true;
                    if (stillHeldSuspicious && !nameTurn) {
                      console.warn('[GUARD] Held turn still looked like a name ask — dropped at turn end');
                    }
                    discardNameQuestionAudio();
                  }
                  blockNameQuestionAudio = false;
                  if (!nameTurn && !stillHeldSuspicious && heldOutboundAudioParts.length) {
                    logGate('play', 'turn_complete');
                  }
                  if (!nameTurn && !stillHeldSuspicious) flushHeldOutboundAudio();
                  blockUnwantedRepeatAsk = false;
                  if (repeatAskCorrectionPending && !outboundHardMuteAfterClose && !endCallInvoked) {
                    repeatAskCorrectionPending = false;
                    geminiSession?.sendRealtimeInput({
                      text: 'SYSTEM (internal): Do not ask the caller to repeat. Say nothing and wait for their answer.',
                    });
                  } else {
                    repeatAskCorrectionPending = false;
                  }
                  nameQuestionNeedsRedirect = false;
                  if (!locationsReleased && locationsHold.length) {
                    if (locationsTextBad(outboundAiAccum) || locationsTextPartial(outboundAiAccum)) {
                      locationsHold = [];
                      if (!locationsRetrySent && geminiSession) {
                        locationsRetrySent = true;
                        playScriptAudioNow = true;
                        try {
                          geminiSession.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
                        } catch { /* the caller still has the line */ }
                      }
                    } else {
                      releaseLocationsAudio();
                      if (!outboundAreasLineDelivered) {
                        outboundAreasLineDelivered = true;
                        outboundAreasLineHeard = true;
                        callMemory = setCallStep(callMemory, 'projects');
                        console.log('[CALL] Locations played — the three roads are on the line');
                      }
                    }
                  }
                  if (!(locationsRetrySent && !locationsReleased)) playScriptAudioNow = false;
                  if (outboundAreasLineHeard) areasLineTurnSealed = true;
                  outboundAiAccum = '';
                  sendPcmToTwilio(Buffer.alloc(0), true);
                  // The silence goodbye has no thank-you word, so the thanks
                  // detector never sees it. Mute only once this turn's audio
                  // is queued, then hang up after it finishes playing.
                  if (isOutboundCall && outboundSilenceGoodbyeSentAt && !outboundThanksSpoken) {
                    console.log('[GUARD] Silence goodbye delivered — ending after it finishes playing');
                    activateOutboundPostThanksMute();
                  }
                  capture?.onAiTurnComplete();
                  capture?.onAiSpeakEnd();
                  resetSpeakNudge();
                  diagLog('tts turn_complete (AI turn fully delivered)');
                  if (isOutboundCall && outboundThanksPlayedInTurn) {
                    // The thank-you was spoken EARLIER in this turn (the close
                    // streams across several messages), so relying on the last
                    // message alone would miss it and the call would never end.
                    if (!outboundThanksSpoken) {
                      console.log('[GUARD] Turn ended after the thank-you — ending the call');
                      diagLog('turn_complete after thanks → mute + hangup');
                      activateOutboundPostThanksMute();
                    }
                    outboundThanksPlayedInTurn = false;
                  }
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
                      // hard-mute the agent and schedule the hangup. This is also
                      // where the FORCED thank-you lands, ending the sales-team close.
                      activateOutboundPostThanksMute();
                    } else if (isOutboundCall && looksLikeHandoffLine(completedAiText)) {
                      // Sales-team closing line delivered — the call ENDS after
                      // the thank-you (no live transfer; the team calls back).
                      handleSalesTeamCloseSpoken(completedAiText);
                    }
                  }
                  lastOutboundTurnSuppressed = false;
                  if (!openingGreetingTurnFinished) {
                    if (isOutboundCall) {
                      // A turn can end after "ನಾನು ಪ್ರಿಯಾ" and the question is
                      // still unsaid. Sealing there dropped the rest and made
                      // her start the first line again.
                      if (greetingAudioHeard && (openingQuestionAudioPlayed || openingQuestionSpoken(outboundAiAccum))) {
                        releaseOpeningAudio();
                        openingTurnComplete = true;
                        openingTurnSealed = true;
                        latLog('OPENING_TURN_COMPLETE');
                        releaseGreetingListening();
                      } else {
                        console.log('[CALL] Opening stopped before the question — still speaking it');
                        if (!openingContinueSent && geminiSession) {
                          openingContinueSent = true;
                          try {
                            geminiSession.sendRealtimeInput({
                              text: 'Finish the sentence you already started. Say only the rest of it. Do not start again.',
                            });
                          } catch { /* the next audio still joins the held line */ }
                        }
                      }
                    } else {
                      openingGreetingTurnFinished = true;
                      openingQuestionSent = true;
                      latLog('OPENING_TURN_COMPLETE');
                      console.log('[GEMINI] Opening question spoken — actively LISTENING (no dead period)');
                      diagLog('opening complete → LISTENING');
                    }
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
                  if (
                    isOutboundCall &&
                    openingGreetingTurnFinished &&
                    !outboundThanksSpoken &&
                    !outboundTransferStarted
                  ) {
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

                  // THE CLOSE IS DETECTED HERE, BECAUSE THERE IS NOWHERE ELSE
                  // TO DETECT IT. The session is configured
                  // `responseModalities: [Modality.AUDIO]`, so a model turn
                  // carries audio and NO text: `turnText` and `completedAiText`
                  // are both empty strings. Every close detector ran off those
                  // empty strings, so the spoken thank-you was never recognised,
                  // the mute never armed, the repeat was never suppressed and the
                  // hangup never fired — exactly the reported "it keeps saying
                  // thank you and the call never ends". The words actually reach
                  // us here, in the transcription of the audio, so this is the
                  // only place the close can be seen.
                  if (isOutboundCall && !outboundHardMuteAfterClose) {
                    // A sales-team line is only a CLOSE once the locations line has
                    // actually been given. Without this the model could jump
                    // straight from "what is your name, sir?" to "our sales team
                    // will call you" and end the call, skipping the one thing the
                    // caller called about. endCall is separately blocked unless a
                    // close is recognised, so holding it here keeps the call alive.
                    const spoken = String(outTx).trim();
                    if (spoken && !outboundTranscriptFolded) {
                      outboundAiAccum = `${outboundAiAccum} ${spoken}`.trim();
                      if (!openingReleased && !openingGreetingTurnFinished && openingQuestionSpoken(outboundAiAccum)) {
                        releaseOpeningAudio();
                      }
                    }
                    const asksForName =
                      !!spoken &&
                      (looksLikeSpokenNameQuestion(spoken) ||
                        looksLikeSpokenNameQuestion(outboundAiAccum));
                    if (asksForName) {
                      discardNameQuestionAudio();
                    } else if (spoken && !outboundAreasLineDelivered && locationsTextBad(outboundAiAccum)) {
                      locationsHold = [];
                      console.log('[CALL] Wrong places in the locations line — saying only the three roads');
                      if (!locationsRetrySent && geminiSession) {
                        locationsRetrySent = true;
                        playScriptAudioNow = true;
                        try {
                          geminiSession.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
                        } catch { /* the next turn still has to be the three roads */ }
                      }
                    } else if (spoken && !outboundAreasLineDelivered && locationsTextReady(outboundAiAccum)) {
                      outboundAreasLineDelivered = true;
                      outboundAreasLineHeard = true;
                      callMemory = setCallStep(callMemory, 'projects');
                      console.log('[GUARD] Areas line delivered — next yes goes to sales-team transfer');
                      releaseLocationsAudio();
                      releaseNameGateFromTranscript();
                    } else if (spoken) {
                      releaseNameGateFromTranscript();
                    }
                    const handoffIsClose = looksLikeHandoffLine(spoken) && outboundAreasLineDelivered;
                    const unwantedRepeatAsk =
                      !!spoken &&
                      agentToldCallerToRepeat(outboundAiAccum) &&
                      lastCallerIntent !== 'repeat_request' &&
                      !looksLikeAreasLine(outboundAiAccum) &&
                      !looksLikeHandoffLine(outboundAiAccum) &&
                      !hasThanksClosing(outboundAiAccum) &&
                      !looksLikeNotInterestedCloseLine(outboundAiAccum) &&
                      !looksLikeClosingGoodbye(outboundAiAccum);
                    if (unwantedRepeatAsk && openingGreetingTurnFinished && !blockUnwantedRepeatAsk) {
                      blockUnwantedRepeatAsk = true;
                      if (lastCallerIntent !== 'why_asking' && lastCallerIntent !== 'echo_waiting') {
                        repeatAskCorrectionPending = true;
                      }
                      console.warn('[VERIFY] Repeat-ask blocked — she finishes the real step instead');
                      outputLeftover = Buffer.alloc(0);
                      aiPlaybackEndsAt = 0;
                      capture?.onAiPlaybackCleared();
                      if (streamSid) {
                        if (audioSink === 'plivo') {
                          ws.send(JSON.stringify({ event: 'clearAudio', streamId: streamSid }));
                        } else {
                          ws.send(JSON.stringify({ event: 'clear', streamSid }));
                        }
                      }
                    }
                    if (spoken && !looksLikeSpokenNameQuestion(spoken) && !unwantedRepeatAsk) {
                      outboundLastSpokenLine = spoken;
                      callMemory = rememberAgentLine(callMemory, spoken);
                      const thanksEndsCall =
                        hasThanksClosing(spoken) &&
                        (outboundAreasLineDelivered || looksLikeNotInterestedCloseLine(spoken));
                      if (
                        thanksEndsCall ||
                        handoffIsClose ||
                        looksLikeNotInterestedCloseLine(spoken)
                      ) {
                        // Authorises the model's own endCall in this same turn.
                        outboundSpokenCloseText = spoken;
                        armOutboundCloseDeadline('close spoken');
                      }
                      if (thanksEndsCall) {
                        outboundThanksPlayedInTurn = true;
                        outboundBusyCloseSent = true;
                        clearOutboundSilenceTimer();
                        if (handoffIsClose || looksLikeHandoffLine(outboundAiAccum)) {
                          outboundTransferStarted = true;
                          callMemory = setCallStep(callMemory, 'closing');
                        }
                        console.log('[GUARD] Close started — finishing the line, then ending the call');
                        diagLog('spoken thank-you → finish the line, then hangup');
                      } else if (looksLikeNotInterestedCloseLine(spoken)) {
                        console.log('[GUARD] Not-interested close spoken — ending after this line finishes');
                        outboundThanksPlayedInTurn = true;
                        outboundBusyCloseSent = true;
                        clearOutboundSilenceTimer();
                      } else if (!outboundTransferStarted && handoffIsClose) {
                        handleSalesTeamCloseSpoken(spoken);
                      } else if (
                        !outboundTransferStarted &&
                        looksLikeHandoffLine(spoken) &&
                        !outboundAreasLineDelivered
                      ) {
                        console.log('[GUARD] Sales-team line before the caller answered — not speaking it');
                      }
                    }
                  }
                }

                if (
                  isOutboundCall &&
                  !openingGreetingTurnFinished &&
                  response.serverContent?.inputTranscription?.text
                ) {
                  const heardDuringGreeting = String(response.serverContent.inputTranscription.text || '').trim();
                  if (
                    isShortAffirmativeReply(heardDuringGreeting) ||
                    looksLikeInterestedYes(heardDuringGreeting)
                  ) {
                    pendingLocationsAfterGreeting = true;
                    console.log('[CALL] yes during the greeting — locations play when this line finishes');
                  } else {
                    console.log('[GEMINI] Greeting still playing — ignoring caller speech');
                  }
                } else if (
                  isOutboundCall &&
                  looksLikeSilenceCheckEcho(response.serverContent?.inputTranscription?.text || '')
                ) {
                  console.log('[SILENCE] Check-line echo ignored — silence clock keeps running');
                } else if (response.serverContent?.inputTranscription?.text) {
                  const userText = response.serverContent.inputTranscription.text;
                  const previousCallerText = callMemory.callerLines[callMemory.callerLines.length - 1] || '';
                  const review = isOutboundCall
                    ? reviewCallerTurn({
                        text: userText,
                        previousCallerText,
                        lastAgentLine: outboundLastSpokenLine,
                        areasDelivered: outboundAreasLineDelivered,
                      })
                    : { intent: 'other' as const, plan: { action: 'allow' as const }, elapsedMs: 0 };
                  lastCallerIntent = review.intent;
                  const verifiedYes = review.plan.action === 'take_answer' && review.plan.answer === 'yes';
                  const verifiedNo = review.plan.action === 'take_answer' && review.plan.answer === 'no';
                  if (isOutboundCall) {
                    console.log(`[VERIFY] ${review.intent} in ${review.elapsedMs.toFixed(1)}ms`);
                  }
                  const questionRoute =
                    isOutboundCall && openingGreetingTurnFinished ? routeCallerQuestion(userText) : null;
                  if (
                    !questionRoute &&
                    (review.plan.action === 'explain_why' || review.plan.action === 'wait_after_echo')
                  ) {
                    const nudge = review.plan.nudge;
                    const waitMs = Math.max(0, aiPlaybackEndsAt - Date.now());
                    const sendVerified = () => {
                      if (endCallInvoked || outboundHardMuteAfterClose) return;
                      try {
                        geminiSession?.sendRealtimeInput({ text: nudge });
                      } catch (e: any) {
                        console.error('[VERIFY] Corrective nudge failed:', e?.message || e);
                      }
                    };
                    if (waitMs > 40) setTimeout(sendVerified, waitMs + 80);
                    else sendVerified();
                  }
                  const userLang = detectScriptLanguage(userText);
                  console.log(`[LANG] Customer STT lang=${userLang} text="${String(userText).slice(0, 100)}"`);
                  lastCustomerTranscript = userText;
                  callMemory = rememberCallerLine(callMemory, userText);
                  lastCustomerTranscriptAt = Date.now();
                  callerSpeechEndedAt = Date.now();
                  telemetry = recordCallerSpeechEnd(
                    telemetry,
                    Date.now(),
                    Math.max(0, Date.now() - (callerVoiceSpanStartedAt || Date.now())),
                  );
                  // Communication strategy for the NEXT reply: length and
                  // explanation follow the caller, the personality never does.
                  noteCallerSignal(userText);
                  setCallState('PROCESSING', 'customer transcript arrived');
                  diagLog(`stt final lang=${userLang} chars=${userText.length} utteranceCount→${customerUtteranceCount + 1}`);
                  // Ladder guarantee #2: transcript arrived — switch to waiting
                  // for the AI's reply audio (a quiet "yes" that DID get through
                  // must still produce a reply; missing reply audio is recovered).
                  noteCustomerTranscriptForRecovery();
                  customerAnsweredOpening(userText);
                  resetOutboundSilenceCycle();
                  // Their words are in: if the call was already saying goodbye,
                  // the close is cancelled and they get a real reply.
                  cancelSilenceCloseIfCallerSpeaks('caller transcript');
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
                      callMemory = setKnownCaller(callMemory, { language: followed.language });
                      telemetry = recordLanguageSwitch(telemetry);
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
                  let questionHandled = false;
                  if (questionRoute === 'repeat') {
                    replayLastPinnedLine();
                    questionHandled = true;
                  } else if (questionRoute === 'callback' && !looksLikeCallbackTimeRequest(userText)) {
                    askCallbackLater();
                    questionHandled = true;
                  } else if (
                    questionRoute === 'who' ||
                    questionRoute === 'why' ||
                    questionRoute === 'where' ||
                    questionRoute === 'defer' ||
                    questionRoute === 'robot'
                  ) {
                    answerSideQuestion(questionRoute, userText);
                    questionHandled = true;
                  }
                  const nameStepHandled = questionHandled ? false : handleNameStep(userText);
                  // The checklist is the name step's sibling: whichever of the two
                  // takes this turn owns it, and no generic nudge may fire on top.
                  const needsStepHandled = nameStepHandled ? false : handleNeedsStep(userText);
                  const stepOwned = nameStepHandled || needsStepHandled;
                  if (stepOwned) {
            // The name step owns this turn: we already sent either the name
            // question or the site question. Never fall through and answer it
            // twice, which is what produced doubled sentences.
            customerUtteranceCount++;
          } else if (isMeaningfulCustomerUtterance(userText, looksLikeOpeningEcho)) {
                    customerUtteranceCount++;
                    injectRuntimeInstructionsIfReady(pendingRuntimeInstruction);
                    injectDeferredContextAfterOpening();
                  }
                  // OWNERSHIP OF THE TURN: handleNameStep has ALREADY sent its
                  // nudge for this utterance (the name question, or the
                  // name-then-locations turn). Both branches below are generic
                  // "keep talking / continue from the NEXT step" nudges: fired on
                  // the same turn they told the model to move PAST the step the
                  // name nudge had just given it, which is why the caller heard
                  // nothing usable after giving their name. A name turn is owned
                  // by the name step alone.
                  if (questionHandled || stepOwned) {
                    // A side question, a repeat, or the script step already owns this turn.
                  } else if (isShortAffirmativeReply(userText)) {
                    customerAnsweredOpening(userText);
                    keepOutboundActiveAfterOpeningYes(userText);
                  } else if (openingGreetingTurnFinished && isCustomerTurnSignal(userText)) {
                    console.log('[CALL] caller spoke — listening, not starting another line');
                  }
                  if (questionHandled) {
                    // The repeat or the side answer already went out. Do not also close or advance.
                  } else if (!stepOwned) {
                    if (outboundHardMuteAfterClose) {
                      forceOutboundHangupIfClosing('customer speech after close');
                    } else {
                    if (lastCallerIntent === 'why_asking' || lastCallerIntent === 'echo_waiting') {
                      // The second pass already answered this turn.
                    } else if (
                      (looksLikeRepeatRequest(userText) && lastCallerIntent === 'repeat_request') ||
                      looksLikeCallerCannotHear(userText)
                    ) {
                      // Stay quiet while they finish (we only act on the final transcript),
                      // clear any leftover agent audio, then clearly repeat the same question once.
                      if (outboundRepeatAskSent) {
                        console.log('[HEARING] Repeat already given once — staying quiet and listening');
                      } else {
                        outboundRepeatAskSent = true;
                        console.log('[GUARD] Repeat / did-not-hear — clearing audio, then repeating the last question');
                        clearCallerAudio();
                        heldOutboundAudioParts = [];
                        clearNameGateTimer();
                        outboundRepeatReplayPending = true;
                        try {
                          geminiSession?.sendRealtimeInput({
                            text: buildOutboundRepeatQuestionNudge(outboundLastSpokenLine),
                          });
                        } catch (e: any) {
                          console.error('[GEMINI] Repeat nudge failed:', e?.message || e);
                        }
                      }
                    } else if (
                      // CALLBACK TIME — the caller asked to be called back at a
                      // specific hour. Handled BEFORE the plain interested branch
                      // so the agreed time is confirmed and stored rather than
                      // lost. Routing is decided here, not by the model, so an
                      // out-of-window request is refused even if the model
                      // disagrees.
                      looksLikeCallbackTimeRequest(userText)
                    ) {
                      try {
                        const mins = requestedMinutesOfDay(userText);
                        const at = new Date();
                        if (mins != null) at.setHours(0, mins, 0, 0);
                        const inWindow = mins != null && isWithinCallbackWindow(at);

                        if (outboundThanksSpoken || outboundHardMuteAfterClose) {
                          forceOutboundHangupIfClosing('callback request after close');
                        } else if (!inWindow) {
                          if (!outboundCallbackRefusedNudgeSent) {
                            outboundCallbackRefusedNudgeSent = true;
                            console.log(
                              `[GUARD] Callback time OUTSIDE ${CALLBACK_WINDOW_LABEL} — ` +
                                `telling the caller it is not possible`,
                            );
                            geminiSession?.sendRealtimeInput({
                              text: buildOutboundCallbackOutsideWindowNudge(),
                            });
                          }
                        } else if (!outboundCallbackTimeNudgeSent) {
                          outboundCallbackTimeNudgeSent = true;
                          const spoken = spokenTimeLabel(at, at.getDate() === new Date().getDate() ? 'today' : 'tomorrow');
                          console.log(`[GUARD] Callback time INSIDE window — confirming ${spoken}`);
                          geminiSession?.sendRealtimeInput({
                            text: buildOutboundCallbackTimeNudge(spoken),
                          });
                          if (customerPhone) {
                            void markOutcomeByPhone(customerPhone, STATUS.INTERESTED, {
                              interested: true,
                              lastResponse: userText,
                            })
                              .then((r) => console.log(`[DB] Callback-request lead marked rows=${r.count}`))
                              .catch((e) => console.error('[DB Error] Failed to mark interested:', e));
                          }
                          // The time is agreed, in-window and confirmed in code —
                          // store it NOW rather than trusting the model to call the
                          // tool, which it routinely skips while saying the words.
                          void persistAgreedCallbackTime(at, `callback ${spoken}`);
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Callback-time nudge failed:', e?.message || e);
                      }
                    } else if (verifiedYes || callerSoundsInterested(userText)) {
                      // FLOW: yes to the opening → the three locations; naming a place
                      // we have → location fact + sales-manager close; plain yes to
                      // those places → sales-manager close. A no is the decline branch.
                      try {
                        const namedPlace = detectOutboundLocality(userText);
                        needsChecklist = absorbVolunteeredNeeds(needsChecklist, userText);
                        if (outboundTransferStarted) {
                          // Closing already delivered — stay silent; hangup is scheduled.
                        } else if (!outboundNameStepDone) {
                          if (!handleNameStep(userText)) {
                            outboundNameAsked = true;
                            outboundNameStepDone = true;
                            outboundLocationsNudgeSent = true;
                            playScriptAudioNow = true;
                            geminiSession?.sendRealtimeInput({ text: OUTBOUND_YES_LOCATIONS_NUDGE });
                            armOutboundStepAudioGuard('the locations', OUTBOUND_YES_LOCATIONS_NUDGE);
                          }
                          console.log('[GUARD] Yes to the opening — locations');
                        } else if (namedPlace && !outboundHandoffNudgeSent) {
                          outboundAreasLineDelivered = true;
                          outboundHandoffNudgeSent = true;
                          console.log(`[GUARD] Named ${namedPlace} — location fact + sales-manager close`);
                          geminiSession?.sendRealtimeInput({
                            text: withTone(buildOutboundLocationInterestNudge(namedPlace)),
                          });
                          callMemory = setCallStep(callMemory, 'closing');
                          if (customerPhone) {
                            void markOutcomeByPhone(customerPhone, STATUS.INTERESTED, {
                              interested: true,
                              lastResponse: userText,
                            })
                              .then((r) => console.log(`[DB] Interested lead marked rows=${r.count}`))
                              .catch((e) => console.error('[DB Error] Failed to mark interested:', e));
                          }
                        } else if (outboundAreasLineDelivered && !outboundHandoffNudgeSent) {
                          sendOutboundHandoffClose(userText);
                        } else if (
                          !outboundAreasLineDelivered &&
                          !outboundLocationsNudgeSent &&
                          !outboundStayActiveNudgeSent
                        ) {
                          // Only reachable if the name step is done and the
                          // projects line somehow has not landed yet.
                          outboundLocationsNudgeSent = true;
                          playScriptAudioNow = true;
                          console.log('[GUARD] Caller interested — locations line');
                          geminiSession?.sendRealtimeInput({
                            text: withTone(OUTBOUND_YES_LOCATIONS_NUDGE),
                          });
                        }
                      } catch (e: any) {
                        console.error('[GEMINI] Interested-flow nudge failed:', e?.message || e);
                      }
                    } else if (
                      verifiedNo ||
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
                          telemetry = recordEnd(
                            telemetry,
                            'not_interested_close',
                            Date.now(),
                          );
                          publishCall(summarize(telemetry));
                          geminiSession?.sendRealtimeInput({
                            text: withTone(OUTBOUND_NOT_INTERESTED_CLOSE_NUDGE),
                          });
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
                      // FLOWCHART: a close line (the ONE close or the sales-team
                      // line + thank-you) must have been delivered before hangup.
                      // The sales-team handoff is read off the model's own turn
                      // text because the model calls endCall in that same turn —
                      // before the engine has set outboundBusyCloseSent.
                      const closingSpoken =
                        outboundBusyCloseSent ||
                        Boolean(outboundSpokenCloseText) ||
                        looksLikeHandoffLine(currentTurnAiText) ||
                        looksLikeHandoffLine(lastPlayedAiRaw) ||
                        looksLikeNotInterestedCloseLine(currentTurnAiText) ||
                        looksLikeNotInterestedCloseLine(lastPlayedAiRaw) ||
                        hasThanksClosing(currentTurnAiText) ||
                        hasThanksClosing(lastPlayedAiRaw) ||
                        outboundThanksSpoken;

                      // (No transfer block — the interested path is a CLOSING:
                      // after the sales-team line, endCall in the SAME turn is
                      // exactly right; closingSpoken below authorizes it.)

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
                        // The model calls endCall in the SAME turn as the close
                        // line, which lands BEFORE outboundBusyCloseSent is set —
                        // so read the handoff straight off its own turn text.
                        salesTeamClose:
                          isOutboundCall &&
                          outboundAreasLineDelivered &&
                          (looksLikeHandoffLine(currentTurnAiText) ||
                            looksLikeHandoffLine(lastPlayedAiRaw) ||
                            outboundTransferStarted),
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
                              'Say your closing line ONCE — the sales-team handover, or the ' +
                              'thank-you if they are not interested — then call endCall in the ' +
                              'SAME turn. Do not say anything else.',
                          },
                          id: call.id,
                        });
                        continue;
                      }

                      console.log(
                        `[GEMINI] End call tool allowed (${endGuard.reason}). ` +
                          `Waiting for thank-you playback to finish, then 1s.`,
                      );
                      diagLog(`endCall ALLOWED reason=${endGuard.reason} → hangup after playback + 1s`);
                      toolResponses.push({
                        name: call.name,
                        response: {
                          success: true,
                          message: 'Stay silent. The line disconnects after the thank-you finishes playing.',
                        },
                        id: call.id,
                      });
                      if (!outboundThanksSpoken) {
                        activateOutboundPostThanksMute();
                      } else if (!outboundThanksHangupTimer) {
                        scheduleOutboundHangupAfterThanks();
                      }
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

                    if (call.name === "setCallbackTime") {
                      const args = (call.args || {}) as Record<string, unknown>;
                      const parsed = parseCallbackTime(
                        args.day as string | undefined,
                        args.timeOfDay as string | undefined,
                      );
                      if (!parsed.ok) {
                        // The model proposed something outside 10am-7pm. Record
                        // nothing — a promise the sales team cannot keep is worse
                        // than no promise — and tell the model to refuse it.
                        console.warn(`[GUARD] setCallbackTime REJECTED — ${parsed.reason}`);
                        diagLog(`setCallbackTime rejected: ${parsed.reason}`);
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: false,
                            error: parsed.reason,
                            instruction:
                              `The sales team is available ${CALLBACK_WINDOW_LABEL} only. ` +
                              `Tell the customer that time is not possible, that the team is ` +
                              `available ${CALLBACK_WINDOW_LABEL}, and offer another day or a call soon.`,
                          },
                          id: call.id,
                        });
                        continue;
                      }
                      const when = parsed.at.toISOString();
                      if (outboundCallbackPersisted) {
                        // The engine already stored the code-verified time. Do NOT
                        // overwrite it with the model's value — the engine's is the
                        // one that passed the window check.
                        console.log(`[DB] setCallbackTime duplicate — engine already stored ${when}`);
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: true,
                            appointmentTime: when,
                            spokenAs: spokenTimeLabel(parsed.at, parsed.day),
                          },
                          id: call.id,
                        });
                        continue;
                      }
                      console.log(
                        `[DB] setCallbackTime ${parsed.day} ${args.timeOfDay} → ${when}`,
                      );
                      if (!customerPhone) {
                        toolResponses.push({
                          name: call.name,
                          response: { success: false, error: 'No phone number on file for this call.' },
                          id: call.id,
                        });
                        continue;
                      }
                      try {
                        const r = await transitionLeadsByPhone(customerPhone, STATUS.INTERESTED, {
                          interested: true,
                          appointmentTime: parsed.at,
                          lastResponse: `callback ${parsed.day} ${args.timeOfDay}`,
                        });
                        console.log(`[DB] Callback time stored rows=${r.count} at=${when}`);
                        diagLog(`callback stored ${parsed.day} ${args.timeOfDay} rows=${r.count}`);
                        toolResponses.push({
                          name: call.name,
                          response: {
                            success: true,
                            appointmentTime: when,
                            spokenAs: spokenTimeLabel(parsed.at, parsed.day),
                          },
                          id: call.id,
                        });
                      } catch (e: any) {
                        console.error('[DB Error] Failed to store callback time:', e);
                        toolResponses.push({
                          name: call.name,
                          response: { success: false, error: 'Database error' },
                          id: call.id,
                        });
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
                const duration = Math.round((Date.now() - startTime) / 1000);
                if (!endCallInvoked && callState !== 'ENDED' && !outboundTransferStarted) {
                  console.warn(
                    '[GEMINI] Session closed mid-call — AUTO-RECONNECTING (phone line stays open)',
                  );
                  diagLog(`session closed mid-call code=${event?.code} reason=${event?.reason || 'none'} → reconnect`);
                  scheduleGeminiReconnect(`session closed: ${event?.reason || event?.code || 'unknown'}`);
                } else if (outboundTransferStarted) {
                  diagLog('session closed after closing line — expected, no reconnect');
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
                      // The two checklist answers lead the summary, because they are
                      // the first thing the sales employee needs to see.
                      needsLine: needsSummaryLine(needsChecklist),
                    });

                    // ONE write, at the end of the call, carrying the checklist with
                    // the summary: AGENTS.md forbids high-frequency writes, and the
                    // checklist must never cost a query per answer.
                    const needsFields = needsPersistFields(needsChecklist);
                    await prisma.lead.updateMany({
                      where: { phone: { contains: tail } },
                      data: {
                        summary: finalSummary,
                        duration: String(duration),
                        ...needsFields,
                      },
                    });
                    console.log(
                      `[DB] Call summary saved for ${customerPhone} needs=${JSON.stringify(needsFields)}`,
                    );
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
          if (!openingGreetingTurnFinished) {
            console.log('[GEMINI] Reconnect before the opening finished — staying on the line, not replaying it');
            openingTurnComplete = true;
            openingTurnSealed = true;
            openingGreetingTurnFinished = true;
          }
          geminiReconnectAttempts++;
          for (let attempt = 1; attempt <= MAX_GEMINI_CONNECT_ATTEMPTS; attempt++) {
            try {
              if (attempt > 1) {
                await new Promise((r) => setTimeout(r, 1200 * (attempt - 1)));
              }
              console.log(`[GEMINI] Reconnect attempt ${geminiReconnectAttempts}.${attempt}...`);
              sessionIsReconnect = true;
              const freshSession = await ai.live.connect(geminiConnectOptions);
              geminiSession = rememberModelPrompt(freshSession);
              droppedFramesNoSession = 0;
              consecutiveAudioSendFailures = 0;
              fullCallGuideInjected = true;
              projectReferenceInjected = true;
              runtimeInstructionsInjected = true;
              // WHAT THE CALLER ALREADY SAID: a fresh session has an empty
              // history, so without this the caller can be asked something they
              // already answered — the most obvious memory failure there is.
              try {
                // Two recall blocks, both private: what the CALLER said, and what
                // the checklist has already collected. Without the second one a
                // reconnect mid-checklist re-asks a question they just answered.
                const recall = [buildRecallContext(callMemory), buildNeedsContext(needsChecklist)]
                  .filter(Boolean)
                  .join('\n\n');
                if (recall) {
                  injectSilentContext(recall, 'RECALL');
                  console.log('[GEMINI] Caller recall injected into the fresh session');
                }
              } catch { /* the resume line still goes out */ }
              // Do not speak a "say that again" line after reconnect. Wait.
              setCallState('LISTENING', 'reconnected — listening again');
              startListeningWatchdog();
              console.log('[CALL] connect ok');
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
            console.log('[CALL] connect ok');
            break;
          } catch (err) {
            console.error(`[GEMINI] Connect attempt ${attempt} failed:`, err);
            if (attempt === MAX_GEMINI_CONNECT_ATTEMPTS) {
              callLog('ERROR', `GEMINI CONNECT FAILED: ${err instanceof Error ? err.message : String(err)}`);
              capture?.onSttError('Gemini live connect failed');
              console.error('[CALL] ALL 3 CONNECT ATTEMPTS FAILED — hanging up');
              await completeAndHangupOutboundCall('all gemini connect attempts failed');
              return;
            }
          }
        }

        if (!connected || !localSession) {
          return;
        }

        geminiSession = rememberModelPrompt(localSession);
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

          // ---- SPEECH-FIRST FRAME CLASSIFICATION (replaces isSpeechLike) ----
          // Every frame gets positive/negative speech evidence. 'speech' is
          // the ONLY class that can start a turn or arm barge-in; 'ambiguous'
          // classification shapes VAD/barge-in/floor. During the opening greeting
          // the bytes sent to the model are silence, so caller speech cannot
          // interrupt that first turn. Every later turn forwards real audio.
          const aiPlaying = now < aiPlaybackEndsAt;
          // Opening: caller audio is replaced with silence and barge-in stays
          // off until greetingListenOpen says playback has finished.
          const greetingProtected = isOutboundCall && !openingGreetingTurnFinished;
          if (greetingProtected && greetingHoldStartedAt === 0) {
            greetingHoldStartedAt = now;
            releaseGreetingListening();
          }
          const openingPhase = greetingProtected;
          const frameClass = classifyFrame({ metrics: frame, noiseFloorRms, config: CLASSIFY_CFG });
          if (DIAG) {
            lastClassCounts[frameClass]++;
            if (now - lastClassLogAt >= 10_000) {
              diagLog(
                `classify 10s: speech=${lastClassCounts.speech} amb=${lastClassCounts.ambiguous} ` +
                  `noise=${lastClassCounts.noise} silent=${lastClassCounts.silent} ` +
                  `duckedTotal=${duckedNoiseFrames} floor=${noiseFloorRms.toFixed(0)}`,
              );
              lastClassCounts = { speech: 0, ambiguous: 0, noise: 0, silent: 0 };
              lastClassLogAt = now;
            }
          }

          // ---- ADAPTIVE NOISE FLOOR (classification-driven) ----
          // Sustained fan/AC/TV noise pulls the floor up FAST (steady signature
          // held ≥160ms), transients barely move it, and speech NEVER raises it
          // — the old fixed-rate blend tracked the floor up under a continuous
          // speaker until only shouting cleared the thresholds (the scream-trap).
          if (frameClass === 'noise' || frameClass === 'ambiguous') {
            sustainedNoiseFrames++;
          } else {
            sustainedNoiseFrames = 0;
          }
          noiseFloorRms = nextNoiseFloorRms(noiseFloorRms, frame, frameClass, aiPlaying, FLOOR_CFG, sustainedNoiseFrames);

          // ---- NOISE GATE (barge-in eligibility only) ----
          const gateOpenRms = Math.min(GATE_OPEN_MAX_RMS, Math.max(GATE_OPEN_MIN_RMS, noiseFloorRms * GATE_FLOOR_MULT));
          const gateCloseRms = gateOpenRms * GATE_CLOSE_RATIO;
          const quietOpenRms = Math.max(GATE_OPEN_MIN_RMS * 0.72, noiseFloorRms * 1.28);
          const wasGateOpen = gateOpen;
          const gateEligible =
            frameClass === 'speech' &&
            frame.crestFactor >= 1.7 &&
            (rms >= quietOpenRms || rms >= gateOpenRms);
          if (gateEligible) {
            gateOpen = true;
            gateBelowSince = null;
          } else if (gateOpen && rms < gateCloseRms && frameClass !== 'speech') {
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
                `class=${frameClass} crest=${frame.crestFactor.toFixed(1)} flat=${frame.spectralFlatness.toFixed(2)} low=${frame.lowEnergyRatio.toFixed(2)} floor=${noiseFloorRms.toFixed(0)}`,
            );
          }
          if (voiceDebug && now - lastNoiseMetricLogAt > 5000) {
            lastNoiseMetricLogAt = now;
            vadLog(
              `metrics floor=${noiseFloorRms.toFixed(0)} rms=${rms.toFixed(0)} gate=${gateOpen ? 'open' : 'closed'} ` +
                `class=${frameClass} zcr=${frame.zeroCrossRate.toFixed(3)} flat=${frame.spectralFlatness.toFixed(2)} low=${frame.lowEnergyRatio.toFixed(2)} aiPlaying=${aiPlaying}`,
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
        // Noise frames are attenuated, not replaced with zeros — a wrong
        // 'noise' label used to deafen Priya. During the opening, caller
        // audio is not forwarded at all. Silence bytes made the model end
        // the first line halfway and say it again.
        let forwardedPcm: Buffer = pcmBuffer;
        if (greetingProtected) {
          bargeInStartedAt = null;
          if (vadIsSpeaking) {
            vadIsSpeaking = false;
            vadSilenceStartedAt = null;
            speechGate = createSpeechGateState();
          }
        } else if (frameClass === 'noise') {
          duckedNoiseFrames++;
          forwardedPcm = forwardFrameToModel(pcmBuffer, sampleCount * 2, frameClass);
        }
        try {
            if (!greetingProtected) {
            const payloadB64 = forwardedPcm.subarray(0, sampleCount * 4).toString("base64");
            geminiSession.sendRealtimeInput({
              audio: {
                data: payloadB64,
                mimeType: 'audio/pcm;rate=16000',
              }
            });
            }
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
            // Barge-in arms ONLY on speech-class frames — noise/ambiguous can
            // never clear the agent's audio even when loud.
            const bargeDecision = frameClass === 'speech' && !openingPhase
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
              const lineStillPlaying = isOutboundCall && Date.now() < aiPlaybackEndsAt;
              const tookOver = callerReallyInterrupted(lastCustomerTranscript, outboundLastSpokenLine);
              if (lineStillPlaying || !tookOver) {
                console.log('[VERIFY] Loud sound during her line — she finishes it');
                bargeInStartedAt = null;
              } else {
              console.log(
                `[VAD] Local barge-in — clearing AI playback ` +
                  `(rms=${rms.toFixed(0)} thr=${bargeInRms.toFixed(0)} hold=${BARGE_IN_MIN_MS}ms gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`
              );
              bargeInConfirmedAt = Date.now();
              oweBargeReply = true;
              capture?.onAiSpeakEnd();
              // How fast did the agent actually yield? This is the number that
              // says whether barge-in FEELS human or feels like being talked over.
              telemetry = recordBargeIn(
                telemetry,
                bargeInStartedAt ? Date.now() - bargeInStartedAt : 0,
              );
              console.log(
                `[BARGE-IN] caller took the floor in ` +
                  `${bargeInStartedAt ? Date.now() - bargeInStartedAt : 0}ms`,
              );
              clearPlayback();
              bargeInStartedAt = null;
              }
            } else if (bargeDecision.action === 'reset') {
              if (bargeInStartedAt !== null && voiceDebug) {
                vadLog(`barge-in reset (rms=${rms.toFixed(0)} thr=${bargeInRms.toFixed(0)} gateOpen=${gateOpen})`);
              }
              bargeInStartedAt = null;
            } else {
              bargeInStartedAt = bargeDecision.startedAt;
            }

            const vadEnergyThr = Math.max(VAD_ENERGY_MIN_RMS, noiseFloorRms * VAD_ENERGY_FLOOR_MULT);
            // END-side energy check only: the START side is owned by the
            // debounced speech gate (N consecutive speech-class frames).
            const speechEnergy = rms > vadEnergyThr && (frameClass === 'speech' || frameClass === 'ambiguous');
            if (frameClass === 'speech') {
              lastSpeechEnergyAt = now;
            }
            // ---- DEBOUNCED TURN START ----
            const gateDecision = updateSpeechGate({
              state: speechGate,
              frameClass,
              now,
              config: GATE_CFG,
            });
            speechGate = gateDecision.state;
            const confirmedStart = gateDecision.event === 'start';
            // SUB-TURN BLIP GUARD: a single loud noise frame right AFTER a
            // confirmed turn began must not be mistaken for continuing speech
            // when the energy check would already have ended the turn.
            const blipAfterStart =
              confirmedStart &&
              rms <= vadEnergyThr &&
              (frame.peak < vadEnergyThr * 2.2 || frame.crestFactor > 8);
            const speechDecision = evaluateLocalSpeech({
              vadIsSpeaking,
              speechEnergy: speechEnergy && !blipAfterStart,
              now,
              silenceStartedAt: vadSilenceStartedAt,
              silenceMs: VAD_SILENCE_MS,
            });
            if (greetingProtected) {
              // Not a caller turn yet. Listening starts when playback ends.
            } else if (speechDecision.event === 'start' || (confirmedStart && !vadIsSpeaking && !blipAfterStart)) {
              vadIsSpeaking = true;
              vadSilenceStartedAt = null;
              vadSpeakingSince = now;
              lastCallerVoiceAt = now;
              callerVoiceSpanStartedAt = now;
              resetSpeakNudge();
              // A caller who starts talking cancels a pending silence goodbye at
              // the speed of the AUDIO, before their transcript has even landed.
              cancelSilenceCloseIfCallerSpeaks('caller voice');
              // Caller is speaking — any pending recovery is obsolete; the new turn owns the state.
              speechRecovery = disarmSpeechRecovery(speechRecovery);
              clearRecoveryTick();
              capture?.onCustomerSpeakStart();
              console.log(
                `[VAD] Customer speech START (debounced) rms=${rms.toFixed(0)} thr=${vadEnergyThr.toFixed(0)} floor=${noiseFloorRms.toFixed(0)} class=${frameClass}`
              );
              diagLog(
                `vad START rms=${rms.toFixed(0)} thr=${vadEnergyThr.toFixed(0)} gate=${gateOpen ? 'open' : 'closed'} flat=${frame.spectralFlatness.toFixed(2)} low=${frame.lowEnergyRatio.toFixed(2)} state→USER_SPEAKING`,
              );
              setCallState('USER_SPEAKING', 'local VAD start (debounced)');
              customerStartedAnsweringOpening();
              latLog('AUDIO_IN (customer speech start)');
              clearWaitTick();
            } else if (speechDecision.event === 'silence_arm') {
              vadSilenceStartedAt = speechDecision.silenceStartedAt;
            } else if (speechDecision.event === 'end') {
                vadIsSpeaking = false;
                vadSilenceStartedAt = null;
                lastCallerVoiceAt = now;
                // A turn ENDED: a fresh debounced start is required before the
                // next turn — residual 'speech' frames from the tail of the
                // last syllable cannot immediately re-open USER_SPEAKING.
                speechGate = createSpeechGateState();
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
    if (outboundThanksFallbackTimer) clearTimeout(outboundThanksFallbackTimer);
    if (openingGraceTimer) clearTimeout(openingGraceTimer);
    void capture?.finalize();
    capture = null;
    geminiSession?.close();
  });
}