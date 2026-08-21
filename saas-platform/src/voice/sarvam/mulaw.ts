/** G.711 µ-law helpers for telephony ↔ PCM. */

const muLawToPcmTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xff;
  const sign = mu & 0x80 ? -1 : 1;
  const exponent = (mu & 0x70) >> 4;
  const data = mu & 0x0f;
  const pcm = ((data << 3) + 132) << exponent;
  muLawToPcmTable[i] = (pcm - 132) * sign;
}

export function muLawByteToPcm(byte: number): number {
  return muLawToPcmTable[byte & 0xff];
}

export function pcmToMuLaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function muLawBufferToPcm16le(muLaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(muLaw.length * 2);
  for (let i = 0; i < muLaw.length; i++) {
    out.writeInt16LE(muLawToPcmTable[muLaw[i]], i * 2);
  }
  return out;
}

export function pcm16leBufferToMuLaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const out = Buffer.allocUnsafe(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = pcmToMuLaw(pcm.readInt16LE(i * 2));
  }
  return out;
}
