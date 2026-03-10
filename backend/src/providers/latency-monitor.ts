/**
 * Adaptive latency optimization: track STT/LLM/TTS latency per provider and prefer fastest.
 * When latency exceeds thresholds, log switch and record providerSwitchCount.
 */

import { config } from '../config.js';
import { metrics } from '../infra/metrics.js';

export type LatencyType = 'STT' | 'LLM' | 'TTS';

/** LLM threshold raised to 4000ms so Gemini etc. are not prematurely penalized and switched to fallback. */
const LATENCY_THRESHOLDS_MS: Record<LatencyType, number> = {
  STT: 800,
  LLM: 4000,
  TTS: 800,
};

const MAX_SAMPLES = 50;
const MIN_SAMPLES_FOR_FASTEST = 2;

/** Rolling latency samples per (type, provider). */
const latencySamples = new Map<string, number[]>();

function key(type: LatencyType, provider: string): string {
  return `${type}:${provider.toLowerCase()}`;
}

function getProvidersForType(type: LatencyType): readonly string[] {
  const t = type.toLowerCase();
  if (t === 'stt') return config.providerFallbacks.stt;
  if (t === 'llm') return config.providerFallbacks.llm;
  return config.providerFallbacks.tts;
}

/** Record a latency sample and push to Prometheus histogram. */
export function recordLatency(type: LatencyType, provider: string, latencyMs: number): void {
  const p = provider.toLowerCase();
  metrics.providerLatencyMs.observe({ provider: p, type }, latencyMs);

  const k = key(type, p);
  let arr = latencySamples.get(k);
  if (!arr) {
    arr = [];
    latencySamples.set(k, arr);
  }
  arr.push(latencyMs);
  if (arr.length > MAX_SAMPLES) arr.shift();

  const threshold = LATENCY_THRESHOLDS_MS[type];
  if (latencyMs > threshold) {
    // Penalize this provider so getFastestProvider returns another next time
    for (let i = 0; i < 5; i++) {
      arr.push(threshold * 1.5);
      if (arr.length > MAX_SAMPLES) arr.shift();
    }
    metrics.providerSwitchCount.inc({ type });
    const nextBest = getFastestProvider(type);
    const toProvider = nextBest && nextBest.toLowerCase() !== p ? nextBest : '—';
    console.warn(
      `[latency-optimization] switch provider\ntype: ${type}\nfrom: ${p}\nto: ${toProvider}\nlatency: ${latencyMs}ms`
    );
  }
}

function average(arr: number[]): number {
  if (arr.length === 0) return Infinity;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Return the provider with lowest average latency for the given type.
 * Returns null if insufficient data (fewer than MIN_SAMPLES_FOR_FASTEST per provider).
 */
export function getFastestProvider(type: LatencyType): string | null {
  const providers = getProvidersForType(type);
  let best: string | null = null;
  let bestAvg = Infinity;
  let hasEnoughData = false;

  for (const p of providers) {
    const k = key(type, p);
    const arr = latencySamples.get(k) ?? [];
    if (arr.length < MIN_SAMPLES_FOR_FASTEST) continue;
    hasEnoughData = true;
    const avg = average(arr);
    if (avg < bestAvg) {
      bestAvg = avg;
      best = p;
    }
  }

  return hasEnoughData ? best : null;
}
