import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWorkspaceId } from '../auth-context.js';
import { getUsageForPeriod, getCurrentPeriod } from '../../services/usage.js';
import {
  getVoiceUsageFromDb,
  aggregateVoiceUsage,
  getVoiceQuota,
  getVoiceCostSummary,
  type VoiceUsageAggregate,
} from '../../usage/voice-usage.js';

const QuerySchema = z.object({
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  /** GET /usage/cost – voice cost summary (workspace cost, breakdown by provider, cost per call). */
  app.get<{ Querystring: { periodStart?: string; periodEnd?: string } }>('/usage/cost', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const query = QuerySchema.safeParse(req.query);
    let periodStart: Date;
    let periodEnd: Date;
    if (query.success && query.data.periodStart && query.data.periodEnd) {
      periodStart = new Date(query.data.periodStart);
      periodEnd = new Date(query.data.periodEnd);
    } else {
      const current = getCurrentPeriod();
      periodStart = current.periodStart;
      periodEnd = current.periodEnd;
    }
    const summary = await getVoiceCostSummary(workspaceId, periodStart, periodEnd);
    return {
      workspaceCost: summary.workspaceCost,
      costBreakdownByProvider: summary.costBreakdownByProvider,
      costPerCall: summary.costPerCall,
      period: { start: summary.period.start.toISOString(), end: summary.period.end.toISOString() },
    };
  });

  /** GET /usage/quota – voice quota and current usage (for dashboard and enforcement). */
  app.get('/usage/quota', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const q = await getVoiceQuota(workspaceId);
    return {
      plan: q.plan,
      callMinutesUsed: q.callMinutesUsed,
      callMinutesLimit: q.callMinutesLimit,
      llmTokensUsed: q.llmTokensUsed,
      llmTokensLimit: q.llmTokensLimit,
      ttsCharsUsed: q.ttsCharsUsed,
      ttsCharsLimit: q.ttsCharsLimit,
    };
  });

  /** GET /usage/voice – voice usage aggregate for the workspace (call minutes, LLM tokens, TTS chars, provider breakdown). */
  app.get<{ Querystring: { periodStart?: string; periodEnd?: string } }>('/usage/voice', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const query = QuerySchema.safeParse(req.query);
    let periodStart: Date;
    let periodEnd: Date;
    if (query.success && query.data.periodStart && query.data.periodEnd) {
      periodStart = new Date(query.data.periodStart);
      periodEnd = new Date(query.data.periodEnd);
    } else {
      const current = getCurrentPeriod();
      periodStart = current.periodStart;
      periodEnd = current.periodEnd;
    }
    const rows = await getVoiceUsageFromDb(workspaceId, periodStart, periodEnd);
    const aggregate: VoiceUsageAggregate = aggregateVoiceUsage(rows);
    return {
      totalCallMinutes: aggregate.totalCallMinutes,
      totalLLMTokens: aggregate.totalLLMTokens,
      totalTTSCharacters: aggregate.totalTTSCharacters,
      providerUsage: aggregate.providerUsage,
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    };
  });

  /** GET /usage – usage metrics for the workspace. Defaults to current period. */
  app.get('/usage', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const query = QuerySchema.safeParse(req.query);
    let periodStart: Date;
    let periodEnd: Date;
    if (query.success && query.data.periodStart && query.data.periodEnd) {
      periodStart = new Date(query.data.periodStart);
      periodEnd = new Date(query.data.periodEnd);
    } else {
      const current = getCurrentPeriod();
      periodStart = current.periodStart;
      periodEnd = current.periodEnd;
    }
    const usage = await getUsageForPeriod(workspaceId, periodStart, periodEnd);
    return {
      usage: {
        call_minutes: usage.call_minutes,
        llm_tokens: usage.llm_tokens,
        stt_seconds: usage.stt_seconds,
        tts_seconds: usage.tts_seconds,
        tool_calls: usage.tool_calls,
      },
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    };
  });
}
