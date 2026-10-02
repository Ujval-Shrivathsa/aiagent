/**
 * VOICE LAB — render the real call lines through the real Live model so a human
 * can actually pick a voice by ear.
 *
 * Uses the SAME model and SDK connection path as a live call
 * (gemini-3.1-flash-live-preview), so what you hear here is what a caller hears.
 * Only `voiceName` changes between renders.
 *
 * Writes 16-bit mono WAVs to ./voice-lab/ for listening.
 *
 * Run: npx tsx scripts/voice-lab.ts
 * Render one voice only: VOICES=Despina npx tsx scripts/voice-lab.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  PDF_OPENING_KN,
  PDF_AREAS_LINE_KN,
  PDF_THANKS_CLOSE_KN,
  buildOutboundFastConnectInstruction,
  getOutboundGreetingInstruction,
  OUTBOUND_YES_LOCATIONS_NUDGE,
  buildOutboundHandoffTransferNudge,
  buildOutboundCallbackTimeNudge,
  buildOutboundCallbackOutsideWindowNudge,
} from '../src/voice/kannada-script';

const MODEL = 'gemini-3.1-flash-live-preview';
const SAMPLE_RATE = 24000;
const OUT_DIR = path.resolve(process.cwd(), 'voice-lab');

/**
 * Candidates chosen from Google's own voice descriptions, filtered to FEMALE
 * voices whose character matches "gentle + smooth". Kore is included as the
 * current production baseline so the others have something to beat.
 */
const DEFAULT_VOICES = [
  'Despina', // ♀ Smooth    — "smooth and gentle female voice" (current default)
  'Vindemiatrix', // ♀ Gentle    — "gentle and delicate female voice"
  'Aoede', // ♀ Breezy     — "relaxed and natural female voice"
  'Sulafat', // ♀ Warm       — "warm and approachable female voice"
  'Callirrhoe', // ♀ Easy-going — "friendly and easy-going female voice"
  'Kore', // ♀ Firm       — the previous voice, kept for comparison
];

const VOICES = (process.env.VOICES || DEFAULT_VOICES.join(','))
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

/**
 * The turns a real caller hears, driven by the SAME instructions the engine
 * sends in production (the greeting instruction and the STEP 2B nudge). Using
 * the real prompts matters: a generic "say exactly this" gets overridden by the
 * system instruction's FIRST LINE, which silently renders the wrong clip.
 */
const LINES: { label: string; instruction: string; expect: string }[] = [
  { label: '01-opening', instruction: getOutboundGreetingInstruction('kn'), expect: PDF_OPENING_KN },
  {
    label: '02-locations',
    instruction: OUTBOUND_YES_LOCATIONS_NUDGE,
    expect: PDF_AREAS_LINE_KN,
  },
  {
    label: '03-close',
    instruction: buildOutboundHandoffTransferNudge(),
    expect: PDF_THANKS_CLOSE_KN.slice(0, 10),
  },
  {
    label: '04-callback-7pm',
    instruction: buildOutboundCallbackTimeNudge('ಸಂಜೆ 7 ಗಂಟೆಗೆ'),
    expect: PDF_THANKS_CLOSE_KN.slice(0, 10),
  },
  {
    label: '05-outside-window',
    instruction: buildOutboundCallbackOutsideWindowNudge(),
    expect: PDF_THANKS_CLOSE_KN.slice(0, 10),
  },
];

/**
 * The REAL production system instruction — the exact prompt a live call uses, so
 * these renders are what a caller actually hears, not a mock persona.
 */
const PERSONA = buildOutboundFastConnectInstruction('30 Sep 2026');

// --- env -------------------------------------------------------------------
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- wav -------------------------------------------------------------------
function toWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // channels = mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// --- one render ------------------------------------------------------------
function render(
  ai: GoogleGenAI,
  voice: string,
  line: { label: string; instruction: string; expect: string },
): Promise<number> {
  return renderAsync(ai, voice, line);
}

async function renderAsync(
  ai: GoogleGenAI,
  voice: string,
  line: { label: string; instruction: string; expect: string },
): Promise<number> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let spoken = '';
    let settled = false;
    const done = (bytes: number) => {
      if (settled) return;
      settled = true;
      try {
        session?.close();
      } catch {}
      resolve(bytes);
    };
    const fail = (msg: string) => {
      console.log(`    x ${voice} / ${line.label}: ${msg}`);
      done(0);
    };

    const timer = setTimeout(() => fail('timeout 40s'), 40_000);
    let session: any = null;
    // onopen can fire before connect() resolves, so hold the prompt and flush
    // it once the session handle actually exists.
    let opened = false;
    let prompt = '';
    const flush = () => {
      if (!opened || !session || !prompt) return;
      session.sendRealtimeInput({ text: prompt });
      prompt = '';
    };

    try {
      const pending = ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          // NO languageCode — kn-IN is undocumented and ignored by the API;
          // letting the model detect from the script is the correct path.
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          systemInstruction: PERSONA,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            prompt = line.instruction;
            flush();
          },
          onmessage: (response: any) => {
            const parts = response?.serverContent?.modelTurn?.parts ?? [];
            for (const p of parts) {
              if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, 'base64'));
            }
            // Capture what was actually SPOKEN so a clipped or truncated line is
            // visible in the log rather than only audible in the WAV.
            const ot = response?.serverContent?.outputTranscription?.text;
            if (ot) spoken += ot;
            const mt = response?.serverContent?.modelTurn?.content?.parts?.find((p: any) => p.text)?.text;
            if (mt) spoken += mt;
            if (response?.serverContent?.turnComplete) {
              clearTimeout(timer);
              const pcm = Buffer.concat(chunks);
              if (!pcm.length) return fail('no audio returned');
              fs.writeFileSync(path.join(OUT_DIR, `${voice}-${line.label}.wav`), toWav(pcm));
              const secs = (pcm.length / 2 / SAMPLE_RATE).toFixed(1);
              const said = spoken.trim();
              // Flag a clip that did not actually say the intended line, so a
              // wrong render is caught here rather than mistaken for a voice.
              const onTarget = said.includes(line.expect);
              console.log(`    + ${voice.padEnd(13)} ${line.label.padEnd(13)} ${secs}s ${onTarget ? '' : 'OFF-SCRIPT'}`);
              console.log(`        said: ${said || '(no transcript)'}`);
              done(pcm.length);
            }
          },
          onerror: (e: any) => {
            clearTimeout(timer);
            fail(e?.message || String(e));
          },
          onclose: () => {
            clearTimeout(timer);
            if (!settled) fail('closed early');
          },
        },
      } as any);
      pending.then(
        (s: any) => {
          session = s;
          opened = true;
          flush();
        },
        (e: any) => {
          clearTimeout(timer);
          fail(e?.message || String(e));
        },
      );
    } catch (e: any) {
      clearTimeout(timer);
      fail(e?.message || String(e));
    }
  });
}

// --- main ------------------------------------------------------------------
async function main() {
  const env = loadEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not found in .env');
  const ai = new GoogleGenAI({ apiKey });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`VOICE LAB — model=${MODEL}\noutput: ${OUT_DIR}\n`);

  for (const voice of VOICES) {
    console.log(`  ${voice}`);
    for (const line of LINES) {
      await render(ai, voice, line);
      await sleep(9000); // stay clear of the 429 rate limit
    }
    console.log('');
  }

  console.log('Done. Play each voice\'s 01-opening and 02-locations and pick the one that');
  console.log('sounds like a real woman on a phone call. Then set VOICE_TTS_VOICE_NAME to it.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});