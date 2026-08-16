/**
 * Outbound agent entry — re-exports the outbound call guide.
 * Source of truth: ./callguide.ts (replica of inbound; greeting differs).
 */
export {
  GREETING_NO_NAME,
  GREETING,
  getGreeting,
  REDIRECT_VARIANTS,
  UNKNOWN_DETAIL_VARIANTS,
  UNKNOWN_AREA_VARIANTS,
  PRONUNCIATION_GUIDE,
  buildOutboundSystemInstruction,
  OUTBOUND_SYSTEM_INSTRUCTION,
} from './callguide';

export { default } from './callguide';
