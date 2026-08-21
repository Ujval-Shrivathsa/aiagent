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

describe('audio-pipeline-config', () => {
  it('loads tolerant defaults for pauses and barge-in', () => {
    const cfg = loadAudioPipelineConfig();
    assert.ok(cfg.aadSilenceDurationMs >= 500, 'AAD silence should tolerate short pauses');
    assert.ok(cfg.vadSilenceMs >= 600, 'local VAD silence should tolerate hesitations');
    assert.ok(cfg.bargeInMinMs >= 200, 'barge-in hold should ignore transient spikes');
    assert.ok(cfg.bargeInMinRms >= 1000, 'barge-in RMS should sit above casual noise');
    assert.equal(cfg.bargeInRequireGateOpen, true);
    assert.ok(cfg.gateReleaseMs >= 400);
    assert.ok(cfg.gateFloor <= 0.2, 'closed gate should duck background into Gemini');
    assert.match(cfg.aadEndSensitivity, /LOW|MEDIUM/);
    assert.match(cfg.aadStartSensitivity, /LOW|MEDIUM/);
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
  it('defaults to kn-IN for Kannada-first openings', () => {
    const prevLang = process.env.VOICE_TTS_LANGUAGE_CODE;
    const prevVoice = process.env.VOICE_TTS_VOICE_NAME;
    delete process.env.VOICE_TTS_LANGUAGE_CODE;
    delete process.env.VOICE_TTS_VOICE_NAME;
    try {
      const settings = loadLiveSpeechSettings();
      assert.equal(settings.languageCode, 'kn-IN');
      assert.equal(settings.voiceName, 'Kore');
      const cfg = buildLiveSpeechConfig(settings);
      assert.equal(cfg.languageCode, 'kn-IN');
      assert.deepEqual(
        (cfg.voiceConfig as any).prebuiltVoiceConfig.voiceName,
        'Kore'
      );
      assert.match(describeSpeechConfig(settings), /kn-IN/);
    } finally {
      if (prevLang === undefined) delete process.env.VOICE_TTS_LANGUAGE_CODE;
      else process.env.VOICE_TTS_LANGUAGE_CODE = prevLang;
      if (prevVoice === undefined) delete process.env.VOICE_TTS_VOICE_NAME;
      else process.env.VOICE_TTS_VOICE_NAME = prevVoice;
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
      'ಸರಿ, ನಿಮಗೆ site ಬೇಕಾ construction ಗೋಸ್ಕರ ಅಥವಾ investment ಗೋಸ್ಕರ?',
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

  it('does not end a turn on a brief pause under the silence window', () => {
    const arm = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1000,
      silenceStartedAt: null,
      silenceMs: 800,
    });
    assert.equal(arm.event, 'silence_arm');
    const still = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1500,
      silenceStartedAt: 1000,
      silenceMs: 800,
    });
    assert.equal(still.event, 'none');
    const end = evaluateLocalSpeech({
      vadIsSpeaking: true,
      speechEnergy: false,
      now: 1900,
      silenceStartedAt: 1000,
      silenceMs: 800,
    });
    assert.equal(end.event, 'end');
  });
});
