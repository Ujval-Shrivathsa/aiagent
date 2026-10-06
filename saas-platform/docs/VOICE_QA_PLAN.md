# Voice QA Plan — real-device validation, human-likeness scoring, robotic-moment audit

Owner: PRIYA project · Applies to: the live outbound agent
Companion documents: `PRIYA_PROJECT_SPEC.md` (§32 testing, §35 TBD), `KANNADA_STYLE_GUIDE.md`,
`SCENARIO_REGRESSION.md` (the 35-scenario inventory and the assertion behind each one),
`HUMAN_VS_HUMAN_GAP_AUDIT.md` (54 differences from a human salesperson, scored and prioritised)

---

## 0. The gap this plan closes

Everything in `src/voice/__tests__` and `scripts/verify-*.mjs` proves **mechanisms**: that a guard is
armed, that a policy function returns the right branch, that a phrase is short and safe. None of it
proves what a prospect actually **hears**.

An agent cannot close that gap. It cannot place a call, cannot hear the audio, and cannot judge
whether Kannada sounds like a person. Anyone who reports "it sounds human now" on the strength of a
green test suite is wrong, and this plan exists so that claim is never made without evidence.

---

## 1. Hard preconditions

1. **Never dial a real customer number for testing.** Use approved test handsets and willing
   colleagues only.
2. **No call is placed without explicit, per-call human instruction.** The agent driving this repo
   must not place calls, ever — including "just to check".
3. **Decide the dial path first.** `POST /api/campaign/start` refuses `localhost`/`ngrok` and dials
   `VOICE_SERVER_URL` (currently the Render deployment). Until either the fixes are deployed or a
   gated local dial path is added, **a test call exercises the old deployed build, not the code in
   this working tree.** Confirm which build answered before scoring anything:

   ```
   GET https://priya-voice-agent-a8hq.onrender.com/api/plivo/hangup-status
   → { "build": "hangup-status/7", ... }
   ```

   `hangup-status/6` means you are testing the previous build. Score nothing until it reads `/7`.
4. **Capture the log before any dev-server restart.** `scripts/start-dev-hidden.vbs` rewrites
   `server-dev.log` and destroys the call evidence for the calls you just made.
5. **Recording:** record only where legally and operationally permitted, and tell the participant.

---

## 2. Scenario matrix

Run each scenario on a real handset, in both **handset mode** and **speaker mode**. Mark each as
`PASS` / `FAIL` / `UNTESTED` and paste the timestamps.

| # | Scenario | What to do | What must happen |
|---|---|---|---|
| 1 | Happy path | Answer, say yes, give a name, say you are interested | Five steps, one thank-you, one hangup after it finishes |
| 2 | Very short answers | Answer everything with `ಹೌದು` / `ಇಲ್ಲ` / `ಸರಿ` | No longer reply from Priya; one question at a time |
| 3 | Long answers | Give 2–3 sentences each turn | She does not summarise it back; one short beat, then the step |
| 4 | Hesitant caller | Pause, say `ಅಂದ್ರೆ...`, trail off | Extended hold, **no** premature silence check |
| 5 | Fast caller | Answer before she finishes | She yields immediately, does not finish her sentence |
| 6 | Slow caller | Wait 4–6 s before answering | She holds; when you speak you are answered, never hung up on |
| 7 | Late reply | Go silent, then speak **during** her goodbye | Goodbye is cancelled, you are answered |
| 8 | Full silence | Say nothing at all | Check at 5 s, identical check at 10 s, goodbye, end ~15 s |
| 9 | Partial speech | Start a word and stop | She waits for the real turn; no phantom reply |
| 10 | Background noise | TV / fan / road noise | She does not treat noise as a turn; no barge-in on noise |
| 11 | Soft speech | Whisper the answers | Still understood — the pipeline is tuned for whispers |
| 12 | Misrecognition | Mumble the name | She does **not** say "could you repeat" reflexively; she uses context |
| 13 | Language switch | Ask for English mid-call | She continues in English, same step, **no announcement** |
| 14 | Mixed language | Kannada with `ಸೈಟ್` / `ಲೋನ್` / `ಇಎಂಐ` | Stays Kannada — loanwords are not a language change |
| 15 | Disinterested | Say not interested | She closes once, kindly, no re-selling, call ends |
| 16 | Annoyed | Say this is annoying / stop calling | Shortest, most respectful reply; no re-asking |
| 17 | Busy | "I'm driving, call later" | Shorter turn, callback window only (10am–7pm) |
| 18 | Repeated answer | Give the same information twice | No repeated question, no repeated acknowledgement |
| 19 | Unexpected answer | Answer a question she did not ask | She recovers to the current step, does not restart |
| 20 | Poor network | Move to weak signal | No dead air beyond the repair window; no dropped turn |
| 21 | Interrupt the close | Interrupt during the thank-you | Caller has priority; the call does not end under them |

### 2.1 The five things to watch on every single scenario

1. **Dead air** — any silence where she has stopped processing and produced nothing.
2. **Incorrect interruption** — did she talk over the caller at any point?
3. **Repeated question / repeated beat** — did anything come twice?
4. **Correct state** — did she stay on the right step and in the right language?
5. **Correct ending** — exactly one hangup, after the close, never mid-sentence.

---

## 3. Native Kannada evaluation

**At least three native Kannada speakers**, at least one who is not a developer and not connected to
the project. Each listens to the same three recorded calls, independently, before any discussion.

Ask exactly these questions. Record verbatim answers; do not paraphrase.

1. Does the voice sound like a person?
2. Does the Kannada sound natural — would anyone say it this way?
3. Does she sound like she understands what was said to her?
4. Did she interrupt the caller at any point? Where?
5. Did she respond too slowly? Too quickly?
6. Did she sound scripted? At which line?
7. Did she repeat herself?
8. Did she sound like a salesperson?
9. Did she sound pushy?
10. Did she sound emotionally flat?
11. Did the language switching feel natural?
12. **Would you identify her as AI?** (yes / no / unsure)
13. **At what exact moment did you first suspect it?** (quote the sentence)

Question 13 is the most valuable one in this document. "Sounds like AI" is unusable; "at `ಅರ್ಥಾಯಿತು`
I knew" is a bug report with a line number.

---

## 4. Robotic-moment audit

One row per moment. The goal of the project is not more features — it is **fewer of these**.

| Timestamp | What Priya said (verbatim) | Why it sounded robotic | What a human would do | Proposed fix | Safe? | Done |
|---|---|---|---|---|---|---|
| _e.g. 00:14_ | `ಸರ್ತಿ ರವಿ ಸರ್.` | Identical beat in all three calls | Vary the beat, or drop it once the name is known | Curated ack set + no-repeat (shipped) | Yes | ☑ |
|  |  |  |  |  |  | ☐ |

**"Safe?" must be answered before the fix ships.** A fix that buys naturalness by risking a
business-fact violation, a premature hangup, or a broken call-control guarantee is not a fix.

Each accepted row becomes a regression test. If a row cannot be tested, say so in the Done column
rather than marking it complete.

---

## 5. Human-likeness scoring framework

Score each dimension **0–100** from the recorded calls plus the native evaluations. **Do not
inflate.** A dimension with no evidence scores its current engineering estimate and is marked
`(estimated)`.

| # | Dimension | Weight | Score | Evidence |
|---|---|---|---|---|
| 1 | Voice naturalness | 10% | | native Q1, Q6 |
| 2 | Kannada authenticity | 12% | | native Q2, style-guide audit |
| 3 | Conversational timing | 10% | | telemetry `callerToAgentMs`, scenario 6/7 |
| 4 | Turn-taking | 10% | | scenario 5/9, telemetry `bargeIns` |
| 5 | Barge-in | 6% | | scenario 5/21, `bargeInYieldMs` p95 |
| 6 | Listening quality | 10% | | scenarios 10/11/12 |
| 7 | Context retention | 6% | | scenario 18/19 |
| 8 | Tone adaptation | 6% | | scenarios 16/17, tone directives |
| 9 | Emotional appropriateness | 5% | | native Q9/Q10 |
| 10 | Business-message clarity | 8% | | scenario 1, five-step completion |
| 11 | Sales professionalism | 5% | | native Q8/Q9 |
| 12 | Language switching | 5% | | scenarios 13/14 |
| 13 | Silence recovery | 4% | | scenario 8 |
| 14 | Natural variation | 3% | | telemetry `ackRepeatsBlocked`, scenario 18 |
| 15 | Overall human impression | 10% | | native Q12/Q13 |

**Overall = Σ (weight × score).**

### 5.1 How to report it honestly

- Report the number you measured, not the number you want. 78% is a 78%.
- State which dimensions are `(estimated)` rather than measured.
- Distinguish **mechanism verified** (a test proves it fires) from **experience verified** (a human
  heard it and it was good). They are different claims and they are not interchangeable.
- Never derive the score from a green test suite. Tests and the phone experience measure different
  things, and the project's own history is a list of cases where the tests passed and the caller
  heard silence.

---

## 6. Performance targets

These are **proposed engineering targets**, not existing product requirements. Nothing in the
original specification established a number for any of them.

| Target | Proposed threshold | How measured |
|---|---|---|
| Unexplained dead-air incidents | 0 per call | `repairs` + scenario review |
| Premature terminations | 0 per call | `endReason` vs scenario expectation |
| Duplicate outbound calls | 0 per campaign | campaign `results` + Plivo live-call list |
| Repeated-question failures | 0 per call | scenario 18, native Q7 |
| Barge-in yield | p95 ≤ 250 ms | telemetry `bargeInYieldMs` |
| Caller → first agent audio | p95 ≤ 1 500 ms | telemetry `callerToAgentMs` |
| Late-reply recovery | 100% of rescues attempted succeed | `lateRepliesRescued` + scenario 7 |
| Robotic-phrase repetition | 0 per call | `ackRepeatsBlocked`, native Q7 |

Thresholds are deliberately conservative and are **guesses grounded in the code's own repair
windows** (`OUTBOUND_STEP_AUDIO_GUARD_MS = 2 600`, recovery grace `1 100 ms`). Treat them as a
baseline to argue with once real numbers exist, not as a specification.

---

## 7. Where the evidence lives

| Evidence | Where |
|---|---|
| Per-call counts and latencies | `GET /api/plivo/hangup-status` → `telemetry.aggregate`, `telemetry.recent` |
| Whether the hangup actually executed | same endpoint → `aleg.count` |
| Which build answered the call | same endpoint → `build` (must read `hangup-status/7`) |
| Static wiring of the guarantees | `npx tsx scripts/verify-late-reply.mjs` (23 checks, exits non-zero) |
| The name step, the silence ladder and the one thank-you | `npx tsx scripts/verify-name-step.mjs`, `npx tsx scripts/verify-silence-thanks.mjs` — both print a readable trace **and** exit non-zero on a wrong trace |
| The naturalness layer, wired as the engine wires it | `npx tsx scripts/verify-naturalness.mjs` (37 checks) |
| Which assertion protects which scenario | `npx tsx scripts/verify-scenarios.mjs` (13 checks — validates `SCENARIO_REGRESSION.md` against the test files, and fails if the document drifts) |
| That the scenario gate itself can fail | `npx tsx scripts/verify-scenarios-selftest.mjs` (7 corruptions; each must be caught by name, not merely by a non-zero exit) |
| Mechanism-level behaviour | `npm test` (279 tests, 50 suites) |
| Which of the caller's own words survive a dropped session | `npx tsx scripts/verify-naturalness.mjs` §8 (9 wiring checks) + `call-memory.test.ts` (16 tests) |
| Every difference from a human salesperson, and whether each claim is real | `npx tsx scripts/verify-human-gap.mjs` (27 checks) — resolves all 57 evidence literals in `HUMAN_VS_HUMAN_GAP_AUDIT.md`, and fails if a plan item is missing, a severity or category count drifts, the headline exceeds `conversation + 10`, or a `yes` verdict coexists with a score of 90+ |
| That the gap gate itself can fail | `npx tsx scripts/verify-human-gap-selftest.mjs` (12 corruptions, each caught **by name**) |
| **Audible quality** | **this plan only — nothing else can measure it** |

`telemetry` carries counts and millisecond latencies only: no name, no phone number, no transcript.
Call records are identified by an opaque hash so two records can be joined during an investigation
without being traceable to a person from the payload.

---

## 8. Status

| Item | State |
|---|---|
| Scenario matrix executed | ☐ **not started** — no real call has been placed with the current build |
| Native evaluation (≥3 speakers) | ☐ **not started** |
| Human-likeness score | ☐ **not measured** |
| Robotic-moment audit | ☐ **template only** |
| Telemetry endpoint live | ☑ shipped, `hangup-status/7` |
| Scenario inventory automated | ☑ `SCENARIO_REGRESSION.md` — 35/35 rows backed by a named assertion, gate + mutation self-test green |
| Build deployed | ☐ **not deployed** — Render still serves `hangup-status/6` |
