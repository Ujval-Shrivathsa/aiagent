function parseHeaderBag(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  const str = raw?.extra_headers || raw?.extraHeaders;
  if (typeof str === 'string' && str.trim()) {
    for (const pair of str.split(/[;,]/)) {
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  } else if (str && typeof str === 'object') {
    for (const [k, v] of Object.entries(str)) out[k] = String(v ?? '');
  }
  return out;
}

/** Normalize Plivo & Twilio WebSocket events to one internal format. */
export function normalizeVoiceEvent(raw: any): any {
  const evt: string = raw.event || raw.type || 'media';
  const result: any = { event: evt };

  if (evt === 'start') {
    const start = raw.start || raw.Start || raw;
    const streamId =
      start.streamSid ||
      start.streamId ||
      start.CallUUID ||
      start.callUuid ||
      start.callSid ||
      start.stream_sid;
    const params =
      start.customParameters ||
      start.CustomParameters ||
      start.extraHeaders ||
      start.extra_headers ||
      start.Parameters ||
      {};
    const objectParams = typeof params === 'string' ? parseHeaderBag({ extra_headers: params }) : params || {};
    const mergedParams = { ...parseHeaderBag(raw), ...objectParams, ...(raw.parameters || {}) };
    result.start = {
      streamSid: streamId,
      callSid: start.callSid || start.callId || start.CallUUID || start.callUuid || streamId,
      customParameters: mergedParams,
      isPlivo: Boolean(raw.extra_headers != null || start.streamId || start.callId),
    };
    return result;
  }

  if (evt === 'media' || evt === 'Media') {
    const media = raw.media || raw.Media || raw;
    result.media = {
      track: media.track || media.Track || raw.track || 'inbound',
      chunk: media.chunk || media.Chunk || raw.chunk || '0',
      timestamp: media.timestamp || media.Timestamp || raw.timestamp || Date.now(),
      payload: media.payload || media.Payload || raw.payload || '',
      contentType: media.contentType || media.content_type || 'audio/x-mulaw',
      sampleRate: media.sampleRate || media.sample_rate || 8000,
    };
    return result;
  }

  if (evt === 'stop' || evt === 'Stop' || evt === 'close' || evt === 'Close') {
    const stop = raw.stop || raw.Stop || raw;
    result.stop = {
      streamSid: stop.streamSid || stop.streamId || stop.CallUUID || stop.callSid || '',
      callSid: stop.callSid || stop.CallUUID || stop.callUuid || '',
    };
    result.event = 'stop';
    return result;
  }

  if (evt === 'connect' || evt === 'Connect') {
    return { event: 'connect', protocol: raw.protocol || raw.Protocol || '' };
  }

  return { ...raw, event: evt };
}
