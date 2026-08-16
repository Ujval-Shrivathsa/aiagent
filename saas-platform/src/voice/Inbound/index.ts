/**
 * Inbound agent entry — re-exports the canonical call guide.
 * Source of truth: ../callguide.ts (from Call agent/callguide.ts)
 */
export {
  GREETING_NO_NAME,
  GREETING,
  getGreeting,
  REDIRECT_VARIANTS,
  UNKNOWN_DETAIL_VARIANTS,
  UNKNOWN_AREA_VARIANTS,
  PRONUNCIATION_GUIDE,
  buildInboundSystemInstruction,
  INBOUND_SYSTEM_INSTRUCTION,
} from '../callguide';

export { default } from '../callguide';
