/**
 * Voice pipeline metrics for TTS worker and queue.
 * Simple in-memory timers for observability.
 */

export type VoiceMetrics = {
  ttsSentenceDurationMs: number;
  ttsQueueLatencyMs: number;
  ttsWorkerIdleTimeMs: number;
};

const state: VoiceMetrics = {
  ttsSentenceDurationMs: 0,
  ttsQueueLatencyMs: 0,
  ttsWorkerIdleTimeMs: 0,
};

let lastIdleStart = 0;

export function getVoiceMetrics(): VoiceMetrics {
  return { ...state };
}

export function recordTtsSentenceDuration(ms: number): void {
  state.ttsSentenceDurationMs = ms;
}

export function recordTtsQueueLatency(ms: number): void {
  state.ttsQueueLatencyMs = ms;
}

export function recordTtsWorkerIdleStart(): void {
  lastIdleStart = Date.now();
}

export function recordTtsWorkerIdleEnd(): void {
  if (lastIdleStart > 0) {
    state.ttsWorkerIdleTimeMs = Date.now() - lastIdleStart;
    lastIdleStart = 0;
  }
}
