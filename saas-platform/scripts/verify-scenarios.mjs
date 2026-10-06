/**
 * Verifies docs/SCENARIO_REGRESSION.md against the repository.
 *
 * WHY THIS EXISTS
 * A scenario table that is maintained by hand drifts: a test gets renamed, a
 * scenario keeps its reassuring row, and the document silently starts claiming
 * coverage that no longer exists. This script reads the table and refuses to
 * pass unless every claim in it is true right now:
 *
 *   1. The IDs are exactly S01..S35 — no gaps, no duplicates, no extras.
 *   2. Every `file::literal` in the evidence column resolves to a real file
 *      whose content actually contains that literal.
 *   3. Every `partial` row points at a row number that really exists in the
 *      scenario matrix of VOICE_QA_PLAN.md (so "we will hear it on a handset"
 *      cannot point at a row that was deleted), and — in both directions —
 *      `partial` and "this also needs a handset" agree with each other. The
 *      first run of this script found 8 rows that said one and meant the other.
 *   3b. Every `§2 row N` mention anywhere in the document, including the
 *      manual-only table, names a row that exists.
 *   4. The measured-coverage table adds up to the total it prints, and to the
 *      number in the pasted command output, and every file it names exists.
 *
 * Tolerances are deliberate: whitespace is normalised (a reformatted test name
 * is not a behaviour change) and matching is substring-based (a test name may
 * gain a suffix without invalidating the claim). Nothing else is loosened.
 *
 * Run: npx tsx scripts/verify-scenarios.mjs
 *
 * SCENARIO_DOC=<path> points the checker at a different copy of the document.
 * That exists so the GATE ITSELF can be tested: break a copy deliberately and
 * confirm this script fails on it. A gate that cannot fail is decoration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DOC_PATH = process.env.SCENARIO_DOC
  ? path.resolve(process.env.SCENARIO_DOC)
  : path.join(root, 'docs/SCENARIO_REGRESSION.md');
const QA_PATH = path.join(root, 'docs/VOICE_QA_PLAN.md');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const norm = (s) => s.replace(/\s+/g, ' ').trim();
/** @param {string} p */
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const doc = read(DOC_PATH);
const qa = read(QA_PATH);

const fileCache = new Map();
const fileText = (rel) => {
  if (!fileCache.has(rel)) {
    const abs = path.join(root, rel);
    fileCache.set(rel, fs.existsSync(abs) ? norm(read(abs)) : null);
  }
  return fileCache.get(rel);
};

// ---------------------------------------------------------------- the 35 rows
const rows = [];
for (const line of doc.split('\n')) {
  const m = /^\|\s*S(\d{2})\s*\|/.exec(line);
  if (!m) continue;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = body.split('|').map(norm);
  rows.push({ id: `S${m[1]}`, scenario: cells[1], layer: cells[2], evidence: cells[3], also: cells[4] });
}

check('the scenario table has exactly 35 rows', rows.length === 35, `found ${rows.length}`);

const ids = rows.map((r) => r.id);
const expected = Array.from({ length: 35 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
check(
  'the IDs are exactly S01..S35, in order and unique',
  ids.join(',') === expected.join(','),
  ids.join(',') === expected.join(',') ? '' : `got ${ids.join(',')}`,
);

// Every `§2 row N` referenced anywhere must exist in the QA plan's own matrix.
const qaSection2 = (() => {
  const start = qa.indexOf('## 2. Scenario matrix');
  const end = qa.indexOf('### 2.1', start);
  return start >= 0 && end > start ? qa.slice(start, end) : '';
})();
const qaRows = new Set();
for (const line of qaSection2.split('\n')) {
  const m = /^\|\s*(\d+)\s*\|/.exec(line);
  if (m) qaRows.add(Number(m[1]));
}
check('VOICE_QA_PLAN.md section 2 has its own scenario rows', qaRows.size > 0, `rows: ${qaRows.size}`);

// --------------------------------------------------------- evidence resolution
let literalsChecked = 0;
const badLiterals = [];
const badFiles = [];
const badLayers = [];
const badPointers = [];

for (const row of rows) {
  if (row.layer !== 'automated' && row.layer !== 'partial') {
    badLayers.push(`${row.id}=${row.layer}`);
    continue;
  }
  const entries = row.evidence.split('<br>').map(norm).filter((e) => e && e !== '—');
  if (entries.length === 0) {
    badLiterals.push(`${row.id}: no evidence`);
    continue;
  }
  for (const entry of entries) {
    const sep = entry.indexOf('::');
    if (sep < 0) {
      badLiterals.push(`${row.id}: "${entry}" is not file::literal`);
      continue;
    }
    const rel = entry.slice(0, sep).trim().replace(/^`|`$/g, '');
    const literal = norm(entry.slice(sep + 2).replace(/`/g, ''));
    const text = fileText(rel);
    if (text === null) {
      badFiles.push(`${row.id}: ${rel}`);
      continue;
    }
    literalsChecked += 1;
    const found = text.includes(literal) || text.includes(literal.replace(/\\'/g, "'"));
    if (!found) badLiterals.push(`${row.id}: ${rel} does not contain "${literal}"`);
  }
  // The two halves of the classification must agree. A row that admits it needs
  // a handset IS partial; a row declared partial MUST say where the handset
  // check lives. Without this the table can quietly claim "fully automated"
  // about behaviour nobody has ever heard.
  const admitsHandset = /\bpartial\b/.test(row.also ?? '');
  if (row.layer === 'partial') {
    if (!admitsHandset) badPointers.push(`${row.id}: declared partial but names no handset check`);
    const m = /§2 row (\d+)/.exec(row.also ?? '');
    if (!m) badPointers.push(`${row.id}: no "§2 row N" pointer`);
    else if (!qaRows.has(Number(m[1]))) badPointers.push(`${row.id}: §2 row ${m[1]} does not exist`);
  } else if (admitsHandset) {
    badPointers.push(`${row.id}: names a handset check but is declared automated`);
  }
}

// Any `§2 row N` mention anywhere — prose, the manual-only table, the legend —
// must name a row that exists, or the document points readers at nothing.
const strayPointers = [];
for (const m of doc.matchAll(/§2 rows? ((?:\d+)(?:\s*(?:,|and)\s*\d+)*)/g)) {
  for (const n of m[1].split(/\s*(?:,|and)\s*/).map(Number)) {
    if (!qaRows.has(n)) strayPointers.push(`§2 row ${n}`);
  }
}
check('every §2 row reference in the document exists in the QA plan', strayPointers.length === 0, strayPointers.join('; '));

check(`every evidence file exists (${literalsChecked} literals across ${rows.length} rows)`, badFiles.length === 0, badFiles.join('; '));
check('every evidence literal is present in the file it names', badLiterals.length === 0, badLiterals.slice(0, 6).join('; '));
check('every row declares a known layer', badLayers.length === 0, badLayers.join('; '));
check('every partial row points at a real VOICE_QA_PLAN row', badPointers.length === 0, badPointers.join('; '));

// -------------------------------------------------------- measured coverage sums
const coverage = [];
for (const line of doc.split('\n')) {
  const m = /^\|\s*`([^`]+\.test\.ts)`\s*\|\s*(\d+)\s*\|/.exec(line);
  if (m) coverage.push({ file: `src/voice/__tests__/${m[1]}`, n: Number(m[2]) });
}
check('the coverage table lists the test files', coverage.length >= 10, `files: ${coverage.length}`);
const sum = coverage.reduce((a, c) => a + c.n, 0);
const totalRow = /\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/.exec(doc);
const pasted = /tests (\d+)/.exec(doc);
check(
  'the per-file counts add up to the printed total',
  totalRow !== null && Number(totalRow[1]) === sum,
  `sum=${sum} total=${totalRow ? totalRow[1] : 'missing'}`,
);
check(
  'the printed total matches the pasted test-run output',
  pasted !== null && Number(pasted[1]) === sum,
  `pasted=${pasted ? pasted[1] : 'missing'}`,
);
const missingFiles = coverage.filter((c) => !fs.existsSync(path.join(root, c.file))).map((c) => c.file);
check('every test file in the coverage table exists on disk', missingFiles.length === 0, missingFiles.join('; '));

// Every verify-*.mjs named in the document must also exist.
const namedScripts = new Set();
for (const m of doc.matchAll(/scripts\/(verify-[a-z-]+\.mjs)/g)) namedScripts.add(m[1]);
const missingScripts = [...namedScripts].filter((s) => !fs.existsSync(path.join(root, 'scripts', s)));
check(`every verification script the document names exists (${namedScripts.size})`, missingScripts.length === 0, missingScripts.join('; '));

console.log(`\nscenarios: ${rows.length} · literals verified: ${literalsChecked} · coverage sum: ${sum}`);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
