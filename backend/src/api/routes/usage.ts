import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWorkspaceId } from '../auth-context.js';
import { getUsageForPeriod, getCurrentPeriod } from '../../services/usage.js';

const QuerySchema = z.object({
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
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
