/**
 * Streaming Speech-to-Text via Deepgram Live API.
 * Forwards PCM to Deepgram; emits partial and final transcripts (VAD = speech_final).
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from '../config.js';
import { resampleTo16k } from './resample.js';

const DEEPGRAM_SAMPLE_RATE = 16000;

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export interface StreamingSTTController {
  pushPcm(pcm: Buffer, sourceSampleRate: number): void;
  close(): void;
}

interface TranscriptPayload {
  channel?: { alternatives?: Array<{ transcript?: string }> };
  speech_final?: boolean;
  is_final?: boolean;
}

function getTranscript(data: TranscriptPayload): string {
  const alt = data.channel?.alternatives?.[0];
  return (alt?.transcript ?? '').trim();
}

function isFinal(data: TranscriptPayload): boolean {
  return Boolean(data.speech_final ?? data.is_final);
}

/**
 * Create a streaming STT session. Call pushPcm with incoming audio; callbacks receive partial/final.
 * Call close() when done.
 */
export function createStreamingSTT(
  onTranscript: TranscriptCallback,
  language: string
): StreamingSTTController | null {
  const apiKey = config.deepgram.apiKey?.trim();
  if (!apiKey) return null;

  const client = createClient(apiKey);
  const connection = client.listen.live({
    model: config.deepgram.model,
    language: language || config.deepgram.language,
    interim_results: true,
    punctuate: true,
    encoding: 'linear16',
    sample_rate: DEEPGRAM_SAMPLE_RATE,
    channels: 1,
  });

  connection.setupConnection();

  connection.on(LiveTranscriptionEvents.Transcript, (data: TranscriptPayload) => {
    const text = getTranscript(data);
    if (!text) return;
    onTranscript(text, isFinal(data));
  });

  connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    onTranscript(`[STT error: ${msg}]`, true);
  });

  return {
    pushPcm(pcm: Buffer, sourceSampleRate: number) {
      const toSend =
        sourceSampleRate === DEEPGRAM_SAMPLE_RATE
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

export function isStreamingSTTAvailable(): boolean {
  return Boolean(config.deepgram.apiKey?.trim());
}
