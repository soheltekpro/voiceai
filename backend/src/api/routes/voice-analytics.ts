/**
 * Voice analytics API: overview, recent calls, per-call metrics.
 * All routes require workspace context and filter by workspaceId where applicable.
 */

import type { FastifyInstance } from 'fastify';
import { getWorkspaceId } from '../auth-context.js';
import {
  getRecentCalls,
  getActiveCalls,
  getCallMetrics,
  type VoiceCallMetrics,
} from '../../voice/call-analytics.js';

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

export type VoiceAnalyticsOverview = {
  activeCalls: number;
  totalCallsToday: number;
  avgCallDurationMs: number | null;
  avgLatencyMs: number | null;
};

export async function registerVoiceAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  /** GET /voice/analytics/overview */
  app.get('/voice/analytics/overview', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const active = getActiveCalls(workspaceId);
    const recent = getRecentCalls(200, workspaceId);
    const todayCalls = recent.filter((c) => c.endedAt != null && isToday(c.startedAt));
    const withDuration = recent.filter((c): c is VoiceCallMetrics & { durationMs: number } => c.durationMs != null && c.durationMs > 0);
    const avgCallDurationMs =
      withDuration.length > 0 ? withDuration.reduce((s, c) => s + c.durationMs, 0) / withDuration.length : null;
    const withLatency = recent.filter(
      (c) =>
        c.sttLatencyMs != null ||
        c.llmFirstTokenMs != null ||
        c.ttsFirstAudioMs != null
    );
    const latencySum = withLatency.reduce((s, c) => {
      const stt = c.sttLatencyMs ?? 0;
      const llm = c.llmFirstTokenMs ?? 0;
      const tts = c.ttsFirstAudioMs ?? 0;
      return s + stt + llm + tts;
    }, 0);
    const avgLatencyMs = withLatency.length > 0 ? latencySum / withLatency.length : null;

    const overview: VoiceAnalyticsOverview = {
      activeCalls: active.length,
      totalCallsToday: todayCalls.length,
      avgCallDurationMs: avgCallDurationMs != null ? Math.round(avgCallDurationMs) : null,
      avgLatencyMs: avgLatencyMs != null ? Math.round(avgLatencyMs) : null,
    };
    return overview;
  });

  /** GET /voice/analytics/active - currently active calls */
  app.get('/voice/analytics/active', async (req) => {
    const workspaceId = getWorkspaceId(req);
    return { calls: getActiveCalls(workspaceId) };
  });

  /** GET /voice/analytics/recent - last 50 calls (optionally ?limit=) */
  app.get<{ Querystring: { limit?: string } }>('/voice/analytics/recent', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit ?? '50', 10) || 50));
    return { calls: getRecentCalls(limit, workspaceId) };
  });

  /** GET /voice/analytics/call/:callId - full metrics for one call */
  app.get<{ Params: { callId: string } }>('/voice/analytics/call/:callId', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const { callId } = req.params;
    const metrics = getCallMetrics(callId);
    if (!metrics) return reply.code(404).send({ error: 'Call not found', callId });
    if (metrics.workspaceId != null && metrics.workspaceId !== workspaceId) {
      return reply.code(404).send({ error: 'Call not found', callId });
    }
    return metrics;
  });
}
