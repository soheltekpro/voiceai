/**
 * Automatic provider failover: try providers in order; on failure, log and retry with next.
 * Used for STT, LLM, and TTS so calls continue when a provider fails or times out.
 */

import { metrics } from '../infra/metrics.js';
import { getCallMetrics, updateCallMetrics } from '../voice/call-analytics.js';

export type ProviderType = 'STT' | 'LLM' | 'TTS';

export type FailoverOptions = {
  /** If set, increment failover count on this call's metrics when failover occurs. */
  callSessionId?: string | null;
};

/** First (original) provider error, preserved so the UI shows it instead of the last fallback error. */
export type FirstProviderError = {
  provider: string;
  message: string;
  status?: number;
};

/** Extract status and message from provider errors (SDK or HTTP-shaped). */
function normalizeProviderError(err: unknown): { status?: number; message: string; body?: string } {
  const message = err instanceof Error ? err.message : String(err);
  let status: number | undefined;
  let body: string | undefined;
  const anyErr = err as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown; data?: unknown } } | undefined;
  if (anyErr?.status != null) status = Number(anyErr.status);
  else if (anyErr?.statusCode != null) status = Number(anyErr.statusCode);
  else if (anyErr?.response?.status != null) status = Number(anyErr.response.status);
  else if (anyErr?.code != null && typeof anyErr.code === 'number') status = anyErr.code;
  const resData = anyErr?.response?.data;
  if (resData != null) {
    body = typeof resData === 'string' ? resData : JSON.stringify(resData);
  }
  if (status == null && message) {
    const statusMatch = message.match(/\bstatus[:\s]+(\d{3})\b/i) ?? message.match(/\b(\d{3})\s+(?:Not Found|Unauthorized|Forbidden|Bad Request|etc)/i);
    if (statusMatch) status = parseInt(statusMatch[1], 10);
  }
  return { status, message, body };
}

/**
 * Run fn(provider) for each provider in order until one succeeds.
 * On failure: log each provider error, try next. Throws the **first** (original) provider error
 * so the UI shows the real failure (e.g. "TTS error from PlayHT") instead of the last fallback error.
 */
export async function withProviderFailover<T>(
  type: ProviderType,
  providers: readonly string[],
  fn: (provider: string) => Promise<T>,
  options?: FailoverOptions
): Promise<T> {
  if (providers.length === 0) throw new Error(`No providers configured for ${type} failover`);
  let firstError: FirstProviderError | null = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (i > 0) {
      const fromProvider = providers[i - 1];
      console.warn(
        `[provider-failover] Voice provider failover triggered\ntype: ${type}\nfrom: ${fromProvider}\nto: ${provider}`
      );
      metrics.providerFailoversTotal.inc({ type });
      if (options?.callSessionId) {
        const m = getCallMetrics(options.callSessionId);
        if (m) updateCallMetrics(options.callSessionId, { failoverCount: 1 });
      }
    }
    try {
      return await fn(provider);
    } catch (err) {
      const { status, message, body } = normalizeProviderError(err);
      if (!firstError) {
        firstError = { provider, message, status };
      }
      console.warn('[provider-failover]', { type, provider, error: message });
      console.error('[voice] provider error', { type, provider, message, status });
      const logPayload: Record<string, unknown> = { provider, message };
      if (status != null) logPayload.status = status;
      if (body != null) logPayload.body = body.slice(0, 500);
      console.warn('[voice]', type, 'error', logPayload);
    }
  }
  const err = firstError ?? { provider: 'unknown', message: 'All providers failed' };
  throw new Error(`${type} error from ${err.provider}: ${err.message}`);
}

/** Build ordered provider list: preferred first (if in fallbacks), then rest of fallbacks. */
export function getOrderedProviders(
  fallbacks: readonly string[],
  preferred?: string | null
): string[] {
  const p = (preferred ?? '').toLowerCase().trim();
  if (!p) return [...fallbacks];
  const rest = fallbacks.filter((x) => x.toLowerCase() !== p);
  return [p, ...rest];
}
