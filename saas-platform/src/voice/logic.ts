import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import { fetchLiveSiteData, formatLiveDataForPrompt } from '../lib/live-site-data';
import { buildInboundSystemInstruction, getGreeting as getInboundGreeting, getInboundGreetingInstruction } from '../voice/Inbound/index';
import { buildOutboundSystemInstruction, getGreeting as getOutboundGreeting, getOutboundGreetingInstruction } from '../voice/Outbound/index';
import { OUTBOUND_OPENING_QUESTION_KN, getOutboundOpeningQuestionKn } from '../voice/kannada-style';
import { CallCaptureSession } from '../voice/call-capture/session';
import { callLog } from '../voice/call-capture/logger';
import { loadAudioPipelineConfig } from '../voice/audio-pipeline-config';
import { buildLiveSpeechConfig, describeSpeechConfig, loadLiveSpeechSettings } from '../voice/tts/speech-config';
import { detectScriptLanguage } from '../voice/language/script-detect';
import {
  languageCodeForConversation,
  languageSwitchSystemPrompt,
  resolveNextConversationLanguage,
  type ConversationLanguage,
} from '../voice/language/conversation-language';
import { evaluateBargeIn, evaluateLocalSpeech } from '../voice/turn-policy';
import { LEAD_STATUS, outcomeFromFlags } from '../lib/lead-status';
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
  description: "End the call ONLY when the customer has CLEARLY said they want to finish — e.g. bye, goodbye, thank you for your time, thanks that's all, I'm done, that's all I needed, you can end the call, or an equivalent clear goodbye in any language. Also allowed after completing a busy/callback-later script the customer requested, or after they clearly declined interest. NEVER call this because of elapsed time (3–5 minutes or any duration), silence, pauses, short replies (okay/hmm), topic changes, incomplete answers, or because you think the conversation is finished. There is no time-based hang-up. If unsure, do NOT end the call.",
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
  description: "Mark the customer for a follow-up if they are interested but unsure of when they can visit or need more time to decide.",
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
  let isOutboundCall = false;
  /** Single canonical name/gender/salutation object for this call. */
  let customerIdentity: CustomerIdentity = emptyIdentity();
  let outboundOpeningRepeatDone = false;
  let outboundGreetingSpoken = false;
  let outboundOpeningWaitTimer: NodeJS.Timeout | null = null;
  const OPENING_WAIT_MS = 4000;
  const OPENING_QUESTION = getOutboundOpeningQuestionKn() || OUTBOUND_OPENING_QUESTION_KN;
  const audioCfg = loadAudioPipelineConfig();
  const ttsSettings = loadLiveSpeechSettings();
  /** Track reply language — every new call starts Kannada (kn-IN TTS). */
  let conversationLanguage: ConversationLanguage = 'kn';
  let activeTtsLanguageCode: 'kn-IN' | 'en-IN' = 'kn-IN';
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
  const HP_F0 = 100, HP_Q = 0.7071, HP_FS = 8000;
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
  const GATE_FLOOR = audioCfg.gateFloor;
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
  const BARGE_IN_MIN_RMS = audioCfg.bargeInMinRms;
  const BARGE_IN_FLOOR_MULT = audioCfg.bargeInFloorMult;
  const BARGE_IN_MIN_MS = audioCfg.bargeInMinMs;
  const BARGE_IN_REQUIRE_GATE = audioCfg.bargeInRequireGateOpen;
  // After barge-in / Gemini `interrupted`, keep dropping model audio until the
  // customer finishes speaking. Without this, late TTS chunks for the aborted
  // turn are still sent to Plivo AND the stereo recorder — AI talks over the
  // customer in the WAV for the rest of that overlap (and can skew sync).
  let suppressAiOutput = false;

  // Dev-only latency instrumentation (set LATENCY_DEBUG=1). Marks:
  // AUDIO_IN (speech start) → GEMINI_AUDIO_SENT (turn committed) →
  // GEMINI_FIRST_AUDIO (first model audio) → PLIVO_AUDIO_SENT (first chunk out).
  const LATENCY_DEBUG = process.env.LATENCY_DEBUG === '1';
  let speechEndAt = 0;
  let awaitingFirstAiAudio = false;
  const latLog = (label: string) => {
    if (!LATENCY_DEBUG) return;
    const delta = speechEndAt > 0 ? ` +${Date.now() - speechEndAt}ms` : '';
    console.log(`[LAT] ${label}${delta}`);
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
  let customerClearGoodbye = false;
  let endCallInvoked = false;
  let goodbyeEndCallNudgeSent = false;
  // Includes Kannada site-visit phrasings (ಸೈಟ್ ವಿಸಿಟ್ / ವಿಸಿಟ್ ಮಾಡ...) so the
  // repeat-offer guard also works when the call is happening in Kannada.
  const looksLikeOpeningEcho = (text: string) => {
    const t = text.trim().toLowerCase();
    if (t.length < 4) return true;
    return /this is bhoomi|alliance square|looking for a site in mysuru|are you looking for a site|ನೋಡ್ತಿದ್ದೀರಾ|ಮಾತಾಡ್ತಿದ್ದೀನಿ|enquiry ಮಾಡಿದ್ದೀರಲ್ಲ|ನಮಸ್ಕಾರ ಸರ್/.test(t);
  };

  let pendingLiveData: Awaited<ReturnType<typeof fetchLiveSiteData>> | null = null;
  let liveDataInjected = false;

  const injectLiveDataIfReady = () => {
    if (liveDataInjected || !geminiSession || !pendingLiveData) return;
    if (isOutboundCall && !outboundOpeningRepeatDone) return;
    liveDataInjected = true;
    const liveDataSection = formatLiveDataForPrompt(pendingLiveData);
    try {
      geminiSession.sendRealtimeInput({
        text: `LIVE INVENTORY/PRICING DATA (silent context only — do not read this aloud, do not restart the greeting):\n${liveDataSection}`
      });
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
      if (!outboundOpeningRepeatDone) {
        console.log("[GEMINI] Opening speech produced no transcript — re-arming retry");
        armOpeningWait();
      }
    }, OPENING_SPEECH_GRACE_MS);
  };

  const customerAnsweredOpening = (raw?: string) => {
    if (!isOutboundCall) return;
    if (!raw || looksLikeOpeningEcho(raw)) return;
    outboundOpeningRepeatDone = true;
    openingSpeechInProgress = false;
    if (openingGraceTimer) {
      clearTimeout(openingGraceTimer);
      openingGraceTimer = null;
    }
    clearOpeningWait();
    injectLiveDataIfReady();
  };

  const armOpeningWait = () => {
    if (!isOutboundCall || outboundOpeningRepeatDone) return;
    if (openingSpeechInProgress) return;
    if (outboundOpeningWaitTimer) return;
    console.log("[GEMINI] Arming 4s opening-question retry");
    outboundOpeningWaitTimer = setTimeout(() => {
      outboundOpeningWaitTimer = null;
      if (!geminiSession || outboundOpeningRepeatDone) {
        console.log("[GEMINI] Opening retry skipped (already answered or session gone)");
        return;
      }
      outboundOpeningRepeatDone = true;
      console.log("[GEMINI] No reply ~4s after opening question — repeating once");
      const repeat = `The customer did not answer. Speak this ONE question calmly in simple Kannada, then STOP and listen. Exact words only — no greeting, no second question: ${OPENING_QUESTION}`;
      try {
        if (typeof geminiSession.sendClientContent === "function") {
          geminiSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: repeat }] }],
            turnComplete: true,
          });
        } else {
          geminiSession.sendRealtimeInput({ text: repeat });
        }
      } catch (e: any) {
        console.error("[GEMINI] Opening retry send failed:", e?.message || e);
      }
      // After the opening repeat is spoken, turnComplete will arm WAITING_FOR_CUSTOMER.
      setTimeout(() => injectLiveDataIfReady(), 1200);
    }, OPENING_WAIT_MS);
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
    const resolved = resolveNextConversationLanguage(conversationLanguage, userText);
    if (!resolved.switched) return;
    const prev = conversationLanguage;
    conversationLanguage = resolved.language;
    activeTtsLanguageCode = languageCodeForConversation(conversationLanguage);
    console.log(
      `[LANG] Conversation language ${prev} → ${conversationLanguage} ` +
        `(tts=${activeTtsLanguageCode}, reason=${resolved.decision.reason})`,
    );
    // Gemini Live speechConfig is set at connect (kn-IN). Mid-call language is
    // enforced via an immediate system nudge — do not wait for multiple turns.
    sendWaitSystemPrompt(
      `${languageSwitchSystemPrompt(conversationLanguage)} SYSTEM TTS LANGUAGE TARGET: ${activeTtsLanguageCode}.`,
    );
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

  /** Agent finished speaking → WAITING_FOR_CUSTOMER (after TTS drains). */
  const armWaitingForCustomer = () => {
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
    if (looksLikeOpeningEcho(userText)) return;
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
  const SITE_VISIT_OFFER_PATTERN = /site\s*visit|visit\s*the\s*(plot|layout|site)|come\s*(and\s*)?(see|visit)|ಸೈಟ್\s*ವಿಸಿಟ್|ವಿಸಿಟ್\s*ಮಾಡ|ಸೈಟ್\s*ನೋಡ/i;
  const FOLLOW_UP_OFFER_PATTERN = /sales\s*team\s*(contact|call|reach)|someone\s*(from\s*our\s*team\s*)?(will\s*)?(call|contact)\s*you/i;
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
    if (audioSink === "plivo") {
      ws.send(JSON.stringify({ event: "clearAudio", streamId: streamSid }));
    } else {
      ws.send(JSON.stringify({ event: "clear", streamSid }));
    }
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

  const playGeminiAudioParts = (parts: any[] | undefined) => {
    if (!parts) return;
    for (const part of parts) {
      const data = part.inlineData?.data || part.audio?.data;
      if (!data) continue;
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
        customerIdentity = customerName
          ? resolveCustomerIdentity({
              rawName: customerName,
              source: isOutbound ? 'campaign' : 'crm',
            })
          : emptyIdentity();
        const rawPhone = customParams.customerPhone || '';
        const phoneDigits = String(rawPhone).replace(/\D/g, '');
        customerPhone = phoneDigits
          ? (phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`)
          : null;

        console.log(
          `[WS] Stream started: ${streamSid} | Name: ${customerIdentity.customer_name_normalized || 'N/A'} | ` +
            `Gender: ${customerIdentity.customer_gender}@${customerIdentity.customer_gender_confidence.toFixed(2)} | ` +
            `Salutation: ${customerIdentity.customer_salutation || 'none'} | ` +
            `Spoken: ${customerIdentity.spoken_address || 'n/a'} | Phone: ${customerPhone || 'N/A'} | Outbound: ${isOutboundCall} | Sink: ${audioSink}`,
        );
        capture = new CallCaptureSession({
          streamSid,
          phone: customerPhone,
          outbound: isOutboundCall,
        });

        // Media stream connected ⇒ callee answered (or inbound picked up).
        if (customerPhone) {
          void markAnsweredByPhone(customerPhone)
            .then((r) => console.log(`[DB] Stream start → answered updated=${r.count}`))
            .catch((e) => console.error('[DB] mark answered failed:', e));
        }

        const currentDateStr = new Date().toLocaleDateString('en-IN');
        const greetingIdentity = customerIdentity.customer_name_normalized
          ? customerIdentity
          : null;
        const activeSystemInstruction = isOutboundCall
          ? buildOutboundSystemInstruction(currentDateStr, greetingIdentity)
          : buildInboundSystemInstruction(currentDateStr, greetingIdentity);

        // LATENCY FIX: previously this file did
        //   const liveDataPromise = fetchLiveSiteData();
        //   const liveData = await liveDataPromise.catch(() => null);
        // BEFORE calling ai.live.connect(...) — meaning the Gemini session
        // wasn't even created, let alone the greeting sent, until the live
        // data fetch resolved. That's the single biggest avoidable source of
        // "the agent takes a while to start talking." Now we kick off the
        // fetch (capped at 1.2s) in parallel with connecting to Gemini, and
        // push the data into the session afterward as additional context
        // instead of gating session creation on it.
        const liveDataPromise = withTimeout(fetchLiveSiteData(), 1200);

        const runtimeInstructionBase = `
TOOL USAGE NOTES:
- If the customer clearly and explicitly says they are not interested, call the notInterested tool.
- If they agree on a specific date/time between 10:00 AM and 5:30 PM (preferred site-visit window), call bookAppointment.
- If they're interested but unsure of timing, call setFollowUp.
- If they explicitly ask for a callback later (busy/driving), follow the BUSY / DRIVING / CALL BACK LATER script, then call endCall.
- endCall ONLY when the customer clearly wants to hang up (bye / goodbye / thank you for your time / thanks that's all / I'm done / that's all I needed / you can end the call / clear equivalent in any language), OR after finishing a busy/callback-later script they requested. NEVER call endCall because a few minutes have passed, for silence, pauses, "okay"/"hmm", topic changes, or incomplete answers. No arbitrary call-duration cutoff.

LANGUAGE REMINDER: START every call in simple Mysuru Kannada (kn-IN). First reply MUST be Kannada. After that, follow the customer's LATEST meaningful language immediately — clear English → English; clear Kannada → Kannada. Do NOT switch for isolated loanwords (plot, budget, site, property…). Never refuse a language. Preserve context when switching.
KANNADA REMINDER: Calm 30-year-old Karnataka sales professional. Short everyday Mysuru Kannada (not formal/textbook). One thought per sentence. Natural site/plot/budget/loan English loanwords OK. No excitement or drama. After a question, STOP and listen. Only the five PDF projects. Office 10–7; site visits 10–5:30 — never 11–7; never push scheduling unless they asked to book.
NO INVENTION: Never invent that the customer asked for a site visit, booking, or any question they did not ask. Never say "sure / that's great / wonderful" about something they did not say. If unclear, ask one short clarification in Kannada and WAIT.
PROJECT FACTS REMINDER: CNM Apex = South-facing only at ₹5,450/sqft (not North). Booking amount = ₹59,000. Agreement amount / maintenance cost-duration → Sales Manager callback. Do not invent non-PDF projects.
LISTENING REMINDER: Never speak over the customer. Allow natural pauses and hesitations. If they interrupt, stop immediately. Opening: Speak → Ask → Stop → Listen. Max one question per turn.
SILENCE REMINDER: After a question, wait. Do not fill silence. If the customer says wait / hold on / ಒಂದು ನಿಮಿಷ / ಸ್ವಲ್ಪ wait ಮಾಡಿ, respect that and do NOT ask if they are still there during their wait. Only brief availability checks come from system "AVAILABILITY CHECK:" messages after unexplained silence — never treat silence as not interested or hang-up.
${isOutboundCall ? `PRONUNCIATION: Hunsur is hun-sur / hun-soor ([hˈʌn.sɜː] or [hʊn.suːr]) — never hoo-na-soo-ru, never "Hoo-n-sur".
SPEAK: Answer with spoken audio when the customer has actually finished a turn. Do not invent content to avoid silence. Keep the first spoken sentence short so playback starts immediately.
QUALIFY: After interest = yes → purpose (invest vs construct) → budget → only matching projects. Do not dump unrelated layouts. Sridevi landmarks include Near Upcoming Electronic City. UK Square ~1 year / under construction ONLY if they specifically ask whether the project is ready. UK Square site sizes are not in the spec — never 50×80 / 50*80; do not invent a size.
` : ''}

CURRENT DATE: ${currentDateStr}

${formatIdentityContext(customerIdentity)}
`;

        let localSession: any;
        try {
          console.log(`[VOICE] Audio pipeline: gain=${inputGain} gateMin=${GATE_OPEN_MIN_RMS} gateRel=${GATE_RELEASE_MS}ms bargeMinRms=${BARGE_IN_MIN_RMS} bargeHold=${BARGE_IN_MIN_MS}ms vadSilence=${VAD_SILENCE_MS}ms aadSilence=${audioCfg.aadSilenceDurationMs}ms aadEnd=${audioCfg.aadEndSensitivity} aadStart=${audioCfg.aadStartSensitivity}`);
          conversationLanguage = 'kn';
          activeTtsLanguageCode = 'kn-IN';
          console.log(`[VOICE] TTS: ${describeSpeechConfig(ttsSettings, activeTtsLanguageCode)} (Kannada-first)`);
          localSession = await ai.live.connect({
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
              systemInstruction: `${activeSystemInstruction}\n${runtimeInstructionBase}`,
              tools: [
                { functionDeclarations: [END_CALL_TOOL, BOOK_APPOINTMENT_TOOL, SET_NAME_TOOL, SET_FOLLOW_UP_TOOL, NOT_INTERESTED_TOOL] },
              ],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                console.log("[GEMINI] Session opened!");
                callLog('SUCCESS', 'GEMINI LIVE SESSION OPEN');
              },
              onerror: (err: any) => {
                const msg = err?.message || String(err);
                console.error("[GEMINI Error]:", err);
                callLog('ERROR', `GEMINI/STT ERROR: ${msg}`);
                capture?.onSttError(msg);
              },
              onmessage: async (response: any) => {
                if (response.serverContent?.interrupted) {
                  console.log(`[GEMINI] Turn interrupted — clearing playback (aiPlaying=${Date.now() < aiPlaybackEndsAt} vadSpeaking=${vadIsSpeaking} gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`);
                  capture?.onAiSpeakEnd();
                  clearPlayback();
                  outputLeftover = Buffer.alloc(0);
                  vadIsSpeaking = true;
                  vadSilenceStartedAt = null;
                  return;
                }

                // Play audio first so speech starts without waiting on DB/tools.
                if (response.serverContent?.modelTurn?.parts) {
                  playGeminiAudioParts(response.serverContent.modelTurn.parts);
                }
                if (response.serverContent?.turnComplete) {
                  sendPcmToTwilio(Buffer.alloc(0), true);
                  capture?.onAiTurnComplete();
                  capture?.onAiSpeakEnd();
                  // If the aborted turn finished after barge-in and the customer
                  // is already quiet, re-arm output for the next reply.
                  if (suppressAiOutput && !vadIsSpeaking) {
                    allowAiOutput();
                  }
                  if (isOutboundCall && !outboundOpeningRepeatDone) {
                    if (!outboundGreetingSpoken) {
                      outboundGreetingSpoken = true;
                      console.log("[GEMINI] Opening question spoken — waiting ~4s for a reply");
                    }
                    armOpeningWait();
                  }
                  // Patient listening: do not re-prompt Gemini until unexplained silence
                  // or an availability-check deadline (see wait-policy).
                  armWaitingForCustomer();
                }

                // Customer clearly said goodbye but model closed verbally without
                // endCall — nudge once so the line actually hangs up.
                if (response.serverContent?.turnComplete && customerClearGoodbye && !endCallInvoked && !goodbyeEndCallNudgeSent) {
                  goodbyeEndCallNudgeSent = true;
                  console.warn("[GUARD] Customer goodbye detected but endCall not called — nudging model to endCall.");
                  geminiSession?.sendRealtimeInput({
                    text: "SYSTEM: The customer clearly indicated they want to end the call. Say ONE short closing thank-you if you have not already, then IMMEDIATELY call the endCall tool. Do not ask another question."
                  });
                }

                if (response.serverContent?.modelTurn) {
                  transcriptCount++;
                  const aiText = response.serverContent.modelTurn.parts
                    .map((p: any) => p.text || "")
                    .join(" ");
                  if (aiText) {
                    fullTranscription += `AI: ${aiText}\n`;
                    capture?.onAiTranscriptChunk(aiText);

                    // Best-effort "ask once" backstop — see comment at the
                    // top of the file. Only fires a corrective nudge on an
                    // actual detected repeat, so it doesn't add overhead on
                    // the common (non-repeating) path.
                    if (SITE_VISIT_OFFER_PATTERN.test(aiText)) {
                      if (siteVisitOfferDetected) {
                        console.warn("[GUARD] Site visit appears to have been offered more than once — sending corrective nudge.");
                        geminiSession?.sendRealtimeInput({
                          text: "REMINDER: you already offered a site visit earlier in this call. Do not offer it again unless the customer brings it up themselves."
                        });
                      }
                      siteVisitOfferDetected = true;
                    }
                    if (FOLLOW_UP_OFFER_PATTERN.test(aiText)) {
                      if (followUpOfferDetected) {
                        console.warn("[GUARD] Sales-team follow-up appears to have been offered more than once — sending corrective nudge.");
                        geminiSession?.sendRealtimeInput({
                          text: "REMINDER: you already offered to have the sales team follow up earlier in this call. Do not offer it again."
                        });
                      }
                      followUpOfferDetected = true;
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
                  customerAnsweredOpening(userText);
                  handleCustomerTranscriptForWait(userText);
                  applyCustomerLanguageFromTranscript(userText);
                  // FIX: previously this unconditionally sent a "clear"
                  // event (wiping Priya's outbound audio buffer) on EVERY
                  // transcribed fragment, not just genuine interruptions —
                  // meaning a stray/misheard fragment while Priya was
                  // mid-sentence could clip her off. "clear" is now only
                  // sent from the serverContent.interrupted branch above,
                  // which reflects an actual detected interruption.

                  fullTranscription += `User: ${userText}\n`;
                  capture?.onCustomerTranscript(userText);
                  if (CUSTOMER_GOODBYE_PATTERN.test(userText)) {
                    customerClearGoodbye = true;
                    console.log(`[GUARD] Clear customer goodbye detected: "${userText.trim()}"`);
                  }

                  if (isFirstResponse && customerPhone) {
                      isFirstResponse = false;
                      const lowerText = userText.toLowerCase();

                      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'plot', 'mysore', 'looking', 'haan', 'han', 'beku', 'vadu', 'sari'];
                      const notInterestedKeywords = ['no', 'not interested', 'stop', 'don\'t', 'busy', 'wrong number', 'nahi', 'beda', 'vaddu', 'alla'];

                      // During the live call stay on `answered`. Only set the
                      // interested flag / lastResponse; outcomes are applied by
                      // tools or after endCall → call completed.
                      let interested: boolean | null = null;
                      if (interestedKeywords.some(kw => lowerText.includes(kw))) {
                        interested = true;
                      } else if (notInterestedKeywords.some(kw => lowerText.includes(kw))) {
                        interested = false;
                      }

                      try {
                        void transitionLeadsByPhone(customerPhone, STATUS.ANSWERED, {
                          interested,
                          lastResponse: userText,
                        }).then((r) => console.log(`[DB] First response tracked for ${customerPhone}: answered (interested=${interested}) rows=${r.count}`))
                          .catch((e) => console.error("[DB Error] Failed to track first response:", e));
                      } catch (e) {
                        console.error("[DB Error] Failed to track first response:", e);
                      }
                    }
                }

                if (response.toolCall) {
                  console.log("[GEMINI] Tool call received:", response.toolCall);
                  const toolResponses: any[] = [];
                  for (const call of response.toolCall.functionCalls) {
                    if (call.name === "endCall") {
                      console.log("[GEMINI] End call tool called. Terminating call...");
                      endCallInvoked = true;

                      const otherTools = response.toolCall.functionCalls.filter((c: any) => c.name !== "endCall");
                      if (otherTools.length > 0) {
                        console.log("[GEMINI] endCall skipped because other tools are present:", otherTools.map((t: any) => t.name));
                        toolResponses.push({ name: call.name, response: { success: false, message: "Please complete other actions before ending the call." }, id: call.id });
                        continue;
                      }

                      if (isOutboundCall) {
                        await new Promise(r => setTimeout(r, 600));
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
                      console.log(`[GEMINI] Setting name to ${name} title=${title || ''} marital=${maritalStatus || ''}`);
                      customerIdentity = resolveCustomerIdentity({
                        rawName: name,
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
                const duration = Math.round((Date.now() - startTime) / 1000);

                if (duration > 3 && customerPhone) {
                  const cleanPhone = customerPhone.replace(/\D/g, '');
                  const durationInfo = `Call: ${duration}s. AI Turns: ${transcriptCount}.`;

                  try {
                    const groqApiKey = process.env.GROQ_API_KEY!;
                    const summaryPrompt = `
                      Summarize the following conversation between an AI Agent (Priya) and a Customer.

                      REQUIREMENTS:
                      - The summary should be professional and concise (2-3 sentences).
                      - Highlight the key outcome.
                      - INCLUDE the specific property name if the customer showed interest or booked a visit.
                      - If the customer DID NOT confirm interest in a specific property, DO NOT mention any property names in the summary.

                      CONVERSATION:
                      ${fullTranscription}

                      SUMMARY:
                    `;

                    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                      method: "POST",
                      headers: {
                        "Authorization": `Bearer ${groqApiKey}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [
                          { role: "system", content: "You are a professional real estate assistant specializing in summarizing calls." },
                          { role: "user", content: summaryPrompt }
                        ],
                        temperature: 0.5,
                        max_tokens: 500
                      })
                    });

                    const groqData: any = await groqResponse.json();
                    const aiSummary = groqData.choices?.[0]?.message?.content?.trim() || "Summary unavailable.";
                    const finalSummary = `${durationInfo}\n\n${aiSummary}`;

                    await prisma.lead.updateMany({
                      where: { phone: { contains: cleanPhone.slice(-10) } },
                      data: {
                        summary: finalSummary
                      }
                    });
                    console.log(`[DB] Professional Groq Summary saved for ${customerPhone}`);
                  } catch (e) {
                    console.error("[DB Error] Failed to save summary with Groq:", e);
                  }
                }
              }
            }
          });
        } catch (err) {
          console.error("[GEMINI] Failed to establish live session:", err);
          callLog('ERROR', `GEMINI CONNECT FAILED: ${err instanceof Error ? err.message : String(err)}`);
          capture?.onSttError('Gemini live connect failed');
          try {
            hangupStream();
          } catch (sendErr) {
            console.error("[WS] Failed to send stop event after connect failure:", sendErr);
          }
          ws.close();
          return;
        }

        geminiSession = localSession;

        // Send greeting only after the session handle is assigned (see onopen note).
        try {
          const greetingName = customerIdentity.customer_name_normalized
            ? customerIdentity
            : null;
          const greetingText: string = isOutboundCall
            ? getOutboundGreeting(greetingName)
            : getInboundGreeting(greetingName?.customer_name_normalized ?? null);
          const instruction = isOutboundCall
            ? getOutboundGreetingInstruction(greetingName)
            : getInboundGreetingInstruction(greetingName);
          console.log(`[GEMINI] Sending calm Kannada-first greeting for spoken audio`);
          capture?.onAiText(greetingText);
          if (typeof geminiSession.sendClientContent === 'function') {
            geminiSession.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: instruction }] }],
              turnComplete: true,
            });
          } else {
            geminiSession.sendRealtimeInput({ text: instruction });
          }
        } catch (greetErr) {
          console.error("[GEMINI] Failed to send greeting after connect:", greetErr);
        }

        // Push live inventory/pricing data into the session once it resolves,
        // instead of gating session creation (and the greeting) on it. If it
        // times out or fails, the call proceeds fine on the static layout
        // list already baked into the system prompt.
        liveDataPromise.then((liveData) => {
          if (!liveData) {
            console.warn("[GEMINI] Live site data unavailable or timed out — continuing with static layout list only.");
            return;
          }
          pendingLiveData = liveData;
          injectLiveDataIfReady();
        });

        if (isOutboundCall) {
          setTimeout(() => {
            if (outboundOpeningRepeatDone || outboundOpeningWaitTimer) return;
            outboundGreetingSpoken = true;
            console.log("[GEMINI] Fallback: arming 4s opening retry (no turnComplete yet)");
            armOpeningWait();
          }, 5500);
        }

      } else if (msg.event === 'media') {
        try {
          const muLawData = Buffer.from(msg.media.payload, "base64");
          capture?.onCustomerMuLaw(muLawData);
          if (!geminiSession) return;
          // Do NOT reset wait/silence timers on raw media — fan/TV/keyboard must
          // not count as a customer response. Only meaningful STT does.
          const sampleCount = muLawData.length;
          const cleaned = sampleCount <= SCRATCH_SAMPLES ? scratchCleaned : new Int16Array(sampleCount);
          let sumSquares = 0;
          for (let i = 0; i < sampleCount; i++) {
            const x = muLawToPcmTable[muLawData[i]];
            const y = HP_B0 * x + HP_B1 * hpX1 + HP_B2 * hpX2 - HP_A1 * hpY1 - HP_A2 * hpY2;
            hpX2 = hpX1; hpX1 = x;
            hpY2 = hpY1; hpY1 = y;
            const s = y > 32767 ? 32767 : y < -32768 ? -32768 : Math.round(y);
            cleaned[i] = s;
            sumSquares += s * s;
          }
          const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
          const now = Date.now();

          // 2) Adaptive noise-floor tracking: converge quickly while the packet
          //    looks like background (below 2x current floor), drift up only
          //    very slowly during speech so talking never inflates the floor.
          if (rms < noiseFloorRms * 2) {
            noiseFloorRms += (rms - noiseFloorRms) * 0.05;
          } else {
            noiseFloorRms += (rms - noiseFloorRms) * 0.004;
          }
          if (noiseFloorRms < NOISE_FLOOR_MIN) noiseFloorRms = NOISE_FLOOR_MIN;
          if (noiseFloorRms > NOISE_FLOOR_MAX) noiseFloorRms = NOISE_FLOOR_MAX;

          // 3) Gate thresholds ride the measured floor instead of fixed values.
          const gateOpenRms = Math.min(GATE_OPEN_MAX_RMS, Math.max(GATE_OPEN_MIN_RMS, noiseFloorRms * GATE_FLOOR_MULT));
          const gateCloseRms = gateOpenRms * GATE_CLOSE_RATIO;
          const wasGateOpen = gateOpen;
          if (rms >= gateOpenRms) {
            gateOpen = true;
            gateBelowSince = null;
          } else if (gateOpen && rms < gateCloseRms) {
            if (gateBelowSince === null) {
              gateBelowSince = now;
            } else if (now - gateBelowSince >= GATE_RELEASE_MS) {
              gateOpen = false;
              gateBelowSince = null;
            }
          }
          if (voiceDebug && wasGateOpen !== gateOpen && now - lastGateLogAt > 250) {
            lastGateLogAt = now;
            vadLog(`gate ${gateOpen ? 'OPEN' : 'CLOSE'} rms=${rms.toFixed(0)} thrOpen=${gateOpenRms.toFixed(0)} floor=${noiseFloorRms.toFixed(0)}`);
          }
          if (voiceDebug && now - lastNoiseMetricLogAt > 5000) {
            lastNoiseMetricLogAt = now;
            vadLog(`metrics floor=${noiseFloorRms.toFixed(0)} rms=${rms.toFixed(0)} gate=${gateOpen ? 'open' : 'closed'} aiPlaying=${now < aiPlaybackEndsAt}`);
          }
          const effectiveGain = (gateOpen ? 1 : GATE_FLOOR) * inputGain;

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

            // Local barge-in: sustained speech well above floor, preferably with
            // an open gate, so transient spikes / background TV don't clear AI.
            const bargeInRms = Math.max(BARGE_IN_MIN_RMS, noiseFloorRms * BARGE_IN_FLOOR_MULT);
            const bargeDecision = evaluateBargeIn({
              now,
              aiPlaybackEndsAt,
              rms,
              bargeInRms,
              gateOpen,
              requireGateOpen: BARGE_IN_REQUIRE_GATE,
              bargeInStartedAt,
              minHoldMs: BARGE_IN_MIN_MS,
            });
            if (bargeDecision.action === 'arm') {
              bargeInStartedAt = bargeDecision.startedAt;
            } else if (bargeDecision.action === 'fire') {
              console.log(
                `[VAD] Local barge-in — clearing AI playback ` +
                  `(rms=${rms.toFixed(0)} thr=${bargeInRms.toFixed(0)} hold=${BARGE_IN_MIN_MS}ms gateOpen=${gateOpen} floor=${noiseFloorRms.toFixed(0)})`
              );
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
            // Prefer gated speech for local speech-start so background doesn't
            // flip vadIsSpeaking; still allow energy only when the gate is open.
            const speechEnergy = gateOpen && rms > vadEnergyThr;
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
    if (openingGraceTimer) clearTimeout(openingGraceTimer);
    void capture?.finalize();
    capture = null;
    geminiSession?.close();
  });
}