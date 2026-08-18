import fs from 'fs';
import path from 'path';
import { callLogsDir, recordingsDir } from '@/voice/call-capture/config';
import type { ConversationFile } from '@/voice/call-capture/conversation-log';

export type RecordingListItem = {
  callId: string;
  phone: string | null;
  outbound: boolean;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  turnCount: number;
  hasAudio: boolean;
};

const CALL_ID_RE = /^call_[0-9]{8}_[0-9]{6}_[a-zA-Z0-9]+$/;

export function isValidCallId(id: string): boolean {
  return CALL_ID_RE.test(id);
}

function phoneTail(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

export function listRecordings(opts?: { phone?: string }): RecordingListItem[] {
  const dir = callLogsDir();
  if (!fs.existsSync(dir)) return [];

  const filterTail = opts?.phone ? phoneTail(opts.phone) : '';
  const items: RecordingListItem[] = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const callId = file.replace(/\.json$/, '');
    if (!isValidCallId(callId)) continue;

    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const data = JSON.parse(raw) as ConversationFile;
      if (filterTail && phoneTail(data.phone) !== filterTail) continue;

      const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
      const ended = data.ended_at ? new Date(data.ended_at).getTime() : NaN;
      const durationSec =
        Number.isFinite(started) && Number.isFinite(ended)
          ? Math.max(0, Math.round((ended - started) / 1000))
          : null;

      const wavPath = path.join(recordingsDir(), `${callId}.wav`);
      items.push({
        callId: data.call_id || callId,
        phone: data.phone,
        outbound: Boolean(data.outbound),
        startedAt: data.started_at,
        endedAt: data.ended_at,
        durationSec,
        turnCount: data.conversation?.length ?? 0,
        hasAudio: fs.existsSync(wavPath),
      });
    } catch {
      // skip corrupt logs
    }
  }

  return items.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function getRecording(callId: string): ConversationFile | null {
  if (!isValidCallId(callId)) return null;
  const filePath = path.join(callLogsDir(), `${callId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ConversationFile;
  } catch {
    return null;
  }
}

export function getAudioFilePath(callId: string): string | null {
  if (!isValidCallId(callId)) return null;
  const wavPath = path.join(recordingsDir(), `${callId}.wav`);
  return fs.existsSync(wavPath) ? wavPath : null;
}
