import {
  CONF_CRM,
  CONF_DICTIONARY,
  CONF_EXPLICIT,
  CONF_LINGUISTIC,
  canUseGenderedSalutation,
} from './config';
import { dictionaryPronunciation, lookupName } from './dictionary';
import {
  genderFromSalutation,
  isProfessionalTitle,
  parseNameWithTitle,
  parseSalutationToken,
} from './parse-title';
import type {
  CustomerIdentity,
  Gender,
  GenderEvidence,
  MaritalStatus,
  ResolveIdentityInput,
  Salutation,
} from './types';
import { buildFormalDisplayName, buildSpokenAddress } from './spoken-address';

const PLACEHOLDER_NAMES = new Set([
  'customer',
  'contact',
  'lead',
  'unknown',
  'null',
  'undefined',
  'unnamed',
  '',
]);

export function emptyIdentity(): CustomerIdentity {
  return {
    customer_name_raw: null,
    customer_name_normalized: null,
    customer_name_pronunciation: null,
    customer_gender: 'unknown',
    customer_gender_confidence: 0,
    customer_gender_evidence: 'none',
    customer_salutation: null,
    customer_salutation_confidence: 0,
    customer_marital_status: 'unknown',
    customer_name_source: null,
    formal_display_name: null,
    spoken_address: null,
    prefer_first_name_only: false,
    in_name_dictionary: false,
  };
}

function titleCaseName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[\u0C80-\u0CFF]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Very cautious linguistic cues only (4th priority).
 * Never treat these as high-confidence.
 */
function linguisticGender(name: string): { gender: Gender; confidence: number } | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!n || n.length < 4) return null;

  if (/(amma|akka|devi|lakshmi|ammah)$/.test(n)) {
    return { gender: 'female', confidence: CONF_LINGUISTIC };
  }
  if (/(appa|anna|ayya|appaiah)$/.test(n)) {
    return { gender: 'male', confidence: CONF_LINGUISTIC };
  }
  return null;
}

function pickMarital(
  ...candidates: Array<MaritalStatus | null | undefined>
): MaritalStatus {
  for (const c of candidates) {
    if (c && c !== 'unknown') return c;
  }
  return 'unknown';
}

function selectSalutation(opts: {
  gender: Gender;
  genderConfidence: number;
  marital: MaritalStatus;
  explicit: Salutation;
  preferFirstNameOnly: boolean;
}): { salutation: Salutation; confidence: number } {
  if (opts.preferFirstNameOnly) {
    return { salutation: null, confidence: 0 };
  }

  // Preserve professional titles over Mr/Mrs/Ms.
  if (isProfessionalTitle(opts.explicit)) {
    return { salutation: opts.explicit, confidence: CONF_EXPLICIT };
  }

  if (opts.explicit === 'Mrs.' || opts.explicit === 'Ms.' || opts.explicit === 'Mr.') {
    return { salutation: opts.explicit, confidence: CONF_EXPLICIT };
  }

  if (!canUseGenderedSalutation(opts.genderConfidence) || opts.gender === 'unknown') {
    return { salutation: null, confidence: 0 };
  }

  if (opts.gender === 'male') {
    return { salutation: 'Mr.', confidence: opts.genderConfidence };
  }

  // Female: Mrs. only with marital evidence; otherwise Ms.
  if (opts.marital === 'married') {
    return { salutation: 'Mrs.', confidence: Math.min(opts.genderConfidence, 0.95) };
  }
  return { salutation: 'Ms.', confidence: opts.genderConfidence };
}

/**
 * Name → gender → salutation pipeline.
 * Priority: explicit customer → CRM → dictionary → cautious linguistic → unknown.
 */
export function resolveCustomerIdentity(input: ResolveIdentityInput = {}): CustomerIdentity {
  const prev = input.previous ?? emptyIdentity();
  const rawIn = (input.rawName ?? prev.customer_name_raw ?? '').trim();
  if (!rawIn || PLACEHOLDER_NAMES.has(rawIn.toLowerCase())) {
    if (prev.customer_name_normalized) {
      // Allow preference / marital updates without a new name.
      const explicitTitle =
        parseSalutationToken(input.explicitTitle ?? undefined) ??
        prev.customer_salutation;
      return finalize({
        ...prev,
        customer_marital_status: pickMarital(
          input.maritalStatus,
          prev.customer_marital_status,
        ),
        prefer_first_name_only:
          input.preferFirstNameOnly === true || prev.prefer_first_name_only,
        explicitTitle,
      });
    }
    return emptyIdentity();
  }

  const parsed = parseNameWithTitle(rawIn);
  const explicitFromArg = parseSalutationToken(input.explicitTitle ?? undefined);
  const explicitTitle: Salutation = explicitFromArg ?? parsed.salutation;

  const normalizedBase = parsed.name || rawIn;
  const normalized = titleCaseName(normalizedBase.replace(/\s+/g, ' ').trim());
  const dict = lookupName(normalized);
  const pronunciation = dict?.ipa ?? dictionaryPronunciation(normalized);

  let gender: Gender = 'unknown';
  let genderConfidence = 0;
  let evidence: GenderEvidence = 'none';

  // 1. Explicit customer title
  const gFromTitle = genderFromSalutation(explicitTitle);
  if (gFromTitle) {
    gender = gFromTitle;
    genderConfidence = CONF_EXPLICIT;
    evidence = 'explicit_customer';
  }

  // 2. CRM profile
  if (evidence === 'none' && input.crmGender && input.crmGender !== 'unknown') {
    gender = input.crmGender;
    genderConfidence = CONF_CRM;
    evidence = 'crm';
  }

  // 3. Name dictionary (reference only)
  if (evidence === 'none' && dict) {
    gender = dict.gender;
    genderConfidence = CONF_DICTIONARY;
    evidence = 'name_dictionary';
  }

  // 4. Cautious linguistic inference
  if (evidence === 'none') {
    const ling = linguisticGender(normalized);
    if (ling) {
      gender = ling.gender;
      genderConfidence = ling.confidence;
      evidence = 'linguistic';
    }
  }

  // Customer correction on previous call state wins when they restate title
  if (input.previous && explicitTitle && gFromTitle) {
    gender = gFromTitle;
    genderConfidence = CONF_EXPLICIT;
    evidence = 'explicit_customer';
  }

  const marital = pickMarital(
    input.maritalStatus,
    parsed.maritalHint,
    input.crmMaritalStatus,
    explicitTitle === 'Mrs.' ? 'married' : null,
    prev.customer_marital_status,
  );

  const preferFirstNameOnly =
    input.preferFirstNameOnly === true ||
    parsed.preferFirstNameOnly ||
    prev.prefer_first_name_only;

  return finalize({
    customer_name_raw: rawIn,
    customer_name_normalized: normalized,
    customer_name_pronunciation: pronunciation,
    customer_gender: gender,
    customer_gender_confidence: genderConfidence,
    customer_gender_evidence: evidence,
    customer_marital_status: marital,
    customer_name_source: input.source ?? prev.customer_name_source ?? 'inferred',
    prefer_first_name_only: preferFirstNameOnly,
    in_name_dictionary: Boolean(dict),
    explicitTitle,
  });
}

function finalize(
  partial: Omit<
    CustomerIdentity,
    'customer_salutation' | 'customer_salutation_confidence' | 'formal_display_name' | 'spoken_address'
  > & { explicitTitle?: Salutation },
): CustomerIdentity {
  const { salutation, confidence } = selectSalutation({
    gender: partial.customer_gender,
    genderConfidence: partial.customer_gender_confidence,
    marital: partial.customer_marital_status,
    explicit: partial.explicitTitle ?? null,
    preferFirstNameOnly: partial.prefer_first_name_only,
  });

  const identity: CustomerIdentity = {
    customer_name_raw: partial.customer_name_raw,
    customer_name_normalized: partial.customer_name_normalized,
    customer_name_pronunciation: partial.customer_name_pronunciation,
    customer_gender: partial.customer_gender,
    customer_gender_confidence: partial.customer_gender_confidence,
    customer_gender_evidence: partial.customer_gender_evidence,
    customer_salutation: salutation,
    customer_salutation_confidence: confidence,
    customer_marital_status: partial.customer_marital_status,
    customer_name_source: partial.customer_name_source,
    formal_display_name: null,
    spoken_address: null,
    prefer_first_name_only: partial.prefer_first_name_only,
    in_name_dictionary: partial.in_name_dictionary,
  };

  identity.formal_display_name = buildFormalDisplayName(identity);
  identity.spoken_address = buildSpokenAddress(identity);
  return identity;
}

/** Apply an explicit customer correction (title / marital / first-name preference). */
export function applyCustomerCorrection(
  current: CustomerIdentity,
  correction: {
    rawName?: string | null;
    title?: string | null;
    maritalStatus?: MaritalStatus | null;
    preferFirstNameOnly?: boolean;
  },
): CustomerIdentity {
  return resolveCustomerIdentity({
    rawName: correction.rawName ?? current.customer_name_normalized,
    source: 'user_spoken',
    explicitTitle: correction.title,
    maritalStatus: correction.maritalStatus,
    preferFirstNameOnly: correction.preferFirstNameOnly,
    previous: current,
    crmGender: current.customer_gender_evidence === 'crm' ? current.customer_gender : null,
    crmMaritalStatus:
      current.customer_marital_status !== 'unknown' ? current.customer_marital_status : null,
  });
}
