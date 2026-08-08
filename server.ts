import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { GoogleGenAI, Modality, Type, ThinkingLevel } from "@google/genai";
import { PRIYA_SYSTEM_INSTRUCTION, SEND_NOTIFICATION_TOOL, SCHEDULE_SITE_VISIT_TOOL } from "./src/constants";

import fs from "fs";

dotenv.config({ path: ".env.local" });
dotenv.config();

const LEADS_FILE = path.join(process.cwd(), "leads.json");

// Initialize leads file
if (!fs.existsSync(LEADS_FILE)) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify([], null, 2));
}

function getLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveLead(lead: any) {
  const leads = getLeads();
  leads.unshift({
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...lead
  });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "alliance-square-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      sameSite: "lax",
      httpOnly: true,
    },
  })
);

// --- Google Auth & Calendar Setup ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL || "http://localhost:3000"}/auth/setup-callback`
);

const CALENDAR_ID = "avacadonujval@gmail.com";

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}

// --- Priya System Instructions & Tools ---
const TOOLS = [
  { functionDeclarations: [SEND_NOTIFICATION_TOOL, SCHEDULE_SITE_VISIT_TOOL] }
];

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

// --- Twilio Voice Webhook ---
app.post("/api/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${req.headers.host}/media-stream" />
      </Connect>
    </Response>
  `);
});

// --- WebSocket Bridge (Twilio <-> Gemini) ---
wss.on("connection", (ws: WebSocket) => {
  console.log("[WS] Twilio connected");
  let streamSid: string | null = null;
  let geminiSession: any = null;
  let startTime = Date.now();
  let callState: any = { 
    clientName: "Unknown", 
    phoneNumber: "Unknown", 
    project: "General Inquiry", 
    location: "N/A",
    status: "follow up" 
  };
  let transcriptCount = 0;

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const setupGemini = async () => {
    try {
      console.log("[GEMINI] Connecting via Official SDK...");
      geminiSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          },
          systemInstruction: `${PRIYA_SYSTEM_INSTRUCTION}\n\nCURRENT DATE AND TIME: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' })}\nUSER TIMEZONE: Asia/Kolkata`,
          tools: TOOLS,
          // @ts-ignore - Fast VAD with lower sensitivity to ignore background noise
          automaticActivityDetection: {
            silenceDurationMs: 250,
            startOfSpeechSensitivity: 0.3,
            endOfSpeechSensitivity: 0.5,
          },
          // @ts-ignore - Fallback turn detection key
          turnDetection: {
            automatic: {
              silenceDurationMs: 250,
            },
          },
          // @ts-ignore - Flattened generationConfig
          candidateCount: 1,
          temperature: 0.5,
          topP: 0.8,
          topK: 40,
        },
        callbacks: {
          onopen: () => {
            console.log("[GEMINI] Session opened! Sending greeting...");
            // Small delay helps prevent 'busy' failures
            setTimeout(() => {
              if (geminiSession) {
                geminiSession.sendRealtimeInput({ 
                  text: "Say exactly this: Thank you for calling Alliance Square, how can I help you today?" 
                });
              }
            }, 500);
          },
          onmessage: async (msg: any) => {
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const pcmBuffer = Buffer.from(part.inlineData.data, "base64");
                  const muLawBuffer = Buffer.alloc(Math.floor(pcmBuffer.length / 6));
                  for (let i = 0; i < muLawBuffer.length; i++) {
                    const offset = i * 6;
                    if (offset + 2 > pcmBuffer.length) break;
                    const sample = pcmBuffer.readInt16LE(offset);
                    muLawBuffer[i] = pcmToMuLaw(sample);
                  }
                  ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: muLawBuffer.toString("base64") } }));
                }
              }
            }
            if (msg.toolCall) {
              console.log("[GEMINI] Tool call received:", msg.toolCall);
              const toolResponses = [];
              for (const call of msg.toolCall.functionCalls) {
                let response;
                // Update callState based on tool arguments
                if (call.args.customerName) callState.clientName = call.args.customerName;
                if (call.args.phoneNumber) callState.phoneNumber = call.args.phoneNumber;
                if (call.args.project) callState.project = call.args.project;

                if (call.name === "scheduleSiteVisit") {
                  response = await handleSchedule(call.args);
                  callState.status = response.success ? "scheduled visit" : "follow up (busy)";
                } else if (call.name === "sendNotification") {
                  console.log("[NOTIFY] Brochure requested:", call.args);
                  response = { success: true, message: "Sales team notified." };
                  callState.status = "Brochure Sent";
                }
                toolResponses.push({ name: call.name, response: response, id: call.id });
              }
              geminiSession.sendToolResponse({ functionResponses: toolResponses });
            }

            if (msg.serverContent?.modelTurn) transcriptCount++;
          },
          onclose: (event: any) => {
            console.warn(`[GEMINI] Connection closed. ${event}`);
            const duration = Math.round((Date.now() - startTime) / 1000);
            
            // SAVE LEAD: Save every call that lasted more than 3 seconds
            if (duration > 3) {
              const newLead = {
                ...callState,
                date: new Date().toLocaleDateString('en-IN'),
                time: new Date().toLocaleTimeString('en-IN'),
                duration: `${duration}s`,
                summary: `Call lasted ${duration}s. AI turns: ${transcriptCount}.`
              };
              saveLead(newLead);
              console.log("✅ LEAD SAVED TO CRM:", newLead.clientName);
            }
          },
          onerror: (err: any) => console.error("[GEMINI] Error:", err)
        }
      });
      console.log("[GEMINI] Connected!");
    } catch (error) {
      console.error("[GEMINI] Failed to setup session:", error);
    }
  };

  ws.on("message", async (data: string) => {
    const msg = JSON.parse(data);
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      console.log("[WS] Stream started:", streamSid);
      await setupGemini();
    } else if (msg.event === "media") {
      if (!geminiSession) return;
      
      const muLawData = Buffer.from(msg.media.payload, "base64");
      const pcmBuffer = Buffer.alloc(muLawData.length * 4);
      for (let i = 0; i < muLawData.length; i++) {
        const sample = muLawToPcmTable[muLawData[i]];
        pcmBuffer.writeInt16LE(sample, i * 4);
        pcmBuffer.writeInt16LE(sample, i * 4 + 2);
      }
      try {
        if (geminiSession) {
          geminiSession.sendRealtimeInput({
            audio: { data: pcmBuffer.toString("base64"), mimeType: 'audio/pcm;rate=16000' }
          });
        }
      } catch (e: any) {
        console.error("[GEMINI] Failed to send audio:", e.message);
      }
    } else if (msg.event === "stop") {
      console.log("[WS] Call ended");
      geminiSession?.close();
    }
  });
});

async function handleSchedule(args: any) {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    console.log("[CALENDAR] AI Requested:", args);
    
    // Defensive parsing
    if (!args.startTime) throw new Error("Missing start time");
    const startDate = new Date(args.startTime);
    if (isNaN(startDate.getTime())) throw new Error("Invalid start time format: " + args.startTime);
    
    // Autogenerate endTime as 1 hour after if missing or invalid
    let endDate = new Date(args.endTime);
    if (isNaN(endDate.getTime())) {
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000); 
    }

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    console.log("[CALENDAR] Checking actual bounds:", startIso, "to", endIso);

    // Availability check removed to allow overlapping appointments

    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: { 
        summary: `Site Visit: ${args.customerName || 'Customer'}`, 
        description: `Project: ${args.project || 'Interest'}`, 
        start: { dateTime: startIso }, 
        end: { dateTime: endIso } 
      }
    });
    console.log("[CALENDAR] Successfully booked slot!");
    return { success: true };
  } catch (e: any) {
    console.error(`[CALENDAR API Error]: ${e.message}`);
    return { success: false, message: "Internal calendar error. Tell the user you cannot book slots right now." };
  }
}

// --- Web App Endpoints ---
app.post("/api/calendar/check-availability", async (req, res) => {
  const { startTime, endTime } = req.body;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    const avail = await calendar.events.list({ calendarId: CALENDAR_ID, timeMin: startTime, timeMax: endTime, singleEvents: true });
    const busy = (avail.data.items || []).filter(e => e.transparency !== "transparent").length > 0;
    res.json({ isAvailable: !busy });
  } catch (e) {
    res.status(500).json({ error: "Failed to check availability" });
  }
});

app.post("/api/calendar/schedule", async (req, res) => {
  const result = await handleSchedule(req.body);
  res.json(result);
});

app.post("/api/notify", (req, res) => {
  console.log("[NOTIFY] Brochure requested:", req.body);
  // Auto-save web lead
  saveLead({
    clientName: req.body.details?.split(":")[1]?.trim() || "Web Client",
    phoneNumber: req.body.phoneNumber || "Unknown",
    project: req.body.type || "Brochure",
    status: "Lead Captured",
    summary: "Lead captured via Web Dashboard notification tool.",
    date: new Date().toLocaleDateString('en-IN'),
    time: new Date().toLocaleTimeString('en-IN'),
    duration: "Web Sess"
  });
  res.json({ success: true, message: "Sales team notified." });
});

app.get("/api/leads", (req, res) => {
  res.json(getLeads());
});

app.post("/api/leads", (req, res) => {
  saveLead(req.body);
  res.json({ success: true });
});

// --- Rest of the API & Auth routes ---
app.get("/api/auth/setup", (req, res) => {
  res.json({ url: oauth2Client.generateAuthUrl({ access_type: "offline", scope: ["https://www.googleapis.com/auth/calendar"], prompt: "consent" }) });
});
app.get("/auth/setup-callback", async (req, res) => {
  const { tokens } = await oauth2Client.getToken(req.query.code as string);
  console.log("REFRESH_TOKEN:", tokens.refresh_token);
  res.send("Success! Check server logs.");
});

// --- Vite Integration ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => res.sendFile(path.join(process.cwd(), "dist", "index.html")));
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
