import path from 'path';

export function recordingsDir(): string {
  return process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');
}

export function callLogsDir(): string {
  return process.env.CALL_LOGS_DIR || path.resolve(process.cwd(), 'call_logs');
}

export function recordingSampleRate(): number {
  const n = Number(process.env.RECORDING_SAMPLE_RATE || 8000);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

export function sttProvider(): string {
  return (process.env.STT_PROVIDER || 'gemini').toLowerCase();
}
