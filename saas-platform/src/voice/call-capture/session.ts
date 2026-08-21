import crypto from 'crypto';
import { callLog, timestamp } from './logger';
import { CallRecorder } from './recorder';
import { ConversationLogger } from './conversation-log';
import { CustomerStt } from './stt';

function makeCallId(streamSid?: string | null): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
    `_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const tail = (streamSid || crypto.randomBytes(4).toString('hex')).replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return `call_${stamp}_${tail || crypto.randomBytes(3).toString('hex')}`;
}

function similarUtterance(a: string, b: string): boolean {
  // Space-insensitive: Gemini's output transcription often drops spaces
  // ("thisis Bhoomifrom..."), which must still match the scripted greeting.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export class CallCaptureSession {
  readonly callId: string;
  private recorder: CallRecorder;
  private conversation: ConversationLogger;
  private stt: CustomerStt;
  private startedAt = Date.now();
  private finalized = false;
  private customerSpeaking = false;
  private aiSpeaking = false;
  private lastAiText = '';
  private aiBuffer = '';
  private aiTimer: NodeJS.Timeout | null = null;

  constructor(opts: { streamSid?: string | null; phone: string | null; outbound: boolean }) {
    this.callId = makeCallId(opts.streamSid);
    this.recorder = new CallRecorder(this.callId);
    this.conversation = new ConversationLogger({
      callId: this.callId,
      phone: opts.phone,
      outbound: opts.outbound,
    });
    this.stt = new CustomerStt((text) => this.commitCustomer(text));
    callLog('CALL', `CALL STARTED  id=${this.callId}`);
    callLog('AUDIO', 'AUDIO STREAM CONNECTED');
    this.recorder.start();
  }

  onCustomerMuLaw(buf: Buffer): void {
    this.recorder.appendCustomerMuLaw(buf);
  }

  onAiMuLaw(buf: Buffer): void {
    this.recorder.appendAiMuLaw(buf);
  }

  /** Telephony playback buffer was cleared (interruption) — keep channels in sync. */
  onAiPlaybackCleared(): void {
    this.recorder.clearAiPending();
  }

  /**
   * Customer finished their turn — allow the next AI reply into the recording.
   * Paired with clearAiPending() so late chunks from an interrupted turn never
   * keep writing on the AI channel while the customer is still talking.
   */
  onAiRecordingAllow(): void {
    this.recorder.allowAi();
  }

  onCustomerSpeakStart(): void {
    if (this.customerSpeaking) return;
    this.customerSpeaking = true;
    callLog('CUSTOMER', 'CUSTOMER (speaking...)');
  }

  onCustomerSpeakEnd(): void {
    if (!this.customerSpeaking) return;
    this.customerSpeaking = false;
    // Next AI turn is allowed to be recorded/played again.
    this.recorder.allowAi();
    callLog('CUSTOMER', 'CUSTOMER finished speaking');
  }

  onAiSpeakStart(): void {
    if (this.aiSpeaking) return;
    this.aiSpeaking = true;
    callLog('AI', 'AI started speaking');
  }

  onAiSpeakEnd(): void {
    this.flushAiBuffer();
    if (!this.aiSpeaking) return;
    this.aiSpeaking = false;
    callLog('AI', 'AI finished speaking');
  }

  onAiTurnComplete(): void {
    this.flushAiBuffer();
  }

  onCustomerTranscript(text: string): void {
    try {
      this.stt.ingest(text);
    } catch (err: any) {
      this.stt.notifyError(err?.message || String(err));
    }
  }

  /** Authoritative AI text (e.g. the scripted greeting) — logged as one line. */
  onAiText(text: string): void {
    this.flushAiBuffer();
    this.commitAi(text);
  }

  /**
   * Streaming AI transcript chunks. Gemini emits these a few words at a time,
   * so they are joined into one utterance before printing.
   */
  onAiTranscriptChunk(text: string): void {
    const t = String(text || '');
    if (!t.trim()) return;
    this.aiBuffer += this.aiBuffer && !/\s$/.test(this.aiBuffer) && !/^\s/.test(t) ? ' ' : '';
    this.aiBuffer += t.trim();
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => this.flushAiBuffer(), 900);
  }

  onSttError(message: string): void {
    this.stt.notifyError(message);
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.flushAiBuffer();
    this.stt.close();
    const recordingPath = await this.recorder.finalize();
    this.conversation.setRecordingPath(recordingPath);
    this.conversation.end();
    const seconds = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    callLog('CALL', 'CALL ENDED');
    callLog('DURATION', `CALL DURATION: ${seconds} seconds`);
  }

  private commitCustomer(text: string): void {
    const ts = timestamp();
    callLog('CUSTOMER', `CUSTOMER: ${text}`);
    this.conversation.add('customer', text, ts);
  }

  private flushAiBuffer(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    const buffered = this.aiBuffer.trim();
    this.aiBuffer = '';
    this.commitAi(buffered);
  }

  private commitAi(text: string): void {
    const t = String(text || '').trim();
    if (!t) return;
    if (this.lastAiText && similarUtterance(this.lastAiText, t)) return;
    this.lastAiText = t;
    const ts = timestamp();
    callLog('AI', `AI: ${t}`);
    this.conversation.add('ai', t, ts);
  }
}

export { callLog } from './logger';
