/** Canonical customer identity for a single call (name → gender → salutation). */

export type Gender = 'male' | 'female' | 'unknown';
export type MaritalStatus = 'married' | 'unmarried' | 'unknown';
export type NameSource =
  | 'user_spoken'
  | 'crm'
  | 'campaign'
  | 'inferred'
  | null;

/** Formal English titles. Professional titles are preserved over Mr/Mrs/Ms. */
export type Salutation =
  | 'Mr.'
  | 'Mrs.'
  | 'Ms.'
  | 'Dr.'
  | 'Prof.'
  | 'Er.'
  | 'CA'
  | null;

export type GenderEvidence =
  | 'explicit_customer'
  | 'crm'
  | 'name_dictionary'
  | 'linguistic'
  | 'none';

export interface CustomerIdentity {
  customer_name_raw: string | null;
  customer_name_normalized: string | null;
  customer_name_pronunciation: string | null;
  customer_gender: Gender;
  customer_gender_confidence: number;
  customer_gender_evidence: GenderEvidence;
  customer_salutation: Salutation;
  customer_salutation_confidence: number;
  customer_marital_status: MaritalStatus;
  customer_name_source: NameSource;
  /** Formal CRM / transcript form, e.g. "Mr. Manjunath" */
  formal_display_name: string | null;
  /** Spoken Kannada address, e.g. "Manjunath ಸರ್" */
  spoken_address: string | null;
  /** Prefer first name only (customer said "just call me Priya") */
  prefer_first_name_only: boolean;
  /** Name was found in the South Indian reference dictionary */
  in_name_dictionary: boolean;
}

export interface ResolveIdentityInput {
  rawName?: string | null;
  source?: NameSource;
  /** Trusted CRM / profile gender when available */
  crmGender?: Gender | null;
  crmMaritalStatus?: MaritalStatus | null;
  /** Explicit title from speech or tool args (Mr/Mrs/Ms/Dr/…) */
  explicitTitle?: string | null;
  maritalStatus?: MaritalStatus | null;
  preferFirstNameOnly?: boolean;
  /** Previous identity on this call — corrections merge on top */
  previous?: CustomerIdentity | null;
}
