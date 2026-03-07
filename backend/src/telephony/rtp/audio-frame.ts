import { mulawToPcm16, pcm16ToMulaw } from './codecs/mulaw.js';

/** Payload type 0 = PCMU (μ-law) */
export const PT_PCMU = 0;

export function decodePcmuToPcm16(pcmuPayload: Buffer): Buffer {
  const out = Buffer.alloc(pcmuPayload.length * 2);
  for (let i = 0; i < pcmuPayload.length; i++) {
    const s = mulawToPcm16(pcmuPayload[i]!);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

export function encodePcm16ToPcmu(pcm16: Buffer): Buffer {
  const samples = Math.floor(pcm16.length / 2);
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    const s = pcm16.readInt16LE(i * 2);
    out[i] = pcm16ToMulaw(s);
  }
  return out;
}

