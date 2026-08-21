/**
 * Configurable confidence thresholds for gender / salutation use.
 * Env overrides avoid hard-coding throughout the app.
 */

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Safe to use Mr./Mrs./Ms. or ಸರ್/ಮ್ಯಾಡಮ್ confidently */
export function genderConfidenceHigh(): number {
  return envFloat('VOICE_GENDER_CONFIDENCE_HIGH', 0.9);
}

/** Cautious use only (context-dependent) */
export function genderConfidenceMedium(): number {
  return envFloat('VOICE_GENDER_CONFIDENCE_MED', 0.7);
}

export function canUseGenderedSalutation(confidence: number): boolean {
  return confidence >= genderConfidenceHigh();
}

export function canUseCautiousSalutation(confidence: number): boolean {
  return confidence >= genderConfidenceMedium();
}

/** Confidence assigned when gender comes from an explicit customer title */
export const CONF_EXPLICIT = 1.0;
/** Trusted CRM profile gender */
export const CONF_CRM = 0.95;
/** Hit in South Indian name reference dictionary */
export const CONF_DICTIONARY = 0.92;
/** Weak linguistic suffix cues only */
export const CONF_LINGUISTIC = 0.72;
