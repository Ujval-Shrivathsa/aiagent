/**
 * Sarvam Bulbul v3 streaming TTS via textToSpeech.convertStream.
 * Kannada production voice: ishita @ 22050 Hz (user-verified quality).
 *
 * Pipeline architecture (fixes voice breaks):
 *   text queue → prefetch convertStream (max 2 in flight)
 *            → resample 22050 linear16 → 8 kHz µ-law
 *            → MuLawPlaybackQueue (framed + prebuffered playAudio)
 */
import type { SarvamAIClient } from 'sarvamai';
import { Readable } from 'node:stream';
import { pcm16leResampleToMuLaw8k } from './mulaw';
import {
  MuLawPlaybackQueue,
  playbackQueueFromEnv,
} from './mu-law-playback-queue';
import {
  sarvamTtsModel,
  sarvamTtsPace,
  sarvamTtsSampleRate,
  sarvamTtsSpeaker,
  sarvamTtsTemperature,
} from './config';
import { markFirstTtsAudio } from './latency';

export type TtsLanguageCode = 'kn-IN' | 'en-IN';

export type ConvertStreamTtsConfig = {
  language_code: TtsLanguageCode;
  speaker: string;
  model: string;
  pace: number;
  speech_sample_rate: number;
  temperature: number;
};

export function ttsConvertStreamConfig(language: TtsLanguageCode): ConvertStreamTtsConfig {
  return {
    language_code: language,
    speaker: sarvamTtsSpeaker(language),
    model: sarvamTtsModel(),
    pace: sarvamTtsPace(language),
    speech_sample_rate: sarvamTtsSampleRate(),
    temperature: sarvamTtsTemperature(language),
  };
}

export type SpeakPhraseHandlers = {
  /** Legacy direct send — prefer attachPlaybackQueue(). */
  onMuLaw?: (chunk: Buffer) => void;
  onFirstAudio?: () => void;
  signal?: AbortSignal;
};

type QueuedPhrase = {
  text: string;
  language: TtsLanguageCode;
  signal?: AbortSignal;
};

/**
 * Prefetching TTS + framed playback.
 * - One convertStream per phrase (never per token)
 * - While phrase N streams to phone, phrase N+1 can start synthesizing
 * - All audio goes through MuLawPlaybackQueue for gap-free playAudio
 */
export class SarvamConvertStreamPlayer {
  private playback: MuLawPlaybackQueue;
  private phraseQueue: QueuedPhrase[] = [];
  private chain: Promise<void> = Promise.resolve();
  private activeAbort: AbortController | null = null;
  private generation = 0;
  /** Max parallel HTTP synth requests (current + 1 prefetch). */
  private inFlight = 0;
  private readonly maxPrefetch = 2;
  private externalHandlers: SpeakPhraseHandlers = {};

  constructor(private readonly client: SarvamAIClient) {
    this.playback = new MuLawPlaybackQueue(
      {
        onSend: (chunk) => this.externalHandlers.onMuLaw?.(chunk),
        onFirstSend: () => {
          markFirstTtsAudio();
          this.externalHandlers.onFirstAudio?.();
        },
      },
      playbackQueueFromEnv(),
    );
  }

  /** Bind phone send handlers for the session. */
  setHandlers(handlers: SpeakPhraseHandlers): void {
    this.externalHandlers = handlers;
  }

  cancel(): void {
    this.generation++;
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.phraseQueue = [];
    this.inFlight = 0;
    this.chain = Promise.resolve();
    this.playback.clear();
  }

  /** Queue a full phrase/sentence for TTS (not token fragments). */
  speak(text: string, language: TtsLanguageCode, handlers?: SpeakPhraseHandlers): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return this.chain;
    if (handlers) this.externalHandlers = handlers;
    this.phraseQueue.push({
      text: trimmed,
      language,
      signal: handlers?.signal ?? this.externalHandlers.signal,
    });
    this.kickSynth();
    return this.chain;
  }

  whenIdle(): Promise<void> {
    return this.chain.then(() => this.drainPlayback());
  }

  clearPlayback(): void {
    this.playback.clear();
  }

  private kickSynth(): void {
    while (this.inFlight < this.maxPrefetch && this.phraseQueue.length > 0) {
      const item = this.phraseQueue.shift()!;
      const gen = this.generation;
      this.inFlight++;
      this.chain = this.chain.then(async () => {
        try {
          await this.synthesizePhrase(item, gen);
        } finally {
          this.inFlight = Math.max(0, this.inFlight - 1);
          if (gen === this.generation) this.kickSynth();
        }
      });
    }
  }

  private async drainPlayback(): Promise<void> {
    this.playback.flush();
  }

  private async synthesizePhrase(item: QueuedPhrase, gen: number): Promise<void> {
    if (gen !== this.generation || item.signal?.aborted) return;

    const cfg = ttsConvertStreamConfig(item.language);
    const ac = new AbortController();
    this.activeAbort = ac;
    const onExternalAbort = () => ac.abort();
    item.signal?.addEventListener('abort', onExternalAbort, { once: true });

    let pcmLeftover = Buffer.alloc(0);
    const sampleRate = cfg.speech_sample_rate;
    const frameSamplesIn = Math.max(1, Math.round((sampleRate / 8000) * 160));

    try {
      const httpRes = await this.client.textToSpeech.convertStream(
        {
          text: item.text,
          language_code: cfg.language_code,
          speaker: cfg.speaker as any,
          model: cfg.model as any,
          pace: cfg.pace,
          speech_sample_rate: sampleRate as 22050,
          temperature: cfg.temperature,
          enable_preprocessing: true,
          output_audio_codec: 'linear16',
        },
        { abortSignal: ac.signal },
      );

      if (gen !== this.generation) return;

      const bin = (httpRes as any)?.data ?? httpRes;
      const webBody = typeof bin?.stream === 'function' ? bin.stream() : null;
      if (!webBody) {
        console.warn('[SARVAM TTS] convertStream returned no body stream');
        return;
      }

      const nodeStream = Readable.fromWeb(webBody as any);
      for await (const chunk of nodeStream) {
        if (gen !== this.generation || ac.signal.aborted) break;
        const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const combined = pcmLeftover.length ? Buffer.concat([pcmLeftover, raw]) : raw;
        const bytesPerSample = 2;
        const alignBytes = frameSamplesIn * bytesPerSample;
        const usableBytes = combined.length - (combined.length % alignBytes);
        pcmLeftover = combined.subarray(usableBytes);
        const pcm = combined.subarray(0, usableBytes);
        if (pcm.length < 2) continue;

        const muLaw = pcm16leResampleToMuLaw8k(pcm, sampleRate);
        if (muLaw.length) this.playback.push(muLaw);
      }

      if (pcmLeftover.length >= 2 && gen === this.generation && !ac.signal.aborted) {
        const tail = pcm16leResampleToMuLaw8k(pcmLeftover, sampleRate);
        if (tail.length) this.playback.push(tail);
      }
      if (gen === this.generation) this.playback.flush();
    } catch (e: any) {
      if (ac.signal.aborted || /abort/i.test(String(e?.message || e))) return;
      console.error('[SARVAM TTS convertStream]', e?.message || e);
    } finally {
      item.signal?.removeEventListener('abort', onExternalAbort);
      if (this.activeAbort === ac) this.activeAbort = null;
    }
  }
}
