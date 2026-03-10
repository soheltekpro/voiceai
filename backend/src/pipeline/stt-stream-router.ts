/**
 * Streaming STT router: Deepgram and AssemblyAI.
 * startStreamingTranscription(options) returns a controller with pushPcm/close.
 * Events: onPartialTranscript(text), onFinalTranscript(text).
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from '../config.js';
import { resampleTo16k } from './resample.js';

const TARGET_SAMPLE_RATE = 16000;

export type StreamingSTTOptions = {
  provider?: 'deepgram' | 'assemblyai' | null;
  language?: string;
  model?: string | null;
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
};

export interface StreamingSTTController {
  pushPcm(pcm: Buffer, sourceSampleRate: number): void;
  close(): void;
}

interface TranscriptPayload {
  channel?: { alternatives?: Array<{ transcript?: string }> };
  speech_final?: boolean;
  is_final?: boolean;
}

function resolveProvider(provider?: string | null): 'deepgram' | 'assemblyai' {
  const p = (provider ?? '').toLowerCase();
  if (p === 'assemblyai') return 'assemblyai';
  return 'deepgram';
}

function getTranscript(data: TranscriptPayload): string {
  const alt = data.channel?.alternatives?.[0];
  return (alt?.transcript ?? '').trim();
}

function isFinal(data: TranscriptPayload): boolean {
  return Boolean(data.speech_final ?? data.is_final);
}

/**
 * Start streaming transcription. Returns controller with pushPcm and close (or Promise for AssemblyAI).
 * Provider: deepgram | assemblyai. Call onPartialTranscript on interim text, onFinalTranscript when segment is final.
 */
export function startStreamingTranscription(options: StreamingSTTOptions): StreamingSTTController | null | Promise<StreamingSTTController | null> {
  const provider = resolveProvider(options.provider);
  const language = (options.language ?? config.deepgram?.language ?? 'en').trim() || 'en';

  if (provider === 'deepgram') {
    return startDeepgram(options, language);
  }
  if (provider === 'assemblyai') {
    return startAssemblyAI(options);
  }
  return startDeepgram(options, language);
}

function startDeepgram(
  options: StreamingSTTOptions,
  language: string
): StreamingSTTController | null {
  const apiKey = config.deepgram?.apiKey?.trim();
  if (!apiKey) return null;

  const client = createClient(apiKey);
  const model = (options.model ?? config.deepgram?.model ?? 'nova-2').trim() || 'nova-2';
  const connection = client.listen.live({
    model,
    language,
    interim_results: true,
    punctuate: true,
    encoding: 'linear16',
    sample_rate: TARGET_SAMPLE_RATE,
    channels: 1,
  });

  connection.setupConnection();

  connection.on(LiveTranscriptionEvents.Transcript, (data: TranscriptPayload) => {
    const text = getTranscript(data);
    if (!text) return;
    if (isFinal(data)) {
      options.onFinalTranscript(text);
    } else {
      options.onPartialTranscript(text);
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    options.onFinalTranscript(`[STT error: ${msg}]`);
  });

  return {
    pushPcm(pcm: Buffer, sourceSampleRate: number) {
      const toSend =
        sourceSampleRate === TARGET_SAMPLE_RATE
          ? pcm
          : Buffer.from(resampleTo16k(pcm, sourceSampleRate));
      if (toSend.length > 0) {
        const u8 = new Uint8Array(toSend);
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        connection.send(buf);
      }
    },
    close() {
      try {
        connection.requestClose();
        connection.disconnect();
      } catch {
        // ignore
      }
    },
  };
}

async function startAssemblyAI(options: StreamingSTTOptions): Promise<StreamingSTTController | null> {
  const apiKey = config.assemblyai?.apiKey?.trim();
  if (!apiKey) return null;

  const { RealtimeTranscriber } = await import('assemblyai');
  const transcriber = new RealtimeTranscriber({
    apiKey,
    sampleRate: TARGET_SAMPLE_RATE,
  });

  const pcmQueue: Buffer[] = [];
  let connected = false;

  transcriber.on('transcript.partial', (message: { text?: string }) => {
    const text = (message?.text ?? '').trim();
    if (text) options.onPartialTranscript(text);
  });

  transcriber.on('transcript.final', (message: { text?: string }) => {
    const text = (message?.text ?? '').trim();
    if (text) options.onFinalTranscript(text);
  });

  transcriber.on('error', (err: Error) => {
    options.onFinalTranscript(`[STT error: ${err?.message ?? String(err)}]`);
  });

  try {
    await transcriber.connect();
    connected = true;
    while (pcmQueue.length > 0) {
      const chunk = pcmQueue.shift();
      if (chunk?.length) transcriber.sendAudio(chunk as unknown as ArrayBuffer);
    }
  } catch (err: unknown) {
    options.onFinalTranscript(`[STT error: ${err instanceof Error ? err.message : String(err)}]`);
    return null;
  }

  return {
    pushPcm(pcm: Buffer, sourceSampleRate: number) {
      const toSend =
        sourceSampleRate === TARGET_SAMPLE_RATE
          ? pcm
          : Buffer.from(resampleTo16k(pcm, sourceSampleRate));
      if (toSend.length === 0) return;
      if (connected) {
        transcriber.sendAudio(toSend as unknown as ArrayBuffer);
      } else {
        pcmQueue.push(toSend);
      }
    },
    close() {
      transcriber.close(false).catch(() => {});
    },
  };
}

/** True if any streaming STT provider is configured. */
export function isStreamingSTTAvailable(provider?: string | null): boolean {
  const p = resolveProvider(provider);
  if (p === 'deepgram') return Boolean(config.deepgram?.apiKey?.trim());
  if (p === 'assemblyai') return Boolean(config.assemblyai?.apiKey?.trim());
  return Boolean(config.deepgram?.apiKey?.trim()) || Boolean(config.assemblyai?.apiKey?.trim());
}
