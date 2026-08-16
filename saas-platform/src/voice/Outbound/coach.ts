import { GoogleGenAI } from '@google/genai';

const COACH_MODEL_PRIMARY = 'gemini-2.5-flash';
const COACH_MODEL_FALLBACK = 'gemini-2.0-flash';
const COACH_TIMEOUT_MS = 900;

const COACH_SYSTEM = `You are a silent coach for Bhoomi, Alliance Square's outbound voice agent in Mysuru.
You NEVER speak to the customer. You only tell Bhoomi what to say next.

SCOPE — ALLIANCE SQUARE ONLY:
- Residential sites/layouts of Alliance Square only.
- If the customer asked anything else (movies, news, other builders, general knowledge), tell Bhoomi to redirect to Alliance Square sites. Do not invent other topics.

ALLOWED PROJECTS ONLY:
1) UK Square — investment; upcoming Mysuru–Kushalnagara National Highway near Hunsur Road; ₹3,300–₹3,400/sqft; UNDER CONSTRUCTION; amenities planned, not completed; do NOT volunteer the ~1 year timeline unless they ask when it will be ready (then: tentative/approximate, not guaranteed); ask-only: E/N/W facing (not South); SR ₹1,200; Yachenahalli / Yelwala.
2) Sridevi Lake View — investment; off T. Narasipura Road; from ₹2,500/sqft; East/West only; 8.15 acres / 144 sites; SR ₹1,200; Varakodu / Varuna.
3) CNM Apex City — ready construction; Srirampura Ring Road; South ₹5,450 only (E/N/W sold out); MUDA + RERA; 3.5 acres / 72; SR ₹3,500.
4) Alliance Serene Phase 2 — ready construction; off Bannur Road; South ₹3,350 / North ₹3,450; N/S only.
5) Adhya Enclave — ready construction; Chamalapura, Nanjangud; ₹3,500; ask-only West facing; 3 acres / 48; SR ₹2,000.

RULES:
- Always say "site" never "plot".
- After opening Yes → next ask budget; do not dump projects before budget.
- Investment → UK Square / Sridevi. Construction → Serene Phase 2 / CNM Apex.
- Budget gap ≤ ₹5 lakh: stay on current project, invite a stretch; > ₹5 lakh: other listed projects.
- Unknown fact → AI agent + Sales Manager callback. Never invent prices, distances, or projects.
- Unlisted distance → Sales Manager callback (no live Maps).
- Booking amount ₹59,000; agreement/maintenance cost-duration → Sales Manager.
- Office 10:00–19:00; site visits 10:00–17:30.
- One question max in Bhoomi's next spoken turn.
- Match the customer's language (Kannada = natural Mysuru Kannada).

Reply in 2–5 short bullets for Bhoomi only: what they asked, which facts to use, what NOT to say, the single next question if any. No greeting. No customer-facing script dump.`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function generateCoach(ai: GoogleGenAI, model: string, userText: string, recent: string): Promise<string> {
  const res = await ai.models.generateContent({
    model,
    contents: `Recent call (may be incomplete):\n${recent.slice(-1800)}\n\nLatest customer utterance:\n${userText}\n\nCoach Bhoomi now.`,
    config: {
      systemInstruction: COACH_SYSTEM,
      temperature: 0.2,
      maxOutputTokens: 220,
    },
  });
  return (res.text || '').trim();
}

/**
 * Outbound-only: a second Gemini listens to the customer and briefs the live voice agent.
 * Returns null on timeout/error so the voice path never stalls.
 */
export async function coachOutboundTurn(userText: string, recentTranscript: string): Promise<string | null> {
  const trimmed = userText.trim();
  if (!trimmed || trimmed.length < 2) return null;

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const run = async () => {
    try {
      return await generateCoach(ai, COACH_MODEL_PRIMARY, trimmed, recentTranscript);
    } catch {
      return await generateCoach(ai, COACH_MODEL_FALLBACK, trimmed, recentTranscript);
    }
  };

  const text = await withTimeout(run(), COACH_TIMEOUT_MS);
  if (!text) return null;
  return text.slice(0, 900);
}
