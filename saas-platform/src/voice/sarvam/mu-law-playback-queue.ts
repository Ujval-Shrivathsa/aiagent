/**
 * Continuous µ-law playback for Plivo playAudio.
 *
 * Root-cause fix for voice breaks:
 * - Aligns audio to 20 ms telephony frames (160 bytes @ 8 kHz)
 * - Pre-buffers before first send (avoids startup underrun)
 * - Batches frames into steady playAudio messages (avoids micro-chunk jitter)
 * - Single ordered drain — never overlapping playAudio streams
 */

export type MuLawPlaybackHandlers = {
  onSend: (muLaw: Buffer) => void;
  onFirstSend?: () => void;
  onUnderrun?: (remainingMs: number) => void;
};

export type MuLawPlaybackQueueOptions = {
  /** Bytes per 20 ms frame at 8 kHz µ-law (default 160). */
  frameBytes?: number;
  /** Pre-buffer this many ms before the first playAudio (default 80). */
  prebufferMs?: number;
  /** Batch this many ms per playAudio message (default 60). */
  batchMs?: number;
};

const DEFAULT_FRAME_BYTES = 160;
const DEFAULT_PREBUFFER_MS = 80;
const DEFAULT_BATCH_MS = 60;

export class MuLawPlaybackQueue {
  private readonly frameBytes: number;
  private readonly prebufferBytes: number;
  private readonly batchBytes: number;
  private buffer = Buffer.alloc(0);
  private generation = 0;
  private started = false;
  private loggedFirst = false;
  private bytesSent = 0;

  constructor(
    private readonly handlers: MuLawPlaybackHandlers,
    opts?: MuLawPlaybackQueueOptions,
  ) {
    const frameBytes = opts?.frameBytes ?? DEFAULT_FRAME_BYTES;
    this.frameBytes = frameBytes;
    const prebufferMs = opts?.prebufferMs ?? DEFAULT_PREBUFFER_MS;
    const batchMs = opts?.batchMs ?? DEFAULT_BATCH_MS;
    this.prebufferBytes = Math.max(frameBytes, Math.round((prebufferMs / 20) * frameBytes));
    this.batchBytes = Math.max(frameBytes, Math.round((batchMs / 20) * frameBytes));
  }

  /** Append resampled µ-law; drains when prebuffer + batch thresholds are met. */
  push(muLaw: Buffer): void {
    if (!muLaw.length) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, muLaw]) : Buffer.from(muLaw);
    this.drain(false);
  }

  /** Flush partial frames at end of a TTS stream. */
  flush(): void {
    this.drain(true);
  }

  /** Immediately stop playback and discard all buffered audio. */
  clear(): void {
    this.generation++;
    this.buffer = Buffer.alloc(0);
    this.started = false;
    this.loggedFirst = false;
    this.bytesSent = 0;
  }

  /** Bytes still waiting to be sent (for underrun diagnostics). */
  bufferedBytes(): number {
    return this.buffer.length;
  }

  /** Approx ms of audio already sent to Plivo. */
  sentDurationMs(): number {
    return this.bytesSent / 8;
  }

  private drain(flush: boolean): void {
    const gen = this.generation;
    if (gen !== this.generation) return;

    // Trim to whole 20 ms frames only (except final flush pads last frame).
    let usable = this.buffer.length - (this.buffer.length % this.frameBytes);
    if (flush && this.buffer.length > 0 && usable < this.buffer.length) {
      const pad = this.frameBytes - (this.buffer.length % this.frameBytes);
      const last = this.buffer[this.buffer.length - 1] ?? 0xff;
      this.buffer = Buffer.concat([this.buffer, Buffer.alloc(pad, last)]);
      usable = this.buffer.length;
    }
    if (usable < this.frameBytes) return;

    if (!this.started) {
      if (!flush && usable < this.prebufferBytes) return;
      this.started = true;
    }

    while (usable >= this.batchBytes || (flush && usable >= this.frameBytes)) {
      if (gen !== this.generation) return;
      const take = flush ? usable : Math.min(usable, this.batchBytes);
      const chunk = this.buffer.subarray(0, take);
      this.buffer = this.buffer.subarray(take);
      usable = this.buffer.length - (this.buffer.length % this.frameBytes);

      if (!this.loggedFirst) {
        this.loggedFirst = true;
        this.handlers.onFirstSend?.();
      }
      this.handlers.onSend(chunk);
      this.bytesSent += chunk.length;
    }
  }
}

export function playbackQueueFromEnv(): MuLawPlaybackQueueOptions {
  const prebufferMs = Number(process.env.VOICE_PLAYBACK_PREBUFFER_MS || DEFAULT_PREBUFFER_MS);
  const batchMs = Number(process.env.VOICE_PLAYBACK_BATCH_MS || DEFAULT_BATCH_MS);
  return {
    prebufferMs: Number.isFinite(prebufferMs) ? prebufferMs : DEFAULT_PREBUFFER_MS,
    batchMs: Number.isFinite(batchMs) ? batchMs : DEFAULT_BATCH_MS,
  };
}
