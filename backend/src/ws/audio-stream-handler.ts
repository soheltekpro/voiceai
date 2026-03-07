/**
 * Buffers incoming PCM and triggers the pipeline when enough audio is available.
 * Designed for low latency: small minimum chunk, cap buffer size.
 * Uses session.sampleRate for duration math (client may send 48kHz from browser).
 */

import type { SessionState } from '../types.js';
import { config } from '../config.js';
import { getSession, updateSession } from './session-manager.js';

/** Bytes per second for 16-bit mono at given sample rate */
function bytesPerSecond(sampleRate: number): number {
  return sampleRate * 2;
}

export function appendAudio(sessionId: string, pcmChunk: Buffer): void {
  const session = getSession(sessionId);
  if (!session) return;

  const newBuffer = Buffer.concat([session.audioBuffer, pcmChunk]);
  const maxBytes = Math.ceil((config.maxBufferMs / 1000) * bytesPerSecond(session.sampleRate));
  const capped = newBuffer.length > maxBytes ? newBuffer.subarray(-maxBytes) : newBuffer;
  updateSession(sessionId, { audioBuffer: capped });
}

/**
 * Returns buffered PCM if duration >= minAudioMs, and clears the buffer.
 * Caller should run pipeline on the returned buffer.
 */
export function takeBufferIfReady(sessionId: string): Buffer | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const minBytes = Math.ceil((config.minAudioMs / 1000) * bytesPerSecond(session.sampleRate));
  if (session.audioBuffer.length < minBytes) return null;

  const toProcess = Buffer.from(session.audioBuffer);
  updateSession(sessionId, { audioBuffer: Buffer.alloc(0) });
  return toProcess;
}

export function getBufferDurationMs(sessionId: string): number {
  const session = getSession(sessionId);
  if (!session) return 0;
  const bps = bytesPerSecond(session.sampleRate);
  return (session.audioBuffer.length / bps) * 1000;
}
