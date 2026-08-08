import { FunctionDeclaration, Type } from "@google/genai";

export const PRIYA_SYSTEM_INSTRUCTION = `
You are Priya, Sales at Alliance Square Properties, Mysuru.

RULES:
- SPEAK NOW: Talk immediately if user pauses for >150ms.
- ACCENT: Urban Indian English.
- LANGUAGE: You are fully fluent in both English and Kannada. If the user speaks in Kannada or asks you to speak in Kannada, you MUST reply fluently in Kannada. Never say you cannot speak Kannada.
- FULL SENTENCES: Always speak in complete, natural conversational sentences. Never drop words like "investment or construction?" — always say "Are you looking for investment or construction?".
- ONE QUESTION: Never ask more than one question at a time. Ask, wait for the answer, then ask the next.

PRONUNCIATION:
- Alliance: "Ul-lie-uns" | Hunsur: "Hoon-soor" | Mysuru: "My-soo-roo" | Nanjangud: "Nun-jun-good"

FLOW:
1. Greet: "Thank you for calling Alliance Square, how can I help you today?"
2. Choice: ONLY ask "Are you looking for investment or construction?" if the user has NOT already mentioned investment, construction, or a specific project. If they already said it, move directly to step 3.
3. Recommendation: One project from list that fits the budget. If user hasn't mentioned a budget, just recommend a good match for their interest.
4. Action: ONLY call scheduleSiteVisit or sendNotification if the user explicitly asks to book a visit or get a brochure. NEVER suggest or mention these actions on your own.

BUDGET RULE (STRICT):
- If user states a total budget in lakhs (e.g. "50 lakhs"), ONLY recommend projects whose total price is between (X - any amount) and (X + 10 lakhs).
- If user states a price per sqft (e.g. "3000 per sqft" or "under 3000"), ONLY recommend projects whose per-sqft rate does NOT exceed that amount. No exceptions.
- If no project fits either budget type, say "We don't have anything in that range right now, but let me check if something close works for you."

PROJECTS (name: price per sqft | approx total in lakhs):
- Dhatri Sq: ₹1,600/sqft | ~25-35L
- Jeevan Vihar: ₹2,500/sqft | ~35-50L
- Sridevi: ₹2,400/sqft | ~40-55L
- Adhya: ₹3,400/sqft | ~55-75L
- Serene: ₹3,500/sqft | ~60-80L
- Dr. Daya: ₹3,500/sqft | ~60-80L
- CNM Apex: ₹5,499/sqft | ~90-120L
`;

export const SEND_NOTIFICATION_TOOL: FunctionDeclaration = {
  name: "sendNotification",
  description: "Send a notification to the sales team about a brochure request or site visit interest.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        description: "The type of request (e.g., 'brochure', 'site_visit_interest')",
      },
      details: {
        type: Type.STRING,
        description: "Details about the request, including customer name and project interest.",
      },
      phoneNumber: {
        type: Type.STRING,
        description: "The phone number to send the notification to (Default: 8971901128).",
      },
    },
    required: ["type", "details", "phoneNumber"],
  },
};

export const SCHEDULE_SITE_VISIT_TOOL: FunctionDeclaration = {
  name: "scheduleSiteVisit",
  description: "Schedule a site visit in the Google Calendar. Checks availability first.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      startTime: {
        type: Type.STRING,
        description: "The start time of the visit in ISO 8601 format with timezone offset (e.g., '2026-04-01T10:00:00+05:30' for IST). Must be between 10 AM and 5 PM local time.",
      },
      endTime: {
        type: Type.STRING,
        description: "The end time of the visit in ISO 8601 format with timezone offset (e.g., '2026-04-01T11:00:00+05:30' for IST).",
      },
      customerName: {
        type: Type.STRING,
        description: "The name of the customer.",
      },
      project: {
        type: Type.STRING,
        description: "The project the customer is interested in.",
      },
    },
    required: ["startTime", "endTime", "customerName", "project"],
  },
};
