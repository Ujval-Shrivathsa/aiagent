/**
 * Rolling µ-law frame buffer — preserves speech onset during agent playback / barge-in.
 * Plivo sends 20ms frames @ 8 kHz mono µ-law.
 */
export class SttRingBuffer {
  private frames: Buffer[] = [];

  constructor(private readonly maxFrames: number) {}

  push(frame: Buffer): void {
    this.frames.push(Buffer.from(frame));
    while (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  /** Replay buffered frames to STT (e.g. after barge-in so words aren't lost). */
  replay(feed: (frame: Buffer) => void): void {
    for (const frame of this.frames) feed(frame);
  }

  get length(): number {
    return this.frames.length;
  }
}
