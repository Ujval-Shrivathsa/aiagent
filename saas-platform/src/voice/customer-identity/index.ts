export type {
  CustomerIdentity,
  Gender,
  GenderEvidence,
  MaritalStatus,
  NameSource,
  ResolveIdentityInput,
  Salutation,
} from './types';

export {
  genderConfidenceHigh,
  genderConfidenceMedium,
  canUseGenderedSalutation,
  canUseCautiousSalutation,
} from './config';

export {
  lookupName,
  dictionaryGender,
  dictionaryPronunciation,
  dictionarySize,
  normalizeNameKey,
} from './dictionary';

export {
  parseNameWithTitle,
  parseSalutationToken,
  isProfessionalTitle,
  genderFromSalutation,
} from './parse-title';

export {
  emptyIdentity,
  resolveCustomerIdentity,
  applyCustomerCorrection,
} from './resolve-identity';

export {
  buildFormalDisplayName,
  buildSpokenAddress,
  kannadaHonorific,
  englishSpokenAddress,
} from './spoken-address';

export {
  CUSTOMER_NAME_AND_ADDRESSING_RULES,
  formatIdentityContext,
} from './prompt';
