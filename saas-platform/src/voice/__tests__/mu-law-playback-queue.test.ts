import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MuLawPlaybackQueue } from '../sarvam/mu-law-playback-queue';

describe('MuLawPlaybackQueue', () => {
  it('prebuffers before first playAudio send', () => {
    const sent: Buffer[] = [];
    const q = new MuLawPlaybackQueue(
      { onSend: (b) => sent.push(b) },
      { prebufferMs: 80, batchMs: 60, frameBytes: 160 },
    );
    q.push(Buffer.alloc(400, 0xff));
    assert.equal(sent.length, 0);
    q.push(Buffer.alloc(400, 0xff));
    assert.ok(sent.length >= 1);
    assert.equal(sent[0]!.length % 160, 0);
  });

  it('clear drops buffered audio', () => {
    const sent: Buffer[] = [];
    const q = new MuLawPlaybackQueue(
      { onSend: (b) => sent.push(b) },
      { prebufferMs: 200, batchMs: 60, frameBytes: 160 },
    );
    q.push(Buffer.alloc(320, 0xff));
    q.clear();
    q.flush();
    assert.equal(sent.length, 0);
  });
});
