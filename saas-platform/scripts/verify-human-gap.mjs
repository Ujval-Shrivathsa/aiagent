/**
 * Verifies docs/HUMAN_VS_HUMAN_GAP_AUDIT.md against the repository AND against
 * itself.
 *
 * WHY THIS EXISTS
 * An audit is the easiest document in a repository to inflate. Every row looks
 * equally researched, the severity column looks considered, and nobody can tell
 * which claims were checked. This script refuses to pass unless the document is
 * internally consistent AND its evidence is real:
 *
 *   1. The gap matrix is exactly G01..G54, in order, with no gaps or duplicates.
 *   2. Every row carries a category A-L and a severity from the four allowed
 *      values.
 *   3. Every `file::literal` in the evidence column resolves: the file exists and
 *      actually contains that literal. (Write the audit, then let the code tell
 *      you whether you were right — this caught a mistyped Kannada verb form in
 *      the first draft.)
 *   4. All twelve failure categories are used, and the count table in §30 agrees
 *      with the matrix row by row.
 *   5. The severity register in §31 agrees with the matrix, and totals 54.
 *   6. Every row of the "human would never do this" table names a real gap row
 *      and a fault layer from the allowed set of nine.
 *   7. Every improvement-plan block P01..Pnn exists, has all ten required fields
 *      IN ORDER, and every Pnn mentioned anywhere in the document resolves to a
 *      block. This is the check that catches the real failure mode: a matrix
 *      pointing at a plan item that was never written.
 *   8. The three scores parse, are within 0..100, and obey the document's own
 *      rule that the headline may never exceed conversation + 10 — so a strong
 *      reliability score can never hide weak conversational realism.
 *   9. The §41 verdict and the scores agree: a verdict of "yes" (a Mysuru buyer
 *      would know immediately) forbids any score of 90 or above anywhere.
 *  10. Every phrase in the native-validation queue still reads `pending` — an
 *      unvalidated phrase may not be quietly presented as approved.
 *
 * Run: npx tsx scripts/verify-human-gap.mjs
 *
 * HUMAN_GAP_DOC=<path> points the checker at a different copy of the document,
 * so the GATE ITSELF can be tested against deliberate corruption.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DOC_PATH = process.env.HUMAN_GAP_DOC
  ? path.resolve(process.env.HUMAN_GAP_DOC)
  : path.join(root, 'docs/HUMAN_VS_HUMAN_GAP_AUDIT.md');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const doc = read(DOC_PATH);
const CATEGORIES = 'ABCDEFGHIJKL'.split('');
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const LAYERS = [
  'prompt',
  'code',
  'model',
  'timing',
  'audio',
  'state machine',
  'VAD',
  'business constraint',
  'missing context',
];
const PLAN_FIELDS = [
  '**Problem:**',
  '**Human behaviour:**',
  '**Current AI behaviour:**',
  '**Why the AI differs:**',
  '**Root cause:**',
  '**Implementation change:**',
  '**Prompt change:**',
  '**Test required:**',
  '**How to measure improvement:**',
  '**Expected impact:**',
];

/** Text between `## <n>.` and the next `## `. */
const section = (n) => {
  const start = doc.indexOf(`\n## ${n}.`);
  if (start < 0) return '';
  const end = doc.indexOf('\n## ', start + 1);
  return end < 0 ? doc.slice(start) : doc.slice(start, end);
};

const fileCache = new Map();
const fileText = (rel) => {
  if (!fileCache.has(rel)) {
    const abs = path.join(root, rel);
    fileCache.set(rel, fs.existsSync(abs) ? norm(read(abs)) : null);
  }
  return fileCache.get(rel);
};

const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

// ------------------------------------------------------------- 1-3. the matrix
const rows = [];
for (const line of section(3).split('\n')) {
  const m = /^\|\s*(G\d{2})\s*\|/.exec(line);
  if (!m) continue;
  const cells = cellsOf(line);
  rows.push({
    id: m[1],
    cat: cells[1],
    severity: cells[5],
    evidence: cells[7] ?? '',
    fix: cells[8] ?? '',
  });
}

const EXPECTED_ROWS = 54;
check(`the gap matrix has ${EXPECTED_ROWS} rows`, rows.length === EXPECTED_ROWS, `found ${rows.length}`);
const ids = rows.map((r) => r.id);
const expectedIds = Array.from({ length: rows.length }, (_, i) => `G${String(i + 1).padStart(2, '0')}`);
check(
  'the IDs are sequential, unique and in order',
  ids.join(',') === expectedIds.join(','),
  ids.join(',') === expectedIds.join(',') ? '' : `got ${ids.slice(0, 8).join(',')}…`,
);

const badCats = rows.filter((r) => !CATEGORIES.includes(r.cat)).map((r) => `${r.id}=${r.cat}`);
const badSev = rows.filter((r) => !SEVERITIES.includes(r.severity)).map((r) => `${r.id}=${r.severity}`);
check('every row declares a known failure category (A-L)', badCats.length === 0, badCats.join('; '));
check('every row declares an allowed severity', badSev.length === 0, badSev.join('; '));

let literalsChecked = 0;
const badFiles = [];
const badLiterals = [];
const rowsWithoutEvidence = [];
for (const row of rows) {
  const entries = row.evidence.split('<br>').map(norm).filter(Boolean);
  if (!entries.length) {
    rowsWithoutEvidence.push(row.id);
    continue;
  }
  for (const entry of entries) {
    const sep = entry.indexOf('::');
    const cleaned = entry.replace(/`/g, '');
    const sep2 = cleaned.indexOf('::');
    if (sep < 0 || sep2 < 0) {
      badLiterals.push(`${row.id}: "${entry}" is not file::literal`);
      continue;
    }
    const rel = cleaned.slice(0, sep2).trim();
    const literal = norm(cleaned.slice(sep2 + 2));
    const text = fileText(rel);
    if (text === null) {
      badFiles.push(`${row.id}: ${rel}`);
      continue;
    }
    literalsChecked += 1;
    if (!text.includes(literal)) badLiterals.push(`${row.id}: ${rel} does not contain "${literal}"`);
  }
}
check('every matrix row carries evidence', rowsWithoutEvidence.length === 0, rowsWithoutEvidence.join('; '));
check(`every evidence file exists (${literalsChecked} literals)`, badFiles.length === 0, badFiles.join('; '));
check(
  'every evidence literal is present in the file it names',
  badLiterals.length === 0,
  badLiterals.slice(0, 5).join('; '),
);

// --------------------------------------------- 4. §30 counts agree with §3
const usedCats = new Set(rows.map((r) => r.cat));
const missingCats = CATEGORIES.filter((c) => !usedCats.has(c));
check('every one of the twelve categories is used by at least one row', missingCats.length === 0, missingCats.join(''));

const catCounts = new Map();
for (const row of rows) catCounts.set(row.cat, (catCounts.get(row.cat) ?? 0) + 1);
const catTable = new Map();
let catTotal = null;
for (const line of section(30).split('\n')) {
  const cells = cellsOf(line);
  const letter = /^([A-L])$/.exec(cells[0] ?? '');
  if (letter && /^\d+$/.test(cells[3] ?? '')) catTable.set(letter[1], Number(cells[3]));
  const total = /\*\*Total\*\*/.test(cells[1] ?? '');
  if (total && /^\*\*(\d+)\*\*$/.test(cells[3] ?? '')) catTotal = Number(cells[3].replace(/\*/g, ''));
}
const catMismatch = CATEGORIES.filter((c) => catTable.get(c) !== (catCounts.get(c) ?? 0)).map(
  (c) => `${c}: table=${catTable.get(c) ?? 'missing'} matrix=${catCounts.get(c) ?? 0}`,
);
check('the §30 count table agrees with the matrix', catMismatch.length === 0, catMismatch.join('; '));
check('the §30 total equals the matrix size', catTotal === rows.length, `table=${catTotal} matrix=${rows.length}`);

// --------------------------------------------- 5. §31 register agrees with §3
const sevCounts = new Map(SEVERITIES.map((s) => [s, 0]));
for (const row of rows) sevCounts.set(row.severity, (sevCounts.get(row.severity) ?? 0) + 1);
const sevTable = new Map();
let sevTotal = null;
for (const line of section(31).split('\n')) {
  const cells = cellsOf(line);
  if (SEVERITIES.includes(cells[0]) && /^\d+$/.test(cells[3] ?? '')) sevTable.set(cells[0], Number(cells[3]));
  // The register's total row puts nothing under Severity/Meaning, then
  // `**Total**` under Rows and the count under Count — so 4 cells, not 5.
  if (/^\*\*Total\*\*$/.test(cells[2] ?? '') && /^\*\*(\d+)\*\*$/.test(cells[3] ?? '')) {
    sevTotal = Number(cells[3].replace(/\*/g, ''));
  }
}
const sevMismatch = SEVERITIES.filter((s) => sevTable.get(s) !== sevCounts.get(s)).map(
  (s) => `${s}: table=${sevTable.get(s) ?? 'missing'} matrix=${sevCounts.get(s)}`,
);
check('the §31 severity register agrees with the matrix', sevMismatch.length === 0, sevMismatch.join('; '));
check('the §31 total equals the matrix size', sevTotal === rows.length, `table=${sevTotal} matrix=${rows.length}`);

// --------------------------------------------- 6. §32 layers and gap IDs
const layerRows = [];
for (const line of section(32).split('\n')) {
  const m = /^\|\s*(G\d{2})\s*\|/.exec(line);
  if (!m) continue;
  const cells = cellsOf(line);
  layerRows.push({ id: m[1], layer: norm(cells[cells.length - 1]) });
}
const knownIds = new Set(ids);
const badLayerId = layerRows.filter((r) => !knownIds.has(r.id)).map((r) => r.id);
const badLayer = layerRows.filter((r) => !LAYERS.includes(r.layer)).map((r) => `${r.id}=${r.layer}`);
const usedLayers = new Set(layerRows.map((r) => r.layer));
check('the "human would never" table names real gap rows', badLayerId.length === 0, badLayerId.join('; '));
check('every fault layer is one of the nine allowed layers', badLayer.length === 0, badLayer.join('; '));
check('at least eight of the nine layers are exercised', usedLayers.size >= 8, `used ${usedLayers.size}`);

// --------------------------------------------- 7. the improvement plan
const planBlocks = new Map();
{
  const re = /^### (P\d{2}) — .*$/gm;
  const starts = [];
  let m;
  while ((m = re.exec(doc)) !== null) starts.push({ id: m[1], at: m.index });
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].at : doc.length;
    planBlocks.set(starts[i].id, doc.slice(starts[i].at, end));
  }
}
check('the plan has a block per item', planBlocks.size >= 20, `blocks: ${planBlocks.size}`);

const fieldProblems = [];
for (const [id, body] of planBlocks) {
  let cursor = -1;
  for (const field of PLAN_FIELDS) {
    const at = body.indexOf(field);
    if (at < 0) fieldProblems.push(`${id} is missing ${field}`);
    else if (at < cursor) fieldProblems.push(`${id} has ${field} out of order`);
    else cursor = at;
  }
}
check(
  `every plan block has all ten fields, in order (${planBlocks.size} blocks)`,
  fieldProblems.length === 0,
  fieldProblems.slice(0, 5).join('; '),
);

const referenced = new Set();
for (const m of doc.matchAll(/\bP(\d{2})\b/g)) referenced.add(`P${m[1]}`);
const dangling = [...referenced].filter((p) => !planBlocks.has(p));
check(
  `every plan item referenced anywhere exists as a block (${referenced.size} referenced)`,
  dangling.length === 0,
  dangling.sort().join(', '),
);

// --------------------------------------------- 8. the scores and the cap
const score = (label) => {
  const re = new RegExp(`${label}[^\\d]*(\\d+)\\s*/\\s*100`);
  const m = re.exec(doc);
  return m ? Number(m[1]) : null;
};
const reliability = score('HUMAN-LIKE RELIABILITY');
const conversation = score('HUMAN-LIKE CONVERSATION');
const overall = score('OVERALL HUMAN SALES AGENT EQUIVALENCE');
const inRange = (n) => typeof n === 'number' && n >= 0 && n <= 100;
check(
  'the two dimensions are scored separately and both parse',
  inRange(reliability) && inRange(conversation),
  `reliability=${reliability} conversation=${conversation}`,
);
check('the overall equivalence score parses', inRange(overall), `overall=${overall}`);

const capMatch = /cap\s*=\s*conversation\s*\+\s*(\d+)/.exec(doc);
const cap = capMatch ? Number(capMatch[1]) : null;
check('the document states its own headline cap', cap !== null, `cap=+${cap}`);
check(
  'the headline never exceeds conversation + the document\'s own cap',
  cap !== null && overall !== null && conversation !== null && overall <= conversation + cap,
  `overall=${overall} conversation+${cap}=${conversation !== null && cap !== null ? conversation + cap : '?'}`,
);
check(
  'reliability is scored above conversation — reliability must never be the problem being audited',
  reliability !== null && conversation !== null && reliability > conversation,
  `reliability=${reliability} conversation=${conversation}`,
);

// --------------------------------------------- 9. verdict vs scores
const verdict = /VERDICT:\s*(yes|no)/i.exec(doc);
check('§41 states a parseable verdict', verdict !== null, verdict ? verdict[0] : 'missing');
if (verdict) {
  const yes = verdict[1].toLowerCase() === 'yes';
  const highest = Math.max(reliability ?? 0, conversation ?? 0, overall ?? 0);
  check(
    yes
      ? 'a "yes" verdict forbids any score of 90 or above'
      : 'a "no" verdict requires a score of at least 90',
    yes ? highest < 90 : highest >= 90,
    `verdict=${verdict[1]} highest=${highest}`,
  );
}

// --------------------------------------------- 10. the native-validation queue
const queueRows = [];
for (const line of section(35).split('\n')) {
  if (!/^\|\s*`/.test(line)) continue;
  if (/^\|\s*Phrase\s*\|/.test(line)) continue;
  queueRows.push(line);
}
const notPending = queueRows.filter((line) => !/☐\s*pending/.test(line));
check('the native-validation queue has rows', queueRows.length >= 5, `rows: ${queueRows.length}`);
check(
  'every phrase in the validation queue is still unvalidated',
  notPending.length === 0,
  `${notPending.length} row(s) no longer read pending`,
);

console.log(
  `\ngap rows: ${rows.length} · categories: ${usedCats.size} · layers: ${usedLayers.size} · literals verified: ${literalsChecked} · plan blocks: ${planBlocks.size}`,
);
console.log(
  `scores: reliability=${reliability} conversation=${conversation} overall=${overall} verdict=${verdict ? verdict[1] : '?'}`,
);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
