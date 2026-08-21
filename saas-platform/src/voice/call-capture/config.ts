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
  const stack = (process.env.VOICE_STACK || 'sarvam').toLowerCase();
  const explicit = (process.env.STT_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  return stack === 'gemini' ? 'gemini' : 'sarvam';
}

/** Gain applied to the customer channel in the recording (phone audio is quiet). */
export function customerRecordingGain(): number {
  const n = Number(process.env.RECORDING_CUSTOMER_GAIN || 3.5);
  return Number.isFinite(n) && n > 0 ? n : 3.5;
}

/** RMS below this is treated as line noise and ducked in the recording. */
export function customerNoiseGateRms(): number {
  const n = Number(process.env.RECORDING_NOISE_GATE_RMS || 260);
  return Number.isFinite(n) && n >= 0 ? n : 260;
}
