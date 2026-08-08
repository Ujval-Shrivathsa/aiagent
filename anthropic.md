# Project Rules and Guidelines (anthropic.md)

This file contains critical rules, configurations, and constraints for the Alliance Square Properties project. **DO NOT ignore these rules.**

## 1. Outbound Call Greeting Logic
- **With Name**: When a lead has a valid name, the greeting MUST be: 
  `"Hello Mr. [Name], I am Priya from Alliance Square. Are you looking for a plot in Mysore?"`
- **Without Name**: When a lead does NOT have a name, the greeting MUST be:
  `"Hello, I am Priya from Alliance Square. Are you looking for a plot in Mysore?"`
- **Constraint**: NEVER address a customer as "Customer", "Contact", "Lead", or any generic placeholder.
- **Mistake Avoidance**: The AI MUST NOT start by explaining itself (e.g., "I am not looking for a plot..."). The greeting should be hardcoded to be the FIRST thing the user hears.

## 2. Gemini Configuration
- **Model**: Use `gemini-3.1-flash-live-preview` for the voice server.
- **SDK Method**: Use `geminiSession.sendRealtimeInput({ text: "..." })`. Do NOT wrap the object in an array (e.g., `[{ text: "..." }]`).
- **VAD/Turn Detection**: Use `silenceDurationMs: 250` with sensitivity `0.3` (start) and `0.5` (end) to ensure fast and natural responses.
- **Greeting Fix**: Use `Say exactly this: [Greeting]` as the instruction to the model to ensure it follows the greeting perfectly.

## 3. Environment and Ports
- **Unified Server**: Run everything on port **3000** using `npm run dev:all`.
- **Standalone Server**: If needed, run the dedicated voice server on port **5050** using `npm run voice`.
- **Environment Loading**: Ensure `dotenv.config()` is called at the very beginning of the server entry points (`server.ts`, `voice/standalone.ts`).
- **Ngrok**: Only one tunnel is allowed on free accounts; use port **3000** for all external Twilio/WebSocket connections.

## 4. AI Agent Configuration — Per-Call-Type File Edit Map
(Updated: 2026-07-30. No more single `base.ts` confusion — each call type has its own editable file.)

### WHICH FILE TO EDIT FOR WHAT CALL TYPE:
| Want to change behavior of… | EDIT THIS FILE ONLY | Do NOT touch the other call-type folders. |
|---|---|---|
| Incoming (inbound) calls | `saas-platform/src/voice/Inbound/index.ts` | Outbound/WithName, Outbound/WithoutName |
| Outbound WITH customer name in spreadsheet | `saas-platform/src/voice/Outbound/WithName/index.ts` | Inbound, Outbound/WithoutName |
| Outbound WITHOUT customer name in spreadsheet | `saas-platform/src/voice/Outbound/WithoutName/index.ts` | Inbound, Outbound/WithName |
| Shared exact phrases / 9 layout catalog / travel times / negative constraints / shared knowledge & personality (changes ALL call types) | `saas-platform/src/voice/shared.ts` | Only edit if you intend the change to affect inbound + both outbound types |

### What's inside each call-type file:
- Every call-type file (`Inbound/index.ts`, `WithName/index.ts`, `WithoutName/index.ts`) is a FULLY SELF-CONTAINED system instruction for that call type. It exports:
  - The system instruction constant (e.g. `INBOUND_SYSTEM_INSTRUCTION`)
  - A greeting function / constant for that call type.
  - It imports shared data / phrases / layout knowledge from `../shared.ts` (or `../../shared.ts`).
- **YOU CAN EDIT THE FULL FLOW (greeting / questions / tone / 8-step flow) RIGHT INSIDE EACH CALL TYPE'S FILE** — you will never accidentally modify another call type's behavior because each is in its own file.

### Imports / Wiring:
- `logic.ts` / `voice-server-logic.ts` import instructions from the per-type folders:
  - `./Inbound` → `INBOUND_SYSTEM_INSTRUCTION` + greeting.
  - `./Outbound/WithName` → `OUTBOUND_NAMED_SYSTEM_INSTRUCTION` + `getGreeting(name)`.
  - `./Outbound/WithoutName` → `OUTBOUND_UNNAMED_SYSTEM_INSTRUCTION` + greeting.
  - **DO NOT** import prompts from `ai-config.ts` or `base.ts` anymore.
- `groq-calls.ts` (post-call summaries) uses `BASE_RULES` alias from `shared.ts` + per-type instructions.

### Editing workflow:
1. Decide: is this change for INBOUND only → open `Inbound/index.ts`. For a specific OUTBOUND type only → open the corresponding Outbound subfolder. For shared phrases/knowledge (affects everything) → open `shared.ts`.
2. Edit the flow / exact lines / greeting / 8-step steps inside the file.
3. Save the file.
4. Restart server: `Ctrl+C` → `npm run dev:all`.

### Runtime behavior rules:
- **Human-Like Interaction**: Use fillers like "umm", "well...", and "I see..." to simulate thinking time.
- **Emotions**: Show subtle happiness when interested and polite firmness when rejected.
- **Termination**: Use the `endCall` tool to terminate calls naturally when the customer is not interested (especially in outbound "No" scenarios).
- **Silence Handling**: A server-side watchdog timer triggers after 7 seconds of silence, instructing the AI to politely re-prompt the user ONCE by repeating the current flow question. This ensures the AI doesn't leave the user hanging repeatedly with "are you still there".
- **Low-Voice Capture**: We boost inbound audio slightly (inputGain 2.5×) before sending to Gemini, and we enable `inputAudioTranscription` so short, quiet answers like "yeah" are detected reliably.
- **VAD Tuning**: `silenceDurationMs` is set to **350ms**, `startOfSpeechSensitivity: 0.05` (very sensitive), and `endOfSpeechSensitivity: 0.75` to avoid prematurely cutting off quiet speech.
- **Comprehensive Knowledge**: The AI must be able to answer "What is it?" for the company and its projects using the shared knowledge block in `shared.ts`.
- **Professional Tone**: The AI must remain professional, use an Indian-English accent, and refer to prices in "lakhs".
- **Legal Compliance**: Always mention RERA registration and bank tie-ups (SBI, HDFC, etc.) to build trust.
- **Property Categorization**: Properties are strictly divided into **Construction** (ready for building/registration) and **Investment** (long-term growth/strategic location). The AI must use this differentiation to recommend the right project based on whether the user says they want to "build a house" or "invest for the future".

## 5. Call Termination Pattern
- **Logic**: In outbound calls, if the user says "No" to the initial greeting, the AI must say "Thank you for your time." and immediately call the `endCall` tool.
- **Tool Implementation**: The `endCall` tool in `logic.ts` sends a `stop` event to Twilio and closes the session.

## 5. Anti-Patterns (What NOT to repeat)
- **Greeting Errors**: Do not let the AI greet the customer with its own thought process.
- **Generic Names**: Never use "Customer" or "Unknown" in the system instruction or as a fallback name in the greeting.
- **SDK Mismatches**: Ensure the model name and session parameters match between `server.ts` and `voice/logic.ts`.
- **Environment Failures**: Always load environment variables from the root `.env.local` or `.env` files.

## 6. Multilingual Support
- **Languages**: The AI (Priya) is fluent in Kannada, Hindi, Telugu, and Tamil in addition to English.
- **Dynamic Switching**: The AI MUST immediately switch to the language being spoken by the customer.
- **Explicit Requests**: If a customer asks to speak in a specific language (e.g., "Kannada nalli mathadi"), the AI must comply and continue the conversation in that language.
- **Persona Consistency**: The professional persona, knowledge base, and goal (scheduling site visits) must remain consistent across all languages.