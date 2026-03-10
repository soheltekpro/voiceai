/**
 * Provider health monitor: latency, error rate, availability.
 * Exposes getBestProvider(type) for fastest healthy provider.
 */

export type ProviderType = 'stt' | 'llm' | 'tts';

const STT_PROVIDERS = ['openai', 'deepgram', 'assemblyai'] as const;
const LLM_PROVIDERS = ['openai', 'google', 'anthropic'] as const;
const TTS_PROVIDERS = ['openai', 'elevenlabs', 'playht'] as const;

const PROVIDERS_BY_TYPE: Record<ProviderType, readonly string[]> = {
  stt: STT_PROVIDERS,
  llm: LLM_PROVIDERS,
  tts: TTS_PROVIDERS,
};

const MAX_SAMPLES = 100;
const ERROR_RATE_THRESHOLD = 0.5;   // consider unhealthy above 50% errors
const MIN_REQUESTS = 3;             // need at least N samples before preferring by latency

interface ProviderMetrics {
  latencies: number[];   // rolling window ms
  errors: number;
  requests: number;
  lastSuccessAt: number;
  lastFailureAt: number;
}

const metrics = new Map<string, ProviderMetrics>();

function getOrCreateMetrics(provider: string): ProviderMetrics {
  let m = metrics.get(provider);
  if (!m) {
    m = { latencies: [], errors: 0, requests: 0, lastSuccessAt: 0, lastFailureAt: 0 };
    metrics.set(provider, m);
  }
  return m;
}

/** Record a successful request (call after completion with latencyMs). */
export function recordSuccess(provider: string, latencyMs: number): void {
  const m = getOrCreateMetrics(provider);
  m.requests++;
  m.lastSuccessAt = Date.now();
  m.latencies.push(latencyMs);
  if (m.latencies.length > MAX_SAMPLES) m.latencies.shift();
}

/** Record a failed request. */
export function recordFailure(provider: string): void {
  const m = getOrCreateMetrics(provider);
  m.requests++;
  m.errors++;
  m.lastFailureAt = Date.now();
}

/** Availability: consider available if we have recent success or few errors. */
function isHealthy(provider: string): boolean {
  const m = metrics.get(provider);
  if (!m || m.requests < 1) return true; // unknown = assume ok
  const errorRate = m.errors / m.requests;
  if (errorRate >= ERROR_RATE_THRESHOLD) return false;
  const recentSuccess = m.lastSuccessAt > m.lastFailureAt || m.errors === 0;
  return recentSuccess;
}

/** Average latency (ms) over last samples. */
function avgLatency(provider: string): number {
  const m = metrics.get(provider);
  if (!m || m.latencies.length === 0) return 9999;
  const sum = m.latencies.reduce((a, b) => a + b, 0);
  return sum / m.latencies.length;
}

/**
 * Return the best (fastest healthy) provider for the given type.
 * Falls back to first available in list if none are healthy.
 */
export function getBestProvider(type: ProviderType): string {
  const candidates = [...PROVIDERS_BY_TYPE[type]];
  const healthy = candidates.filter((p) => isHealthy(p));
  const toUse = healthy.length > 0 ? healthy : candidates;

  if (toUse.length === 0) return candidates[0] ?? 'openai';

  return toUse.reduce((best, p) => (avgLatency(p) < avgLatency(best) ? p : best));
}

/** Get current metrics for a provider (for observability). */
export function getProviderMetrics(provider: string): { requests: number; errors: number; avgLatencyMs: number; healthy: boolean } | null {
  const m = metrics.get(provider);
  if (!m) return null;
  const avg = m.latencies.length ? m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length : 0;
  return {
    requests: m.requests,
    errors: m.errors,
    avgLatencyMs: Math.round(avg),
    healthy: isHealthy(provider),
  };
}

/** Get all providers' metrics for a type (for dashboards). */
export function getMetricsByType(type: ProviderType): Record<string, { requests: number; errors: number; avgLatencyMs: number; healthy: boolean }> {
  const out: Record<string, { requests: number; errors: number; avgLatencyMs: number; healthy: boolean }> = {};
  for (const p of PROVIDERS_BY_TYPE[type]) {
    const m = getProviderMetrics(p);
    if (m) out[p] = m;
  }
  return out;
}
