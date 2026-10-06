# Scenario regression list — 35 scenarios, and what each one is actually protected by

Companion documents: `VOICE_QA_PLAN.md` (real-device validation, native-evaluator questions,
human-likeness scoring), `KANNADA_STYLE_GUIDE.md` (spoken-Kannada register and phrase policy),
`PRIYA_PROJECT_SPEC.md` (§32 testing).

**What this document is for.** The other two documents describe *how to judge Priya with a human
ear*. This one is the engineering counterpart: for each conversational scenario the project cares
about, it names the assertion that would fail if the behaviour regressed. It exists so that the
next change to the engine can be checked against behaviour rather than against intuition.

**How the evidence column works.** Every entry is `<file>::<literal>`, where `<literal>` is a test
or check name that must be present in that file. Multiple entries are separated by `<br>`.
`node scripts/verify-scenarios.mjs` parses this table and **fails** if an ID is missing, if an ID is
duplicated or out of range, if a named literal is not found in the named file, or if a `partial` row
does not also point at a real row of the real-device plan. A row in this table therefore cannot claim
coverage the repository does not have.

**Layer column.**

| Layer | Meaning |
|---|---|
| `automated` | The behaviour is decided by pure functions or by source invariants, and a failing assertion is the whole story. |
| `partial` | The *mechanism* is pinned, but the *audible outcome* still needs a handset. The `Also needs` column names where that lives. |
| `manual` | No test can reach it. Listed in section 3, not numbered here, because it would be dishonest to give it an S-number and imply automation. |

Read `partial` as **"protected against regression, not proven to sound good."** Nothing in this
document is evidence that Priya sounds human; see section 3.

---

## 1. The 35 scenarios

| ID | Scenario | Layer | Evidence (`file::literal`) | Also needs |
|---|---|---|---|---|
| S01 | Opens immediately on answer, with no preamble, apology or reaction | automated | `src/voice/__tests__/owner-decisions.test.ts::still speaks the whole opening in one go` | — |
| S02 | The opening is intro **and** the site question in one turn, before the name | automated | `src/voice/__tests__/kannada-script.test.ts::opening = intro AND site question in ONE turn, THEN the name` | — |
| S03 | The name question is the pinned Kannada wording, never improvised | automated | `src/voice/__tests__/owner-decisions.test.ts::the name question carries the exact Kannada wording, not an improvised one` | — |
| S04 | Nothing is said before the name question — no thank-you, no promised step | automated | `src/voice/__tests__/kannada-script.test.ts::the name step NEVER opens with a thank-you, in any language` | — |
| S05 | A real name is captured however it is offered; a name is never invented | automated | `src/voice/__tests__/kannada-script.test.ts::never invents a name, and never captures the agent as the caller`<br>`src/voice/__tests__/owner-decisions.test.ts::still captures a real name, however it is offered` | — |
| S06 | The honorific matches the name: ಮಾಮ್ only for a clearly feminine name, ಸರ್ otherwise | automated | `src/voice/__tests__/kannada-script.test.ts::ma’am only for a clearly feminine name, sir for everything else`<br>`src/voice/__tests__/conversation-naturalness.test.ts::it addresses the caller with the right honorific`<br>`scripts/verify-naturalness.mjs::a female name gets ಮಾಮ್`<br>`scripts/verify-naturalness.mjs::a male name gets ಸರ್` | — |
| S07 | A declined name goes straight to the locations, with no reaction | automated | `src/voice/__tests__/kannada-script.test.ts::a declined name still goes straight to the locations, with no reaction` | — |
| S08 | After the name: exactly one short word, then the locations | partial | `src/voice/__tests__/kannada-script.test.ts::after the name she thanks in ONE word and goes straight to the locations` | partial — does the beat land as speech? `VOICE_QA_PLAN.md` §2 row 1 |
| S09 | The acknowledgement is the owner's word, and can never be mistaken for the close | automated | `src/voice/__tests__/kannada-script.test.ts::the acknowledgement is ಸರ್ತಿ, and it can never be mistaken for the close` | — |
| S10 | Every acknowledgement in the set is short and never thanks-shaped | automated | `src/voice/__tests__/conversation-naturalness.test.ts::EVERY variant is safe: short, and never a thanks-style close` | — |
| S11 | The safety gate rejects a thanks-close, and rejects anything longer than a beat | automated | `src/voice/__tests__/conversation-naturalness.test.ts::the safety gate rejects the things it must reject`<br>`src/voice/__tests__/conversation-naturalness.test.ts::the set is deliberately small — a beat, not a vocabulary` | — |
| S12 | The per-call beat differs between calls and is reproducible for one call id | automated | `src/voice/__tests__/conversation-naturalness.test.ts::selection is deterministic — a live call is reproducible, a test is assertable` | — |
| S13 | No acknowledgement repeats inside one call | automated | `src/voice/__tests__/conversation-naturalness.test.ts::the guard beats every phrase before it ever repeats one`<br>`src/voice/__tests__/conversation-naturalness.test.ts::a whole simulated call never repeats a phrase while the pool lasts` | — |
| S14 | The legacy rollback restores the single fixed word | automated | `src/voice/__tests__/conversation-naturalness.test.ts::legacyOnly pins the original behaviour — this is the rollback` | — |
| S15 | The nudge carries the acknowledgement this call was given, not a constant | automated | `src/voice/__tests__/conversation-naturalness.test.ts::the nudge carries the acknowledgement this call was given`<br>`src/voice/__tests__/conversation-naturalness.test.ts::the retry nudge uses its realization too` | — |
| S16 | Business content is byte-identical whatever the beat is | automated | `src/voice/__tests__/conversation-naturalness.test.ts::the business content never varies — only the beat does` | — |
| S17 | A repair never replays the phrase the caller just heard | automated | `src/voice/__tests__/conversation-naturalness.test.ts::a repair does not hand back the phrase the caller already heard` | — |
| S18 | A neutral caller gets no directive at all — no added prompt noise | automated | `src/voice/__tests__/conversation-naturalness.test.ts::neutral callers get no directive at all — no extra prompt noise`<br>`scripts/verify-naturalness.mjs::a neutral caller gets no extra prompt noise` | — |
| S19 | A pressed caller is told to be *shorter*, never *warmer* | automated | `src/voice/__tests__/conversation-naturalness.test.ts::a pressed-for-time caller is told to be shorter, not warmer` | — |
| S20 | No tone directive can license a new claim, a price or an offer | automated | `src/voice/__tests__/conversation-naturalness.test.ts::no directive ever licenses a new claim, a price, or an offer` | — |
| S21 | No directive mirrors the caller's energy, mood or loudness | automated | `src/voice/__tests__/conversation-naturalness.test.ts::no directive tells the agent to mirror the caller` | — |
| S22 | Irritation is not mistaken for merely being busy | automated | `src/voice/__tests__/conversation-naturalness.test.ts::an irritation is never mistaken for merely busy` | — |
| S23 | A refusal outranks a price question asked in the same breath | automated | `src/voice/__tests__/conversation-naturalness.test.ts::a refusal outranks a price question in the same breath` | — |
| S24 | Short answers are real turns, and never buy a longer reply | partial | `src/voice/__tests__/short-reply.test.ts::recognises houda / haudu / ha as real turns`<br>`src/voice/__tests__/conversation-naturalness.test.ts::a short answer never buys a longer reply` | partial — `VOICE_QA_PLAN.md` §2 row 2 |
| S25 | Noise never becomes a turn; caller audio is attenuated, never erased | partial | `src/voice/__tests__/noise-duck.test.ts::never turns a noise frame into silence`<br>`src/voice/__tests__/audio-pipeline.test.ts::debounces turn START: one noise frame never starts, three speech frames do`<br>`src/voice/__tests__/noise-duck.test.ts::attenuates rather than removes — quieter, but the same signal` | partial — `VOICE_QA_PLAN.md` §2 row 10 |
| S26 | Barge-in fires on real overlap, never on a transient spike | partial | `src/voice/__tests__/audio-pipeline.test.ts::does not fire barge-in on a short transient spike` | partial — did she finish her sentence? `VOICE_QA_PLAN.md` §2 row 5 |
| S27 | Barge-in yield time is measured, not guessed | automated | `src/voice/__tests__/conversation-naturalness.test.ts::barge-in records how fast the agent yielded` | — |
| S28 | Silence: check at 5s, the same check again at 10s, close at ~15s | partial | `src/voice/__tests__/kannada-script.test.ts::5s quiet → check; 5s more → the SAME check again; 5s more → the call ends`<br>`src/voice/__tests__/kannada-script.test.ts::the check line is asked TWICE per silent stretch, then the call closes` | partial — `VOICE_QA_PLAN.md` §2 row 8 |
| S29 | Caller speech fully resets the silence cycle, so a later quiet spell checks again | automated | `src/voice/__tests__/kannada-script.test.ts::caller speech fully resets the cycle, so a LATER quiet spell can check again` | — |
| S30 | A late reply during the goodbye cancels the close and is answered | partial | `src/voice/__tests__/kannada-script.test.ts::cancels a pending silence goodbye the moment the caller speaks`<br>`scripts/verify-late-reply.mjs::guard clears itself the moment agent audio reaches the caller` | partial — `VOICE_QA_PLAN.md` §2 row 7 |
| S31 | A close that is already committed cannot be cancelled | automated | `src/voice/__tests__/kannada-script.test.ts::refuses to cancel once the close is committed` | — |
| S32 | The recovery ladder escalates and then RESUMES the call — it never gives up to a hangup | partial | `src/voice/__tests__/speech-recovery.test.ts::escalates with a more explicit nudge, then RESUMES the call (never gives up to hangup)`<br>`src/voice/__tests__/speech-recovery.test.ts::nudge text never tells the model to hang up and stays private` | partial — `VOICE_QA_PLAN.md` §2 row 20 |
| S33 | The call never ends from silence alone, or after only the opening yes | automated | `src/voice/__tests__/end-call-guard.test.ts::NEVER allows endCall from silence alone — no silence path exists`<br>`src/voice/__tests__/end-call-guard.test.ts::blocks outbound hangup after only the opening yes` | — |
| S34 | Exactly one thank-you, and the tail of the close is never truncated | automated | `src/voice/__tests__/thanks-repeat-in-turn.test.ts::a thanks repeated inside one turn is dropped`<br>`src/voice/__tests__/thanks-repeat-in-turn.test.ts::the tail of the close is NOT truncated`<br>`src/voice/__tests__/end-call-guard.test.ts::always allows endCall after the sales-team close` | — |
| S35 | Language changes only on an explicit request — not on a loanword, not on the caller's own name | partial | `src/voice/__tests__/language-follow.test.ts::does NOT switch on a plain English sentence — only on a request`<br>`src/voice/__tests__/language-follow.test.ts::does NOT switch on the caller giving their name`<br>`src/voice/__tests__/language-follow.test.ts::stays in Kannada across English/Marathi turns until asked`<br>`src/voice/__tests__/language-follow.test.ts::switches when the caller explicitly asks` | partial — `VOICE_QA_PLAN.md` §2 row 13 |

---

## 2. Measured coverage

Measured on this working tree, not estimated:

```
npx tsx --test --test-reporter=spec src/voice/__tests__/*.test.ts     → SPEC-EXIT: 0
ℹ tests 279   ℹ suites 50   ℹ pass 279   ℹ fail 0   ℹ skipped 0
```

| Test file | Tests | Scenarios it carries |
|---|---|---|
| `conversation-naturalness.test.ts` | 69 | S10–S23, S27 |
| `kannada-script.test.ts` | 80 | S02, S04, S05, S06, S07, S08, S09, S28–S31, S34 |
| `owner-decisions.test.ts` | 27 | S01, S03, S05 |
| `audio-pipeline.test.ts` | 14 | S25, S26 |
| `callback-time.test.ts` | 13 | callback window (supports S19) |
| `end-call-guard.test.ts` | 12 | S33, S34 |
| `language-follow.test.ts` | 12 | S35 |
| `speech-recovery.test.ts` | 10 | S32 |
| `outbound-dedup.test.ts` | 8 | repetition across turns (supports S13) |
| `plivo-hangup.test.ts` | 6 | exactly one hangup |
| `noise-duck.test.ts` | 5 | S25 |
| `thanks-repeat-in-turn.test.ts` | 4 | S34 |
| `short-reply.test.ts` | 3 | S24 |
| `call-memory.test.ts` | 16 | the reconnect-memory gap (see `HUMAN_VS_HUMAN_GAP_AUDIT.md` G20/G44) |
| **Total** | **279** | **35 / 35 have a named assertion** |

Four standalone verification harnesses check wiring that unit tests cannot reach, because
`src/voice/logic.ts` needs a live WebSocket to import. Run them with `npx tsx` — plain `node`
cannot resolve the extensionless local imports:

```
npx tsx scripts/verify-late-reply.mjs         # 23 checks — S30, and the step speak guard
npx tsx scripts/verify-name-step.mjs          # trace; non-zero exit on a wrong trace — S03, S04
npx tsx scripts/verify-silence-thanks.mjs     # 2 verdicts; non-zero exit on FAIL — S28, S31, S34
npx tsx scripts/verify-naturalness.mjs        # 37 checks — S06, S12, S15, S16, S17, S18, S27, plus the call-memory wiring
npx tsx scripts/verify-scenarios.mjs          # 13 checks — validates THIS document
npx tsx scripts/verify-scenarios-selftest.mjs # 7 corruptions, each must be caught
npx tsx scripts/verify-human-gap.mjs          # 27 checks — validates HUMAN_VS_HUMAN_GAP_AUDIT.md
npx tsx scripts/verify-human-gap-selftest.mjs # 12 corruptions, each must be caught by name
```

Every one of these exits non-zero when the behaviour it describes is wrong. `verify-silence-thanks.mjs`
did **not** until this pass: it printed `VERDICT: FAIL` and exited 0, so a broken silence ladder looked
like a green result to anyone chaining on the exit status. The fail path is now proven the same way as
the gate below — by breaking a copy and watching it fail.

`npx tsx scripts/verify-scenarios.mjs` validates **this document** against the test files: it fails if a
scenario is missing or duplicated, if an evidence literal is gone from the file it names, if a `partial`
row stops naming its handset check, if any `§2 row N` reference points at a row that does not exist, or
if the coverage table stops adding up. `verify-scenarios-selftest.mjs` corrupts the document seven ways
and requires each corruption to be caught **by name**, because a non-zero exit on its own can also mean
a crash — a mistake this test made on its first attempt.

---

## 3. What the 35 scenarios do NOT cover

This is the honest half. Every automated row above proves a *mechanism*; none of them proves that
the result sounds like a person. All of the following are reachable **only** on a live call:

| Not covered by any test | Why it cannot be | Where it is checked |
|---|---|---|
| Whether the voice itself sounds human | It is a TTS voice chosen by env config. No assertion can hear it. | `VOICE_QA_PLAN.md` §3 Q1 |
| Whether the Kannada is natural, idiomatic, and in the right register | Requires a native speaker, not a regex. **No native speaker has reviewed any phrase yet.** | `VOICE_QA_PLAN.md` §3, `KANNADA_STYLE_GUIDE.md` §2 and its acknowledgement table (`☐ pending`) |
| Whether an acknowledgement arrives at a human-feeling moment | Placement is timing under real acoustic latency. | `VOICE_QA_PLAN.md` §2 row 1 |
| Whether dead air occurs under real network jitter | Needs a real media path, not a mock clock. | `VOICE_QA_PLAN.md` §2 row 20 |
| Whether she is identified as AI, and at which exact sentence | Only a listener can answer this. | `VOICE_QA_PLAN.md` §3 Q12–Q13 |
| Whether whispered or soft speech survives the real pipeline | The classifier is tested on synthetic frames, not on a quiet human. | `VOICE_QA_PLAN.md` §2 row 11 |
| Speakerphone echo and double-talk behaviour | Physical acoustic coupling. | `VOICE_QA_PLAN.md` §2 rows 2 and 10 |

**Status: none of the manual items above has been run.** No call has been placed against a real
handset for this work, so the 35 rows here represent *regression protection*, not *validated
human-likeness*. An honest human-likeness estimate remains approximately 77%, with voice
naturalness and Kannada authenticity unimproved and unmeasured — the two heaviest dimensions in the
scoring framework in `VOICE_QA_PLAN.md` §5.
