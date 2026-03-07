import type { FastifyInstance } from 'fastify';
import { getWorkspaceId } from '../auth-context.js';
import { getWorkspacePlan, getUsageForPeriod, getCurrentPeriod } from '../../services/usage.js';

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  /** GET /billing – current plan and usage for the workspace (current period). */
  app.get('/billing', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const plan = await getWorkspacePlan(workspaceId);
    const { periodStart, periodEnd } = getCurrentPeriod();
    const usage = await getUsageForPeriod(workspaceId, periodStart, periodEnd);
    return {
      plan: plan
        ? {
            id: plan.planId,
            name: plan.planName,
            price: plan.price,
            callMinutesLimit: plan.callMinutesLimit,
            tokenLimit: plan.tokenLimit,
            toolCallsLimit: plan.toolCallsLimit,
            sttSecondsLimit: plan.sttSecondsLimit,
            ttsSecondsLimit: plan.ttsSecondsLimit,
          }
        : null,
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
