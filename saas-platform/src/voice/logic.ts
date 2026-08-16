import { GoogleGenAI, Modality, Type } from '@google/genai';
import { WebSocket } from 'ws';
import { prisma } from '../lib/prisma';
import { fetchLiveSiteData, formatLiveDataForPrompt } from '../lib/live-site-data';
import { buildInboundSystemInstruction, getGreeting as getInboundGreeting } from '../voice/Inbound/index';
import { buildOutboundSystemInstruction, getGreeting as getOutboundGreeting } from '../voice/Outbound/index';

// --- Normalize Plivo & Twilio WebSocket events to one internal format ---
function normalizeVoiceEvent(raw: any): any {
  const evt: string = raw.event || raw.type || 'media';
  const result: any = { event: evt };

  if (evt === 'start') {
    const start = raw.start || raw.Start || raw;
    const streamId = start.streamSid || start.streamId || start.CallUUID || start.callUuid || start.callSid || start.stream_sid;
    const params = start.customParameters || start.CustomParameters || start.extraHeaders || start.extra_headers || start.Parameters || {};
    const mergedParams = { ...(params || {}), ...(raw.parameters || {}) };
    result.start = {
      streamSid: streamId,
      callSid: start.callSid || start.CallUUID || start.callUuid || streamId,
      customParameters: mergedParams,
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
  description: "Update the customer's name in the system once they provide it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "The full name of the customer.",
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

// Cleaned-up, deduplicated lead status values used throughout this file.
const STATUS = {
  VISIT_SCHEDULED: 'visit scheduled',
  FOLLOW_UP: 'follow up',
  NOT_INTERESTED: 'not interested', // was 'not - interested' — inconsistent formatting vs the others, fixed here. Double check nothing downstream (dashboards/filters) still expects the old string before deploying this.
  CALL_COMPLETED: 'call completed', // neutral default (see NOT_INTERESTED_TOOL comment above)
};
const PROTECTED_STATUSES = [STATUS.VISIT_SCHEDULED, STATUS.FOLLOW_UP];

export async function setupGemini(ws: WebSocket) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  let streamSid: string | null = null;
  let geminiSession: any = null;
  let transcriptCount = 0;
  let startTime = Date.now();
  let customerPhone: string | null = null;
  let silenceTimer: NodeJS.Timeout | null = null;
  let lastSilenceReset = 0;
  let repromptCount = 0;
  // Soft check-ins only — NEVER auto-end the call on silence. The customer
  // must clearly say they want to hang up before endCall is used.
  const MAX_REPROMPTS = 2;
  const SILENCE_TIMEOUT_MS = 12000;
  const SILENCE_RESET_DEBOUNCE_MS = 500; // don't churn the timer on every ~20ms audio packet
  let fullTranscription: string = "";
  let isFirstResponse = true;
  let isOutboundCall = false;
  let outboundOpeningRepeatDone = false;
  let outboundGreetingSpoken = false;
  let outboundOpeningWaitTimer: NodeJS.Timeout | null = null;
  const OPENING_WAIT_MS = 4000;
  const OPENING_QUESTION = "Are you looking for a site in Mysuru?";
  const inputGain = 2.5;

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
    return /this is bhoomi|alliance square|looking for a site in mysuru|are you looking for a site/.test(t);
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

  const customerAnsweredOpening = (raw?: string) => {
    if (!isOutboundCall) return;
    if (!raw || looksLikeOpeningEcho(raw)) return;
    outboundOpeningRepeatDone = true;
    clearOpeningWait();
    injectLiveDataIfReady();
  };

  const armOpeningWait = () => {
    if (!isOutboundCall || outboundOpeningRepeatDone) return;
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
      const repeat = `The customer did not answer. Speak this question out loud once, with audio, then wait. Exact words only — do not add a greeting or a second question: ${OPENING_QUESTION}`;
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
      resetSilenceTimer();
      setTimeout(() => injectLiveDataIfReady(), 1200);
    }, OPENING_WAIT_MS);
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
      console.log(`[GEMINI] Streaming speech to Twilio (${geminiPlaybackRate} Hz → 8 kHz mu-law)`);
    }
    ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: muLawBuffer.toString("base64") } }));
  };

  const playGeminiAudioParts = (parts: any[] | undefined) => {
    if (!parts) return;
    for (const part of parts) {
      const data = part.inlineData?.data || part.audio?.data;
      if (!data) continue;
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
  const VAD_ENERGY_THRESHOLD = 500;
  const VAD_SILENCE_MS = 450;
  let vadIsSpeaking = false;
  let vadSilenceStartedAt: number | null = null;

  const resetSilenceTimer = () => {
    if (isOutboundCall && !outboundOpeningRepeatDone && !outboundGreetingSpoken) {
      return;
    }
    if (isOutboundCall && outboundGreetingSpoken && !outboundOpeningRepeatDone && outboundOpeningWaitTimer) {
      return;
    }
    const now = Date.now();
    if (now - lastSilenceReset < SILENCE_RESET_DEBOUNCE_MS) {
      return;
    }
    lastSilenceReset = now;

    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!geminiSession) return;
      // Customer audio resets this timer; if they speak again after a re-prompt,
      // count goes back to 0 so we don't escalate from earlier quiet stretches.
      repromptCount++;
      if (repromptCount > MAX_REPROMPTS) {
        // CRITICAL: do NOT end the call on silence. Keep waiting quietly.
        // Ending is only allowed when the customer clearly says goodbye.
        console.log(`[GEMINI] Silence after ${MAX_REPROMPTS} soft re-prompts — staying on the line (no auto endCall).`);
        if (silenceTimer) clearTimeout(silenceTimer);
        return;
      }
      console.log(`[GEMINI] Silence detected (${SILENCE_TIMEOUT_MS / 1000}s, soft re-prompt #${repromptCount}/${MAX_REPROMPTS}). NOT ending call.`);

      const repromptText = isOutboundCall
        ? `SILENCE RE-PROMPT: The customer has been quiet for ${SILENCE_TIMEOUT_MS / 1000}+ seconds. Softly and briefly rephrase your last open question IN THE SAME LANGUAGE — do NOT say goodbye, do NOT call endCall, do NOT invent that they are done. Just wait with them.`
        : `SILENCE RE-PROMPT: The customer has been quiet for ${SILENCE_TIMEOUT_MS / 1000}+ seconds on this INBOUND call. Softly and briefly rephrase whichever question you were waiting on, IN THE SAME LANGUAGE. Do NOT say "I'll let you go", do NOT say goodbye, do NOT call endCall — silence is NOT a reason to hang up. Stay on the line.`;

      geminiSession.sendRealtimeInput({ text: repromptText });
    }, SILENCE_TIMEOUT_MS);
  };

  console.log(`[WS] Connected (Twilio/Plivo). Waiting for start event...`);

  ws.on('message', async (data: string) => {
    try {
      const rawMsg = JSON.parse(data);
      const msg = normalizeVoiceEvent(rawMsg);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        const customParams = msg.start.customParameters || {};
        const isOutbound = customParams.isOutbound === 'true';
        isOutboundCall = isOutbound;
        const rawName = customParams.customerName || '';
        const blacklistedNames = ['customer', 'contact', 'lead', 'unknown', 'null', 'undefined', 'unnamed', ''];
        const hasValidName = rawName && !blacklistedNames.includes(rawName.toLowerCase().trim());
        const customerName = hasValidName ? rawName.trim() : '';
        customerPhone = customParams.customerPhone || null;

        console.log(`[WS] Stream started: ${streamSid} | Name: ${customerName || 'N/A'} | Phone: ${customerPhone || 'N/A'} | Outbound: ${isOutboundCall}`);

        const currentDateStr = new Date().toLocaleDateString('en-IN');
        const activeSystemInstruction = isOutboundCall
          ? buildOutboundSystemInstruction(currentDateStr)
          : buildInboundSystemInstruction(currentDateStr);

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

LANGUAGE REMINDER: Reply in whatever Indian language the customer is using (Hindi, Kannada, Tamil, Telugu, Malayalam, Marathi, Gujarati, Punjabi, Bengali, etc., or mixed). Never refuse a language; never stay in English if they switched away from English.
KANNADA REMINDER: Natural everyday Mysuru Kannada — polite, friendly, respectful, professional (not rude/abrupt, not formal textbook). Native pronunciation: correct Kannada consonants/vowels, natural intonation — not English-accented Kannada. Only the five PDF projects. If they only ask office hours: 10–7 (site visits 10–5:30 if relevant) — never 11–7; never push scheduling unless they asked to book.
PROJECT FACTS REMINDER: CNM Apex = South-facing only at ₹5,450/sqft (not North). Booking amount = ₹59,000. Agreement amount / maintenance cost-duration → Sales Manager callback. Do not invent non-PDF projects.
LISTENING REMINDER: Never speak over the customer. If interrupted, stop immediately. Start speaking as soon as they have finished — do not wait for a long pause. Keep replies short so the first words start quickly.
${isOutboundCall ? `PRONUNCIATION: Hunsur is hun-sur / hun-soor ([hˈʌn.sɜː] or [hʊn.suːr]) — never hoo-na-soo-ru, never "Hoo-n-sur".
SPEAK: Always answer with spoken audio. Never stay silent after the customer finishes. Keep the first spoken sentence short so playback starts immediately.
QUALIFY: After interest = yes → purpose (invest vs construct) → budget → only matching projects. Do not dump unrelated layouts. Sridevi landmarks include Near Upcoming Electronic City. UK Square ~1 year / under construction ONLY if they specifically ask whether the project is ready. UK Square site sizes are not in the spec — never 50×80 / 50*80; do not invent a size.
` : ''}

CURRENT DATE: ${currentDateStr}
`;

        let localSession: any;
        try {
          localSession = await ai.live.connect({
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              thinkingConfig: { thinkingLevel: "minimal" },
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  silenceDurationMs: 400,
                  prefixPaddingMs: 20,
                },
              },
              speechConfig: {
                // Indian English voice (en-IN). Female consultant timbre via Kore.
                languageCode: "en-IN",
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
              },
              systemInstruction: `${activeSystemInstruction}\n${runtimeInstructionBase}`,
              tools: [
                { functionDeclarations: [END_CALL_TOOL, BOOK_APPOINTMENT_TOOL, SET_NAME_TOOL, SET_FOLLOW_UP_TOOL, NOT_INTERESTED_TOOL] },
              ],
              inputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                console.log("[GEMINI] Session opened!");
                resetSilenceTimer();
                // NOTE: do NOT send the greeting here. `ai.live.connect` resolves
                // the session object AFTER onopen can fire, and `geminiSession`
                // is only assigned after the await — so sending from onopen was
                // a race that often logged "Session not available" and left the
                // caller in silence. Greeting is sent immediately after the
                // await below, once `geminiSession` is assigned.
              },
              onmessage: async (response: any) => {
                if (response.serverContent?.interrupted) {
                  console.log("[GEMINI] Turn interrupted — clearing playback, listening...");
                  ws.send(JSON.stringify({ event: "clear", streamSid }));
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
                  if (isOutboundCall && !outboundOpeningRepeatDone) {
                    if (!outboundGreetingSpoken) {
                      outboundGreetingSpoken = true;
                      console.log("[GEMINI] Opening question spoken — waiting ~4s for a reply");
                    }
                    armOpeningWait();
                  }
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
                  resetSilenceTimer();
                  const aiText = response.serverContent.modelTurn.parts
                    .map((p: any) => p.text || "")
                    .join(" ");
                  if (aiText) {
                    fullTranscription += `AI: ${aiText}\n`;

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

                if (response.serverContent?.inputTranscription?.text) {
                  resetSilenceTimer();
                  const userText = response.serverContent.inputTranscription.text;
                  customerAnsweredOpening(userText);
                  if (!looksLikeOpeningEcho(userText)) {
                    repromptCount = 0; // customer spoke — clear soft-reprompt streak
                  }
                  // FIX: previously this unconditionally sent a "clear"
                  // event (wiping Priya's outbound audio buffer) on EVERY
                  // transcribed fragment, not just genuine interruptions —
                  // meaning a stray/misheard fragment while Priya was
                  // mid-sentence could clip her off. "clear" is now only
                  // sent from the serverContent.interrupted branch above,
                  // which reflects an actual detected interruption.

                  fullTranscription += `User: ${userText}\n`;
                  if (CUSTOMER_GOODBYE_PATTERN.test(userText)) {
                    customerClearGoodbye = true;
                    console.log(`[GUARD] Clear customer goodbye detected: "${userText.trim()}"`);
                  }

                  if (isFirstResponse && customerPhone) {
                      isFirstResponse = false;
                      const cleanPhone = customerPhone.replace(/\D/g, '');
                      const lowerText = userText.toLowerCase();

                      const interestedKeywords = ['yes', 'yeah', 'sure', 'interested', 'okay', 'plot', 'mysore', 'looking', 'haan', 'han', 'beku', 'vadu', 'sari'];
                      const notInterestedKeywords = ['no', 'not interested', 'stop', 'don\'t', 'busy', 'wrong number', 'nahi', 'beda', 'vaddu', 'alla'];

                      let status: string = 'answered';
                      let interested: boolean | null = null;

                      if (interestedKeywords.some(kw => lowerText.includes(kw))) {
                        status = STATUS.FOLLOW_UP;
                        interested = true;
                      } else if (notInterestedKeywords.some(kw => lowerText.includes(kw))) {
                        status = STATUS.NOT_INTERESTED;
                        interested = false;
                      }

                      try {
                        void prisma.lead.updateMany({
                          where: {
                            phone: { contains: cleanPhone.slice(-10) },
                            status: { notIn: PROTECTED_STATUSES }
                          },
                          data: {
                            status,
                            interested,
                            lastResponse: userText
                          }
                        }).then(() => console.log(`[DB] First response tracked for ${customerPhone}: ${status}`))
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
                        const cleanPhone = customerPhone.replace(/\D/g, '');
                        try {
                          // FIX (data integrity): previously this unconditionally set
                          // status: 'not - interested' for any lead not already
                          // visit-scheduled/follow-up — silently mislabeling every
                          // customer who got useful info and hung up without an
                          // explicit outcome. Now endCall sets a neutral
                          // "call completed" status, and only the notInterested
                          // tool (below) marks a lead as not interested.
                          await prisma.lead.updateMany({
                            where: {
                              phone: { contains: cleanPhone.slice(-10) },
                              status: { notIn: [...PROTECTED_STATUSES, STATUS.NOT_INTERESTED] }
                            },
                            data: {
                              status: STATUS.CALL_COMPLETED,
                            }
                          });
                          console.log(`[DB] Marked call completed for ${customerPhone} (if not already scheduled/followed-up/not-interested)`);
                        } catch (e) {
                          console.error("[DB Error] Failed to mark call completed:", e);
                        }
                      }
                      ws.send(JSON.stringify({ event: "stop", streamSid }));
                      geminiSession?.close();
                      ws.close();
                    }

                    if (call.name === "notInterested") {
                      console.log(`[GEMINI] Customer marked not interested`);
                      if (customerPhone) {
                        const cleanPhone = customerPhone.replace(/\D/g, '');
                        try {
                          await prisma.lead.updateMany({
                            where: {
                              phone: { contains: cleanPhone.slice(-10) },
                              // FIX (data integrity bug): was
                              // `status: { notIn: PROTECTED_STATUSES }`, which
                              // includes FOLLOW_UP. FOLLOW_UP can be set purely
                              // by the crude first-response keyword heuristic
                              // above (a loose match on "yeah"/"okay"/etc. on
                              // the customer's very first utterance) — that's
                              // not an explicit signal and shouldn't be able to
                              // block an explicit, later "no, not interested"
                              // from the same call. Only a confirmed booking
                              // (VISIT_SCHEDULED) is a strong enough signal to
                              // survive an explicit notInterested tool call.
                              status: { notIn: [STATUS.VISIT_SCHEDULED] }
                            },
                            data: { status: STATUS.NOT_INTERESTED, interested: false }
                          });
                          console.log(`[DB] Not-interested set for ${customerPhone}`);
                          toolResponses.push({ name: call.name, response: { success: true }, id: call.id });
                        } catch (e) {
                          console.error("[DB Error] Failed to set not-interested:", e);
                          toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                        }
                      } else {
                        // FIX (silent failure): previously, when customerPhone was
                        // missing, execution fell through with no response pushed
                        // here, and the generic fallback at the bottom of this loop
                        // reported success: true regardless — so the model believed
                        // the update saved when nothing was written. Every branch
                        // below now explicitly reports failure when there's no
                        // phone number to update.
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
                      const cleanPhone = customerPhone.replace(/\D/g, '');
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

                        await prisma.lead.updateMany({
                          where: { phone: { contains: cleanPhone.slice(-10) } },
                          data: {
                            appointmentTime: parsedDate,
                            status: STATUS.VISIT_SCHEDULED,
                            interested: true
                          }
                        });
                        console.log(`[DB] Appointment booked for ${customerPhone} at ${dateTime} (within 10:00–17:30 site-visit window ✓)`);
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
                      const cleanPhone = customerPhone.replace(/\D/g, '');
                      try {
                        await prisma.lead.updateMany({
                          where: { phone: { contains: cleanPhone.slice(-10) } },
                          data: {
                            status: STATUS.FOLLOW_UP,
                            interested: true
                          }
                        });
                        console.log(`[DB] Follow up set for ${customerPhone} (Reason: ${reason})`);
                        toolResponses.push({ name: call.name, response: { success: true, message: `Follow up set. Status updated to follow up.` }, id: call.id });
                      } catch (e) {
                        console.error("[DB Error] Failed to set follow up:", e);
                        toolResponses.push({ name: call.name, response: { success: false, error: "Database error" }, id: call.id });
                      }
                      continue;
                    }

                    if (call.name === "setName") {
                      const { name } = call.args;
                      console.log(`[GEMINI] Setting name to ${name}`);
                      if (!customerPhone) {
                        toolResponses.push({ name: call.name, response: { success: false, error: "No phone number on file for this call — could not save the name." }, id: call.id });
                        continue;
                      }
                      const cleanPhone = customerPhone.replace(/\D/g, '');
                      try {
                        await prisma.lead.updateMany({
                          where: { phone: { contains: cleanPhone.slice(-10) } },
                          data: { name }
                        });
                        console.log(`[DB] Name updated for ${customerPhone}: ${name}`);
                        toolResponses.push({ name: call.name, response: { success: true, message: `Name updated to ${name}` }, id: call.id });
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
              onerror: (err: any) => {
                console.error("[GEMINI Error]:", err);
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
          try {
            ws.send(JSON.stringify({ event: "stop", streamSid }));
          } catch (sendErr) {
            console.error("[WS] Failed to send stop event after connect failure:", sendErr);
          }
          ws.close();
          return;
        }

        geminiSession = localSession;

        // Send greeting only after the session handle is assigned (see onopen note).
        try {
          const greetingText: string = isOutboundCall
            ? getOutboundGreeting(customerName)
            : getInboundGreeting(customerName);
          const instruction = `Speak this greeting out loud now with audio. Exact words: ${greetingText}`;
          console.log(`[GEMINI] Sending greeting for spoken audio`);
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
        if (!geminiSession) return;
        resetSilenceTimer();
        const muLawData = Buffer.from(msg.media.payload, "base64");
        const pcmBuffer = Buffer.alloc(muLawData.length * 4);
        let sumSquares = 0;
        for (let i = 0; i < muLawData.length; i++) {
          const sample = muLawToPcmTable[muLawData[i]];
          sumSquares += sample * sample;
          const boosted = Math.max(-32768, Math.min(32767, Math.round(sample * inputGain)));
          pcmBuffer.writeInt16LE(boosted, i * 4);
          pcmBuffer.writeInt16LE(boosted, i * 4 + 2);
        }
        try {
          geminiSession.sendRealtimeInput({
            audio: { data: pcmBuffer.toString("base64"), mimeType: 'audio/pcm;rate=16000' }
          });

          const rms = muLawData.length > 0 ? Math.sqrt(sumSquares / muLawData.length) : 0;
          const now = Date.now();
          if (rms > VAD_ENERGY_THRESHOLD) {
            if (!vadIsSpeaking) repromptCount = 0;
            vadIsSpeaking = true;
            vadSilenceStartedAt = null;
          } else if (vadIsSpeaking) {
            if (vadSilenceStartedAt === null) {
              vadSilenceStartedAt = now;
            } else if (now - vadSilenceStartedAt >= VAD_SILENCE_MS) {
              vadIsSpeaking = false;
              vadSilenceStartedAt = null;
              if (isOutboundCall && !outboundOpeningRepeatDone) {
                // Greeting echo must not fake a customer utterance during the 4s wait.
                return;
              }
              try {
                geminiSession.sendRealtimeInput({ audioStreamEnd: true });
              } catch (vadErr: any) {
                console.error("[GEMINI] Failed to send audioStreamEnd:", vadErr.message);
              }
            }
          }
        } catch (e: any) {
          console.error("[GEMINI] Failed to send audio:", e.message);
        }
      } else if (msg.event === 'stop') {
        process.stdout.write('\n[WS] Call stopped by Twilio/Plivo\n');
        geminiSession?.close();
      }
    } catch (e) {
      console.error("[WS Message Error]:", e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed');
    if (silenceTimer) clearTimeout(silenceTimer);
    if (outboundOpeningWaitTimer) clearTimeout(outboundOpeningWaitTimer);
    geminiSession?.close();
  });
}