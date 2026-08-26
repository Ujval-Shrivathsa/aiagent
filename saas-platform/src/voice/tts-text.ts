/**
 * Speech-ready text helpers (Kannada Kanglish spacing, number/dimension normalization).
 * Used by tests and any post-processing of model text before playback.
 */

import { normalizeSpokenNumbers } from './spoken-pricing';

/** Strip generic AI / call-center boilerplate before TTS. */
export function stripAiBoilerplate(raw: string, language: 'kn-IN' | 'en-IN'): string {
  let text = raw;
  const en = [
    /^(Certainly!?|Absolutely!?|Of course!?|Sure thing!?)[\s,]*/gi,
    /\bI understand your concern\.?\s*/gi,
    /\bI(?:'d| would) be happy to assist(?: you)?\.?\s*/gi,
    /\bPlease be advised that\s*/gi,
    /\bThank you for (?:your question|reaching out)\.?\s*/gi,
    /\bHow may I assist you(?: today)?\??\s*/gi,
  ];
  const kn = [
    'ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು',
    'ದಯವಿಟ್ಟು ನಿರೀಕ್ಷಿಸಿ',
    'ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ',
    'ಕೃಪೆಮಾಡಿ',
  ];
  if (language === 'en-IN') {
    for (const re of en) text = text.replace(re, '');
  } else {
    for (const phrase of kn) text = text.split(phrase).join('');
  }
  return text.replace(/^\s+[,.\-–—]+\s*/, '').trim();
}

/** Soften common textbook / formal Kannada into everyday spoken Mysuru forms. */
export function softenTextbookKannada(raw: string): string {
  let text = raw;
  const regexSwaps: Array<[RegExp, string]> = [
    [/ತಾವು/g, 'ನೀವು'],
    [/ತಮ್ಮ/g, 'ನಿಮ್ಮ'],
    [/ತಿಳಿಸಬಹುದೇ/g, 'ಹೇಳ್ತೀರಾ'],
    [/ತಿಳಿಸಬಹುದು/g, 'ಹೇಳಬಹುದು'],
    [/ಇಚ್ಛಿಸುತ್ತೀರಾ/g, 'ಬೇಕಾ'],
    [/ಇಚ್ಛಿಸುತ್ತೀರಿ/g, 'ಬೇಕಾ'],
    [/ಕೃಪೆಮಾಡಿ/g, ''],
    [/ಆಸಕ್ತಿ ಹೊಂದಿದ್ದೀರಾ/g, 'ನೋಡ್ತಿದ್ದೀರಾ'],
    [/ಆಸಕ್ತಿ ಹೊಂದಿದ್ದೀರಿ/g, 'ನೋಡ್ತಿದ್ದೀರಾ'],
    [/ಭೇಟಿ ನಿಗದಿಪಡಿಸಬಹುದು/g, 'visit fix ಮಾಡಬಹುದು'],
    [/ಭೇಟಿ ನಿಗದಿಪಡಿಸಬಹುದೇ/g, 'visit fix ಮಾಡೋಣವಾ'],
    [/ಅಮೂಲ್ಯ ಸಮಯ/g, 'ಸಮಯ'],
    [/ಪ್ರತಿಷ್ಠಿತ/g, ''],
    [/ಅನುಗುಣವಾಗಿ/g, ''],
    [/ಸೂಕ್ತವಾದ/g, ''],
    [/ಸಂದೇಹ/g, 'doubt'],
    [/ಉದ್ದೇಶ/g, ''],
  ];
  const literalSwaps: Array<[string, string]> = [
    ['ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು', ''],
    ['ದಯವಿಟ್ಟು ನಿರೀಕ್ಷಿಸಿ', 'ಒಂದು ನಿಮಿಷ'],
    ['ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ', 'ಅರ್ಥ ಆಯ್ತು'],
    ['ಮಾಡಿಕೊಂಡಿದ್ದೇನೆ', 'ಮಾಡ್ತೀನಿ'],
    ['ನೀಡುತ್ತೇವೆ', 'ಹೇಳ್ತೀನಿ'],
    ['ಪ್ರಸ್ತುತವಾಗಿ', ''],
  ];
  for (const [re, to] of regexSwaps) text = text.replace(re, to);
  for (const [from, to] of literalSwaps) text = text.split(from).join(to);
  return text.replace(/\s{2,}/g, ' ').trim();
}

export function prepareTtsText(raw: string, language: 'kn-IN' | 'en-IN'): string {
  let text = stripAiBoilerplate((raw || '').replace(/\s+/g, ' ').trim(), language);
  if (!text) return '';
  text = normalizeSpokenNumbers(text, language);

  if (language === 'en-IN') {
    text = text.replace(/[।]+/g, '.');
    text = text.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
    text = text.replace(/\.{2,}/g, '.');
    text = text.replace(/\s+([,.!?;:])/g, '$1');
    text = text.replace(/([,.!?;:])(?=[A-Za-z])/g, '$1 ');
    return text.replace(/\s+/g, ' ').trim();
  }

  text = softenTextbookKannada(text);
  text = text.replace(/[।]+/g, '.');
  text = text.replace(/[…]+/g, '.');
  text = text.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/,{2,}/g, ',');
  text = text.replace(/([\u0C80-\u0CFF])([A-Za-z0-9])/g, '$1 $2');
  text = text.replace(/([A-Za-z0-9])([\u0C80-\u0CFF])/g, '$1 $2');
  text = text.replace(/\s+([,.!?])/g, '$1');
  text = text.replace(/([,.!?])(?=[\u0C80-\u0CFFA-Za-z])/g, '$1 ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Split streaming LLM text into speakable phrases (sentence boundaries).
 */
export function takeSpeakableChunks(
  buffer: string,
  opts?: {
    allowEarlyPhrase?: boolean;
    earlyMinChars?: number;
    minPhraseChars?: number;
    kannadaSafe?: boolean;
  },
): { ready: string[]; rest: string } {
  const allowEarly = opts?.allowEarlyPhrase === true;
  const earlyMin = opts?.earlyMinChars ?? 32;
  const minPhrase = opts?.minPhraseChars ?? 24;
  const knSafe = opts?.kannadaSafe !== false;
  const ready: string[] = [];
  let rest = buffer;

  const re = /[.!?।\n]+[\s]*/g;
  let match: RegExpExecArray | null;
  let last = 0;
  let pendingShort = '';
  while ((match = re.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const piece = buffer.slice(last, end).trim();
    if (piece) {
      const merged = pendingShort ? `${pendingShort} ${piece}`.trim() : piece;
      if (merged.length >= minPhrase) {
        ready.push(merged);
        pendingShort = '';
      } else {
        pendingShort = merged;
      }
    }
    last = end;
  }
  rest = pendingShort ? `${pendingShort} ${buffer.slice(last)}`.trim() : buffer.slice(last);

  if (ready.length === 0 && allowEarly && rest.trim().length >= earlyMin) {
    const window = rest.slice(0, Math.min(rest.length, 120));
    let cut = -1;
    for (let i = window.length - 1; i >= earlyMin; i--) {
      const ch = window[i];
      if (/\s/.test(ch)) {
        cut = i;
        break;
      }
      if (!knSafe && (ch === ',' || ch === '،') && i >= earlyMin + 8) {
        cut = i;
        break;
      }
    }
    if (cut >= earlyMin) {
      const phrase = rest.slice(0, cut).trim();
      if (phrase.length >= minPhrase) {
        ready.push(phrase);
        rest = rest.slice(cut).replace(/^\s+/, '');
      }
    }
  }

  return { ready, rest };
}
