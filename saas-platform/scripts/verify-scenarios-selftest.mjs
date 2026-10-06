/**
 * Self-test for scripts/verify-scenarios.mjs.
 *
 * A verification gate nobody has tried to break is a gate that might pass
 * everything, including a document that is wrong. This script deliberately
 * corrupts the scenario document in seven different ways and requires the gate
 * to catch every one of them.
 *
 * The important detail: a non-zero exit is NOT treated as a detection. Each
 * mutation must produce the SPECIFIC diagnostic that names the problem. That
 * distinction is not academic — a missing temp file also exits non-zero, and an
 * earlier attempt at this test fooled itself exactly that way.
 *
 * Run: npx tsx scripts/verify-scenarios-selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CHECKER = path.join(here, 'verify-scenarios.mjs');
const DOC = path.join(root, 'docs/SCENARIO_REGRESSION.md');

const source = fs.readFileSync(DOC, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scen-selftest-'));

/** Replace cell `index` of the first table row whose ID cell is `id`. */
const setCell = (text, id, index, value) =>
  text
    .split('\n')
    .map((line) => {
      if (!line.startsWith(`| ${id} |`)) return line;
      const cells = line.split('|');
      cells[index] = ` ${value} `;
      return cells.join('|');
    })
    .join('\n');

const mutations = [
  {
    name: 'an evidence literal that exists nowhere',
    doc: source.replace('recognises houda / haudu / ha as real turns', 'recognises a turn that was never coded'),
    expect: 'every evidence literal is present in the file it names',
  },
  {
    name: 'a scenario row deleted',
    doc: source.split('\n').filter((l) => !l.startsWith('| S17 |')).join('\n'),
    expect: 'the scenario table has exactly 35 rows',
  },
  {
    name: 'a handset pointer aimed at a row that does not exist',
    doc: source.replace('§2 row 20', '§2 row 99'),
    expect: 'every §2 row reference in the document exists in the QA plan',
  },
  {
    name: 'a row that admits it needs a handset but is filed as automated',
    doc: setCell(source, 'S32', 3, 'automated'),
    expect: 'names a handset check but is declared automated',
  },
  {
    name: 'a partial row that no longer names its handset check',
    doc: setCell(source, 'S08', 5, 'does the beat land as speech? VOICE_QA_PLAN.md §2 row 1'),
    expect: 'declared partial but names no handset check',
  },
  {
    name: 'a duplicated scenario ID',
    doc: source.replace('| S18 |', '| S17 |'),
    expect: 'the IDs are exactly S01..S35, in order and unique',
  },
  {
    // Derived from the document, never hardcoded: a literal here silently stops
    // applying the moment the real test count changes, and the mutation then
    // "passes" by never having been made. The guard below turns that into a
    // loud failure instead.
    name: 'per-file counts that no longer add up to the printed total',
    doc: source.replace(/(\*\*Total\*\*\s*\|\s*\*\*)(\d+)(\*\*)/, (_, pre, n, post) => `${pre}${Number(n) + 1}${post}`),
    expect: 'the per-file counts add up to the printed total',
    mustContain: /\*\*Total\*\*\s*\|\s*\*\*\d+\*\*/,
  },
];

let mutationFailures = 0;
// A broken mutation is a failure of THIS script, not a detection by the gate.
// Counting the two separately is the only way the report stays honest when a
// mutation silently stops applying (which is exactly what happened to the
// hardcoded total below, the moment the real test count changed).
let missedMutations = 0;
const contains = (text, needle) =>
  needle instanceof RegExp ? needle.test(text) : text.includes(needle);
for (const [i, m] of mutations.entries()) {
  const applied = m.doc !== source && (!m.mustContain || contains(m.doc, m.mustContain));
  const file = path.join(tmp, `m${i + 1}.md`);
  fs.writeFileSync(file, m.doc);

  const run = spawnSync('npx', ['tsx', CHECKER], {
    cwd: root,
    env: { ...process.env, SCENARIO_DOC: file },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const caught = run.status !== 0 && out.includes(m.expect);
  if (!caught) mutationFailures += 1;
  if (!applied) missedMutations += 1;

  const why = !applied
    ? 'MUTATION DID NOT APPLY — this self-test is broken, not a detection'
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
console.log(`${cleanOk ? 'PASS' : 'FAIL'}  the real document still passes the gate`);

fs.rmSync(tmp, { recursive: true, force: true });
const caughtCount = mutations.length - mutationFailures;
console.log(
  `\nmutations caught: ${caughtCount} / ${mutations.length}` +
    ` · clean document accepted: ${cleanOk}` +
    ` · self-test mutations that no longer apply: ${missedMutations}`,
);
const failures = mutationFailures + (cleanOk ? 0 : 1);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
