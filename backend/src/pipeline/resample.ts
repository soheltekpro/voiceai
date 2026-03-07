/**
 * Resample PCM 16-bit mono to 16kHz for Whisper.
 * Simple linear interpolation; good enough for voice.
 */

const TARGET_RATE = 16000;

export function resampleTo16k(pcmBuffer: Buffer, sourceSampleRate: number): Buffer {
  if (sourceSampleRate === TARGET_RATE) return pcmBuffer;

  const numSamples = pcmBuffer.length / 2; // 16-bit = 2 bytes per sample
  const ratio = sourceSampleRate / TARGET_RATE;
  const outLength = Math.floor(numSamples / ratio) * 2;
  const out = Buffer.alloc(outLength);

  for (let i = 0; i < outLength / 2; i++) {
    const srcIndex = i * ratio;
    const idx0 = Math.floor(srcIndex);
    const idx1 = Math.min(idx0 + 1, numSamples - 1);
    const frac = srcIndex - idx0;
    const s0 = pcmBuffer.readInt16LE(idx0 * 2);
    const s1 = pcmBuffer.readInt16LE(idx1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}
