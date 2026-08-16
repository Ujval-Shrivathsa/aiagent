import { callLog } from './logger';
import { sttProvider } from './config';

/**
 * Streaming STT adapter. Live customer text currently comes from Gemini Live
 * `inputAudioTranscription` (already on the call). Swap `STT_PROVIDER` later
 * without changing the call audio path.
 */
export class CustomerStt {
  private pending = '';
  private lastFinal = '';
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private onFinal: (text: string) => void;

  constructor(onFinal: (text: string) => void) {
    this.onFinal = onFinal;
    callLog('STT', `STT PROVIDER: ${sttProvider()}`);
  }

  ingest(text: string): void {
    if (this.closed) return;
    const t = String(text || '').trim();
    if (!t) return;
    if (t === this.lastFinal) return;

    if (this.lastFinal && t.startsWith(this.lastFinal) === false && this.lastFinal.startsWith(t) === false) {
      this.flush();
    }

    this.pending = t;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 550);
  }

  notifyError(message: string): void {
    callLog('ERROR', `STT ERROR: ${message}`);
    callLog('RECONNECT', 'Attempting STT reconnect... (Gemini session stays on the call)');
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.flush();
  }

  private flush(): void {
    const t = this.pending.trim();
    this.pending = '';
    if (!t || t === this.lastFinal) return;
    if (this.lastFinal && this.lastFinal.startsWith(t) && t.length < this.lastFinal.length) return;
    this.lastFinal = t;
    this.onFinal(t);
  }
}
