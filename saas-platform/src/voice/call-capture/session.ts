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
  const na = a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

  onCustomerSpeakStart(): void {
    if (this.customerSpeaking) return;
    this.customerSpeaking = true;
    callLog('CUSTOMER', 'CUSTOMER (speaking...)');
  }

  onCustomerSpeakEnd(): void {
    if (!this.customerSpeaking) return;
    this.customerSpeaking = false;
    callLog('CUSTOMER', 'CUSTOMER finished speaking');
  }

  onAiSpeakStart(): void {
    if (this.aiSpeaking) return;
    this.aiSpeaking = true;
    callLog('AI', 'AI started speaking');
  }

  onAiSpeakEnd(): void {
    if (!this.aiSpeaking) return;
    this.aiSpeaking = false;
    callLog('AI', 'AI finished speaking');
  }

  onCustomerTranscript(text: string): void {
    try {
      this.stt.ingest(text);
    } catch (err: any) {
      this.stt.notifyError(err?.message || String(err));
    }
  }

  onAiText(text: string): void {
    const t = String(text || '').trim();
    if (!t) return;
    if (this.lastAiText && similarUtterance(this.lastAiText, t)) return;
    this.lastAiText = t;
    const ts = timestamp();
    callLog('AI', `AI: ${t}`);
    this.conversation.add('ai', t, ts);
  }

  onSttError(message: string): void {
    this.stt.notifyError(message);
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
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
}

export { callLog } from './logger';
