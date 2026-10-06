# Every difference between Priya and a real human property salesperson

**Benchmark:** a competent, experienced human property salesperson from Mysuru, on a phone call with a
real prospective buyer. **Not** another AI agent, not the code's own test suite.

**The question this document answers:** *"If I received this call, at what moments would I realise I am
talking to an AI rather than a real salesperson?"*

Owner: PRIYA project · Applies to: the live outbound agent (`saas-platform/src/voice/**`)
Companion documents: `VOICE_QA_PLAN.md` (how to run the human evaluation), `KANNADA_STYLE_GUIDE.md`
(spoken-Kannada register), `SCENARIO_REGRESSION.md` (which assertion protects which scenario),
`PRIYA_PROJECT_SPEC.md` (§24 superseded figures).

---

## 0. Evidence basis — read this before trusting a single row

**No call has been placed for this work.** Nobody has heard this build on a handset. That single fact
governs how every claim below must be read, so the columns are split by what actually backs them:

| Kind of claim | What stands behind it |
|---|---|
| **Priya behaviour** | A named artifact in the repository — a prompt string, a threshold, a branch. The `Evidence` column gives `<file>::<literal>`, and `scripts/verify-human-gap.mjs` fails if the literal is not in the file it names. |
| **Human behaviour** | What a competent salesperson does. Written from the caller's side of the phone, not from the code. |
| **How the caller experiences it** | **An inference.** It is the most plausible audible consequence of the two columns beside it. It is not a measurement, and no row here may be quoted as if someone heard it. |
| **Severity** | A guess at how quickly a real Mysuru buyer would work out they are talking to a machine — ordered by time-to-detection, not by how easy it is to fix. |

Section §36 and §41 state plainly which of this is verifiable today and which is not.

---

## 1. First principle

A real salesperson is not speech + script + questions + answers. They run all of the following at once,
most of it below the level of conscious decision:

listening · interpreting intent · remembering context · noticing hesitation · reading emotion · deciding
how much to say · deciding when *not* to speak · adjusting wording · adjusting pace · recognising a busy
caller · understanding an indirect answer · repairing a misunderstanding · reacting to the unexpected ·
using local conversational habits · avoiding repetition · knowing when to stop selling · noticing real
interest · noticing discomfort · making the whole thing feel spontaneous.

Priya runs a **five-step linear flow with a maximum of two questions**, pinned wording, one pace, and a
code-driven silence ladder. That is the whole gap in one sentence. Everything below is a specific
instance of it.

---

## 2. Not "does it work?"

| Question | Answer, honestly |
|---|---|
| Does it feel human? | No — not yet. §37 scores it. |
| Does it listen like a human? | It reacts to a **regex over a transcript**, not to meaning (§4). |
| Does it react like a human? | It reacts to *categories* it was coded to notice (§11, §12). |
| Does it understand like a human? | It cannot demonstrate comprehension, and is **forbidden** to try (§10). |
| Does it adapt like a human? | It adapts length and explanation, never warmth, pace or them (§12, §25). |
| Does it pause like a human? | It treats a 250 ms gap as the end of a turn and 5 s of silence as a problem (§6). |
| Does it recover like a human? | One generic repeat request, and an unanswerable question **ends the call** (§24, §21). |
| Does it sound locally natural? | Unvalidated. Zero native reviewers have heard a phrase (§16). |
| Does it sell like a human? | It asks two questions and hands off. It qualifies nothing (§13, §14). |
| Does it know when NOT to sell? | Yes — better than most of this document (§13). |
| Does it remember what was just said? | Within a session, yes; across a dropped session it used to lose it — fixed this pass (§20). |
| Does it make the caller feel heard? | **No. It is explicitly instructed not to.** (§10) |

---

## 3. Human vs AI gap matrix

54 differences. Columns: category letter (§30), the human behaviour, what Priya actually does, the
difference, severity (§31), what the caller experiences, the code that proves Priya's side, and the fix.
Every `Evidence` cell is checked by `scripts/verify-human-gap.mjs`.

| ID | Cat | Human salesperson behaviour | Priya behaviour (grounded) | Difference | Severity | How the caller experiences it | Evidence (`file::literal`) | Fix |
|---|---|---|---|---|---|---|---|---|
| G01 | A | Pitch and pace drift naturally inside one sentence — a question lifts, a statement settles | One level pace, pinned for the whole call, and the prompt forbids matching the caller's energy | A human's delivery carries meaning in its movement; Priya's carries meaning only in its words | High | "She sounds like a recording — same level all the way through." | `src/voice/kannada-script.ts::NEVER change your speed to match how the caller sounds`<br>`src/voice/tts/speech-config.ts::const config: Record<string, unknown> = { temperature: settings.temperature };` | No rate/pitch knob exists in the Live API. The only levers are sentence shaping and voice choice. See P01. |
| G02 | A | Takes a real breath before a longer sentence | Prompt forbids it outright — "no searching pause, no hesitation, no theatrical breathing room before a line" | The runtime block asks for "a real breath before a longer line", the delivery block bans it: two instructions, opposite | High | Every line arrives with machine-regular spacing, including the long ones | `src/voice/kannada-script.ts::No searching pause, no hesitation, no theatrical breathing room` | One of the two blocks is wrong. Prompt-only change; no code risk. See P02. |
| G03 | A | Emotion is audible and moves with the conversation | Affective dialog is compiled in but gated OFF — the model rejects it | Priya's warmth lives entirely in word choice, never in the sound | High | A caller being told something friendly hears a neutral voice, and starts editing what they say | `src/voice/tts/speech-config.ts::Verified rejected by gemini-3.1-flash-live-preview — keep gated` | Model limitation, not a bug. Do not re-enable blind; it returns no audio at all. See P03. |
| G04 | A | A question has a rise; a statement has a fall | Pitch guidance exists only as an instruction; nothing verifies it | Unverifiable in principle from the code side | Medium | Questions that do not sound like questions | `src/voice/kannada-script.ts::Questions end on a friendly rise; statements settle down warm` | Native listening test only. §28 Q1. |
| G05 | A | Speaks up when the caller clearly cannot hear, unprompted | Volume never changes; "a little louder" is available in one repair nudge only | A human self-corrects against the acoustic feedback they can hear; Priya cannot hear the caller's line | Low | A caller on a poor line has to ask, twice sometimes | `src/voice/kannada-script.ts::Speak it a little SLOWER and a little louder than before` | Business/telephony limit. Leave it; the repeat nudge covers the case. |
| G06 | B | Answers in ~200–600 ms, sometimes a full second when actually thinking | Fixed pipeline latency: 250 ms local VAD + 250 ms model AAD, then generation | A human's latency tracks the difficulty of the reply; Priya's tracks the configuration | Medium | The gaps are always the same length, so the call has a metronome | `src/voice/audio-pipeline-config.ts::aadSilenceDurationMs: silenceMs(process.env.VOICE_AAD_SILENCE_MS, 250)` | Measure p50 and p95 on a real call first (telemetry already carries them). Then widen variance deliberately. See P04. |
| G07 | B | A simple "yes" gets an immediate reply; a real question gets a beat | Nothing in the pipeline varies latency with the content of the turn | The timing carries no attentiveness at all | Medium | "She answers the same way no matter what I say." | `src/voice/call-telemetry.ts::export function createCallTelemetry` | Same as G06 — one measurement, then one deliberate change. |
| G08 | B | Yields the floor in ~100–200 ms on a real interruption | Barge-in arms after a 150 ms hold of speech-class frames, then clears playback | Close to human. Not a defect. Listed for completeness | Low | Interruption mostly feels right | `src/voice/audio-pipeline-config.ts::bargeInMinMs: num(process.env.VOICE_BARGE_IN_MIN_MS, 150)` | Nothing. This one is working. |
| G09 | B | Waits out a thinking pause — silence mid-sentence is not the end of a turn | End of turn is committed after 250 ms of quiet; the recovery ladder then waits 1 100 ms for words | A human pause to think is read as a finished turn, then as a possible failure | High | A caller who pauses mid-thought gets "kindly say that again" instead of patience | `src/voice/audio-pipeline-config.ts::vadSilenceMs: silenceMs(process.env.VOICE_VAD_SILENCE_MS, 250)` | Raise the end-of-turn quiet for the caller's first reply after a question only. See P05. |
| G10 | B | Would never ask "are you still there?" five seconds after a question | Availability check fires at 5 s, again at 10 s, goodbye at 15 s, call ends | Five seconds is a fast answer, not an emergency | High | A caller who is thinking, or finding their glasses, is asked if they are still on the line — twice — and then hung up on | `src/voice/kannada-script.ts::export const SILENCE_CHECK_AFTER_MS = 5_000;` | Owner decision on the ladder. Even at 8 s it would read as impatience. See P06. |
| G11 | C | Speaks idiomatic spoken Kannada, judged by ear, never by rule | Every phrase is unaudited — no native speaker has approved any of them | The largest single unknown in the project | Critical | A caller either hears their language or hears a translation. If it is a translation, they know in one sentence | `src/voice/conversation-naturalness.ts::validatedByNativeSpeaker: false` | Native review. Nothing in code can substitute. See P07. |
| G12 | C | Never uses a written verb form in speech | The prompt lists the correct spoken forms and bans the written ones, but the model still chooses each form freely | A rule in a prompt is a strong hint, not a guarantee | High | One `ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ` in the middle of a call is louder than ten correct sentences | `src/voice/kannada-script.ts::Never: ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ, ವಾಸಿಸುತ್ತೀರಾ, ತಿಳಿದುಕೊಳ್ಳಬೇಕು` | Add an output-side detector for the written forms and re-ask the turn. See P08. |
| G13 | C | Speaks Kannada because that is their language | Kannada is sent to the TTS with **no** language code (the Live API silently ignores `kn-IN`), so the model self-detects | The model, not the config, decides what Kannada sounds like | Medium | Kannada whose accent and phonemes are the model's guess | `src/voice/language/language-follow.ts::kn: null,` | Re-test `kn-IN` when the Live API adds Kannada; until then nothing. |
| G14 | C | Says "ಸರ್ತಿ" occasionally, not at the same beat every call | Curated set, rotated per call by a stable seed, with a no-repeat guard | **Fixed in a previous pass.** This used to be the same word every call, every caller | Low | The beat varies across calls now | `src/voice/__tests__/conversation-naturalness.test.ts::the business content never varies — only the beat does` | Nothing left to do here. Keep the guard. |
| G15 | D | Hears meaning: a price question is interest, not confusion | Classifies the transcript with regular expressions, in a fixed priority order | Priya hears **patterns**, not intent. Anything outside the patterns falls to `neutral` | High | Say something a regex does not know and the reply does not fit what you said | `src/voice/conversation-naturalness.ts::const CONFUSED_RE =` | Add a meaning-level classification pass for the reply, not for the routing. See P09. |
| G16 | D | Hears "I'll think about it" as soft interest or hesitation, and leaves room | Hesitation is only recognised if it is one of the listed tokens; everything else is `neutral` | The most common real answer on a cold call is outside the pattern | High | "Let me think about it" gets a neutral continuation instead of room | `src/voice/conversation-naturalness.ts::const HESITANT_RE =` | Extend the hesitation patterns, and treat an unparsed answer as hesitation rather than neutral. See P09. |
| G17 | D | Hears a question about price, EMI or a visit as interest | Interest patterns cover price / rate / EMI / loan / visit / block / "how much" | Working as intended | Low | Interest is usually classified correctly | `src/voice/conversation-naturalness.ts::const INTERESTED_RE =` | Nothing. |
| G18 | D | **Proves** comprehension — repeats the key word, asks about it, reflects it | Is **forbidden** to: "Never repeat the caller's own words back at them before you respond" and "if you are unsure what they said, assume you heard it and just answer" | The one behaviour that makes a caller feel heard is banned by the prompt | Critical | A buyer gives a specific answer — "Hunsur, my brother lives there" — gets "ಸರ್ತಿ", and hears nothing about Hunsur. That is the moment they know | `src/voice/kannada-script.ts::Never repeat the caller's own words back at them before you respond` | Distinguish *echoing the words* (correctly banned) from *referring to the content* (banned by accident). See P10 — this is the highest-value fix in the document. |
| G19 | D | An acknowledgement carries information about what was heard | Every acknowledgement is capped at three words and is chosen to be reusable in any context | By construction, deleting the caller's previous sentence would not break it | High | The acknowledgement is audibly a beat, not a response | `src/voice/conversation-naturalness.ts::export const ACK_MAX_WORDS = 3;` | Add a second, content-bearing clause after the beat where the caller gave content. See P10. |
| G20 | E | Holds the whole conversation in mind without effort | The model session holds it — until the socket drops. A reconnect builds a **fresh session with restored instructions and no dialogue history** | Across a reconnect the caller's own words were gone entirely | High | The caller tells her something, the line glitches, and she does not know it any more | `src/voice/logic.ts::RECONNECT IMPLEMENTATION — fresh session + restored state + resume line` | **Fixed this pass:** a bounded recall block is now injected into the fresh session. See P11. |
| G21 | E | Uses the caller's name naturally later in the call | Captures the name, picks ಸರ್/ಮಾಮ್, persists it to the lead, and carries it into the acknowledgement | Working as intended | Low | Being called by name, correctly gendered | `src/voice/logic.ts::callMemory = setKnownCaller(callMemory, { name, honorific: outboundCallerHonorific });` | Nothing. |
| G22 | E | Knows what the company already knows about the caller — they enquired about Hunsur last month | The lead-name lookup was removed and no CRM context reaches the prompt | A salesperson with a CRM would open differently for a warm enquiry; Priya cannot tell a warm lead from a cold one | Medium | A warm caller gets the same cold-call opening as everyone else | `src/voice/logic.ts::Lead-name lookup removed` | Pass the lead's enquired locality/project into the runtime block. See P12. |
| G23 | E | Does not press for something the caller has declined to give | Stores the refusal, skips the acknowledgement word, goes straight to the locations | Working as intended | Low | Declining to give a name is accepted without friction | `src/voice/__tests__/kannada-script.test.ts::a declined name still goes straight to the locations, with no reaction` | Nothing. |
| G24 | F | Hears irritation and stops selling immediately | Irritation is recognised by pattern, and the directive is short and respectful | Right behaviour, narrow trigger | High | A caller who is annoyed in words Priya does not know gets the ordinary flow | `src/voice/conversation-naturalness.ts::const ANNOYED_RE =` | Broaden the trigger; treat any second refusal as irritation. See P13. |
| G25 | F | Reads tone, sighs, and pauses as emotional information | The audio pipeline classifies frames as speech / noise / ambiguous for turn-taking. It has **no** emotion model at all | Emotion is inferred from transcript words only, so a sigh carries nothing | High | A caller's flat, tired delivery is invisible; the reply stays cheerful | `src/voice/audio-pipeline-config.ts::Frame classification (speech vs noise vs ambiguous)` | No emotive signal is available in the current config. Stop implying otherwise in the prompt. See P03. |
| G26 | F | Slows down and simplifies when someone is struggling | Pace is pinned; only length, explanation and strategy change | Deliberate owner decision — correct for consistency, visible as unresponsiveness to distress | Medium | A hard-of-hearing or elderly caller gets volume-matched, not help | `src/voice/kannada-script.ts::NEVER change your speed to match how the caller sounds` | Allow one exception: the repair nudge may slow down. It already does. Leave the rest. |
| G27 | G | Senses a busy caller in three words and gets out of the way | `busy` is detected by pattern and gives a one-sentence directive | Working as intended | Low | A busy caller gets a short turn | `src/voice/__tests__/conversation-naturalness.test.ts::a pressed-for-time caller is told to be shorter, not warmer` | Nothing. |
| G28 | G | Adapts to how the caller talks — their formality, their mixing, their accent | Adapts only on an explicit request to change language | A human mirrors the register of the person they are talking to; Priya waits to be told | Medium | She sounds the same whether the caller is formal or casual | `src/voice/language/language-follow.ts::if (decision.reason !== 'explicit_request' || !decision.language) {` | Owner decision — the current rule is a deliberate fix for a real bug. Register (not language) could still adapt. See P14. |
| G29 | G | Naturally says less when there is less to say | The tone directive is **appended to a nudge** and the model may ignore it. Nothing verifies the reply actually got shorter | The adaptation is advisory text, not a control | High | The "shorter reply" for a busy caller is often the usual reply | `src/voice/conversation-naturalness.ts::export function buildToneDirective` | Measure turn length against the directive on real calls; if ignored, cut the source material instead of asking the model to. See P15. |
| G30 | G | Goes quiet and gives room when someone is unsure | Hesitant directive: one short line, no push, no repeat of the question | Working as intended, when hesitation is detected at all | Low | An unsure caller is not pressured | `src/voice/conversation-naturalness.ts::Give them room with one short line` | Nothing (the detection gap is G16). |
| G31 | H | Qualifies: budget, timeline, purpose, who else decides — conversationally, woven in | Forbidden. Two questions for the entire call, by owner decision | The call is structurally a two-question script with a handoff. It cannot read as a sales conversation because it is not one | Critical | A buyer notices within two turns that this is an information-gathering call, not a sales conversation — the shape gives it away | `src/voice/kannada-script.ts::TWO QUESTIONS MAX on the whole call` | Owner decision. If the two-question limit stays, at minimum let her *sound* like she chose it. See P16. |
| G32 | H | Answers a price question with a range, a starting point, or an honest "it depends" | Refuses and hands off, always with the same line | A human gives partial information and keeps the conversation; a machine declines | High | "She won't tell me anything about price" — which reads as either a bot or a bad salesperson | `src/voice/kannada-script.ts::Never invent prices, sizes, approvals or any fact not in the script` | Business constraint. The fix is to supply *some* approved indicative content. See P17. |
| G33 | H | Asks a different, smaller question when the first answer was ambiguous | May ask only the two permitted questions, ever | Cannot clarify without breaking the flow | Medium | An ambiguous answer produces a handoff instead of a second question | `src/voice/kannada-script.ts::no "shall I continue?"` | Fold the clarification into the flow rather than adding a question. See P16. |
| G34 | H | Stops selling the moment the answer is no | The not-interested directive says "Stop selling. Close kindly and briefly, once, and end the call" | Working as intended — this one is genuinely good | Low | A decline is respected in one turn | `src/voice/conversation-naturalness.ts::Stop selling. Close kindly and briefly` | Nothing. |
| G35 | H | When asked something they do not know, says "let me find out and come back to you" | An unanswerable question triggers the sales-team line, **one thank-you, and endCall in the same turn** — the call ends | A salesperson keeps the conversation; Priya terminates it | Critical | Ask "how did you get my number?" or "which company are you from?" and the call can end with a thank-you. Nothing exposes a script like being thanked and hung up on for asking a normal question | `src/voice/kannada-script.ts::Add ONE short thank-you. Then`<br>`src/voice/kannada-script.ts::IMMEDIATELY call endCall in the SAME turn — that is the end of this call` | Answer or deflect, then continue. Never close the call because a question was hard. See P18. |
| G36 | I | If the line drops, says so: "sorry, I lost you for a second" | Forbidden from admitting anything of the kind — the recall block explicitly instructs her not to mention it | A human acknowledges the gap; Priya pretends it never happened | Medium | A caller who noticed the gap hears the pretence and knows | `src/voice/call-memory.ts::never say that you lost track` | Deliberate: admitting a system restart is worse. Leave it. |
| G37 | I | If a garbled word is obvious from context, uses the context | If a name cannot be read, marks it declined and moves on without asking again | A human asks once more, gently, with a guess attached; Priya silently drops it and stops using a name | Medium | "She stopped using my name and never asked again — as if she gave up" | `src/voice/logic.ts::Could not read a name from` | One gentle retry with a guess, then move on. See P19. |
| G38 | I | Distinguishes "I didn't catch that" from "I don't understand what you mean" | The ladder has exactly two kinds — ask for a repeat, or reply now. Both produce the same one generic request | A single generic repair tells the caller the system failed, not that a person missed a word | High | "Sorry, could you repeat that" for a mispronunciation, for a mumble, and for a hard question — the same sentence every time | `src/voice/speech-recovery.ts::ask them to kindly repeat that once` | Differentiated repair per cause. See P20. |
| G39 | I | Checks a specific word when unsure: "Hunsur, is it?" | Explicitly banned: "NEVER ask them to confirm what they just said", plus a code-level suppressor for echo-confirm questions | A human closes a misunderstanding in four words; Priya is not allowed to | High | The one repair that would feel most human is the one she cannot make | `src/voice/kannada-script.ts::NEVER ask them to confirm what they just said` | Allow a *content* confirmation ("Hunsur, right?") while keeping the *meta* confirmation banned. See P20. |
| G40 | I | Resumes a sentence after being interrupted, from where they were | On barge-in the playback is cleared and the model regenerates the turn from the flow state | The interrupted half-sentence is lost, not resumed | Medium | She starts the thought again from the top, or drops it entirely | `src/voice/logic.ts::Local barge-in — clearing AI playback` | Record how far the turn got and nudge "finish that thought". See P21. |
| G41 | I | Repairs themselves out loud and carries on | Self-repair lines are suppressed outright by three separate guards (echo-confirm, future-site pitch, cannot-answer) | Suppression was added to stop loops, and it also stops recovery | Medium | A small stumble disappears instead of being smoothed over | `src/voice/logic.ts::ECHO-CONFIRM` | Narrow the suppressors to repeated instances rather than first instances. See P22. |
| G42 | J | Never asks for something already given | The prompt forbids it, and the recall block now carries the facts across a reconnect | Enforced by instruction plus a new context block; neither is a guarantee the model obeys | High | Being asked for a name that was just given is the most damaging single moment in the document | `src/voice/call-memory.ts::Never ask again for anything listed above` | Verify on a real call; add a code-side check that blocks a repeated question. See P11. |
| G43 | J | Stays in the language the caller asked for | Once switched, the language persists until asked again | Working as intended | Low | Language choice is respected | `src/voice/language/language-follow.ts::Once switched, stay in the caller's language until they ask again` | Nothing. |
| G44 | J | Carries a fact through a bad connection | The recall block carries the last four caller utterances, the name, the flow position and her own last line | **Fixed this pass.** It is bounded and truncates at 160 characters per line | High | A caller is not asked again after a glitch | `src/voice/call-memory.ts::What the caller has already said (oldest first):` | Verify on a real call. See P11. |
| G45 | J | Never re-explains what they already explained | Forbidden in the prompt ("NEVER deliver the same INFORMATION twice"), unverified in practice | The rule exists; compliance is the model's | Medium | A repeated explanation is a strong AI tell | `src/voice/kannada-script.ts::NEVER deliver the same INFORMATION twice` | Add a spoken-line repetition detector, mirroring the acknowledgement guard. See P23. |
| G46 | K | Often lets the other person land the point before responding | Clears playback 150 ms into sustained speech-class audio, mid-word if necessary | Priya yields *faster* than a polite human. That is a tell of a different kind | High | She stops mid-word the instant the caller breathes loudly, which no human does | `src/voice/logic.ts::caller took the floor in` | Require a minimum word boundary, or a slightly longer hold, before dropping audio. See P24. |
| G47 | K | Briefly overlaps the other speaker and then yields | Cannot overlap at all — the design clears the agent's audio rather than mixing | Overlapping speech is a normal human event and never happens here | Medium | Nobody ever talks over Priya, which is subtly unnatural | `src/voice/logic.ts::bargeInConfirmedAt = Date.now();` | Telephony/architecture limit. Leave it. |
| G48 | K | Keeps their place through an interruption | The turn is regenerated from the flow state, so the place is the step, not the sentence | Loses the sentence, keeps the step | Medium | She restarts the step's content rather than continuing her sentence | `src/voice/logic.ts::clearPlayback();` | Same fix as G40. See P21. |
| G49 | K | Does not mistake a fan or a door for somebody speaking | Turn start requires ~40 ms of consecutive speech-class frames; noise frames are never forwarded at volume | Working as intended | Low | Room noise does not trigger her | `src/voice/__tests__/audio-pipeline.test.ts::debounces turn START: one noise frame never starts, three speech frames do` | Nothing. |
| G50 | L | The conversation has no visible structure | The flow is exactly five steps, they are named in the prompt (`THE WHOLE CALL, IN FIVE STEPS`), and the runtime block recites the position of the call on every turn | The caller is inside a state machine — and its states are literally enumerated in the model's instructions | Critical | The sequence is the same for every caller. Two calls, and the shape is memorised | `src/voice/logic.ts::OUTBOUND SCRIPT STATE — where the call is right now` | Keep the flow; change what the caller *hears*. The runtime block should not read like a runbook. See P25. |
| G51 | L | Transitions differ with what is actually being said | Four prompt blocks pin the interest question "AS WRITTEN" and one comment promises it is "REFERENCE phrasing only, never the same words twice" — the model resolves an unresolved contradiction | Where a contradiction is unresolved, the caller hears whichever side the model read last — worst case the identical question on every call | High | Two calls from the same company produce the identical second question, which is the classic script-detection tell | `src/voice/kannada-script.ts::it is said the same way every time`<br>`src/voice/kannada-script.ts::REFERENCE phrasing only` | Owner decision: pin it, or free it — but only one. See P26. |
| G52 | L | Closes on the caller's own thread: "Hunsur — good choice. Our team will call you." | The close is two fixed sentences regardless of which locality interested the caller | The closing never references anything the caller said | High | The end of the call is the most formulaic part of it, and the caller hears that | `src/voice/kannada-script.ts::Say these TWO short sentences, warmly and happily` | Let the close name the locality the caller actually asked about. See P27. |
| G53 | L | A first call runs for minutes, with the customer doing most of the talking | The whole call is 3–5 turns and under a minute | Not a defect in itself — but it leaves no room to *feel* like a conversation | Medium | The call is over before it becomes a conversation | `src/voice/kannada-script.ts::There is NO sixth step.` | Business decision. Out of scope for voice work. |
| G54 | L | The call winds down and ends on a courtesy | After the thank-you the engine hard-mutes the agent and executes a scripted hangup | The end is a mechanism, not a courtesy | Medium | The line drops the instant the thank-you finishes, which is abrupt in a way a human never is | `src/voice/logic.ts::activateOutboundPostThanksMute` | Add a short natural tail (the existing 350 ms settle) and measure whether the last word is heard. See P28. |

---

## 4. Listening

The question is whether Priya responds to what the caller **meant** or only to the words the recogniser
produced. Both, in different layers — which is the real answer:

- **Routing and repair are keyword-driven.** `detectCallerSignal` is five regular expressions with a
  fixed priority order. It is well-designed for what it does (ANNOYED outranks BUSY; a refusal outranks a
  price question asked in the same breath) — but a signal it does not recognise falls through to
  `short_answer` / `long_answer` / `neutral` purely on **character count**.
- **The reply content is meaning-driven**, because the model generates it from the transcript.

So the failure mode is specific and predictable: **Priya's reply is generated from meaning, but her
strategy is chosen from patterns.** A caller who says something important in unfamiliar phrasing gets a
reply that is fine and a strategy that is wrong. Examples where the pattern decides badly:

| Caller says | What it means | Pattern result | Consequence |
|---|---|---|---|
| "ನೋಡಿ, ನಾನು ಇನ್ನೊಂದು ಪ್ರಾಜೆಕ್ಟ್ ನೋಡ್ತಿದ್ದೀನಿ, ಇದು ಸ್ವಲ್ಪ..." | Comparing options; comparing price implies interest | no match → `long_answer` | Acknowledge and move on; the comparison, which is the actual interest signal, is discarded |
| "ಅಂದ್ರೆ... ನಿಮ್ಮ ರೇಟ್ ಎಷ್ಟು?" | Hesitation **plus** a price question | `HESITANT_RE` matches `ಅಂದ್ರೆ` first | The price question — the strongest interest signal available — is classified as hesitation |
| "ಯಾರಿಗೆ ಕೊಡ್ತೀರಿ?" (who are you giving it to) | Misheard/odd question | no match → `neutral` | Nothing special; she carries on |
| "ಹೌದು ಆದರೆ ನನಗೆ ಸಮಯ ಇಲ್ಲ" (yes, but I have no time) | Interested **and** busy | `BUSY_RE` matches "ಸಮಯ ಇಲ್ಲ" → `busy` | A genuinely interested caller is treated as a nuisance and closed |

The first, second and fourth are **real ordering bugs of intuition**, not of code: a human reads the
interest first, the excuse second.

---

## 5. Interruptions

| Event | Human | Priya | Verdict |
|---|---|---|---|
| Caller interrupts | Yields in ~100–200 ms, usually at the end of the current word | 150 ms hold → `clearPlayback()` midsentence | Yields *faster and more abruptly* than a person (§46) |
| Both speak briefly | Normal; they overlap and resolve | Impossible — the agent audio is cleared, never mixed | Structurally absent (§47) |
| Caller starts a sentence and stops | Waits; assumes they are thinking | Commits a turn at 250 ms quiet → 1 100 ms later asks them to repeat | The worst case in the document (§9) |
| Caller changes direction mid-sentence | Follows the new direction | Keeps the step; the step is owned by state, not by the caller | Visible (§48) |
| Caller continues after a pause | Continues with them | New turn, new state | Mostly fine |
| Caller talks over the close | The close is abandoned | The close is protected: once `outboundSpokenCloseText` is set the close is armed, and a later caller turn can restart a *committed* close only by design | Handled — the call does not end under the caller |

The honest summary: Priya participates in a conversation the way a well-tuned intercom does. She stops
the instant she is spoken to, and she never overlaps. **A human is not that polite.**

---

## 6. Pauses — silence is not failure

The engine has exactly two interpretations of silence, and both are wrong for a human:

1. **250 ms of quiet inside the caller's turn = the turn has ended.** A human's mid-sentence thinking
   pause routinely exceeds that. The caller's half-finished thought becomes a committed turn, then no
   transcript arrives, then the recovery ladder asks them to repeat.
2. **5 s of quiet after a turn = the caller may have gone away.** A human waits much longer, and does
   not use an identical sentence for it. The check line is deliberately repeated word-for-word at 10 s
   (`SILENCE_CHECK_REPEAT_AFTER_MS`), and at 15 s the call is ended with a goodbye.

The second is bounded and safe — it can no longer hang up on someone who has just spoken (a late reply
cancels the close). But the *first* is the one that hurts, because it fires during ordinary speech
pauses, and it is the same 250 ms everywhere: after a question, after a long answer, after a mumble.

---

## 7. Response timing

A human's latency is a **signal**: half a second for "yes", a beat longer for something that needs
thought, a visible pause when the answer is hard. Priya's latency is a **configuration**, identical on
every turn of every call:

```
250 ms  local VAD commits the caller's turn     (audio-pipeline-config.ts: vadSilenceMs)
250 ms  Gemini AAD commits it to the model      (audio-pipeline-config.ts: aadSilenceDurationMs)
        + generation
1 100 ms recovery ladder grace if no words      (speech-recovery.ts: transcriptGraceMs)
```

Because the pipeline is deterministic, its variance is near zero. **That is itself the tell.**
`call-telemetry.ts` already records `callerToAgentMs` per turn; the first real call should compare
**p50 and p95**, and a narrow distribution is a finding, not a comfort.

## 8. Response length

| Caller | Human | Priya | Verified? |
|---|---|---|---|
| Short answer | Short reply | `short_answer` directive: one short turn | Directive exists; **nothing measures the actual turn length** (§29) |
| Long answer | Acknowledge in one beat, move on | `long_answer`: "do not summarise, one short sentence" | Same |
| Confused | Re-explain differently, then stop | `confused`: same point plainer, same length, then stop | Same |
| Busy | One sentence | `busy`: one sentence, no warmth, do not keep them | Same |
| Interested | Warm, still brief | `interested`: warmth up slightly, keep it short | Same |
| Uninterested | Close once | `uninterested`: stop selling, close once | Same |

The design is right and the directives are well written. **The gap is that they are advisory text
appended to a nudge.** There is no assertion anywhere that a busy caller actually got a shorter reply —
and if the model ignores the directive, nothing notices. This is the difference between "designed to
adapt" and "adapts".

## 9. Repetition audit

| Surface | Guard | Status |
|---|---|---|
| Acknowledgement | Curated set, per-call rotation, no-repeat guard | Tested (69 tests) |
| Step repair | Fresh beat on the retry (`nextAckWord()`) | Tested |
| Opening | Said once; `outboundOpeningRepeatDone` | Tested |
| Thank-you | Exactly once, `hasThanksClosing` is the trigger | Tested (4 tests) |
| Silence check | Deliberately identical **both** times (owner decision) | Tested — and a genuine tell (§6) |
| Silence goodbye | Once, then close | Tested |
| **Interest question** | Pinned "AS WRITTEN" in four blocks; a fifth says fresh every call | **Contradiction, untested** (§51) |
| **Spoken turn content** | Rule in the prompt only; no detector | **Unprotected** (§45) |
| **Closing sentences** | Fixed pair, same every call, regardless of locality | **Fixed text — the tell** (§52) |

## 10. Acknowledgement quality

The test requested — *"if removing the caller's previous sentence would still make the acknowledgement
work, flag it as robotic"* — has a precise answer in the code, and it is the second one:

- The ack **carries the name** and the correct honorific, so it fails the test in the good direction
  when the caller has just given a name.
- Every other acknowledgement is ≤ 3 words (`ACK_MAX_WORDS = 3`) from a set of five generic beats.
  Delete the caller's previous sentence and every one of them still works. **By design.**
- The prompt forbids the alternative outright: "Never repeat the caller's own words back at them before
  you respond" and "if you are unsure what they said, assume you heard it and just answer".

There is also a hard engine constraint the fix must respect: `hasThanksClosing` is the **end-of-call
trigger**, so any acknowledgement that grows toward a thank-you hangs the call up mid-sentence. Any
content-bearing acknowledgement must stay clear of `ಧನ್ಯವಾದ` / `धन्यवाद` / "thank".

This is the highest-value finding in the document, and it is item **P10**.

## 11. Contextual understanding (indirect intent)

| Indirect signal | Human reads it as | Priya reads it as | Consequence |
|---|---|---|---|
| "ಅಂದ್ರೆ... ಎಷ್ಟು?" | Hesitant **and** interested | hesitant (the `ಅಂದ್ರೆ` matches first) | The interest is lost |
| "ನೋಡಿ ಹೇಳ್ತೀನಿ" | Polite deferral, still open | no pattern → neutral | No room given |
| Long silence after a question | Thinking | 5 s later: "are you still there?" | Pressure instead of room |
| "ಒಳ್ಳೆಯದಾಗಿದೆ, ಆದರೆ..." | Interested, with an objection coming | `short_answer`/neutral | The objection never gets heard |
| "ಯಾರು ಕೊಡ್ತೀರಿ?" | Who is this / is this real? | neutral | Nothing changes |
| Asking about possession/approval | Strong interest (the strong qualifying question) | no pattern → neutral | The single best buying signal on the call is invisible |

The distinction Priya cannot make is between **strong interest, weak interest, curiosity, politeness,
hesitation and refusal**. She has one pattern for the last one and character-count buckets for the rest.

## 12. Emotional intelligence

Owner decision, correctly implemented: **no energy mirroring**. A tired caller does not make her slower,
a pleased one does not make her brighter. What is supposed to change is wording, length, patience,
explanation and pressure — and each of those has a directive (see §8).

What is missing:

- **Recognition** is regex-only, so only listed phrasings count (§24).
- **Prosody carries nothing.** A sigh at 10 s sounds exactly like a sigh at 1 s to the pipeline. The
  audio classification is for turn-taking, not emotion (§25).
- **Patience is a fixed ladder**, so a nervous caller who needs 12 s gets checked at 5 s and 10 s (§10).
- Directives are advisory, so the model may ignore all of them (§29).

## 13. Sales intuition

A human's version of "this person isn't ready", "this one is genuinely interested", "this one is just
being polite" is built from dozens of signals. Priya has:

- a five-item interested pattern (price/rate/EMI/loan/visit/book/how much, plus a few Kannada tokens),
- a refusal pattern,
- a busy pattern,
- a hesitation pattern,

and nothing else. She cannot tell **polite from interested** — which is the single most common failure
of a cold call — because the only strong interest patterns she has are *questions*, and a polite buyer
who simply says "ಸರಿ ಸರ್" produces none of them. They are classified `short_answer` and the flow closes
with the sales-team line, which is the correct output for the wrong reason.

Worse, the one thing a salesperson does with a warm lead — **qualify it** — is forbidden (§31). So the
sales-intuition verdict is: *it works for the two cases the flow has, and there is no machinery for any
other case.*

## 14. Questionnaire vs conversation — the major benchmark

**A caller can feel the questionnaire, and the reason is structural, not stylistic.** The prompt is
explicit: `TWO QUESTIONS MAX on the whole call`, "There is NO sixth step", "Nothing else — no purpose, no
budget". The call is:

```
opening question → name question → localities + one interest question → handoff + thank-you → hangup
```

That is a form with a human voice over it. Micro-transitions — the whole of §14 — are explicitly
*removed*: `GET TO THE POINT` bans "no reaction before it", and `DIRECTNESS_RULES` says "If a turn of
yours would only be an acknowledgement with no new information in it, it is not a turn at all."

So the honest answer to "does the caller feel the underlying questionnaire?" is **yes, and the prompt
was written specifically to make it feel that way, for good reasons.** Each rule was added because a
caller complained about the opposite failure. The system is now on the far side of that trade-off:
perfectly on-script, and audibly not a conversation.

## 15. Script detection

| Detectable tell | Present? | Evidence |
|---|---|---|
| Overly perfect transitions | Yes | No filler, no reaction before a line (`DIRECTNESS_RULES`) |
| Identical wording across calls | Partly | Beat varies; the interest question and the close do not |
| Unnatural sequencing | No | The sequence is natural for a 3-turn call |
| Fixed acknowledgements | Fixed set | Curated five, rotated |
| Predictable sentence structures | Yes | Two questions, fixed close pair, one goodbye |
| Overly polished speech | Yes | Uniform pace, no hesitation, no breath |
| Repeated cadence | Yes | `ONE PACE, EVERY TIME` |

The business process may be scripted. The **surface** cannot be, and at present it is.

## 16. Kannada naturalness

Nothing here can be settled from a keyboard. What can be said precisely:

- The **intent** is right and unusually well specified: spoken forms listed, written forms banned
  (`ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ`, `ವಾಸಿಸುತ್ತೀರಾ`, `ತಿಳಿದುಕೊಳ್ಳಬೇಕು`), contractions wanted, honorific on the address,
  one honorific per turn, loanwords allowed.
- The **phrases** are unaudited. Every one of the five acknowledgements carries
  `validatedByNativeSpeaker: false`, and the style guide's verdict column is empty.
- The pinned lines are the ones most likely to sound right (they are short and plain) and the most
  damaging if they are wrong (the caller hears them every time).

Two specific phrases I would put at the front of the native-review queue, both currently shipping:

| Phrase | Why it needs a human verdict | Natural alternative if rejected |
|---|---|---|
| `ಸರ್ತಿ` as a standalone beat | It is a real word ("order/sequence") used colloquially as "alright". On a phone, as a *standalone* beat before a name, usage varies by region and generation | `ಹೌದು ಸರ್` or a rising `ಹಾ ಸರ್` |
| `ಅರ್ಥಾಯಿತು` (in the set) | Correct and very common, but as a standalone acknowledgement after a name it can read as a data-entry confirmation rather than a person listening | `ಸರಿ ಸರ್` |

**No dialect was added and none should be.** The target is ordinary professional Karnataka phone
Kannada (§17).

## 17. Mysuru context

Passes for the right reasons and fails for none of the caricature reasons: no dialect performance, no
regional slang, no stereotype; the localities named are the real `ALLOWED_LAYOUT_NAMES`; the call
conventions are ordinary Karnataka ones (honorific, one question at a time). It does **not** currently
sound like a "Mysuru salesperson" specifically — it sounds like a neutral Kannada-speaking agent,
because locality knowledge is the only Mysuru-specific thing in it. A real Mysuru salesperson opens with
something local ("ಹುಣಸೂರು ರಸ್ತೆ ಕಡೆ ಏನಾದರೂ ನೋಡ್ತಿದೀರಾ?"), which the flow cannot do: the opening is pinned.

## 18. Code-switching

Handled better than most of the pipeline:

- Loanwords (`ಸೈಟ್`, `ಪ್ಲಾಟ್`, `ಲೋನ್`, `ಇಎಂಐ`, `ರೇಟ್`, `ವಿಸಿಟ್`, `ಸೇಲ್ಸ್ ಟೀಮ್`) are normal and encouraged.
- The follow module **strips** loanwords and numerals before deciding a language, so a Kannada sentence
  full of real-estate English is not read as English.
- Priya never switches the whole sentence to English because the caller used an English word.
- A caller mixing English into Kannada mid-sentence gets no special treatment — which is correct.

The remaining gap: **Priya's own code-mixing is static.** A human's mixing rises with the caller's; hers
is whatever the model picks, because nothing tells her to match the caller's density (§28).

## 19. Language switching

The transition is invisible by design, and the design is sound:

- Switching requires an **explicit request**. Detection alone is not consent — a fix for a real shipped
  bug where a caller giving their name flipped the TTS locale to `en-IN` mid-Kannada-call.
- `Never announce a language change` is in both the prompt and the private directive.
- Once switched, the language persists.

Honest limits: `kn → en` sends a real `en-IN` locale, so it is audibly supported. `kn → hi/mr` sends
`hi-IN`/`mr-IN`. **Kannada sends nothing at all** (`kn: null`) and relies on the model — so the switch
*into* Kannada, and the quality of Kannada generally, are the two least controlled things in the
language story (§13).

## 20. Memory

| Fact | Remembered? | Where |
|---|---|---|
| Name + honorific | Yes | `setKnownCaller`, persisted to the lead row |
| Language requested/active | Yes | `languageSwitchState`, `callMemory` |
| What was already explained | In-session only | Model history |
| The caller's own words | In-session; **and now across a reconnect** | `call-memory.ts` (this pass) |
| The lead's prior enquiry | **No** | Lead-name lookup removed |
| Whether a question was already asked | Step flags, not answers | `outboundNameAsked`, `outboundAreasLineDelivered` |

The failure the request asks about — *"I already told you that"* — had one concrete cause: a reconnect
started a fresh session with instructions but no dialogue, so anything the caller had said before the
glitch ceased to exist for the model. That is now closed with a bounded recall block (four utterances,
160 characters each, the name, the flow position, her own last line), injected **only** when there is
something to recall, and explicitly forbidden from carrying an internal directive.

What is still open: nothing *enforces* it. It is a context block; the model can still ask again. A
code-side guard (see P11) is the next step.

## 21. Unexpected questions

| Caller asks | Family | What the code does | Would a human? |
|---|---|---|---|
| "How did you get my number?" | unexpected | No approved answer exists. If the model cannot answer, it offers the sales team, thanks them and **ends the call** | No — a human answers or explains |
| "Which projects?" | covered | Names only the five allowed projects | Yes |
| "Where exactly?" | covered | The localities line | Yes |
| "What is the price?" | covered | Sales team will explain; step to close | Partly — a human gives a range |
| "Is it ready to move?" | covered | Sales team | Partly |
| "Who are you?" | covered | "ನಾನು ಪ್ರಿಯಾ, ಅಲೈಯನ್ಸ್ ಸ್ಕ್ವೇರ್ನಿಂದ ಮಾತಾಡ್ತಿದ್ದೀನಿ ಸರ್" then back to the step | Yes |
| "Can you call later?" | covered | Callback window 10am–7pm, enforced in **code**, not by the model | Yes |
| "Why are you asking?" | uncovered | No answer exists | No |
| "I'm not interested" | covered | Close once, end | Yes |
| "Tell me quickly" | covered | Busy/annoyed directive | Yes |
| "Which company?" | covered | Alliance Square | Yes |
| Forbidden project named | guarded | A detector nudges back to the allowed list | Yes-ish |

The safe-by-design behaviour ("never invent") is right. **The unsupported ones are not handled — they
terminate the call** (§35), which is the most visible script failure in the whole system.

## 22. Human uncertainty

A human says "I'm not sure, let me have the sales team help with that" and then **continues the call**.
Priya says the same sentence and then ends the call. So the *wording* of human uncertainty is present
and the *behaviour* is not.

Never hallucinating is a genuine strength: no price, no size, no approval, no project outside the
allowed list, ever. Nothing in the repository invents a fact. That is better than most human
salespeople, and it should not be traded away.

## 23. Error recovery

Handled: mishearing (repair ladder, bounded at 2 attempts, never hangs up), caller correcting her
(transcript path), topic change (guarded), caller repeating (repeat nudge), caller speaking over her
(barge-in clears playback), caller misunderstanding (confused directive).

Not handled: **the half-sentence lost to a barge-in is never resumed** (§40); a garbled name is dropped
rather than retried (§37); and self-repairs are suppressed by three separate guards (§41).

## 24. Natural repair — differentiated?

Not yet. The ladder distinguishes exactly two causes, and both produce one generic request:

| Cause | Human repair | Priya's repair |
|---|---|---|
| Didn't hear (no transcript) | "Sorry, I didn't catch that — say that again?" | `ask_repeat`, generic, once, then again more explicitly |
| Didn't understand (transcript arrived, no reply) | Answers it | `reply_now` — nudge the model to speak |
| Ambiguous answer | A specific clarifying question | **No distinct path** — treated as `neutral`/length bucket |
| Unexpected answer | Answers or deflects, continues | **No distinct path**; may end the call (§35) |
| Language change | Follows it | Hands to the language module; fine |
| Interruption | Resumes mid-thought | Drops the sentence (§40) |
| Misheard *content* (name) | "Hunsur, is it?" | Dropped, never confirmed |

Four of seven repair causes have no distinct handling. That is item **P20**.

## 25. Pacing

One pace, pinned, for the whole call, in the prompt twice (`VOICE_DELIVERY` and the runtime block),
because the owner heard Priya "hurry one line and crawl the next" and correctly decided that a level
pace beats an erratic one. The result is the opposite failure: **the variance is now zero.** Opening,
question, acknowledgement, explanation and close are all delivered at the same rate (§01, §06).

The middle ground a human occupies — a settled base pace with small, purposeful variation (a beat after
a question, a slightly quicker list of localities, a slower close) — is available in the prompt and is
not currently asked for.

## 26. Voice emotion

Not asked as "does the TTS sound good?" but "does the voice communicate the appropriate state?":

| Dimension | Communicated? | Why |
|---|---|---|
| Warmth | By wording only | Affective dialog is gated off (model rejects it) |
| Confidence | Partly | Level pace helps; no emphasis control |
| Attentiveness | **No** | Nothing in the sound responds to the caller |
| Calmness | Yes | The single most successful thing about the voice |
| Professionalism | Yes | |
| Subtle engagement | Partly | |

One detail that does read as human: the engine has a real "wait for the tail of the audio" logic, so the
hangup does not chop the last word. That is a genuine courtesy a machine usually fails.

## 27. Breathing / fillers / prosody

Correct, and worth defending: **no fake filler was added.** There is no "umm", no "actually", no
padding. The prompt explicitly bans opener reactions and discourages searching pauses. Prosody is
carried by punctuation and sentence shaping (commas as breaths, short lines, no trailing off), and no
rate/pitch/SSML control exists in the API at all.

The one place the policy goes too far is the **total** ban on a breath before a longer line (§02) — a
human quality a real salesperson has, removed by instruction rather than by limitation. That is the
cheapest high-value repair in the document after §10.

## 28. Caller perception test — the instrument

Run `VOICE_QA_PLAN.md` §3 (Q1–Q13) with at least three native Kannada speakers, one of whom is not
connected to the project, on three recorded calls, independently, before any discussion.

**The question that matters most:** *"What was the first moment you knew it was AI?"* — because it turns
a useless verdict ("sounds like a bot") into a defect report with a line in it.

**Status: ☐ not started.** No recording exists, because no call has been placed.

Predicted first-suspicion moments, from this audit, to be tested rather than assumed:

1. **The opening sentence** — level machine pace, no breath (§01, §02).
2. **The acknowledgement after the name** — nothing about the caller enters it (§18).
3. **The interest question** — the same words on every call (§51).
4. **Anything unsupported** — the call ends with a thank-you (§35).
5. **"Are you still there?" at five seconds** (§10).

## 29. Blind test — protocol

Prepare, in random order, labelled only A/B: one human salesperson call (a colleague role-playing the
same brief) and one Priya call. Give evaluators no context. Ask, in this order: *"Which one sounds more
human?"*, then *"Why?"*, then *"At what moment did you decide?"*. Do not reveal the answer; do not
reveal the purpose of the test.

**Status: ☐ not started.** Prerequisites: a placed call, a recording, and a build where
`hangup-status` reads `/7` (Render still serves `/6`).

## 30. Human-likeness failure categories

Every matrix row carries exactly one letter. Counts are checked by `verify-human-gap.mjs`, so this table
cannot drift from §3.

| Cat | Meaning | Rows | Count |
|---|---|---|---|
| A | Voice — the sound itself feels artificial | G01–G05 | 5 |
| B | Timing — response timing feels artificial | G06–G10 | 5 |
| C | Language — words or sentences feel unnatural | G11–G14 | 4 |
| D | Listening — fails to demonstrate understanding | G15–G19 | 5 |
| E | Context — forgets information | G20–G23 | 4 |
| F | Emotion — fails to recognise caller state | G24–G26 | 3 |
| G | Adaptation — same response regardless of caller | G27–G30 | 4 |
| H | Sales — questionnaire, not a salesperson | G31–G35 | 5 |
| I | Recovery — cannot recover from the unexpected | G36–G41 | 6 |
| J | Memory — repeats already-known information | G42–G45 | 4 |
| K | Interruption — cannot participate in overlap | G46–G49 | 4 |
| L | Conversation flow — the state machine is visible | G50–G54 | 5 |
| | **Total** | **G01–G54** | **54** |

54 rows. **Sixteen of them need no change**, either because they are already right or because the
behaviour is deliberate and should be kept: G08 (barge-in timing), G14 (the beat already varies across
calls — fixed in an earlier pass), G17 (interest detection), G20 and G44 (reconnect memory — fixed this
pass), G21 and G23 (name handling), G26 (the one-pace rule is a deliberate keeping), G27 and G30 (the
busy and hesitant directives), G34 (knowing when to stop selling), G36 and G47 (deliberate: never admit
a restart, never fake overlap), G43 (language persistence), G49 (noise rejection), G53 (call length — a
business decision, out of scope for voice work). The other thirty-eight are open, and the severity table
below is the priority order for them.

## 31. Severity register

Ordered by **how quickly a caller works out they are talking to a machine** — the only ordering that
matters for the caller.

| Severity | Meaning | Rows | Count |
|---|---|---|---|
| Critical | The caller knows almost immediately | G11, G18, G31, G35, G50 | 5 |
| High | Strongly damages the illusion or the conversation | G01, G02, G03, G09, G10, G12, G15, G16, G19, G20, G24, G25, G29, G32, G38, G39, G42, G44, G46, G51, G52 | 21 |
| Medium | Noticeably robotic, tolerable | G04, G06, G07, G13, G22, G26, G28, G33, G36, G37, G40, G41, G45, G47, G48, G53, G54 | 17 |
| Low | Minor artificiality | G05, G08, G14, G17, G21, G23, G27, G30, G34, G43, G49 | 11 |
| | | **Total** | **54** |

Every Critical row is a *moment*, not a mechanism: the Kannada itself (G11), the acknowledgement that
proves nothing (G18), the two-question form (G31), a normal question ending the call (G35), and the
enumerated five-step state machine (G50).

## 32. "A human would never do this" — and which layer is at fault

| Row | A human would never… | Why Priya does it | Layer at fault |
|---|---|---|---|
| G02 | speak with no breath at all | two prompt blocks disagree | prompt |
| G10 | ask "are you still there?" after 5 s | a ladder was tuned to end silent calls fast | state machine |
| G18 | receive an answer and say nothing about it | echoing the caller was banned after a repeat loop | prompt |
| G25 | be unable to hear that someone sounds tired | no emotion path exists in the audio pipeline | audio |
| G29 | be told to be brief and stay long anyway | the directive is advisory text | model |
| G31 | run a sales call as two questions and a handoff | owner decision, to stop improvisation | business constraint |
| G35 | thank someone and hang up because they asked a question | "never invent" plus a no-answer fallback that closes | prompt |
| G38 | say the same "sorry, repeat that" for every failure | only two repair kinds were implemented | code |
| G39 | never check a name they half-heard | confirmation was banned after an echo loop | prompt |
| G40 | abandon a half-finished sentence after being interrupted | playback is cleared, no resume exists | code |
| G46 | stop mid-word because of a breath | barge-in threshold is 150 ms of energy | VAD |
| G50 | read out the same state machine every call | the runtime block doubles as a runbook | prompt |
| G51 | be inconsistent about their own script | four blocks pin a line, one says it is free | prompt |
| G22 | not know the customer already phoned | lead-name lookup was removed | missing context |
| G06 | respond with the same delay to everything | latency is configuration, not judgement | timing |
| G12 | use a written verb form out loud | prompt bans are hints, not guarantees | model |
| G20 | forget what was said thirty seconds ago | a fresh session after a reconnect has no history | state machine |

## 33. "Would a customer notice?"

**Yes, immediately and within one call:** G11, G18, G31, G35, G50, G51, G52, G10, G01, G02, G46.
Those eleven are the whole priority list, and they are all in §31's Critical/High band.

**Noticeable over two calls:** G14, G19, G45, G53, G54.

**Not worth time right now** (invisible to a caller, and explicitly *not* on the fix list): the
`silenceMs` frame floor arithmetic, the exchange of `sendClientContent` for `sendRealtimeInput`, the
`acknowledgementPoolFor` rotation offset, the telemetry key naming, the `hint` spelling in
`stats()`. Fixing these would buy nothing a caller can hear.

## 34. "Would a salesperson say this?"

Checked against every pinned line. Verdict per line, from the caller's side:

| Line | Would a salesperson say this? | Comment |
|---|---|---|
| `PDF_OPENING_TURN1_KN` | Yes | Short, natural, one question |
| `PDF_NAME_QUESTION_KN` | Yes | Plain and normal |
| `PDF_AREAS_LINE_KN` | Mostly | Four localities in one breath is a list, not speech. A salesperson names one or two and asks which area they know |
| `PDF_INTEREST_QUESTION_KN` | Yes | Natural wording (`ಇದೆಯಾ`, not `ಇದೆಯೇ`) |
| `PDF_HANDOFF_LINE_KN` | Yes | Standard handoff |
| `PDF_THANKS_CLOSE_KN` | Yes | But a salesperson would tie it to the conversation, not repeat it verbatim |
| `OUTBOUND_NOT_INTERESTED_CLOSE_KN` | Yes | Warm and short |
| `SILENCE_CHECK_LINE_KN` | Yes, once | Not twice, and not at 5 s |
| `SILENCE_GOODBYE_LINE_KN` | Yes | |
| `CALLBACK_OUTSIDE_WINDOW_LINE_KN` | **Uncertain** | Naming the window and offering two alternatives in one breath is a policy statement. A salesperson says "ಅವರು ಬೆಳಿಗ್ಗೆ 10 ರಿಂದ ಸಂಜೆ 7 ರ ವರೆಗೆ ಇರುತ್ತಾರೆ, ಬೇರೆ ಯಾವಾಗ ಬೇಕು?" | ☐ native validation |

## 35. "Would I say this?" — native validation queue

Every phrase below is **unvalidated**. Each must be read aloud by a native Kannada speaker and marked
yes/no before it is trusted. Nothing in this list may be treated as approved.

| Phrase | Where it ships | Question to ask the reviewer | Verdict |
|---|---|---|---|
| `ಸರ್ತಿ` (standalone beat) | acknowledgement, default | Would you say this on the phone, on its own, right after hearing a name? | ☐ pending |
| `ಹೌದು` (standalone beat) | acknowledgement | On its own, as a beat before a sentence — does it sound like listening or like agreeing? | ☐ pending |
| `ಆಯಿತು` | acknowledgement | Too familiar for a first cold call? | ☐ pending |
| `ಸರಿ` | acknowledgement | Fine as a transition? | ☐ pending |
| `ಅರ್ಥಾಯಿತು` | acknowledgement | Does it sound like a person, or like a form being filled in? | ☐ pending |
| `PDF_AREAS_LINE_KN` | pinned, every call | Four locality names in one sentence — would you say it this way, or one at a time? | ☐ pending |
| `PDF_THANKS_CLOSE_KN` | pinned, every call | `ನಿಮ್ಗೆ ಸಮಯ ಕೊಡಿದಂತೆ` — is this the phrase you would use, or is it slightly formal? | ☐ pending |
| `CALLBACK_OUTSIDE_WINDOW_LINE_KN` | callback path | Does it sound like a person declining a time, or like a policy? | ☐ pending |
| `ಸರಿ ಸರ್, ಒಂದು ಸಲ ಮತ್ತೆ ಹೇಳಿ` | repair nudge | Natural way to ask someone to repeat? | ☐ pending |
| `ಹಲೋ ಸರ್, ಇನ್ನೂ ಲೈನ್ನಲ್ಲಿ ಇದೀರಾ?` | silence check | Would you really ask this after 5 seconds? | ☐ pending |

## 36. Human conversational imperfection

**Allowed and wanted** (all safe, none of them a business-fact risk): short fragments, varying sentence
length, occasional rephrasing, a brief pause before a considered answer, a one-word acknowledgement, a
direct answer with no formal transition, referring back to something the caller said, a breath before a
longer line, and a small self-correction.

**Never allowed** (this is where "human-like" turns into "broken"): invented prices or facts, a
half-spoken line abandoned silently, a repeated question, a second thank-you, an admission of being an
AI, random errors inserted for texture, or fake fillers.

The current prompt sits at the opposite end of this trade-off from where it should: it has banned most
of the "allowed" list to eliminate the failures, and the ban is itself a tell.

## 37. The two scores, separately

Scored on the framework's own terms: mechanism-verified, experience-unverified, no call placed.

```
HUMAN-LIKE RELIABILITY      (the system does the intended workflow)        82 / 100
HUMAN-LIKE CONVERSATION     (it behaves like a person)                     55 / 100
OVERALL HUMAN SALES AGENT EQUIVALENCE                                      64 / 100
```

**Derivation, stated so it can be checked.** Reliability is high because dead air, premature hangup,
late-reply rescue, silence handling, the single thank-you and the guard set are all implemented and
tested — 279 tests and eight verification harnesses, none of which has ever been heard on a handset, so 82 is an
engineering estimate, not a measurement. Conversation is 55 because the two heaviest realism dimensions
(voice naturalness, Kannada authenticity) are unvalidated and constrained, the call is structurally a
two-question script, the acknowledgement is forbidden from proving comprehension, the pace has zero
variance, and the state machine is visible in the wording.

**Overall is not the average.** A system can be perfectly reliable and sound like a machine; letting an
82 lift a 55 hides exactly the thing the caller notices. The rule used here:

```
overall = round(0.35 × reliability + 0.65 × conversation)      = 64
cap     = conversation + 10                                    = 65
overall = min(0.35×R + 0.65×C, C + 10)                          = 64
```

**Reliability must never publish above `conversation + 10`.** With reliability at 82 and conversation at
55, the headline is 64 — the reliability gap is worth 9 points of credibility, and no more.

## 38. What the two scores must not be used for

- **Not** as a claim that Priya is 64% as good as a human salesperson. The dimensions are not
  commensurable with a human at all; the numbers are a structured way of saying *where* the gap is.
- **Not** as evidence of improvement without a second measurement after the fixes in §39.
- **Not** above 90 on any dimension, unless a native speaker and a blind test say so. There is no
  measurement in this repository that could justify such a number.

## 39. Improvement plan

28 items, each with every field required. `P01`–`P13` are the ones this audit would do first, in
order; `P14`–`P28` complete the list so that every row of §3 has a named owner. Ordered by expected
caller-visible impact per unit of risk. `Root cause` names the layer using §32's vocabulary.

### P01 — Voice prosody has no lever
- **Problem:** Delivery is flat: one pitch, one pace, no emphasis (§01, §04, §25).
- **Human behaviour:** Pitch and pace move with meaning — a question lifts, a statement settles.
- **Current AI behaviour:** `buildLiveSpeechConfig()` sets only `voiceName` and an optional
  `languageCode`; the prompt pins one level pace and forbids matching the caller.
- **Why the AI differs:** The Gemini Live API exposes no rate, pitch or SSML control.
- **Root cause:** model
- **Implementation change:** Add a per-sentence shaping pass to the generated text that the model speaks
  from: cap sentence length, require a comma-sized break inside any turn over ten words, and prefer two
  short sentences over one long one.
- **Prompt change:** Replace `ONE PACE, EVERY TIME` with a settled base pace plus a bounded allowance: a
  beat after a question, a slightly quicker enumeration of localities, a slower close.
- **Test required:** Assert the shaping helper splits long turns and never alters business content
  (byte-identical remainder check, mirroring the existing acknowledgement test).
- **How to measure improvement:** Native Q1/Q6 before and after, plus "first moment you knew" (§28).
- **Expected impact:** The single largest realism gain available without a new model; it cannot be
  verified from code, only by ear.

### P02 — Contradictory breath instruction
- **Problem:** The delivery block bans a breath before a line; the runtime block asks for one (§02).
- **Human behaviour:** Breathes before a longer sentence.
- **Current AI behaviour:** Two instructions, opposite, both in the live prompt.
- **Why the AI differs:** The ban was added to stop "theatrical" padding; the allowance was added later
  for naturalness, and the first was never removed.
- **Root cause:** prompt
- **Implementation change:** None.
- **Prompt change:** Delete "No searching pause, no hesitation, no theatrical breathing room before a
  line" and keep the runtime block's "a real breath before a longer line".
- **Test required:** A source-invariant assertion that the ban string is absent from every instruction
  builder, and that the allowance is present in the runtime block.
- **How to measure improvement:** Native Q6 (did it sound scripted?) on the same three calls.
- **Expected impact:** High for one prompt deletion; zero business risk.

### P03 — Emotion is invisible, and the prompt pretends otherwise
- **Problem:** No prosodic emotion path exists, yet the prompt implies emotional reading (§03, §25).
- **Human behaviour:** Hears a sigh, a flat tone, a tired voice.
- **Current AI behaviour:** Frame classification is speech/noise/ambiguous for turn-taking only;
  affective dialog is gated off because the model returns no audio with it on.
- **Why the AI differs:** Not available in the current model configuration.
- **Root cause:** audio
- **Implementation change:** Do not re-enable `enableAffectiveDialog` blindly — it is verified to break
  audio. Instead add a quiet-talker detector: sustained low frame energy across a whole turn raises the
  existing `short_answer`/`hesitant` treatment, without claiming emotion.
- **Prompt change:** Remove any wording that claims the agent can hear the caller's mood; keep the
  wording-level strategy directives.
- **Test required:** Unit test the quiet-talker detector on synthetic frames; assert it never changes
  business content or unlocks a claim.
- **How to measure improvement:** Native Q10 (did she sound emotionally flat?) and Q12.
- **Expected impact:** Medium. Stop overclaiming, get one useful signal.

### P04 — Timing has no variance
- **Problem:** Identical latency on every turn; timing carries no attentiveness (§06, §07).
- **Human behaviour:** Fast for a simple yes, a beat longer for something hard.
- **Current AI behaviour:** Fixed 250 ms + 250 ms pipeline, then generation.
- **Why the AI differs:** Latency is configuration, not judgement.
- **Root cause:** timing
- **Implementation change:** First *measure*: read `telemetry.aggregate.callerToAgentMs.p50/p95` from
  `hangup-status`. Add variance only after the numbers exist, and only inside the pipeline's safe band —
  the 250 ms window is explicitly documented as not-to-be-shortened.
- **Prompt change:** None.
- **Test required:** A telemetry test that a recorded distribution reports both p50 and p95
  (nearest-rank, already implemented).
- **How to measure improvement:** Spread between p50 and p95 on a real call, compared against one human
  salesperson's spread on the same brief.
- **Expected impact:** Low until measured; a fix here without data would be guesswork.

### P05 — A thinking pause is read as a finished turn
- **Problem:** 250 ms of quiet commits the caller's turn; a human pause to think then looks like a
  failure (§09).
- **Human behaviour:** Waits out a mid-sentence pause without comment.
- **Current AI behaviour:** Local VAD ends the turn at 250 ms; 1 100 ms later the ladder asks for a
  repeat.
- **Why the AI differs:** The VAD window was set for reliable transcription on 8 kHz telephony, where a
  longer window risks committing half-spoken turns.
- **Root cause:** VAD
- **Implementation change:** Apply a longer end-of-turn window **only** for the first caller reply after
  a question, where a thinking pause is most likely, and leave the general path at 250 ms.
- **Prompt change:** None.
- **Test required:** Unit test the window selector: after a question → extended; mid-call → unchanged.
- **How to measure improvement:** Count `repairs` per call on a real call where the caller pauses
  deliberately; target zero spurious repeat requests in `VOICE_QA_PLAN.md` §2 row 4.
- **Expected impact:** High — removes one of the most human-detectable failure moments.

### P06 — The 5-second availability check
- **Problem:** "Are you still there?" fires at 5 s and a goodbye at 15 s (§10).
- **Human behaviour:** Waits far longer, and never repeats the same sentence word for word.
- **Current AI behaviour:** Check at 5 s, the identical check at 10 s, goodbye and hangup at 15 s.
- **Why the AI differs:** The owner's complaint was an endless check loop; the ladder removed it and
  over-corrected the timing.
- **Root cause:** state machine
- **Implementation change:** Reorder the ladder so the first check is later than the second is now, and
  keep the call-close bound unchanged (it is already safe against late replies).
- **Prompt change:** Allow the second check to be rephrased rather than identical, keeping the
  no-third-check rule.
- **Test required:** Update the pinned silence-ladder test to the new timings; keep the assertion that
  the check is asked at most twice and the goodbye at most once.
- **How to measure improvement:** `VOICE_QA_PLAN.md` §2 rows 6 and 8 with a real slow caller.
- **Expected impact:** High. Requires an owner decision on the ladder — flag, do not decide unilaterally.

### P07 — No native speaker has heard any phrase
- **Problem:** The whole Kannada surface is unaudited (§11, §16, §35).
- **Human behaviour:** Speaks their own language, judged by ear.
- **Current AI behaviour:** Every phrase carries `validatedByNativeSpeaker: false`.
- **Why the AI differs:** No native reviewer has been involved.
- **Root cause:** missing context
- **Implementation change:** None possible in code.
- **Prompt change:** None until verdicts exist.
- **Test required:** The §35 queue, run as a review, with verdicts written into
  `KANNADA_STYLE_GUIDE.md` §2.
- **How to measure improvement:** Verdict counts on the §35 queue; native Q2.
- **Expected impact:** Critical. Until this is done, no claim about Kannada may be made at all.

### P08 — Written verb forms can still be spoken
- **Problem:** A written-register verb form in one turn is louder than ten correct ones (§12).
- **Human behaviour:** Never uses one out loud.
- **Current AI behaviour:** The prompt bans them; the model chooses freely.
- **Why the AI differs:** A prompt ban is a hint, not a guarantee.
- **Root cause:** model
- **Implementation change:** Detect the banned written forms in the output transcript
  (`outputAudioTranscription` is already handled) and re-ask the turn with an explicit correction; bounded
  to once per call.
- **Prompt change:** Add the specific rejected forms to the runtime block, not only to the static prompt.
- **Test required:** Unit test the detector against the banned list and against the spoken forms
  (no false positives on `ಮಾತಾಡ್ತಿದ್ದೀನಿ`).
- **How to measure improvement:** Count of written-form detections per call (target zero) on real calls.
- **Expected impact:** Medium. Cheap, bounded, and removes an obvious tell.

### P09 — Intent classification is a regex with poor defaults
- **Problem:** Unknown phrasing falls to `neutral`/`short_answer`/`long_answer` by character count;
  hesitation can mask a price question (§15, §16, §11).
- **Human behaviour:** Reads the meaning first, the excuse second.
- **Current AI behaviour:** Five patterns in a fixed priority order, then length buckets.
- **Why the AI differs:** Patterns were added one at a time for specific complaints.
- **Root cause:** code
- **Implementation change:** Two changes to `detectCallerSignal`: (a) reorder so a *question* signal
  outranks hesitation (someone who asks the price while hesitating is interested); (b) treat an
  unparsed turn that is not short as `hesitant` rather than `neutral`, because on a cold call the
  unparsed answer is almost always a soft deferral.
- **Prompt change:** Extend the hesitation directive to cover polite deferrals.
- **Test required:** Table-driven tests for the four cases in §4, each asserted by classification.
- **How to measure improvement:** `VOICE_QA_PLAN.md` §2 rows 4, 15, 17 with a role-playing caller.
- **Expected impact:** High for caller-perceived understanding.

### P10 — The acknowledgement cannot prove comprehension
- **Problem:** The one behaviour that makes a caller feel heard is banned by the prompt (§18, §19).
- **Human behaviour:** "Hunsur, ಒಳ್ಳೆ ಜಾಗ" — names what they just heard.
- **Current AI behaviour:** A ≤ 3-word generic beat, forbidden from repeating the caller's words.
- **Why the AI differs:** An echo loop (the agent repeating the caller's sentence back) was fixed by
  banning all reference to the caller's content.
- **Root cause:** prompt
- **Implementation change:** Add a content-bearing follow-on to the beat, built from the caller's own
  utterance **without** echoing it verbatim: after the beat, one short clause referring to the *thing*
  named (locality, project, or the nature of their answer). Extend the tone layer rather than replacing
  the ack set, and keep the hard rule that nothing may trip `hasThanksClosing`.
- **Prompt change:** Narrow the ban from "never repeat the caller's words" to "never repeat the caller's
  sentence"; explicitly permit referring to what was said.
- **Test required:** The existing byte-identical business-content test must still pass; add a test that
  the content bearing clause is absent when the caller gave no content, and that no variant trips
  `hasThanksClosing`.
- **How to measure improvement:** The requested test — *"delete the caller's previous sentence; does the
  acknowledgement still work?"* — applied by a reviewer to real ack lines; plus native Q3.
- **Expected impact:** Highest-value single fix in the document.

### P11 — Memory: enforce, do not just remind
- **Problem:** After a reconnect the caller's words were gone; a recall block is now injected, but
  nothing prevents the model from asking again (§20, §42, §44).
- **Human behaviour:** Never asks for something already given.
- **Current AI behaviour:** Recall block + prompt rule; both advisory.
- **Why the AI differs:** There is no answer-level memory, only short-term step flags.
- **Root cause:** state machine
- **Implementation change:** **Partly done this pass** (`call-memory.ts` + reconnect wiring + 16 tests +
  9 wiring checks). Next: keep a compact key/value record of *answered* questions (name, yes/no to the
  opening, locality named) and block a repeated question at the transcript level, the way the
  acknowledgement guard blocks a repeated beat.
- **Prompt change:** The recall block already carries the rule.
- **Test required:** The existing 16 unit tests plus a test that a recorded answer blocks the matching
  question.
- **How to measure improvement:** Count "already answered" moments per call on a real call with an
  induced line drop.
- **Expected impact:** High — removes the most damaging memory failure.

### P12 — The caller's own enquiry is not used
- **Problem:** A warm lead gets a cold-call opening (§22).
- **Human behaviour:** Opens with what the company already knows.
- **Current AI behaviour:** Lead-name lookup removed; no CRM context in the prompt.
- **Why the AI differs:** The CRM field was removed when the flow stopped addressing the caller by a
  stored name.
- **Root cause:** missing context
- **Implementation change:** Pass the lead's enquired locality/project (not the name) into the runtime
  block as background, and let the areas line lead with that locality when it is in
  `ALLOWED_LAYOUT_NAMES`.
- **Prompt change:** One clause permitting the areas line to start with the locality of interest.
- **Test required:** Pinned-line test that a locality outside the allowed list can never be named, and
  that the byte-identical business content test still passes when no CRM context exists.
- **How to measure improvement:** Role-play a warm lead; native Q8 (did she sound like a salesperson?).
- **Expected impact:** Medium — a big change to how the first ten seconds feel for warm leads.

### P13 — Irritation and ease are narrow triggers
- **Problem:** Irritation is only noticed when the caller uses one of the listed phrasings (§24).
- **Human behaviour:** Registers the second refusal, the flat tone, the short answers as irritation.
- **Current AI behaviour:** One regex; a second refusal in different words is not necessarily caught.
- **Why the AI differs:** The pattern was written for the reported phrasings only.
- **Root cause:** code
- **Implementation change:** Treat the second unambiguous decline on a call as `annoyed` regardless of
  wording, and treat two consecutive one-word answers after a question as `busy`.
- **Prompt change:** Add "a second decline is irritation, not a new question" to the directive.
- **Test required:** Table-driven classification tests for both counters.
- **How to measure improvement:** `VOICE_QA_PLAN.md` §2 rows 16 and 18.
- **Expected impact:** Medium-high; it is a small, testable change to the layer that decides strategy.

### P14 — Register does not follow the caller
- **Problem:** She sounds the same whether the caller is formal, casual, rural or urban (G28).
- **Human behaviour:** Drifts toward the other person's register within a turn or two.
- **Current AI behaviour:** The conversation language changes only on an explicit request; nothing adapts the register.
- **Why the AI differs:** Language switching was tightened after a real bug, and register was never separated from language.
- **Root cause:** prompt
- **Implementation change:** None.
- **Prompt change:** Permit register mirroring explicitly while forbidding language switching: match their level of formality and their English-Kannada mix, never their language.
- **Test required:** A source-invariant assertion that the two rules are stated separately, so a future edit cannot re-couple them.
- **How to measure improvement:** Native Q2 on two recorded calls — one formal caller, one casual.
- **Expected impact:** Medium. Removes the "she talks to everyone identically" impression.

### P15 — Adaptation is advisory, not measured
- **Problem:** Directives to shorten or simplify are appended text; nothing checks the reply obeyed (§29).
- **Human behaviour:** A busy caller simply gets less, automatically.
- **Current AI behaviour:** `buildToneDirective` returns one strategy hint per turn, appended to a nudge.
- **Why the AI differs:** The strategy layer was added at the prompt level because it was the cheapest safe layer.
- **Root cause:** model
- **Implementation change:** Count spoken words per agent turn for each directive and record the comparison in telemetry. If the model ignores a directive, reduce the source material for that step rather than asking again.
- **Prompt change:** None until the measurement exists.
- **Test required:** A telemetry test that a turn's word count is recorded against the directive that produced it, with no personal data in the payload.
- **How to measure improvement:** Mean words per turn for busy vs neutral callers on real calls; the target is a visible difference.
- **Expected impact:** High. This is the difference between "designed to adapt" and "adapts".

### P16 — The two-question ceiling is audible as a form
- **Problem:** Two questions for the whole call, by owner decision, and the shape is legible to a caller (§31, G33).
- **Human behaviour:** Qualifies conversationally: budget, timeline, purpose, who else decides — woven in, not asked in sequence.
- **Current AI behaviour:** `TWO QUESTIONS MAX`, no purpose, no budget, no "shall I continue", nothing else.
- **Why the AI differs:** Every extra question produced a real complaint; the ceiling removed the class of failure.
- **Root cause:** business constraint
- **Implementation change:** None without an owner decision.
- **Prompt change:** If the ceiling stays, let her sound as though she chose it: one clause of reasoning before the handoff ("ನಿಮ್ಮ ವಿವರ ಸೇಲ್ಸ್ ಟೀಮ್‌ಗೆ ಕೊಡ್ತೀನಿ, ಅವರು ಚೆನ್ನಾಗಿ ವಿವರಿಸ್ತಾರೆ") instead of a bare transfer.
- **Test required:** Pinned-line test that no third question can ever be generated, whatever the prompt says.
- **How to measure improvement:** Native Q8 (did she sound like a salesperson?) on a role-played qualification.
- **Expected impact:** High for realism; requires an owner decision, because it trades away part of the anti-improvisation guarantee.

### P17 — No approved content for a price question
- **Problem:** A price question always gets the same decline (§32).
- **Human behaviour:** Gives a range, a starting point, or an honest "it depends", and keeps the conversation.
- **Current AI behaviour:** Never invents prices, sizes or approvals; the sales team takes it, then the close.
- **Why the AI differs:** No approved indicative content exists for the agent to use.
- **Root cause:** business constraint
- **Implementation change:** Add an explicit, owner-approved content block (for example a starting price band per locality, or a plain "ಖಚಿತ ಬೆಲೆ ಪ್ರಾಜೆಕ್ಟ್ ಮೇಲೆ ಅವಲಂಬಿಸುತ್ತೆ") that the agent may say, with the existing never-invent guard unchanged around it.
- **Prompt change:** Name that block as sayable, and keep everything outside it forbidden.
- **Test required:** A test that a price can only come from the approved block, and that no number outside it is ever spoken.
- **How to measure improvement:** Native Q8 and the caller's follow-up length on price questions.
- **Expected impact:** High. Requires the business to supply the content; nothing else unblocks it.

### P18 — An unsupported question ends the call
- **Problem:** A question the agent cannot answer triggers the sales-team line, one thank-you and `endCall` in the same turn — the call ends (§35).
- **Human behaviour:** Answers, or says they will find out, and continues the conversation.
- **Current AI behaviour:** The no-answer fallback is a terminating path by design.
- **Why the AI differs:** "Never invent" was correct, and the exit was added so the caller was never left hanging on an answer the agent did not have.
- **Root cause:** prompt
- **Implementation change:** None.
- **Prompt change:** Split the fallback in two: an unanswered *question* continues the call after a brief honest deflection, and only an unanswerable *request for action* (something requiring a person) closes it. Name the common unsupported questions explicitly — how did you get my number, why are you asking, who are you with — and give each a short, safe, allowed answer.
- **Test required:** Table-driven test that each named unsupported question produces a continue-the-call nudge and never the close nudge.
- **How to measure improvement:** `VOICE_QA_PLAN.md` §2 row 19 with the named questions, and native Q13 (first moment of suspicion).
- **Expected impact:** Critical. This is one of the most obvious script tells in the system.

### P19 — A garbled name is silently dropped
- **Problem:** If a name cannot be read, it is marked declined and never asked again (§37).
- **Human behaviour:** Asks once more, gently, with a guess attached; then uses whatever they get.
- **Current AI behaviour:** `outboundNameDeclined = true` and straight to the locations, with no second attempt.
- **Why the AI differs:** A stall on the name step was a real complaint, so the retry was removed.
- **Root cause:** code
- **Implementation change:** When `extractCallerName` returns nothing but the utterance is not a refusal, issue one gentle retry with a candidate name offered as a guess; bound it to once per call.
- **Prompt change:** Permit the guess form ("ಸರ್, ಹೆಸರು ಸ್ವಲ್ಪ ಸ್ಪಷ್ಟವಾಗಿ ಹೇಳ್ತೀರಾ?") and keep the ban on meta-confirmation.
- **Test required:** Unit tests for the three branches: name found, name refused, name garbled-then-retried-once.
- **How to measure improvement:** Name-capture rate on real calls with a deliberately mumbled test call.
- **Expected impact:** Medium. Small, bounded, and removes a moment where she visibly gives up.

### P20 — Repair is not differentiated
- **Problem:** One generic repeat request covers mishearing, mumbling, ambiguity and a hard question; content confirmation is banned outright (§38, §39).
- **Human behaviour:** A different repair for each cause, and a four-word content check when unsure.
- **Current AI behaviour:** The ladder has two kinds (`ask_repeat`, `reply_now`); `looksLikeCannotAnswerLine` covers the rest, and echo-confirmation is suppressed by code.
- **Why the AI differs:** Each repair path was added for one reported failure, and confirmation was banned after an echo loop.
- **Root cause:** code
- **Implementation change:** Add a distinguishable third and fourth repair cause: ambiguous answer (transcript arrived, low confidence) and misunderstood content (a detected entity mismatch), each with its own nudge text. Keep the existing two.
- **Prompt change:** Allow content confirmation — "ಹುಣಸೂರು, ಅಲ್ವಾ?" — while keeping meta-confirmation banned ("did you say yes sir?").
- **Test required:** A test per cause asserting a distinct nudge, and an assertion that no cause produces the generic sentence.
- **How to measure improvement:** Count of repeat requests per call on a real call with an intentional mumble; native Q4.
- **Expected impact:** High. This is the request's §24, and it is currently four causes short.

### P21 — An interrupted sentence is abandoned
- **Problem:** Barge-in clears playback and the model regenerates the turn from the flow state, so the half-spoken thought is lost (§40, §48).
- **Human behaviour:** Resumes where they were, or finishes the thought.
- **Current AI behaviour:** `clearPlayback()` with no record of how far the turn got.
- **Why the AI differs:** Resuming looked riskier than starting again, and starting again had already been guarded against.
- **Root cause:** code
- **Implementation change:** Track the fraction of the turn delivered (from the audio-transcript text received before the interruption) and, when the caller's new utterance does not change the step, nudge "finish the thought you were on".
- **Prompt change:** One clause permitting a resumed sentence when the interruption did not answer the question.
- **Test required:** A test that an interruption which does not settle the current step produces the resume nudge, and one that does produces none.
- **How to measure improvement:** Role-play interrupting mid-sentence on 5 calls; count restarts versus resumptions.
- **Expected impact:** Medium-high; it is the difference between a machine that resets and a person who remembers what they were saying.

### P22 — Self-repair is suppressed
- **Problem:** Three guards drop audio outright on first occurrence (echo-confirm, future-site pitch, cannot-answer) (§41).
- **Human behaviour:** Repairs themselves out loud and carries on.
- **Current AI behaviour:** The turn is suppressed before the caller hears it.
- **Why the AI differs:** Each guard exists to stop a real loop that reached a caller.
- **Root cause:** code
- **Implementation change:** Keep the suppressors but scope them to the *second* occurrence, and allow the first to be spoken when the same sentence has not already been spoken this call (the no-repeat guard already exists).
- **Prompt change:** None.
- **Test required:** A test that a first-occurrence echo-confirm is allowed through and a repeated one is still suppressed.
- **How to measure improvement:** Count suppression events per call; target zero for first occurrences.
- **Expected impact:** Medium. It restores recovery without reopening the loop.

### P23 — Spoken repetition has no detector
- **Problem:** The prompt forbids repeating information; nothing notices when it happens (§45).
- **Human behaviour:** Never says the same thing twice.
- **Current AI behaviour:** The acknowledgement has a no-repeat guard; spoken lines have only an instruction.
- **Why the AI differs:** The acknowledgement guard was built for the beat, and never generalised.
- **Root cause:** code
- **Implementation change:** Feed each complete agent transcript line into the existing `recentSpoken` guard and, on a near-duplicate, suppress and re-ask the turn once.
- **Prompt change:** None.
- **Test required:** A unit test that a near-duplicate transcript line is detected, that benign rewording is not, and that the guard is bounded.
- **How to measure improvement:** `ackRepeatsBlocked`-style counter for whole lines, per call.
- **Expected impact:** Medium. Repetition is one of the loudest machine tells and this is a cheap guard.

### P24 — Barge-in is too abrupt
- **Problem:** She clears playback 150 ms into sustained speech-class audio, mid-word if necessary (§46).
- **Human behaviour:** Yields in about the same time, but at a word boundary, and often finishes the current word.
- **Current AI behaviour:** `clearPlayback()` fires on the energy threshold alone.
- **Why the AI differs:** The threshold was tuned to fix slow interruptions, and word boundaries were never considered.
- **Root cause:** VAD
- **Implementation change:** Defer the clear by the current word's remaining audio, bounded to a short maximum, so the cut lands between words rather than inside one.
- **Prompt change:** None.
- **Test required:** A test that a barge-in during a word defers the clear within the bound, and that a barge-in between words does not defer.
- **How to measure improvement:** `bargeInYieldMs` p95 against the bound, plus native Q4 (did she interrupt the caller?).
- **Expected impact:** High. It removes an audible mechanical cut with no change to who wins the floor.

### P25 — The runtime block reads like a runbook
- **Problem:** The model is told the position of the call in an enumerated state machine on every turn, and the flow is enumerated in the prompt (§50).
- **Human behaviour:** Nobody knows what step they are on; the conversation simply moves.
- **Current AI behaviour:** `OUTBOUND SCRIPT STATE — where the call is right now`, plus five numbered steps in the prompt.
- **Why the AI differs:** The linear script was the fix for improvisation and repetition, and the runtime block makes the state legible to the model.
- **Root cause:** prompt
- **Implementation change:** None.
- **Prompt change:** Keep the flow for the model, but forbid it from being *narrated*: no enumeration language, no "step", no "next", no recap of what has been covered. The runtime block should describe what has happened, not which step of a plan is in progress.
- **Test required:** A source-invariant check that the runtime block contains no step-number narration, and that the five pinned lines are still named.
- **How to measure improvement:** Native Q5 (did the wording feel scripted?) on three calls.
- **Expected impact:** Medium-high. The structure has to exist; the caller should not be able to hear it.

### P26 — The script contradiction must be settled
- **Problem:** Four prompt blocks pin the interest question "AS WRITTEN" and one comment says it is "REFERENCE phrasing only … never the same words twice" (§51).
- **Human behaviour:** Would not ask the identical question on two calls.
- **Current AI behaviour:** The model obeys whichever side it read last; worst case the same words every call.
- **Why the AI differs:** Both intentions are legitimate — anti-improvisation and anti-scripted — and nobody chose between them.
- **Root cause:** prompt
- **Implementation change:** None.
- **Prompt change:** Choose one. If pinned (safer, matches the owner's recorded decision): delete the "rephrase freely" claims and keep the question word-for-word like the other anchored lines. If free (better for script detection): keep the meaning pinned and require fresh wording every call, and say so in every block that currently says "AS WRITTEN".
- **Test required:** A source-invariant assertion that the assembled instruction contains exactly one rule for the interest question, and that it matches the anchored-lines list.
- **How to measure improvement:** Two real calls compared for identical wording; native Q6 for "did it sound scripted".
- **Expected impact:** High. This is a decision, not a build — and it cannot be left as two instructions to one model.

### P27 — The close ignores what the caller asked about
- **Problem:** The close is the same two sentences whatever interested them (§52).
- **Human behaviour:** Closes on the caller's own thread.
- **Current AI behaviour:** `Say these TWO short sentences, warmly and happily, in ONE utterance`.
- **Why the AI differs:** The close is fixed because the thank-you is the engine's hangup trigger, and a fixed sentence is the safest thing to hang up on.
- **Root cause:** prompt
- **Implementation change:** None — the safety property must stay.
- **Prompt change:** Permit one short reference to the locality the caller named, placed *before* the sales-team line, with the thank-you still said exactly once, verbatim, and last. The close must still contain the exact pinned thank-you for the detector to fire.
- **Test required:** A test that the close still contains the pinned thank-you text when a locality is referenced, and that `hasThanksClosing` still matches it.
- **How to measure improvement:** Native Q3 and Q13 on two calls with different localities.
- **Expected impact:** High for the final impression, which is the part a caller remembers.

### P28 — The end is a mechanism
- **Problem:** After the thank-you the engine hard-mutes and hangs up (§54).
- **Human behaviour:** The line winds down and ends on a courtesy.
- **Current AI behaviour:** `activateOutboundPostThanksMute()` plus a settle window before the hangup.
- **Why the AI differs:** The hangup has to be deterministic, and letting the model decide was the bug that produced a call that never ended.
- **Root cause:** state machine
- **Implementation change:** Widen the existing audio settle window so the last word is provably audible, and verify from the recording rather than the code.
- **Prompt change:** None.
- **Test required:** A test that the mute cannot arm before the thank-you's audio has finished playing, with the bound stated.
- **How to measure improvement:** Listen to the last two seconds of a real recording; does the final word land?
- **Expected impact:** Medium. A truncated goodbye is remembered more than a good one.

## 40. The final objective — restated as acceptance criteria

Not "an AI that follows the script well". The caller must experience, in order:

1. **listening** — an answer that shows the *content* was heard, not just the fact of speaking (P10);
2. **understanding** — a strategy that matches the intent, including indirect and hesitant answers (P09);
3. **a natural response** — Kannada that survives a native ear, delivered with a breath and a settled
   range rather than a metronome (P02, P07);
4. **a relevant question** — one that follows from what the caller said, not from a fixed pair (P16/P26);
5. **appropriate adaptation** — measurably shorter for a busy caller, measurably patient for one who is
   thinking (P05, P15);
6. **smooth continuation** — no call-ending because a question was hard (P18), no question asked twice
   (P11).

The business process may stay rigid underneath. The caller must not feel the rigidity. Today they can,
and §50 is why.

## 41. The honest answer

**VERDICT: yes.**

If you removed the visual interface and gave a prospective property buyer in Mysuru only the phone
audio, they would know Priya was AI. Not eventually — quickly, and most likely in the first two turns.
The most probable moments, in order of how soon they arrive:

1. **The opening sentence.** Level machine pace, no breath, no pitch movement. Before any content is
   evaluated, the sound gives it away (G01, G02).
2. **The acknowledgement after the name.** The caller has just said something personal; what comes back
   is a three-word beat that would work with any sentence in its place (G18, G19). This is the moment I
   would bet on as *the* answer to "when did you first know".
3. **By the second question**, the shape is legible: two questions, a localities list, a handoff. Many
   callers will read that as a scripted call regardless of the voice (G31, G50).
4. **Any unsupported question** — "how did you get my number?", "why are you asking?" — which can end
   with a thank-you and a hangup. Nothing says "machine following a script" more clearly (G35).
5. **A true 5-second pause**, on a caller who was only thinking (G10).

**Because the verdict is yes, no claim of 90% is made anywhere in this document.** The measured position
is:

```
HUMAN-LIKE RELIABILITY    82/100   mechanism-verified, never heard
HUMAN-LIKE CONVERSATION   55/100   and this is the number that decides
OVERALL EQUIVALENCE       64/100
```

The reliability is real — dead air, premature hangup, silence handling and the single thank-you are
genuinely solved, and the reliability score would survive an audit of the test suite. **It is not the
number that matters.** A caller does not experience reliability. They experience a voice, a beat, a
shape, and whether anything they said came back to them.

The path from here is §39, in this order: **P07** (a native speaker, before anything else is claimed),
**P10** (the acknowledgement), **P18** (never end a call because a question was hard), **P02**
(the breath), **P06** and **P05** (the pause and the ladder), **P26** (settle the script contradiction).
Then call again, run §28 and §29 with real people, and re-score.

Until those are done, the differences are obvious, not subtle. Saying anything else would be generous,
and generosity is exactly what this document was asked not to provide.
