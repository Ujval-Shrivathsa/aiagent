/**
 * Conversation test harness for the Priya inbound agent.
 *
 * Drives the production system instruction + tools through Gemini Live
 * (audio modality + output transcription) and runs scripted scenarios.
 *
 * Run: npx tsx test-agent.ts
 * Filter: TEST_ONLY=1 npx tsx test-agent.ts  (1-based scenario index)
 */
import { GoogleGenAI, Modality, Type } from '@google/genai';
import dotenv from 'dotenv';
import { buildInboundSystemInstruction, getGreeting } from './src/voice/Inbound/index';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env.local' });
dotenv.config({ path: '../.env' });

const TOOLS = [
  {
    name: 'endCall',
    description: "End the call ONLY when the customer has CLEARLY said they want to finish — e.g. bye, goodbye, thank you for your time, thanks that's all, I'm done, that's all I needed, you can end the call, or an equivalent clear goodbye in any language. Also allowed after completing a busy/callback-later script the customer requested. NEVER call this because of elapsed time (3–5 minutes or any duration), silence, pauses, short replies (okay/hmm), topic changes, incomplete answers, or because you think the conversation is finished. If unsure, do NOT end the call.",
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  { name: 'bookAppointment', description: 'Book a site-visit appointment. Only use this if they agree on a specific date and time within the preferred site-visit window of 10:00 AM to 5:30 PM.', parameters: { type: Type.OBJECT, properties: { dateTime: { type: Type.STRING, description: 'ISO 8601 date-time, between 10:00 and 17:30 local.' } }, required: ['dateTime'] } },
  { name: 'setFollowUp', description: 'Mark the customer for a follow-up if they are interested but unsure of when they can visit or need more time to decide.', parameters: { type: Type.OBJECT, properties: { reason: { type: Type.STRING } }, required: ['reason'] } },
  { name: 'setName', description: "Update the customer's name in the system once they provide it.", parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } },
  { name: 'notInterested', description: "Call this when the customer explicitly and clearly says they are not interested. Only when they actively decline.", parameters: { type: Type.OBJECT, properties: {}, required: [] } },
];

const currentDateStr = new Date().toLocaleDateString('en-IN');
const runtimeInstructionBase = `
TOOL USAGE NOTES:
- If the customer clearly and explicitly says they are not interested, call the notInterested tool.
- If they agree on a specific date/time between 10:00 AM and 5:30 PM (preferred site-visit window), call bookAppointment.
- If they're interested but unsure of timing, call setFollowUp.
- endCall ONLY when the customer clearly wants to hang up (bye / goodbye / thank you for your time / thanks that's all / I'm done / that's all I needed / you can end the call / clear equivalent in any language), OR after finishing a busy/callback-later script they requested. NEVER call endCall because a few minutes have passed, for silence, pauses, "okay"/"hmm", topic changes, or incomplete answers. No arbitrary call-duration cutoff.
CURRENT DATE: ${currentDateStr}
`;
const SYSTEM_INSTRUCTION = `${buildInboundSystemInstruction(currentDateStr)}\n${runtimeInstructionBase}`;

type TurnResult = { text: string; toolCalls: string[] };

async function runScenario(name: string, userTurns: string[]): Promise<{ transcript: string[]; toolLog: string[] }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const transcript: string[] = [];
  const toolLog: string[] = [];

  let resolveTurn: ((r: TurnResult) => void) | null = null;
  let buf = '';
  let bufTools: string[] = [];
  let sessionRef: any = null;
  let closed = false;

  const session = await ai.live.connect({
    model: 'gemini-3.1-flash-live-preview',
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: TOOLS }],
    },
    callbacks: {
      onopen: () => { console.log(`[${name}] session opened`); },
      onmessage: (response: any) => {
        if (response.serverContent?.outputTranscription?.text) {
          buf += response.serverContent.outputTranscription.text;
        }
        if (response.serverContent?.modelTurn?.parts) {
          for (const p of response.serverContent.modelTurn.parts) {
            if (p.text) buf += p.text;
          }
        }
        if (response.toolCall) {
          const responses: any[] = [];
          for (const call of response.toolCall.functionCalls) {
            bufTools.push(`${call.name}(${JSON.stringify(call.args || {})})`);
            toolLog.push(`${call.name}(${JSON.stringify(call.args || {})})`);
            responses.push({ name: call.name, response: { success: true }, id: call.id });
          }
          try { sessionRef?.sendToolResponse({ functionResponses: responses }); } catch {}
        }
        if (response.serverContent?.turnComplete) {
          const r = { text: buf.trim(), toolCalls: bufTools };
          buf = '';
          bufTools = [];
          resolveTurn?.(r);
          resolveTurn = null;
        }
      },
      onerror: (e: any) => { console.error(`[${name}] session error:`, e?.message || e); },
      onclose: (event: any) => {
        closed = true;
        if (event?.code && event.code !== 1000) {
          console.error(`[${name}] session closed. code=${event?.code} reason=${event?.reason || '(none)'}`);
        }
        resolveTurn?.({ text: buf.trim(), toolCalls: bufTools });
        resolveTurn = null;
      },
    },
  });
  sessionRef = session;

  const waitForTurn = () => new Promise<TurnResult>((resolve) => {
    const mine = (r: TurnResult) => resolve(r);
    resolveTurn = mine;
    setTimeout(() => {
      if (resolveTurn === mine) {
        resolveTurn = null;
        resolve({ text: buf.trim() || '(no response within timeout)', toolCalls: bufTools });
        buf = ''; bufTools = [];
      }
    }, 60000);
  });

  console.log(`[${name}] sending greeting instruction...`);
  session.sendRealtimeInput({ text: `Say exactly this: ${getGreeting('')}` });
  let r = await waitForTurn();
  transcript.push(`PRIYA: ${r.text}${r.toolCalls.length ? '  [tools: ' + r.toolCalls.join(', ') + ']' : ''}`);

  for (const turn of userTurns) {
    if (closed) { transcript.push('(session closed — call ended)'); break; }
    transcript.push(`CUSTOMER: ${turn}`);
    try {
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: turn }] }], turnComplete: true });
    } catch (e: any) {
      transcript.push(`(send failed: ${e.message} — call likely ended)`);
      break;
    }
    r = await waitForTurn();
    transcript.push(`PRIYA: ${r.text}${r.toolCalls.length ? '  [tools: ' + r.toolCalls.join(', ') + ']' : ''}`);
  }

  try { session.close(); } catch {}
  return { transcript, toolLog };
}

function checkRepetition(transcript: string[]): string[] {
  const seen = new Map<string, number>();
  const repeats: string[] = [];
  transcript.filter(l => l.startsWith('PRIYA:')).forEach((line, idx) => {
    const sentences = line.replace(/^PRIYA:\s*/, '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 25);
    for (const s of sentences) {
      if (seen.has(s) && seen.get(s) !== idx) repeats.push(s);
      seen.set(s, idx);
    }
  });
  return [...new Set(repeats)];
}

function analyzeEndCalls(transcript: string[], toolLog: string[], expectEndOnLast: boolean): string[] {
  const issues: string[] = [];
  const endCalls = toolLog.filter(t => t.startsWith('endCall'));
  const priyaLines = transcript.filter(l => l.startsWith('PRIYA:'));

  for (let i = 0; i < priyaLines.length - (expectEndOnLast ? 1 : 0); i++) {
    if (priyaLines[i].includes('[tools: endCall')) {
      issues.push(`Premature endCall on turn ${i + 1}: ${priyaLines[i].slice(0, 120)}`);
    }
  }

  if (expectEndOnLast) {
    const last = priyaLines[priyaLines.length - 1] || '';
    if (!last.includes('endCall') && endCalls.length === 0) {
      issues.push('Expected endCall after clear goodbye — missing');
    }
  } else if (endCalls.length > 0) {
    issues.push(`Unexpected endCall(s): ${endCalls.join(', ')}`);
  }
  return issues;
}

async function main() {
  const only = process.env.TEST_ONLY ? Number(process.env.TEST_ONLY) : null;
  const scenarios: Array<{ name: string; turns: string[]; note: string; expectEndOnLast?: boolean }> = [
    {
      name: 'SCENARIO 1: ambiguous pauses must NOT end the call',
      note: 'okay / hmm / incomplete replies / topic change — NO endCall.',
      expectEndOnLast: false,
      turns: [
        'What are your office timings?',
        'Okay.',
        'Hmm.',
        'And what about UK Square price?',
        'Alright.',
      ],
    },
    {
      name: 'SCENARIO 2: clear goodbye MUST end the call',
      note: 'After "Thanks, that\'s all. Bye." — must call endCall once, no double closing.',
      expectEndOnLast: true,
      turns: [
        'Tell me office hours please.',
        'Thanks, that\'s all. Bye.',
      ],
    },
    {
      name: 'SCENARIO 3: site visit first without naming a project',
      note: 'Must qualify first — not "which site to book". No endCall.',
      expectEndOnLast: false,
      turns: [
        'Hi, I want to come for a site visit.',
        'I want to build a house soon.',
        'Around 40 to 50 lakhs near ring road.',
      ],
    },
    {
      name: 'SCENARIO 4: "I\'m done" clear end',
      note: 'Clear finished statement must trigger endCall.',
      expectEndOnLast: true,
      turns: [
        'How far is CNM Apex from Mysuru Airport?',
        'Okay that\'s all I needed. I\'m done.',
      ],
    },
    {
      name: 'SCENARIO 5: Kannada — stay in language, no premature end',
      note: 'Natural Kannada replies; no endCall until goodbye.',
      expectEndOnLast: true,
      turns: [
        'ನಮಸ್ಕಾರ, ಸೈಟ್ ಬಗ್ಗೆ ಸ್ವಲ್ಪ ಮಾಹಿತಿ ಬೇಕಿತ್ತು.',
        'CNM Apex City ರೇಟ್ ಎಷ್ಟು?',
        'ಸರಿ, ಧನ್ಯವಾದಗಳು. ಸಾಕು, ಬೈ.',
      ],
    },
  ];

  let failures = 0;
  for (const [i, sc] of scenarios.entries()) {
    if (only !== null && i !== only - 1) continue;
    console.log('\n' + '='.repeat(80));
    console.log(sc.name);
    console.log('EXPECTATION: ' + sc.note);
    console.log('='.repeat(80));
    try {
      const { transcript, toolLog } = await runScenario(sc.name, sc.turns);
      transcript.forEach(l => console.log(l));
      console.log(`-- tool calls: ${toolLog.length ? toolLog.join(', ') : '(none)'}`);
      const repeats = checkRepetition(transcript);
      console.log(`-- repeated sentences: ${repeats.length ? repeats.join(' || ') : '(none)'}`);
      const endIssues = analyzeEndCalls(transcript, toolLog, !!sc.expectEndOnLast);
      if (endIssues.length || repeats.length) {
        failures++;
        endIssues.forEach(x => console.log(`-- FAIL: ${x}`));
        if (repeats.length) console.log(`-- FAIL: repetition detected`);
      } else {
        console.log('-- PASS');
      }
    } catch (e: any) {
      failures++;
      console.error(`Scenario failed to run: ${e.message}`);
    }
  }
  console.log(`\n${'='.repeat(80)}\nDone. Failures: ${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
