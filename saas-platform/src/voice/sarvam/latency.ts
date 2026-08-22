/**

 * End-to-end voice turn latency — log in dev to find bottlenecks.

 */



export type TurnLatency = {

  /** chatTurn() entry (after STT final received). */

  turnStart: number;

  /** STT endpoint / user stopped speaking (if known). */

  speechEndMs?: number;

  /** Final transcript received. */

  sttFinalMs?: number;

  /** First LLM token. */

  firstTokenMs?: number;

  /** First TTS chunk enqueued. */

  firstTtsEnqueueMs?: number;

  /** First µ-law sent to phone. */

  firstPlayoutMs?: number;

};



export function markSpeechEnd(lat: TurnLatency, speechEndAt: number): void {

  if (lat.speechEndMs != null) return;

  lat.speechEndMs = Math.max(0, speechEndAt - lat.turnStart);

}



export function markSttFinal(lat: TurnLatency): void {

  if (lat.sttFinalMs != null) return;

  lat.sttFinalMs = Date.now() - lat.turnStart;

}



export function markFirstToken(lat: TurnLatency): void {

  if (lat.firstTokenMs != null) return;

  lat.firstTokenMs = Date.now() - lat.turnStart;

}



export function markFirstTtsAudio(): void {
  /* hook for external latency trackers */
}

export function markFirstTtsEnqueue(lat: TurnLatency): void {

  if (lat.firstTtsEnqueueMs != null) return;

  lat.firstTtsEnqueueMs = Date.now() - lat.turnStart;

}



export function markFirstPlayout(lat: TurnLatency): void {

  if (lat.firstPlayoutMs != null) return;

  lat.firstPlayoutMs = Date.now() - lat.turnStart;

}



export function logTurnLatency(lat: TurnLatency, extra?: string): void {

  const e2e =

    lat.speechEndMs != null && lat.firstPlayoutMs != null

      ? `e2e_speech→audio=${lat.firstPlayoutMs - lat.speechEndMs}ms`

      : null;

  const parts = [

    `speech_end=${lat.speechEndMs ?? '-'}ms`,

    `stt=${lat.sttFinalMs ?? '-'}ms`,

    `ttft=${lat.firstTokenMs ?? '-'}ms`,

    `tts_q=${lat.firstTtsEnqueueMs ?? '-'}ms`,

    `play=${lat.firstPlayoutMs ?? '-'}ms`,

    `done=${Date.now() - lat.turnStart}ms`,

  ];

  if (e2e) parts.push(e2e);

  if (extra) parts.push(extra);

  console.log(`[VOICE LATENCY] ${parts.join(' ')}`);

}


