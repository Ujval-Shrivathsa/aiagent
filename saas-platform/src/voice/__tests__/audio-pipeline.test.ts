/**
 * Unit tests for voice pipeline helpers (no live Gemini / telephony required).
 * Run: npx tsx --test src/voice/__tests__/audio-pipeline.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadAudioPipelineConfig } from '../audio-pipeline-config';
import { buildLiveSpeechConfig, describeSpeechConfig, loadLiveSpeechSettings } from '../tts/speech-config';
import { detectScriptLanguage, isPrimarilyKannada } from '../language/script-detect';
import { evaluateBargeIn, evaluateLocalSpeech } from '../turn-policy';
import {
  analyzePcmFrame,
  classifyFrame,
  createSpeechGateState,
  updateSpeechGate,
  nextNoiseFloorRms,
  DEFAULT_SPEECH_CLASSIFY,
  DEFAULT_SPEECH_GATE,
  DEFAULT_NOISE_FLOOR,
} from '../speech-likelihood';

describe('audio-pipeline-config', () => {
  it('loads the speech-first / sharp-hearing / stability contract', () => {
    const cfg = loadAudioPipelineConfig();
    // Turn-end: 250ms absorbs intra-word Kannada pauses over 8kHz telephony
    // (100ms committed half-spoken turns — the "agent never hears me" bug).
assert.equal(cfg.aadSilenceDurationMs, 250);
assert.equal(cfg.vadSilenceMs, 250);
assert.ok(cfg.vadSilenceMs >= cfg.aadSilenceDurationMs, 'local VAD should outlast AAD');
// Turn-end must stay generous. An aggressive value (60ms) REGRESSED on real
// calls: half-spoken turns produced no transcript, so the agent looped
// "I couldn't hear you" instead of listening.
assert.ok(
  cfg.vadSilenceMs >= 200 && cfg.aadSilenceDurationMs >= 200,
  'turn-end must not be shortened — it breaks transcription on 8kHz telephony',
);
assert.ok(cfg.aadPrefixPaddingMs >= 100, 'prefix padding keeps soft opening syllables');
    // SPEECH-FIRST: a turn starts only after ~60ms of consecutive speech
    // frames — single noisy frames must never fire USER_SPEAKING.
assert.ok(cfg.speechGateStartMs >= 40, 'debounce rejects one-frame noise');
assert.ok(cfg.speechGateStartMs <= 80, 'debounce stays inside the prefix padding (no latency)');
    assert.ok(cfg.speechGateWindowMs >= cfg.speechGateStartMs, 'candidate window forgives one gap');
    // Sharp hearing: quiet speech still clears every threshold — the caller
    // never needs to shout (the floor itself no longer tracks up on speech).
    assert.ok(cfg.gateOpenMinRms <= 100, 'quiet speech gate threshold');
    assert.ok(cfg.vadEnergyMinRms <= 100, 'quiet speech VAD threshold');
    assert.ok(cfg.inputGain >= 2.4, 'full gain to the model — caller never shouts');
    assert.ok(cfg.speechMaxLowEnergyRatio <= 0.9, 'low-band rumble veto (fan/AC/traffic)');
    assert.ok(cfg.speechMaxFlatness <= 0.85, 'flat-spectrum veto (white noise/keyboard)');
    // THE SCREAM-TRAP FIX: speech must not raise the noise floor.
    assert.ok(cfg.floorSpeechRate <= 0.01, 'floor never tracks up under sustained caller speech');
    assert.ok(cfg.floorSteadyRate >= 0.03, 'sustained fan/AC noise converges into the floor fast');
    assert.ok(cfg.floorTransientRate <= 0.02, 'transients (doors, clicks) barely move the floor');
    // Noise immunity: barge-in stays speech-class-gated.
    assert.ok(cfg.bargeInMinRms >= 1700, 'barge-in RMS should ignore background TV');
    assert.equal(cfg.bargeInRequireGateOpen, true);
    // Fast interruption: arms quickly, but speech-class frames only.
    assert.ok(cfg.bargeInMinMs <= 260, 'barge-in arms fast for real speech');
    assert.ok(cfg.gateReleaseMs >= 200);
    // AAD: HIGH sensitivity on both edges — first syllable in, quick commit out.
    assert.match(cfg.aadEndSensitivity, /HIGH|MEDIUM/);
    assert.match(cfg.aadStartSensitivity, /HIGH|MEDIUM/);
    // Recovery budget: stuck-state failsafe fires fast.
    assert.ok(cfg.responseWatchdogMs <= 1400, 'recovery ladder arms quickly');
  });

  it('honours env overrides', () => {
    const prev = process.env.VOICE_AAD_SILENCE_MS;
    process.env.VOICE_AAD_SILENCE_MS = '900';
    try {
      assert.equal(loadAudioPipelineConfig().aadSilenceDurationMs, 900);
    } finally {
      if (prev === undefined) delete process.env.VOICE_AAD_SILENCE_MS;
      else process.env.VOICE_AAD_SILENCE_MS = prev;
    }
  });
});

describe('tts speech-config', () => {
  it('defaults to native auto-detect (no languageCode) for Kannada-first calls', () => {
    const prevLang = process.env.VOICE_TTS_LANGUAGE_CODE;
    const prevVoice = process.env.VOICE_TTS_VOICE_NAME;
    delete process.env.VOICE_TTS_LANGUAGE_CODE;
    delete process.env.VOICE_TTS_VOICE_NAME;
    try {
      const settings = loadLiveSpeechSettings();
      // Kannada is NOT a documented Live locale, so no languageCode is sent.
      assert.equal(settings.languageCode, null);
      assert.equal(settings.voiceName, 'Kore');
      const cfg = buildLiveSpeechConfig(settings);
      assert.equal(cfg.languageCode, undefined, 'no languageCode key is sent');
      assert.equal('languageCode' in cfg, false);
      assert.deepEqual(
        (cfg.voiceConfig as any).prebuiltVoiceConfig.voiceName,
        'Kore'
      );
      assert.match(describeSpeechConfig(settings), /auto/);
    } finally {
      if (prevLang === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prevLang;
      if (prevVoice === undefined) delete process.env.VOICE_TTS_VOICE_NAME;
      else process.env.VOICE_TTS_VOICE_NAME = prevVoice;
    }
  });

  it('normalizes a configured kn-IN to auto, since the API ignores it', () => {
    const prevLang = process.env.VOICE_TTS_LANGUAGE_CODE;
    process.env.VOICE_TTS_LANGUAGE_CODE = 'kn-IN';
    try {
      const settings = loadLiveSpeechSettings();
      assert.equal(settings.languageCode, null);
      assert.equal('languageCode' in buildLiveSpeechConfig(settings), false);
    } finally {
      if (prevLang === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prevLang;
    }
  });

  it('allows forcing en-IN when explicitly configured', () => {
    const prev = process.env.VOICE_TTS_LANGUAGE_CODE;
    process.env.VOICE_TTS_LANGUAGE_CODE = 'en-IN';
    try {
      const settings = loadLiveSpeechSettings();
      assert.equal(settings.languageCode, 'en-IN');
      assert.equal(buildLiveSpeechConfig(settings).languageCode, 'en-IN');
    } finally {
      if (prev === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prev;
    }
  });
});

describe('script-detect', () => {
  it('detects Kannada script and Kanglish without flipping to English', () => {
    assert.equal(detectScriptLanguage('ಸರಿ, ನನಗೆ site ಬೇಕು'), 'kn');
    assert.equal(isPrimarilyKannada('Budget ಎಷ್ಟು ಇಟ್ಟಿದ್ದೀರಿ?'), true);
    assert.equal(detectScriptLanguage('Are you looking for a site?'), 'en');
    assert.equal(detectScriptLanguage('नमस्ते, प्लॉट चाहिए'), 'hi');
  });

  it('covers Kannada sample sentences used for TTS articulation checks', () => {
    const samples = [
      'ಸರಿ, ನಿಮಗೆ construction site ಬೇಕಾ ಅಥವಾ investment site ಬೇಕಾ?',
      'Rate ಸುಮಾರು ಮೂರು ಸಾವಿರದಿಂದ ಮೂರು ಸಾವಿರ ನಾನೂರು per sqft ಇರುತ್ತೆ.',
      'ನಂಜನಗೂಡು ಬಳಿ layout ಇದೆ.',
      'ಸರಿ, ಬೇರೆ ಏನಾದ್ರೂ doubt ಇದ್ರೆ ಕೇಳಿ.',
    ];
    for (const s of samples) {
      assert.equal(detectScriptLanguage(s), 'kn', s);
      assert.equal(isPrimarilyKannada(s), true, s);
    }
  });
});

describe('turn-policy', () => {
  it('does not fire barge-in on a short transient spike', () => {
    const base = {
      now: 1000,
      aiPlaybackEndsAt: 5000,
      rms: 2000,
      bargeInRms: 1400,
      gateOpen: true,
      requireGateOpen: true,
      bargeInStartedAt: null as number | null,
      minHoldMs: 280,
    };
    const arm = evaluateBargeIn(base);
    assert.equal(arm.action, 'arm');
    const tooSoon = evaluateBargeIn({ ...base, now: 1200, bargeInStartedAt: 1000 });
    assert.equal(tooSoon.action, 'none');
    const fire = evaluateBargeIn({ ...base, now: 1300, bargeInStartedAt: 1000 });
    assert.equal(fire.action, 'fire');
  });

  it('does not end a turn on a brief pause under the silence window', () => {
    const arm = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1000,
      silenceStartedAt: null,
      silenceMs: 50,
    });
    assert.equal(arm.event, 'silence_arm');
    const still = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1030,
      silenceStartedAt: 1000,
      silenceMs: 50,
    });
    assert.equal(still.event, 'none');
    const end = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1060,
      silenceStartedAt: 1000,
      silenceMs: 50,
    });
    assert.equal(end.event, 'end');
  });

  it('ignores loud noise when the gate is closed', () => {
    const d = evaluateBargeIn({
      now: 2000,
      aiPlaybackEndsAt: 5000,
      rms: 5000,
      bargeInRms: 1400,
      gateOpen: false,
      requireGateOpen: true,
      bargeInStartedAt: 1000,
      minHoldMs: 280,
    });
    assert.equal(d.action, 'reset');
  });

  it('rejects steady noise but accepts normal and quiet speech', () => {
    // Steady fan/TV-like noise: high RMS, low crest, no harmonic structure.
    assert.equal(
      classifyFrame({ metrics: { rms: 900, peak: 1200, crestFactor: 1.33, zeroCrossRate: 0.01, lowEnergyRatio: 0.9, spectralFlatness: 0.35, periodicity: 0 }, noiseFloorRms: 100, config: DEFAULT_SPEECH_CLASSIFY }),
      'noise',
      'steady low-band hum (fan/AC) — low-band veto',
    );
    // White-noise burst (the old bug: rms≈5000 triggered VAD): flat spectrum
    // AND extreme zero-crossing rate — both vetoes fire before crest helps it.
    assert.equal(
      classifyFrame({ metrics: { rms: 5000, peak: 16000, crestFactor: 3.2, zeroCrossRate: 0.5, lowEnergyRatio: 0.35, spectralFlatness: 0.55, periodicity: 0.13 }, noiseFloorRms: 150, config: DEFAULT_SPEECH_CLASSIFY }),
      'noise',
      'white-noise burst — ZCR + flatness vetoes beat crest',
    );
    // Normal speech: harmonic, voice-band, dynamic.
    assert.equal(
      classifyFrame({ metrics: { rms: 1800, peak: 9000, crestFactor: 5.0, zeroCrossRate: 0.08, lowEnergyRatio: 0.3, spectralFlatness: 0.2, periodicity: 0.65 }, noiseFloorRms: 150, config: DEFAULT_SPEECH_CLASSIFY }),
      'speech',
      'normal speech',
    );
    // Quiet speech: low RMS but speech-shaped.
    assert.equal(
      classifyFrame({ metrics: { rms: 180, peak: 520, crestFactor: 2.9, zeroCrossRate: 0.06, lowEnergyRatio: 0.35, spectralFlatness: 0.25, periodicity: 0.6 }, noiseFloorRms: 100, config: DEFAULT_SPEECH_CLASSIFY }),
      'speech',
      'quiet speech',
    );
    // Below-floor frame is silent regardless of shape.
    assert.equal(
      classifyFrame({ metrics: { rms: 100, peak: 300, crestFactor: 3.0, zeroCrossRate: 0.06, lowEnergyRatio: 0.3, spectralFlatness: 0.2, periodicity: 0.5 }, noiseFloorRms: 100, config: DEFAULT_SPEECH_CLASSIFY }),
      'silent',
      'below-floor frame is silent',
    );
  });

  it('classifies synthetic waveforms end-to-end (analyze → classify)', () => {
    const cfg = DEFAULT_SPEECH_CLASSIFY;
    // 160-sample synthetic fan hum: 120Hz sine + slight noise.
    const fan = new Int16Array(160);
    for (let i = 0; i < 160; i++) fan[i] = Math.round(2000 * Math.sin(2 * Math.PI * 120 * i / 8000));
    assert.equal(classifyFrame({ metrics: analyzePcmFrame(fan, 160), noiseFloorRms: 200, config: cfg }), 'noise', 'synthetic fan hum');
    // White-noise burst. SEEDED, not Math.random(): 160 samples is a short
    // window, and an unlucky draw produced a crest/ZCR profile that classified
    // as speech — failing this test roughly 2 runs in 6 on the unmodified
    // baseline, for reasons unrelated to whatever was under test.
    const hiss = new Int16Array(160);
    let seed = 0x9e3779b9;
    for (let i = 0; i < 160; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const u = (seed >>> 8) / 0x01000000; // 24-bit → [0, 1)
      hiss[i] = Math.round((u * 2 - 1) * 9000);
    }
    assert.equal(classifyFrame({ metrics: analyzePcmFrame(hiss, 160), noiseFloorRms: 150, config: cfg }), 'noise', 'synthetic white-noise burst');
    // Synthetic voiced speech: 180Hz glottal harmonics with amplitude flutter
    // and consonant bursts — classic speech shape on telephony.
    const speech = new Int16Array(160);
    for (let i = 0; i < 160; i++) {
      const t = i / 8000;
      const flutter = 1 + 0.5 * Math.sin(2 * Math.PI * 26 * t);
      const burst = i % 40 < 6 ? 2.5 : 1; // periodic consonant spikes
      speech[i] = Math.round(2600 * flutter * burst * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 540 * t) + 0.3 * Math.sin(2 * Math.PI * 1100 * t)));
    }
    const speechMetrics = analyzePcmFrame(speech, 160);
    assert.equal(classifyFrame({ metrics: speechMetrics, noiseFloorRms: 200, config: cfg }), 'speech', `synthetic speech (flat=${speechMetrics.spectralFlatness.toFixed(2)} low=${speechMetrics.lowEnergyRatio.toFixed(2)})`);
  });

  it('debounces turn START: one noise frame never starts, three speech frames do', () => {
    const cfg = { ...DEFAULT_SPEECH_GATE, frameMs: 20 };
    const speechMetrics = { rms: 1800, peak: 9000, crestFactor: 5.0, zeroCrossRate: 0.08, lowEnergyRatio: 0.3, spectralFlatness: 0.2 };
    const noiseMetrics = { rms: 5000, peak: 16000, crestFactor: 3.2, zeroCrossRate: 0.5, lowEnergyRatio: 0.35, spectralFlatness: 0.92 };
    let state = createSpeechGateState();
    // One speech frame + one loud noise frame — must NOT start.
    let d = updateSpeechGate({ state, frameClass: 'speech', now: 1000, config: cfg });
    state = d.state;
    d = updateSpeechGate({ state, frameClass: 'noise', now: 1020, config: cfg });
    state = d.state;
    assert.equal(d.event, 'none');
    assert.equal(state.speaking, false);
    // Three consecutive speech frames — START on the third (60ms).
    state = createSpeechGateState();
    d = updateSpeechGate({ state, frameClass: 'speech', now: 1000, config: cfg });
    state = d.state;
    assert.equal(d.event, 'none');
    d = updateSpeechGate({ state, frameClass: 'speech', now: 1020, config: cfg });
    state = d.state;
    assert.equal(d.event, 'none');
    d = updateSpeechGate({ state, frameClass: 'speech', now: 1040, config: cfg });
    state = d.state;
    assert.equal(d.event, 'start');
    assert.equal(state.speaking, true);
    // Inside a turn, ambiguous frames keep the turn (no re-start event).
    d = updateSpeechGate({ state, frameClass: 'ambiguous', now: 1060, config: cfg });
    assert.equal(d.event, 'none');
    void speechMetrics; void noiseMetrics;
  });

  it('noise-floor: speech never raises it, steady noise converges, transient barely moves it', () => {
    const speechM = { rms: 3000, peak: 12000, crestFactor: 4, zeroCrossRate: 0.08, lowEnergyRatio: 0.3, spectralFlatness: 0.2, periodicity: 0.6 };
    const steadyM = { rms: 900, peak: 1100, crestFactor: 1.2, zeroCrossRate: 0.01, lowEnergyRatio: 0.9, spectralFlatness: 0.35, periodicity: 0 };
    const transientM = { rms: 6000, peak: 20000, crestFactor: 3.3, zeroCrossRate: 0.45, lowEnergyRatio: 0.4, spectralFlatness: 0.85, periodicity: 0 };
    // Speech never drags the floor up (the scream-trap fix).
    let floor = 150;
    for (let i = 0; i < 500; i++) floor = nextNoiseFloorRms(floor, speechM, 'speech', false, DEFAULT_NOISE_FLOOR, 0);
    assert.ok(floor < 200, `floor stayed low under speech (got ${floor.toFixed(0)})`);
    // Sustained fan/AC noise (steady signature held 160ms+) converges fast.
    floor = 150;
    for (let i = 0; i < 50; i++) floor = nextNoiseFloorRms(floor, steadyM, 'noise', false, DEFAULT_NOISE_FLOOR, 100);
    assert.ok(floor > 500, `floor tracked sustained noise up (got ${floor.toFixed(0)})`);
    // A single-frame flat burst is a TRANSIENT — must not spike the floor.
    floor = 150;
    floor = nextNoiseFloorRms(floor, transientM, 'noise', false, DEFAULT_NOISE_FLOOR, 0);
    assert.ok(floor < 220, `transient did not spike the floor (got ${floor.toFixed(0)})`);
    // Clamped to the configured range.
    floor = nextNoiseFloorRms(740, steadyM, 'noise', false, DEFAULT_NOISE_FLOOR, 100);
    assert.ok(floor <= DEFAULT_NOISE_FLOOR.max, 'floor respects max clamp');
  });
});
