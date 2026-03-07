/**
 * Speech-to-Text using OpenAI Whisper.
 * Input: PCM buffer 16kHz mono 16-bit (raw).
 * We build a WAV, write to a temp file, and pass createReadStream so the SDK sends multipart file correctly.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function transcribe(pcmBuffer: Buffer): Promise<string> {
  const wav = createWavFromPcm(pcmBuffer, 16000);
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.promises.writeFile(tmpPath, wav);
  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: config.openai.sttModel,
      language: 'en',
    });
    return (response.text ?? '').trim();
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/** Build a minimal WAV file from 16-bit mono PCM */
function createWavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);
  let offset = 0;

  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(fileSize - 8, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4; // chunk size
  header.writeUInt16LE(1, offset); offset += 2;  // PCM
  header.writeUInt16LE(numChannels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), offset); offset += 2;
  header.writeUInt16LE(bitsPerSample, offset); offset += 2;
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);

  return Buffer.concat([header, pcm]);
}
