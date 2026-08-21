import { canUseGenderedSalutation } from './config';
import type { CustomerIdentity } from './types';

/** Formal CRM / written form: "Mr. Manjunath", "Ms. Priya", or bare name. */
export function buildFormalDisplayName(identity: CustomerIdentity): string | null {
  const name = identity.customer_name_normalized;
  if (!name) return null;
  if (identity.prefer_first_name_only) return name;

  const sal = identity.customer_salutation;
  if (sal && canUseGenderedSalutation(identity.customer_salutation_confidence)) {
    // Professional titles and gender titles both prefix the name.
    if (sal === 'CA') return `CA ${name}`;
    return `${sal} ${name}`;
  }
  // Professional titles always display even if gender confidence path differed
  if (sal === 'Dr.' || sal === 'Prof.' || sal === 'Er.' || sal === 'CA') {
    return sal === 'CA' ? `CA ${name}` : `${sal} ${name}`;
  }
  return name;
}

/**
 * Spoken conversational address for Kannada calls.
 * Prefers "Manjunath ಸರ್" / "Priya ಮ್ಯಾಡಮ್" over spoken "Mr./Mrs.".
 */
export function buildSpokenAddress(identity: CustomerIdentity): string | null {
  const name = identity.customer_name_normalized;
  if (!name) return null;
  if (identity.prefer_first_name_only) return name;

  const honorific = kannadaHonorific(identity);
  if (honorific) return `${name} ${honorific}`;
  return name;
}

/** Natural Kannada honorific alone: ಸರ್ / ಮ್ಯಾಡಮ್ / null */
export function kannadaHonorific(identity: CustomerIdentity | null | undefined): string | null {
  if (!identity || identity.prefer_first_name_only) return null;
  if (!canUseGenderedSalutation(identity.customer_gender_confidence)) return null;
  if (identity.customer_gender === 'male') return 'ಸರ್';
  if (identity.customer_gender === 'female') return 'ಮ್ಯಾಡಮ್';
  return null;
}

/** Short English spoken form when not using Kannada honorifics. */
export function englishSpokenAddress(identity: CustomerIdentity): string | null {
  return buildFormalDisplayName(identity);
}
