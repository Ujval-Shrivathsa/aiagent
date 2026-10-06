/**
 * Self-test for scripts/verify-human-gap.mjs.
 *
 * A gate that validates an audit has to be broken on purpose before it can be
 * trusted, because the audit's whole value is that it might be wrong. This
 * script corrupts docs/HUMAN_VS_HUMAN_GAP_AUDIT.md in eleven different ways and
 * requires the gate to catch every one.
 *
 * Two details that matter:
 *   - A non-zero exit is NOT treated as a detection. Each mutation must produce
 *     the specific diagnostic that names the problem; a crash also exits
 *     non-zero, and an earlier version of the sibling self-test fooled itself
 *     exactly that way.
 *   - Every mutation first proves it actually applied. A replacement that
 *     silently matched nothing would otherwise look like a gate that works.
 *
 * Run: npx tsx scripts/verify-human-gap-selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CHECKER = path.join(here, 'verify-human-gap.mjs');
const DOC = path.join(root, 'docs/HUMAN_VS_HUMAN_GAP_AUDIT.md');

const source = fs.readFileSync(DOC, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-selftest-'));

/**
 * Replace cell `index` of the first table row whose ID cell is `id`.
 *
 * `index` is the cell index the GATE sees — i.e. counted after the leading and
 * trailing pipes are stripped (`cellsOf`). A raw `line.split('|')` has an extra
 * empty element in front of it, so the writes must be offset by one. Getting
 * this wrong is not harmless: the first version of this helper edited the
 * column NEXT TO the intended one, the document stayed valid, and the gate
 * correctly passed — a silent no-op that looked like a passing test.
 */
const setCell = (text, id, index, value) =>
  text
    .split('\n')
    .map((line, i, all) => {
      if (!line.startsWith(`| ${id} |`)) return line;
      if (all.slice(0, i).some((prev) => prev.startsWith(`| ${id} |`))) return line;
      const cells = line.split('|');
      cells[index + 1] = ` ${value} `;
      return cells.join('|');
    })
    .join('\n');

const mutations = [
  {
    name: 'a gap row deleted',
    doc: source.split('\n').filter((l) => !l.startsWith('| G27 |')).join('\n'),
    expect: 'the gap matrix has 54 rows',
  },
  {
    name: 'a gap ID out of sequence',
    doc: source.replace('| G20 |', '| G19 |'),
    expect: 'the IDs are sequential, unique and in order',
  },
  {
    name: 'an evidence literal that exists nowhere',
    doc: source.replace('validatedByNativeSpeaker: false', 'validatedBySomeoneWeHaveNotMet'),
    expect: 'every evidence literal is present in the file it names',
  },
  {
    name: 'an invented severity',
    doc: setCell(source, 'G07', 5, 'Very High'),
    mustContain: '| Very High |',
    expect: 'every row declares an allowed severity',
  },
  {
    name: 'a category count that no longer matches the matrix',
    doc: source.replace(
      '| A | Voice — the sound itself feels artificial | G01–G05 | 5 |',
      '| A | Voice — the sound itself feels artificial | G01–G05 | 4 |',
    ),
    expect: 'the §30 count table agrees with the matrix',
  },
  {
    name: 'a severity register that drifts from the matrix',
    doc: source.replace(
      '| Medium | Noticeably robotic, tolerable | G04, G06, G07, G13, G22, G26, G28, G33, G36, G37, G40, G41, G45, G47, G48, G53, G54 | 17 |',
      '| Medium | Noticeably robotic, tolerable | G04, G06, G07, G13, G22, G26, G28, G33, G36, G37, G40, G41, G45, G47, G48, G53, G54 | 16 |',
    ),
    expect: 'the §31 severity register agrees with the matrix',
  },
  {
    name: 'a fault layer that is not one of the nine',
    doc: source.replace(
      '| G18 | receive an answer and say nothing about it | echoing the caller was banned after a repeat loop | prompt |',
      '| G18 | receive an answer and say nothing about it | echoing the caller was banned after a repeat loop | vibes |',
    ),
    expect: 'every fault layer is one of the nine allowed layers',
  },
  {
    name: 'a plan item referenced but never written',
    doc: source.replace('### P10 —', '### P90 —'),
    expect: 'every plan item referenced anywhere exists as a block',
  },
  {
    name: 'a plan block missing a required field',
    doc: source.replace(
      '- **Implementation change:** None.\n- **Prompt change:** Delete "No searching pause',
      '- **Prompt change:** Delete "No searching pause',
    ),
    expect: 'every plan block has all ten fields, in order',
  },
  {
    name: 'a headline that exceeds the documented cap',
    doc: source.replace(
      /OVERALL HUMAN SALES AGENT EQUIVALENCE(\s+)64 \/ 100/,
      (_m, sp) => `OVERALL HUMAN SALES AGENT EQUIVALENCE${sp}99 / 100`,
    ),
    expect: "the headline never exceeds conversation + the document's own cap",
  },
  {
    name: 'a verdict that contradicts the scores',
    doc: source.replace('VERDICT: yes', 'VERDICT: no'),
    expect: 'a "no" verdict requires a score of at least 90',
  },
  {
    name: 'a native-validation phrase quietly marked approved',
    doc: source.replace('☐ pending', '☑ approved'),
    expect: 'every phrase in the validation queue is still unvalidated',
  },
];

let missed = 0;
let missedMutations = 0;
for (const [i, m] of mutations.entries()) {
  // A mutation counts as applied only if it changed the text AND the intended
  // edit is visibly present — otherwise a helper bug reads as a passing gate.
  const applied = m.doc !== source && (!m.mustContain || m.doc.includes(m.mustContain));
  const file = path.join(tmp, `m${i + 1}.md`);
  fs.writeFileSync(file, m.doc);

  const run = spawnSync('npx', ['tsx', CHECKER], {
    cwd: root,
    env: { ...process.env, HUMAN_GAP_DOC: file },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const caught = run.status !== 0 && out.includes(m.expect);
  if (!caught) {
    missed += 1;
    missedMutations += 1;
  }

  const why = !applied
    ? 'MUTATION DID NOT APPLY — the test itself is broken'
    : run.status === 0
      ? 'NOT DETECTED (gate passed a corrupted document)'
      : !out.includes(m.expect)
        ? `failed for an unrelated reason (expected "${m.expect}")`
        : 'detected';
  console.log(`${caught ? 'PASS' : 'FAIL'}  ${m.name} — ${why}`);
}

// The gate must also pass the real document, or "detects everything" would be
// indistinguishable from "rejects everything".
const clean = spawnSync('npx', ['tsx', CHECKER], {
  cwd: root,
  env: { ...process.env },
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const cleanOk = clean.status === 0 && `${clean.stdout}`.includes('ALL CHECKS PASSED');
if (!cleanOk) missed += 1;
console.log(`${cleanOk ? 'PASS' : 'FAIL'}  the real document still passes the gate`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  `\nmutations caught: ${mutations.length - missedMutations} / ${mutations.length} · clean document accepted: ${cleanOk}`,
);
console.log(missed === 0 ? 'ALL CHECKS PASSED' : `${missed} CHECK(S) FAILED`);
process.exit(missed === 0 ? 0 : 1);
