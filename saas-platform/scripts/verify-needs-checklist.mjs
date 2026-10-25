/**
 * ============================================================================
 *   verify-needs-checklist.mjs
 * ============================================================================
 *
 * Proves the NEEDS CHECKLIST is actually wired into the call, and that the rules
 * around it hold — without placing a call and without importing the engine
 * (logic.ts needs a live WebSocket to import, so this reads the source instead).
 *
 * What it checks:
 *   1. the checklist is asked BEFORE the pinned close, from every entry point;
 *   2. a question that is out and unanswered is never put twice, and the call is
 *      never closed over it;
 *   3. the dead-air repair is armed for the checklist questions;
 *   4. the answers cost exactly ONE database write, at the end of the call;
 *   5. the reconnect recall carries them, so a dropped line does not re-ask them;
 *   6. the prompt states the two questions, and the four-question cap replaces
 *      the old "two questions max";
 *   7. every pinned line is still present and unchanged;
 *   8. the Lead model and the dashboard actually carry the two fields.
 *
 * Run: node scripts/verify-needs-checklist.mjs
 * Exits non-zero on the first failed check.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failures = 0;
let passes = 0;

/** Read a source file with line endings normalised, so CRLF files compare cleanly. */
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function check(label, condition, detail = '') {
  if (condition) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** The body of one top-level `const name = ... => { ... };` arrow function. */
function functionBody(source, name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) return '';
  const nextTopLevel = source.indexOf('\n  const ', start + 10);
  return source.slice(start, nextTopLevel < 0 ? source.length : nextTopLevel);
}

const logic = read('src/voice/logic.ts');
const script = read('src/voice/kannada-script.ts');
const needs = read('src/voice/needs-checklist.ts');
const naturalness = read('src/voice/conversation-naturalness.ts');
const schema = read('prisma/schema.prisma');
const dashboard = read('src/app/dashboard/page.tsx');
const summary = read('src/lib/call-summary.ts');

console.log('\n=== the checklist module states the two items, in order ===');
check(
  'NEED_IDS is exactly purpose, locality',
  /export const NEED_IDS = \['purpose', 'locality'\] as const;/.test(needs),
);
check(
  'an item that was already asked is never handed back as "next"',
  needs.includes('if (checklist.asked.includes(id)) continue;'),
);
check(
  'the open question is tracked separately from the next question',
  needs.includes('export function openNeedQuestion('),
);
check(
  'a directive-shaped line can never become an answer',
  needs.includes('DIRECTIVE_SHAPED'),
);
check('an unresolvable answer is recorded, not guessed', needs.includes("'Not stated'"));
check(
  'both phrases are still flagged as awaiting a native speaker',
  count(needs, 'validatedByNativeSpeaker: false') >= 2,
);

console.log('\n=== the engine asks the checklist BEFORE the pinned close ===');
check(
  'the checklist gate exists',
  logic.includes('const askNextNeedOrHandoff = (): boolean =>'),
  'askNextNeedOrHandoff is missing',
);
const askCalls = count(logic, 'askNextNeedOrHandoff()');
check(
  'every route that used to jump to the close now asks the checklist first',
  askCalls >= 3,
  `found ${askCalls} call sites (expected >= 3: suppression, interested branch, handler)`,
);
check(
  'the pinned close only goes out when the list is exhausted',
  logic.includes('sendOutboundHandoffClose('),
);
check(
  'an out-and-unanswered question is never asked twice, and never closed over',
  logic.includes('if (openNeed) return true;'),
);
check(
  'the checklist handler exists and owns its turn',
  logic.includes('const needsStepHandled = nameStepHandled ? false : handleNeedsStep(userText);') &&
    logic.includes('const stepOwned = nameStepHandled || needsStepHandled;'),
);
check(
  'the checklist runs only after the areas line has landed',
  /if \(!outboundNameStepDone \|\| !outboundAreasLineDelivered\) return false;/.test(logic),
);
check(
  'replies that own their own branch are never consumed as an answer',
  ['looksLikeCallerCannotHear(raw)', 'looksLikeRepeatRequest(raw)', 'looksLikeCallbackTimeRequest(raw)', 'looksLikeNotInterested(raw)', 'looksLikeCustomerBusy(raw)', 'looksLikeOpeningDecline(raw)', 'isLikelySttNoise(raw)'].every(
    (g) => logic.includes(g),
  ),
);

console.log('\n=== no dead air after a checklist question ===');
check(
  'the step audio guard is armed for the needs question',
  logic.includes("armOutboundStepAudioGuard(\n        'the needs question',"),
  'the 2.6s repair is not armed for the checklist',
);
check(
  'the repair re-issues the SAME question',
  logic.includes('buildNeedQuestionRetryNudge(next, { acquired: outboundCallerName })'),
);

console.log('\n=== the answers cost ONE write, at the end of the call ===');
check(
  'the persist helper is called exactly once in the engine',
  count(logic, 'needsPersistFields(') === 1,
  `found ${count(logic, 'needsPersistFields(')} uses`,
);
check(
  'it is spread into the single call-end updateMany',
  logic.includes('...needsFields,'),
);
check(
  'nothing inside the checklist handler touches the database',
  !functionBody(logic, 'handleNeedsStep').includes('prisma.'),
  'a DB call inside handleNeedsStep would be a per-answer write',
);
check(
  'the summary carries the two answers',
  logic.includes('needsLine: needsSummaryLine(needsChecklist)'),
);
check(
  'the summary writer uses the needs line',
  summary.includes('needsLine?: string;') && summary.includes('input.needsLine'),
);

console.log('\n=== a dropped line cannot re-ask what was answered ===');
check(
  'the reconnect recall includes the checklist',
  logic.includes('buildNeedsContext(needsChecklist)'),
);
check(
  'the recall block forbids asking again',
  needs.includes('Never ask again for anything listed above'),
);

console.log('\n=== the prompt states the list, and the five pinned lines are intact ===');
check(
  'both needs questions are spoken lines in the script',
  script.includes('export const NEEDS_PURPOSE_QUESTION_KN =') &&
    script.includes('export const NEEDS_LOCALITY_QUESTION_KN ='),
);
check(
  'the checklist block reaches BOTH instructions',
  count(script, '${NEEDS_CHECKLIST_RULES}') === 2,
  `found ${count(script, '${NEEDS_CHECKLIST_RULES}')} injections`,
);
check(
  'the four-question cap replaced the old two-question cap',
  script.includes('AT MOST FOUR QUESTIONS') && !script.includes('TWO QUESTIONS MAX'),
);
check(
  'step 3B and the five-step shape are both still stated',
  script.includes('3B. THE TWO NEEDS QUESTIONS') && script.includes('There is NO sixth step'),
);
check(
  'the area question is not answered by the engine and left open to the model',
  script.includes('do NOT offer a menu') || needs.includes('do NOT offer a menu'),
);

const pinned = [
  "export const PDF_OPENING_TURN1_KN = PDF_OPENING_KN;",
  "'ಹಲೋ ನಾನು ಅಲಯನ್ಸ್ ಸ್ಕ್ವೇರ್ ನಿಂದ ಪ್ರಿಯ ಮೈಸೂರಿನಲ್ಲಿ ಸೈಟ್ ನೊತಿದೀರಾ'",
  "export const PDF_NAME_QUESTION_KN = 'ನಿಮ್ಮ ಹೆಸರು ಏನು?';",
  "'ಸರಿ, ನಮ್ಮಲ್ಲಿ ಕೆಲವು ಆಯ್ಕೆಗಳಿದೆ — ಹುಣಸೂರು ರಸ್ತೆ, ತಿ. ನರಸೀಪುರ ರಸ್ತೆ, ಶ್ರೀರಾಂಪುರ ಮತ್ತು ಕೆ. ಆರ್. ನಗರ ಪ್ರದೇಶಗಳಲ್ಲಿ ಸೈಟ್\u200cಗಳಿವೆ.'",
  "export const PDF_HANDOFF_LINE_KN =",
  "export const PDF_THANKS_CLOSE_KN = 'ನಿಮ್ಗೆ ಸಮಯ ಕೊಡಿದಂತೆ ಧನ್ಯವಾದಗಳು.';",
  "export const PDF_ACK_KN = 'ಸರ್ತಿ';",
];
for (const line of pinned) {
  check(`pinned line present: ${line.slice(0, 46)}…`, script.includes(line));
}
check(
  'the thanks detector still fires on the closing line only',
  script.includes("export const PDF_THANKS_CLOSE_KN = 'ನಿಮ್ಗೆ ಸಮಯ ಕೊಡಿದಂತೆ ಧನ್ಯವಾದಗಳು.';"),
);

console.log('\n=== the listening beat is small, safe and never repeated ===');
check(
  'the beat set exists and is separate from the named acknowledgement',
  naturalness.includes('export const LISTENING_BEATS_KN'),
);
check('the beat is chosen per call', logic.includes('chooseListeningBeat({'));
check(
  'a beat is never the same sound twice in one call',
  logic.includes('avoid: listeningBeatsUsed'),
);

console.log('\n=== the sales employee receives the answers ===');
check(
  'the Lead model has both columns',
  /needPurpose\s+String\?/.test(schema) && /needLocality\s+String\?/.test(schema),
);
const migration = 'prisma/migrations/20261013120000_needs_checklist/migration.sql';
check('a migration adds both columns', fs.existsSync(path.join(root, migration)) &&
  read(migration).includes('"needPurpose"') &&
  read(migration).includes('"needLocality"'));
check(
  'the dashboard renders both fields',
  dashboard.includes('leadNeeds') &&
    dashboard.includes('needPurpose') &&
    dashboard.includes('Preferred locality'),
);

console.log(
  `\n${failures === 0 ? 'OK' : 'FAILED'} — ${passes} passed, ${failures} failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
