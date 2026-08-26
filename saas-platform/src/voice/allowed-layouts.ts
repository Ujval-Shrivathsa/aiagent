/**
 * The ONLY five Alliance Square projects from Project-Specific Content PDF.
 * Every prompt, live-data filter, and runtime guard must use this module.
 */

export const ALLOWED_LAYOUT_NAMES = [
  'UK Square',
  'Sridevi Lake View',
  'CNM Apex City',
  'Alliance Serene Phase 2',
  'Adhya Enclave',
] as const;

export type AllowedLayoutName = (typeof ALLOWED_LAYOUT_NAMES)[number];

/** Common website / legacy names that must NEVER be spoken or recommended. */
export const FORBIDDEN_LAYOUT_NAMES = [
  'Jeevan Vihar',
  'Jeevan Vihar Phase 2',
  'Dhatri Square',
  'Dr. Daya Nagar',
  'Alliance Serene Phase 1',
  'Serene Phase 1',
] as const;

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bjeevan\s*vihar\b/i, label: 'Jeevan Vihar' },
  { pattern: /\bdhatri\s*square\b/i, label: 'Dhatri Square' },
  { pattern: /\bdr\.?\s*daya\s*nagar\b/i, label: 'Dr. Daya Nagar' },
  { pattern: /\balliance\s*serene\s*phase\s*1\b/i, label: 'Alliance Serene Phase 1' },
  { pattern: /\bserene\s*phase\s*1\b/i, label: 'Serene Phase 1' },
];

export function isAllowedLayoutName(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return ALLOWED_LAYOUT_NAMES.some(
    (allowed) => n.includes(allowed.toLowerCase()) || allowed.toLowerCase().includes(n),
  );
}

/** Returns the forbidden layout label if text mentions a non-PDF project. */
export function detectForbiddenLayoutMention(text: string): string | null {
  const raw = String(text || '');
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(raw)) return label;
  }
  return null;
}

/** Comma-separated list for runtime reminders. */
export function allowedLayoutsList(): string {
  return ALLOWED_LAYOUT_NAMES.join(', ');
}

/**
 * Hard prompt block — inject early in inbound + outbound system instructions.
 */
export const ALLOWED_LAYOUTS_ONLY_RULES = `ALLOWED LAYOUTS — ABSOLUTE RULE (Project-Specific Content PDF):

You may ONLY discuss, recommend, price, or describe these FIVE Alliance Square projects:
1) UK Square — investment
2) Sridevi Lake View — investment
3) CNM Apex City — ready construction
4) Alliance Serene Phase 2 — ready construction
5) Adhya Enclave — ready construction

NEVER mention, recommend, confirm, or imply any other Alliance Square layout exists — including names that may appear on the website but are NOT in this PDF (e.g. Jeevan Vihar, Dhatri Square, Dr. Daya Nagar, Serene Phase 1, or any other project).

If the customer asks "what projects / layouts do you have?":
- Name ONLY projects from the list above.
- Do NOT dump all five at once unless they explicitly ask for the full list.
- Match their purpose: investment → UK Square / Sridevi Lake View; construction → Serene Phase 2 / CNM Apex City.

If they ask about a project NOT in the list above:
- Do NOT invent details or say "we might have something there."
- Say naturally that you don't have that project on this call. Do NOT keep offering to call the Sales Manager — mention at most once if needed, then wait for the customer. Or redirect to the closest matching allowed project if purpose/budget fits.

Live website data, general knowledge, or caller suggestions must NOT add projects beyond these five. PDF spec always wins.
`;
