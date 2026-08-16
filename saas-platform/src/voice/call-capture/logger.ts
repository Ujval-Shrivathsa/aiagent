type Icon =
  | 'CALL'
  | 'AUDIO'
  | 'RECORDING'
  | 'CUSTOMER'
  | 'AI'
  | 'STT'
  | 'ERROR'
  | 'SUCCESS'
  | 'RECONNECT'
  | 'DURATION'
  | 'TRANSCRIPT';

const ICONS: Record<Icon, string> = {
  CALL: '📞',
  AUDIO: '🔊',
  RECORDING: '💾',
  CUSTOMER: '👤',
  AI: '🤖',
  STT: '📝',
  ERROR: '❌',
  SUCCESS: '✅',
  RECONNECT: '🔄',
  DURATION: '⏱️',
  TRANSCRIPT: '📁',
};

export function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function callLog(icon: Icon, message: string): void {
  const line = `[${timestamp()}] ${ICONS[icon]} ${message}`;
  if (icon === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}
