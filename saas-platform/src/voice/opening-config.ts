/**
 * Configurable call-opening lines (agent / company / question).
 * Change via env without editing conversation logic.
 *
 * Env:
 *   VOICE_OPENING_AGENT_NAME_KN=ಭೂಮಿ
 *   VOICE_OPENING_AGENT_NAME_EN=Bhoomi
 *   VOICE_OPENING_COMPANY_NAME=Alliance Square
 *   VOICE_OPENING_QUESTION_KN=ನೀವು Mysore ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ?
 *   VOICE_OPENING_QUESTION_EN=Are you looking at a site in Mysore?
 *   VOICE_OPENING_INCLUDE_NAME=1   (0 = never use lead name in opening)
 */

function str(env: string | undefined, fallback: string): string {
  const v = (env || '').trim();
  return v || fallback;
}

export type OpeningConfig = {
  agentNameKn: string;
  agentNameEn: string;
  companyName: string;
  questionKn: string;
  questionEn: string;
  /** When true, include a known lead name if available (still optional / natural). */
  includeNameWhenAvailable: boolean;
};

export function loadOpeningConfig(): OpeningConfig {
  return {
    agentNameKn: str(process.env.VOICE_OPENING_AGENT_NAME_KN, 'ಭೂಮಿ'),
    agentNameEn: str(process.env.VOICE_OPENING_AGENT_NAME_EN, 'Bhoomi'),
    companyName: str(process.env.VOICE_OPENING_COMPANY_NAME, 'Alliance Square'),
    questionKn: str(process.env.VOICE_OPENING_QUESTION_KN, 'ನೀವು Mysuru ನಲ್ಲಿ site ನೋಡ್ತಿದ್ದೀರಾ?'),
    questionEn: str(process.env.VOICE_OPENING_QUESTION_EN, 'Are you looking for a site in Mysuru?'),
    includeNameWhenAvailable: str(process.env.VOICE_OPENING_INCLUDE_NAME, '1') !== '0',
  };
}
