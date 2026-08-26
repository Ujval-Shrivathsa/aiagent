/**
 * How site dimensions, pricing, and units should be spoken on phone calls.
 * Gemini Live reads model text aloud — write numbers the way they should sound.
 * normalizeSpokenNumbers() in tts-text.ts applies the same rules for tests/helpers.
 */

export const SPOKEN_PRICING_AND_DIMENSIONS_RULES = `SPOKEN PRICING & SITE DIMENSIONS (STRICT — Kannada primary; match customer language):

WRITE FOR THE EAR — your text becomes speech immediately. Never output symbol-heavy lines like "₹3,300/sq.ft." or "30×40" without speaking form.

=== SITE DIMENSIONS (all languages) ===
- 30×40 / 30x40 / 30*40 → say "30 by 40" (natural Mysuru telecaller style). Optional: "30 by 40 feet site".
- Same for 30×50, 40×60, 30×odd — "30 by 50", "40 by 60", "30 odd size site" / "odd dimension site".
- Do NOT say "thirty multiplied by forty", "three zero four zero", or read symbols literally.
- UK Square: site dimensions are NOT in the PDF — never invent 50×80 / 50 by 80 or any size there.

=== KANNADA / KANGLISH (DEFAULT on this call) ===
- Prefer clear Kanglish locals use: "30 by 40 site", "2500 per square feet", "25 lakhs budget".
- NEVER say "sqft" or "sq ft" — TTS mispronounces it in Kannada. Always say "square feet" in full.
- Price examples (speak slowly, one beat between parts):
  - ₹2,500/sqft → "2500 per square feet" or "square feet ಗೆ 2500 rupees"
  - ₹3,300–₹3,400 → "3300 to 3400 per square feet"
  - ₹5,450 → "5450 per square feet"
  - ₹59,000 booking → "59 thousand booking amount" / "59 thousand rupees"
  - Budget: "20 to 25 lakhs range", "50 lakhs budget"
- SR / guideline value: "SR value 1200 per square feet" — do not mumble "₹1,200/sq.ft." or "sqft"
- Facings: "East facing site", "West facing available", "South facing only"
- Area: "8.15 acres", "144 sites", "20 acre layout" — say digits clearly

=== ENGLISH (when customer speaks clear English) ===
- "Two thousand five hundred rupees per square foot onwards"
- "Three thousand three hundred to three thousand four hundred rupees per square foot"
- "Five thousand four hundred fifty rupees per square foot"
- "Thirty by forty feet site"
- "Fifty-nine thousand rupees booking amount"
- "Twenty-five lakh budget" or "25 lakh budget" — Indian English uses lakh/lakhs

=== HINDI / TAMIL / TELUGU / MALAYALAM / OTHER INDIAN LANGUAGES ===
- Keep the SAME factual numbers — never change price or size.
- Dimensions: local number words OR "30 by 40" (widely understood on property calls).
- Per sqft / square feet: keep as loanword where natural on phone calls.
- Lakhs/crores: use what that language normally uses in real estate ( lakh / lakhs / லட்சம் / లక్షలు etc. ) — still say the number clearly.
- Do not switch to English just to read a price — pronounce it naturally in their language.

=== UNITS & SYMBOLS ===
- NEVER output "sqft", "sq ft", or "sq. ft." — always say "square feet" / "per square feet" in full (Kannada and English turns).
- ₹ — say "rupees" (or "ರೂ" / "rupaye" in Hindi) — never only the symbol.
- Commas in prices (3,300) confuse TTS — in your spoken reply prefer "3300" without commas.
- Ranges: "3300 to 3400", not "3300-3400" dashed quickly.

When quoting from the PDF spec, speak the exact figure — only change formatting so it sounds natural on a phone.
`;

/** Normalize dimension separators for speech. */
function normalizeDimensions(text: string): string {
  return text
    .replace(/(\d+)\s*[×xX*]\s*(\d+)/g, '$1 by $2')
    .replace(/(\d+)\s*[×xX*]\s*odd\b/gi, '$1 odd size');
}

/** Strip commas inside rupee amounts and tighten unit abbreviations. */
function normalizePricesAndUnits(text: string): string {
  let out = text;
  // ₹3,300 → ₹3300
  out = out.replace(/₹\s*([\d]{1,3}(?:,\d{3})+(?:\.\d+)?)/g, (_, num: string) => `₹${num.replace(/,/g, '')}`);
  // Standalone comma-separated thousands in price context
  out = out.replace(/\b(\d{1,2}),(\d{3})\b/g, '$1$2');
  out = out.replace(/\b(\d),(\d{3})\/(\s*sq)/gi, '$1$2/$3');
  // Unit shorthand → full "square feet" (sqft TTS sounds wrong in Kannada)
  out = out.replace(/\bper\s*sq\.?\s*ft\.?/gi, 'per square feet');
  out = out.replace(/\bper\s*sqft\b/gi, 'per square feet');
  out = out.replace(/\bsq\.?\s*ft\.?/gi, 'square feet');
  out = out.replace(/\bsqft\b/gi, 'square feet');
  out = out.replace(/\/\s*sq\.?\s*ft\.?/gi, ' per square feet');
  out = out.replace(/\/sqft/gi, ' per square feet');
  out = out.replace(/\/square feet/gi, ' per square feet');
  // En/em dash ranges between numbers → " to "
  out = out.replace(/(\d)\s*[–—-]\s*(\d)/g, '$1 to $2');
  out = out.replace(/(₹\d+)\s*[–—-]\s*(₹\d+)/g, '$1 to $2');
  return out;
}

/**
 * Prepare numbers, dimensions, and units for phone TTS / native audio.
 * Safe for both Kannada and English replies.
 */
export function normalizeSpokenNumbers(text: string, _language?: 'kn-IN' | 'en-IN'): string {
  if (!text) return '';
  let out = normalizeDimensions(text);
  out = normalizePricesAndUnits(out);
  // Space around ₹ for clearer pronunciation
  out = out.replace(/₹(\d)/g, '₹ $1').replace(/\s+/g, ' ').trim();
  return out;
}

/** Compact runtime reminder for logic.ts. */
export const SPOKEN_PRICING_RUNTIME_REMINDER =
  'PRONUNCIATION: Site sizes as "30 by 40" not × symbols. Prices as "3300 per square feet" / "59 thousand rupees" — never "sqft". Lakhs clear. Match customer language for numbers.';
