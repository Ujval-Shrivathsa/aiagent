import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoiceEvent } from '../logic';

const CALL_UUID = '12345678-1234-1234-1234-123456789abc';
const STREAM_UUID = '87654321-4321-4321-4321-cba987654321';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The call leg is only hung up through the Plivo REST API, and that is only
 * possible if the start event's call id survives normalisation. Plivo names the
 * field `callId` (NOT `CallUUID`/`callSid`), so reading the wrong keys left the
 * UUID uncaptured and the remote hangup a permanent no-op — the caller stayed
 * on a silent but OPEN line, i.e. "the agent never ends the call".
 */
test('plivo start event: the callId is captured as the hangup CallUUID', () => {
  const msg = normalizeVoiceEvent({
    event: 'start',
    start: {
      callId: CALL_UUID,
      streamId: STREAM_UUID,
      accountId: 'MAXXXXXXXXXXXXXXXXXX',
      tracks: ['inbound'],
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
    },
    extra_headers: 'customerPhone=%2B919876543210',
  });

  assert.equal(msg.start.callUuid, CALL_UUID);
  assert.equal(msg.start.callSid, CALL_UUID);
  assert.equal(msg.start.streamSid, STREAM_UUID);
  assert.equal(msg.start.isPlivo, true);
  // This is exactly the guard the engine applies before trusting the UUID.
  assert.ok(UUID_RE.test(msg.start.callUuid), 'callUuid must be a real UUID for the hangup API');
  // The stream id must NOT be mistaken for the call id.
  assert.notEqual(msg.start.callUuid, STREAM_UUID);
});

test('plivo start event: the hangup UUID is never the stream id by fallback', () => {
  // A start event with no call id must not silently hand the stream id to the
  // hangup API — that 404s and leaves the call open.
  const msg = normalizeVoiceEvent({
    event: 'start',
    start: { streamId: STREAM_UUID },
  });
  assert.equal(msg.start.callUuid, '');
  assert.equal(msg.start.callSid, STREAM_UUID);
});

test('plivo start event: the legacy CallUUID / callSid spellings still work', () => {
  const legacy = normalizeVoiceEvent({ event: 'start', start: { CallUUID: CALL_UUID } });
  assert.equal(legacy.start.callUuid, CALL_UUID);

  const twilio = normalizeVoiceEvent({ event: 'start', start: { callSid: 'CA123' } });
  assert.equal(twilio.start.callUuid, 'CA123');
  assert.equal(twilio.start.isPlivo, false);
});

test('plivo start event: custom parameters still parse from extra_headers', () => {
  const msg = normalizeVoiceEvent({
    event: 'start',
    start: { callId: CALL_UUID, streamId: STREAM_UUID },
    extra_headers: 'customerName=Ravi;customerPhone=%2B919876543210',
  });
  assert.equal(msg.start.customParameters.customerPhone, '+919876543210');
  assert.equal(msg.start.customParameters.customerName, 'Ravi');
});
