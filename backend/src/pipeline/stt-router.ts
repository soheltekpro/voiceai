/**
 * STT router: OpenAI Whisper, Deepgram, AssemblyAI.
 * Input: PCM 16kHz mono 16-bit buffer. Returns { text }.
 * Empty provider defaults to openai.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config.js';
import { withProviderFailover, getOrderedProviders } from '../providers/provider-failover.js';
import { getFastestProvider, recordLatency } from '../providers/latency-monitor.js';

export type STTOptions = {
  provider?: string | null;
  model?: string | null;
  language?: string | null;
  preferredLatency?: 'low' | 'balanced' | 'quality';
  /** Optional call session id for failover metrics. */
  callSessionId?: string | null;
};

export type STTResult = {
  text: string;
};

const DEFAULT_SAMPLE_RATE = 16000;

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
  header.writeUInt32LE(16, offset); offset += 4;
  header.writeUInt16LE(1, offset); offset += 2;
  header.writeUInt16LE(numChannels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), offset); offset += 2;
  header.writeUInt16LE(bitsPerSample, offset); offset += 2;
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);
  return Buffer.concat([header, pcm]);
}

function resolveProvider(provider?: string | null): 'openai' | 'deepgram' | 'assemblyai' {
  const p = (provider ?? '').toLowerCase();
  if (p === 'deepgram') return 'deepgram';
  if (p === 'assemblyai') return 'assemblyai';
  return 'openai';
}

const DEEPGRAM_BY_LATENCY = { low: 'nova-2', balanced: 'nova-2', quality: 'nova-2-general' } as const;

function resolveSttModel(provider: string, options: STTOptions): string | undefined {
  const m = (options.model ?? '').trim();
  if (m) return m;
  const latency = options.preferredLatency ?? config.preferredLatency ?? 'balanced';
  if (provider === 'deepgram') return DEEPGRAM_BY_LATENCY[latency];
  return undefined; // openai/assemblyai use config or API default
}

async function transcribeWithProvider(
  provider: string,
  audioBuffer: Buffer,
  options: STTOptions,
  sampleRate: number
): Promise<STTResult> {
  const p = resolveProvider(provider);
  const model = resolveSttModel(p, options);
  const language = (options.language ?? 'en').trim() || 'en';
  if (p === 'openai') return transcribeOpenAI(audioBuffer, sampleRate, model, language);
  if (p === 'deepgram') return transcribeDeepgram(audioBuffer, sampleRate, model ?? config.deepgram.model);
  if (p === 'assemblyai') return transcribeAssemblyAI(audioBuffer, sampleRate, model);
  return transcribeOpenAI(audioBuffer, sampleRate, model, language);
}

export async function transcribeAudioByProvider(
  audioBuffer: Buffer,
  options: STTOptions = {},
  sampleRate: number = DEFAULT_SAMPLE_RATE
): Promise<STTResult> {
  // Agent-configured provider takes priority; only then use latency-based fastest or default
  const agentPreferred = options.provider != null && String(options.provider).trim() !== ''
    ? resolveProvider(options.provider)
    : null;
  const preferred = agentPreferred ?? getFastestProvider('STT') ?? resolveProvider(null);
  const providers = getOrderedProviders(config.providerFallbacks.stt, preferred);
  return withProviderFailover(
    'STT',
    providers,
    async (provider) => {
      const start = Date.now();
      const result = await transcribeWithProvider(provider, audioBuffer, options, sampleRate);
      recordLatency('STT', provider, Date.now() - start);
      return result;
    },
    { callSessionId: options.callSessionId }
  );
}

async function transcribeOpenAI(
  pcmBuffer: Buffer,
  sampleRate: number,
  modelOverride?: string,
  language?: string
): Promise<STTResult> {
  const apiKey = config.openai?.apiKey?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for STT provider openai. Set it in backend/.env');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const wav = createWavFromPcm(pcmBuffer, sampleRate);
  const tmpPath = path.join(os.tmpdir(), `stt-openai-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.promises.writeFile(tmpPath, wav);
  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: modelOverride ?? config.openai.sttModel,
      language: language ?? 'en',
    });
    return { text: (response.text ?? '').trim() };
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

async function transcribeDeepgram(
  pcmBuffer: Buffer,
  sampleRate: number,
  modelOverride?: string
): Promise<STTResult> {
  const apiKey = config.deepgram?.apiKey?.trim();
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required for STT provider deepgram. Set it in backend/.env');
  const { createClient } = await import('@deepgram/sdk');
  const deepgram = createClient(apiKey);
  const wav = createWavFromPcm(pcmBuffer, sampleRate);
  const model = modelOverride ?? config.deepgram?.model ?? 'nova-2';
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(wav, {
    model,
    smart_format: true,
  });
  if (error) throw new Error(`Deepgram STT: ${error.message ?? String(error)}`);
  const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  return { text: text.trim() };
}

async function transcribeAssemblyAI(
  pcmBuffer: Buffer,
  sampleRate: number,
  _modelOverride?: string
): Promise<STTResult> {
  const apiKey = config.assemblyai?.apiKey?.trim();
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is required for STT provider assemblyai. Set it in backend/.env');
  const { AssemblyAI } = await import('assemblyai');
  const client = new AssemblyAI({ apiKey });
  const wav = createWavFromPcm(pcmBuffer, sampleRate);
  const tmpPath = path.join(os.tmpdir(), `stt-aa-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.promises.writeFile(tmpPath, wav);
  try {
    const transcript = await client.transcripts.transcribe({ audio: tmpPath });
    const text = transcript.text ?? (transcript.status === 'completed' ? '' : '');
    return { text: text.trim() };
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}
