/**
 * Local turn check — NOT a second AI model.
 *
 * The live call uses a single Gemini Live model for hearing and speech. This
 * module is a few milliseconds of regex/rules on the same transcript so a
 * confused next move can be corrected before audio is cut. It never calls an
 * LLM and must stay under ~100ms.
 */
import { looksLikeRepeatRequest, PDF_INTEREST_QUESTION_KN, PDF_SITE_QUESTION_KN } from './kannada-script';
import { isShortAffirmativeReply } from './short-reply';

export type VerifiedIntent =
  | 'why_asking'
  | 'echo_then_answer'
  | 'echo_waiting'
  | 'repeat_request'
  | 'other';

export type ReplyPlan =
  | { action: 'allow' }
  | { action: 'explain_why'; nudge: string }
  | { action: 'take_answer'; answer: 'yes' | 'no' }
  | { action: 'wait_after_echo'; nudge: string };

export type TurnReview = {
  intent: VerifiedIntent;
  plan: ReplyPlan;
  elapsedMs: number;
};

const WHY_ASKING_RE =
  /(?:why (?:are|do|did) you (?:ask|asking)|why (?:this|that) question|what(?:'s| is) this question for|ಯಾಕೆ\s*ಕೇಳ|ಏಕೆ\s*ಕೇಳ|ಯಾಕೆ\s*ಈ\s*ಪ್ರಶ್ನೆ|ಏಕೆ\s*ಈ\s*ಪ್ರಶ್ನೆ|ಏನು\s*ಕೇಳ್ತಿದ)/i;

const YES_RE = /(?:^|[\s,])(?:yes|yeah|yep|ಹೌದು|ಹಾ)(?:[\s,.?!]|$)/i;
const NO_RE = /(?:^|[\s,])(?:no|nope|ಇಲ್ಲ|ಬೇಡ)(?:[\s,.?!]|$)/i;

const REPEAT_ASK_RE =
  /(?:ಮತ್ತೆ ಹೇಳಿ|ಇನ್ನೊಮ್ಮೆ ಹೇಳ|ಮತ್ತೊಮ್ಮೆ ಹೇಳ|ಕೇಳಿಸಿತಾ|tell me once more|once more|can you repeat|please repeat|say that again|say it again|please say again|once again|come again|are you (?:still )?there|एक बार फिर|फिर से बोल|दोबारा (?:बोल|कह))/i;

function squash(text: string): string {
  return String(text || '')
    .replace(/[\s?.!,।'"“”]/g, '')
    .toLowerCase();
}

function echoesQuestion(text: string, question: string): boolean {
  const q = squash(question);
  const t = squash(text);
  if (q.length < 8 || t.length < 8) return false;
  const head = q.slice(0, Math.min(14, q.length));
  return t.includes(head) || (q.includes(t) && t.length >= 10);
}

function embeddedAnswer(text: string): 'yes' | 'no' | null {
  const t = String(text || '').trim();
  if (!t) return null;
  if (isShortAffirmativeReply(t)) return 'yes';
  if (/^(?:no+|nope|nah|ಇಲ್ಲ|ಬೇಡ)[.!?\s]*$/iu.test(t)) return 'no';
  if (NO_RE.test(t) && !YES_RE.test(t)) return 'no';
  if (YES_RE.test(t)) return 'yes';
  return null;
}

function whyNudge(areasDelivered: boolean): string {
  if (!areasDelivered) {
    return (
      'SYSTEM (internal): They asked why you are asking. In one short polite Kannada sentence, say you called to check whether they are looking for a site in Mysuru. ' +
      `Then ask exactly: "${PDF_SITE_QUESTION_KN}" Do NOT ask them to repeat. Do NOT say ಮತ್ತೆ ಹೇಳಿ. Then wait.`
    );
  }
  return (
    'SYSTEM (internal): They asked why you are asking. In one short polite Kannada sentence, say you are checking whether any of these three places suits them. ' +
    `Then ask exactly: "${PDF_INTEREST_QUESTION_KN}" Do NOT ask them to repeat. Do NOT say ಮತ್ತೆ ಹೇಳಿ. Then wait.`
  );
}

const WAIT_NUDGE =
  'SYSTEM (internal): They repeated your question and have not answered it yet. Say nothing. Wait for yes or no. Do NOT ask them to repeat. Do NOT say ಮತ್ತೆ ಹೇಳಿ.';

/**
 * First pass reads the words. Second pass checks that reading against the
 * last thing Priya said and the rule that she must not ask them to repeat
 * unless they asked to hear the line again.
 */
export function reviewCallerTurn(input: {
  text: string;
  previousCallerText?: string;
  lastAgentLine?: string;
  areasDelivered: boolean;
}): TurnReview {
  const started = performance.now();
  const text = String(input.text || '').trim();
  const previous = String(input.previousCallerText || '').trim();
  const agent = String(input.lastAgentLine || '');
  const questions = [PDF_SITE_QUESTION_KN, PDF_INTEREST_QUESTION_KN, agent];
  const echoed = questions.some((q) => echoesQuestion(text, q));
  const previousEchoed = questions.some((q) => echoesQuestion(previous, q));
  const answer = embeddedAnswer(text);

  let intent: VerifiedIntent = 'other';
  let plan: ReplyPlan = { action: 'allow' };

  if (WHY_ASKING_RE.test(text)) {
    intent = 'why_asking';
    plan = { action: 'explain_why', nudge: whyNudge(input.areasDelivered) };
  } else if ((echoed || previousEchoed) && answer) {
    intent = 'echo_then_answer';
    plan = { action: 'take_answer', answer };
  } else if (echoed && !looksLikeRepeatRequest(text)) {
    intent = 'echo_waiting';
    plan = { action: 'wait_after_echo', nudge: WAIT_NUDGE };
  } else if (looksLikeRepeatRequest(text)) {
    intent = 'repeat_request';
    plan = { action: 'allow' };
  }

  return { intent, plan, elapsedMs: performance.now() - started };
}

/**
 * A loud frame is not a reason to cut Priya off. She finishes the line unless
 * the caller has already said something new that is not her own question
 * coming back, and not "why are you asking".
 */
export function callerReallyInterrupted(callerText: string, agentLine: string): boolean {
  const t = String(callerText || '').trim();
  if (t.length < 12) return false;
  if (WHY_ASKING_RE.test(t)) return false;
  if (echoesQuestion(t, agentLine) || echoesQuestion(t, PDF_SITE_QUESTION_KN) || echoesQuestion(t, PDF_INTEREST_QUESTION_KN)) {
    return false;
  }
  return true;
}

/** True when Priya herself is asking the caller to say it again. */
export function agentToldCallerToRepeat(text: string): boolean {
  return REPEAT_ASK_RE.test(String(text || ''));
}
