import type { MaritalStatus, Salutation } from './types';

const TITLE_ALIASES: Record<string, Salutation> = {
  mr: 'Mr.',
  mister: 'Mr.',
  mrs: 'Mrs.',
  missus: 'Mrs.',
  ms: 'Ms.',
  miss: 'Ms.',
  dr: 'Dr.',
  doctor: 'Dr.',
  prof: 'Prof.',
  professor: 'Prof.',
  er: 'Er.',
  engineer: 'Er.',
  ca: 'CA',
};

const PROFESSIONAL: ReadonlySet<Salutation> = new Set(['Dr.', 'Prof.', 'Er.', 'CA']);

/** Titles that should not be overwritten by Mr/Mrs/Ms inference. */
export function isProfessionalTitle(s: Salutation): boolean {
  return s != null && PROFESSIONAL.has(s);
}

export function parseSalutationToken(token: string | null | undefined): Salutation {
  if (!token?.trim()) return null;
  const key = token.trim().replace(/\./g, '').toLowerCase();
  return TITLE_ALIASES[key] ?? null;
}

export interface ParsedSpokenName {
  salutation: Salutation;
  name: string;
  /** Customer asked to drop titles and use first name */
  preferFirstNameOnly: boolean;
  maritalHint: MaritalStatus;
}

/**
 * Pull an optional title out of a raw spoken / CRM name string.
 * Examples: "Mr. Ramesh", "Mrs Lakshmi", "Dr. Ravi Kumar"
 */
export function parseNameWithTitle(raw: string | null | undefined): ParsedSpokenName {
  const empty: ParsedSpokenName = {
    salutation: null,
    name: '',
    preferFirstNameOnly: false,
    maritalHint: 'unknown',
  };
  if (!raw?.trim()) return empty;

  let text = raw.trim();
  let preferFirstNameOnly = false;
  let maritalHint: MaritalStatus = 'unknown';

  // "just call me Priya" / "call me Priya"
  const justCall = text.match(
    /(?:just\s+)?(?:call|address)\s+me(?:\s+as)?\s+([A-Za-z\u0C80-\u0CFF][\w.'-]*)/i,
  );
  if (justCall?.[1]) {
    preferFirstNameOnly = true;
    text = justCall[1];
  }

  // "I am Mrs. Lakshmi" / "This is Mr. Ramesh"
  const intro = text.match(
    /^(?:i\s+am|i'm|this\s+is|my\s+name\s+is|nanna\s+hesaru)\s+(.+)$/i,
  );
  if (intro?.[1]) text = intro[1].trim();

  const titleMatch = text.match(
    /^(mr|mrs|ms|miss|mister|missus|dr|doctor|prof|professor|er|engineer|ca)\.?\s+(.+)$/i,
  );
  let salutation: Salutation = null;
  let name = text;
  if (titleMatch) {
    salutation = parseSalutationToken(titleMatch[1]);
    name = titleMatch[2].trim();
    if (salutation === 'Mrs.') maritalHint = 'married';
  }

  // Strip trailing honorifics sometimes transcribed: "Manjunath sir"
  name = name.replace(/\s+(sir|madam|ma'?am|ಸರ್|ಮ್ಯಾಡಮ್)\.?$/i, '').trim();

  return {
    salutation,
    name,
    preferFirstNameOnly,
    maritalHint,
  };
}

/** Title gender implication (only for Mr/Mrs/Ms). */
export function genderFromSalutation(s: Salutation): 'male' | 'female' | null {
  if (s === 'Mr.') return 'male';
  if (s === 'Mrs.' || s === 'Ms.') return 'female';
  return null;
}
