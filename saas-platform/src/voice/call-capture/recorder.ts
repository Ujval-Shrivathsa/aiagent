import fs from 'fs';
import path from 'path';
import { recordingsDir, recordingSampleRate } from './config';
import { callLog } from './logger';

const FRAME_MS = 20;

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

export class CallRecorder {
  readonly filePath: string;
  private stream: fs.WriteStream | null = null;
  private customerQ: number[] = [];
  private aiQ: number[] = [];
  private dataBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private sampleRate: number;
  private frameSamples: number;

  constructor(callId: string) {
    this.sampleRate = recordingSampleRate();
    this.frameSamples = Math.max(1, Math.round(this.sampleRate * (FRAME_MS / 1000)));
    const dir = recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${callId}.wav`);
  }

  start(): boolean {
    if (this.stream) return true;
    try {
      this.stream = fs.createWriteStream(this.filePath);
      this.stream.write(wavHeader(0, this.sampleRate));
      this.timer = setInterval(() => this.flushFrame(), FRAME_MS);
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
      for (let i = 0; i < buf.length; i++) this.customerQ.push(muLawToPcm[buf[i]]);
    } catch (err: any) {
      callLog('ERROR', `AUDIO DECODE ERROR (customer): ${err?.message || err}`);
    }
  }

  appendAiMuLaw(buf: Buffer): void {
    if (this.closed || !this.stream) return;
    try {
      for (let i = 0; i < buf.length; i++) this.aiQ.push(muLawToPcm[buf[i]]);
    } catch (err: any) {
      callLog('ERROR', `AUDIO DECODE ERROR (ai): ${err?.message || err}`);
    }
  }

  private flushFrame(forceRest = false): void {
    if (!this.stream || this.closed) return;
    const n = forceRest
      ? Math.max(this.customerQ.length, this.aiQ.length)
      : this.frameSamples;
    if (n === 0) return;
    if (!forceRest && this.customerQ.length === 0 && this.aiQ.length === 0) {
      // Keep wall-clock duration aligned with the live call.
    }
    const out = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
      const l = this.customerQ.length ? this.customerQ.shift()! : 0;
      const r = this.aiQ.length ? this.aiQ.shift()! : 0;
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
    this.flushFrame(true);
    const stream = this.stream;
    this.stream = null;
    if (!stream) {
      callLog('ERROR', 'RECORDING FINALIZE SKIPPED: never started');
      return null;
    }

    await new Promise<void>((resolve) => stream.end(() => resolve()));
    try {
      const fd = fs.openSync(this.filePath, 'r+');
      fs.writeSync(fd, wavHeader(this.dataBytes, this.sampleRate), 0, 44, 0);
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
