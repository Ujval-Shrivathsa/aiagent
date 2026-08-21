import fs from 'fs';
import path from 'path';
import { recordingsDir, recordingSampleRate, customerRecordingGain, customerNoiseGateRms } from './config';
import { callLog } from './logger';

const FRAME_MS = 20;
/** Cap catch-up per tick so a long event-loop stall does not spike CPU. */
const MAX_CATCHUP_FRAMES = 50;

function wavHeader(dataBytes: number, sampleRate: number, channels = 2, bits = 16): Buffer {
  const buf = Buffer.alloc(44);
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

const muLawToPcm = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xFF;
  const sign = (mu & 0x80) ? -1 : 1;
  const exponent = (mu & 0x70) >> 4;
  const data = mu & 0x0F;
  const pcm = ((data << 3) + 132) << exponent;
  muLawToPcm[i] = (pcm - 132) * sign;
}

/** Growable ring buffer of Int16 PCM — O(1) push/shift vs Array.shift(). */
class PcmRing {
  private buf: Int16Array;
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(initial = 16000) {
    this.buf = new Int16Array(initial);
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  pushSamples(src: ArrayLike<number>, offset = 0, len = src.length): void {
    this.ensure(len);
    for (let i = 0; i < len; i++) {
      this.buf[this.tail] = src[offset + i] as number;
      this.tail++;
      if (this.tail >= this.buf.length) this.tail = 0;
    }
    this.count += len;
  }

  /** Pop one sample, or 0 if empty. */
  shiftOrZero(): number {
    if (this.count === 0) return 0;
    const v = this.buf[this.head];
    this.head++;
    if (this.head >= this.buf.length) this.head = 0;
    this.count--;
    return v;
  }

  private ensure(n: number): void {
    if (this.count + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.count + n) cap *= 2;
    const next = new Int16Array(cap);
    for (let i = 0; i < this.count; i++) {
      next[i] = this.buf[(this.head + i) % this.buf.length];
    }
    this.buf = next;
    this.head = 0;
    this.tail = this.count;
  }
}

export class CallRecorder {
  readonly filePath: string;
  private stream: fs.WriteStream | null = null;
  private customerQ = new PcmRing();
  private aiQ = new PcmRing();
  private dataBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private sampleRate: number;
  private frameSamples: number;
  private customerGain: number;
  private noiseGateRms: number;
  // Noise-gate release: keep the gate open for a short tail after speech so
  // word endings aren't clipped. Counted in 20ms chunks (~300ms).
  private gateOpenChunks = 0;
  // DC-block filter state for the customer channel (removes hum/rumble).
  private dcPrevIn = 0;
  private dcPrevOut = 0;
  /** Wall-clock origin for sample-accurate frame catch-up. */
  private startedAtMs = 0;
  private framesWritten = 0;
  /** When true, ignore AI appends (barge-in / interrupt until next AI turn). */
  private dropAi = false;

  constructor(callId: string) {
    this.sampleRate = recordingSampleRate();
    this.frameSamples = Math.max(1, Math.round(this.sampleRate * (FRAME_MS / 1000)));
    this.customerGain = customerRecordingGain();
    this.noiseGateRms = customerNoiseGateRms();
    const dir = recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${callId}.wav`);
  }

  start(): boolean {
    if (this.stream) return true;
    try {
      this.stream = fs.createWriteStream(this.filePath);
      this.stream.write(wavHeader(0, this.sampleRate));
      this.startedAtMs = Date.now();
      this.framesWritten = 0;
      this.timer = setInterval(() => this.tick(), FRAME_MS);
      callLog('RECORDING', `RECORDING STARTED`);
      return true;
    } catch (err: any) {
      callLog('ERROR', `RECORDING WRITE FAILURE: ${err?.message || err}`);
      this.stream = null;
      return false;
    }
  }

  appendCustomerMuLaw(buf: Buffer): void {
    if (this.closed || !this.stream) return;
    try {
      // Decode + DC-block (high-pass) to strip hum/rumble from the line.
      const cleaned = new Int16Array(buf.length);
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = muLawToPcm[buf[i]];
        const y = x - this.dcPrevIn + 0.995 * this.dcPrevOut;
        this.dcPrevIn = x;
        this.dcPrevOut = y;
        cleaned[i] = y;
        sumSquares += y * y;
      }

      // Noise gate: duck chunks that are just line noise, with a ~300ms
      // release so word endings aren't chopped.
      const rms = buf.length > 0 ? Math.sqrt(sumSquares / buf.length) : 0;
      if (rms >= this.noiseGateRms) {
        this.gateOpenChunks = 15;
      } else if (this.gateOpenChunks > 0) {
        this.gateOpenChunks--;
      }
      const gateFactor = this.gateOpenChunks > 0 ? 1 : 0.12;

      const factor = this.customerGain * gateFactor;
      for (let i = 0; i < cleaned.length; i++) {
        const boosted = Math.round(cleaned[i] * factor);
        cleaned[i] = Math.max(-32768, Math.min(32767, boosted));
      }
      this.customerQ.pushSamples(cleaned);
    } catch (err: any) {
      callLog('ERROR', `AUDIO DECODE ERROR (customer): ${err?.message || err}`);
    }
  }

  appendAiMuLaw(buf: Buffer): void {
    if (this.closed || !this.stream || this.dropAi) return;
    try {
      const decoded = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) decoded[i] = muLawToPcm[buf[i]];
      this.aiQ.pushSamples(decoded);
    } catch (err: any) {
      callLog('ERROR', `AUDIO DECODE ERROR (ai): ${err?.message || err}`);
    }
  }

  /**
   * Drop AI audio that has been queued but not yet written. Called when the
   * telephony side clears its playback buffer (customer interruption) —
   * without this, the recorder keeps "playing out" AI speech that the
   * customer never heard, shifting the AI channel out of sync with the
   * customer channel for the rest of the call.
   *
   * Also arms dropAi so late Gemini chunks for the aborted turn are ignored
   * until {@link allowAi} (customer finished speaking / next AI turn).
   */
  clearAiPending(): void {
    this.aiQ.clear();
    this.dropAi = true;
  }

  /** Re-enable AI recording after barge-in (next model turn). */
  allowAi(): void {
    this.dropAi = false;
  }

  private tick(): void {
    if (!this.stream || this.closed || !this.startedAtMs) return;
    const elapsed = Date.now() - this.startedAtMs;
    const targetFrames = Math.floor(elapsed / FRAME_MS);
    let n = targetFrames - this.framesWritten;
    if (n <= 0) return;
    if (n > MAX_CATCHUP_FRAMES) n = MAX_CATCHUP_FRAMES;
    for (let i = 0; i < n; i++) {
      this.flushFrame();
      this.framesWritten++;
    }
  }

  private flushFrame(forceRest = false): void {
    if (!this.stream || this.closed) return;
    const n = forceRest
      ? Math.max(this.customerQ.length, this.aiQ.length)
      : this.frameSamples;
    if (n === 0) return;
    const out = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
      const l = this.customerQ.shiftOrZero();
      const r = this.aiQ.shiftOrZero();
      out.writeInt16LE(l, i * 4);
      out.writeInt16LE(r, i * 4 + 2);
    }
    const ok = this.stream.write(out);
    this.dataBytes += out.length;
    if (!ok) {
      this.stream.once('drain', () => {});
    }
  }

  async finalize(): Promise<string | null> {
    if (this.closed) return this.dataBytes > 0 ? this.filePath : null;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Catch up any frames still owed to wall-clock before draining leftovers,
    // so finalize never compresses a backlog into a desynced burst at the end.
    if (this.startedAtMs) {
      const targetFrames = Math.floor((Date.now() - this.startedAtMs) / FRAME_MS);
      while (this.framesWritten < targetFrames) {
        this.flushFrame();
        this.framesWritten++;
      }
    }
    this.flushFrame(true);
    const stream = this.stream;
    this.stream = null;
    if (!stream) {
      callLog('ERROR', 'RECORDING FINALIZE SKIPPED: never started');
      return null;
    }

    await new Promise<void>((resolve) => stream.end(() => resolve()));
    try {
      // Prefer measured dataBytes; if that somehow disagrees with the file,
      // rewrite from on-disk size so players never see a 0-length data chunk.
      let dataBytes = this.dataBytes;
      const st = fs.statSync(this.filePath);
      const fromFile = Math.max(0, st.size - 44);
      if (dataBytes <= 0 && fromFile > 0) dataBytes = fromFile;
      else if (fromFile > 0 && Math.abs(fromFile - dataBytes) > 4) dataBytes = fromFile;
      this.dataBytes = dataBytes;
      const fd = fs.openSync(this.filePath, 'r+');
      fs.writeSync(fd, wavHeader(dataBytes, this.sampleRate), 0, 44, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      callLog('RECORDING', 'RECORDING FINALIZED');
      callLog('RECORDING', `RECORDING: ${this.filePath}`);
      return this.filePath;
    } catch (err: any) {
      callLog('ERROR', `RECORDING FINALIZE ERROR: ${err?.message || err}`);
      return this.filePath;
    }
  }
}
