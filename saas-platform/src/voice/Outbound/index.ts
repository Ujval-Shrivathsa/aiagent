/**
 * Outbound agent entry — re-exports the outbound call guide.
 * Source of truth: docs/Revised Content for AI - Alliance.pdf
 */
export {
  GREETING_NO_NAME,
  GREETING,
  getGreeting,
  getOutboundGreetingInstruction,
  getOutboundGreetingIntroInstruction,
  getOutboundGreetingQuestionInstruction,
  PDF_OPENING,
  PDF_PURPOSE_QUESTION,
  PDF_INVESTMENT_PITCH,
  PDF_INVESTMENT_YES_CLOSE,
  PDF_INVESTMENT_NO_CLOSE,
  PDF_BUILD_HOUSE_CLOSE,
  PDF_MANAGER_CALLBACK,
  looksLikeRepeatRequest,
  looksLikeInvestmentPitchYes,
  INVESTMENT_PITCH_PENDING_QUESTION,
  looksLikeManagerCallbackQuestion,
  OUTBOUND_REPEAT_NUDGE,
  OUTBOUND_INVESTMENT_YES_CLOSE_NUDGE,
  OUTBOUND_MANAGER_CALLBACK_NUDGE,
  OUTBOUND_MANAGER_CALLBACK_END_ONLY_NUDGE,
  OUTBOUND_SILENT_END_NUDGE,
  OUTBOUND_NO_REPEAT_NUDGE,
  looksLikeSalesManagerCallbackLine,
  looksLikeThanksOnlyLine,
  looksLikeClosingGoodbye,
  isRedundantOutboundThanksTurn,
  OUTBOUND_THANKS_BEFORE_END_NUDGE,
  hasThanksClosing,
  REDIRECT_VARIANTS,
  UNKNOWN_DETAIL_VARIANTS,
  UNKNOWN_AREA_VARIANTS,
  PRONUNCIATION_GUIDE,
  buildOutboundSystemInstruction,
  buildOutboundFastConnectInstruction,
  buildOutboundProjectReferenceContext,
  OUTBOUND_SYSTEM_INSTRUCTION,
} from './callguide';

export {
  CONTEXTUAL_CONVERSATION_RULES,
  looksLikeIdentityQuestion,
  looksLikeContextInterrupt,
  deriveOutboundConversationMemory,
  buildOutboundIdentityAnswerNudge,
  buildOutboundOffTopicAnswerNudge,
  buildOutboundResumeNudge,
} from './context-flow';
export type { OutboundConversationMemory } from './context-flow';

export { default } from './callguide';
