import fs from 'fs';
import path from 'path';
import { callLogsDir } from './config';
import { callLog } from './logger';

export type Speaker = 'customer' | 'ai';

export type ConversationTurn = {
  speaker: Speaker;
  text: string;
  timestamp: string;
};

export type ConversationFile = {
  call_id: string;
  started_at: string;
  ended_at: string | null;
  recording_path: string | null;
  phone: string | null;
  outbound: boolean;
  conversation: ConversationTurn[];
};

export class ConversationLogger {
  readonly filePath: string;
  private data: ConversationFile;

  constructor(opts: { callId: string; phone: string | null; outbound: boolean }) {
    const dir = callLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${opts.callId}.json`);
    this.data = {
      call_id: opts.callId,
      started_at: new Date().toISOString(),
      ended_at: null,
      recording_path: null,
      phone: opts.phone,
      outbound: opts.outbound,
      conversation: [],
    };
    this.flush();
  }

  add(speaker: Speaker, text: string, timestamp: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.data.conversation.push({ speaker, text: trimmed, timestamp });
    this.flush();
  }

  setRecordingPath(p: string | null): void {
    this.data.recording_path = p;
    this.flush();
  }

  end(): string {
    this.data.ended_at = new Date().toISOString();
    this.flush();
    callLog('TRANSCRIPT', `TRANSCRIPT: ${this.filePath}`);
    return this.filePath;
  }

  private flush(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err: any) {
      callLog('ERROR', `CONVERSATION LOG WRITE FAILURE: ${err?.message || err}`);
    }
  }
}
