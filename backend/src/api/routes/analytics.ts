import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/analytics', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const { days } = QuerySchema.parse(req.query);
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    const callsWhere = { workspaceId, startedAt: { gte: startDate, lte: endDate } };

    const [calls, toolEvents, workspaceUsageRows] = await Promise.all([
      prisma.call.findMany({
        where: callsWhere,
        select: { id: true, status: true, durationSeconds: true, startedAt: true, tokensUsed: true },
      }),
      prisma.callEvent.findMany({
        where: {
          type: 'TOOL_CALLED',
          session: { agent: { workspaceId } },
          timestamp: { gte: startDate, lte: endDate },
        },
        select: { payload: true },
      }),
      prisma.workspaceUsage.findMany({
        where: {
          workspaceId,
          metric: 'llm_tokens',
          periodStart: { gte: startDate },
        },
        select: { value: true, periodStart: true },
      }),
    ]);

    const totalCalls = calls.length;
    const successfulCalls = calls.filter((c) => c.status === 'ENDED').length;
    const failedCalls = calls.filter((c) => c.status === 'ERROR').length;
    const endedWithDuration = calls.filter((c) => c.status === 'ENDED' && c.durationSeconds != null);
    const averageCallDuration =
      endedWithDuration.length > 0
        ? endedWithDuration.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / endedWithDuration.length
        : 0;

    const toolUsageCounts: Record<string, number> = {};
    for (const e of toolEvents) {
      const payload = e.payload as Record<string, unknown> | null;
      const name = (payload?.toolName ?? payload?.tool_name ?? 'unknown') as string;
      toolUsageCounts[name] = (toolUsageCounts[name] ?? 0) + 1;
    }

    const tokenUsageFromCalls = calls.reduce((s, c) => s + (c.tokensUsed ?? 0), 0);
    const tokenUsageFromWorkspace = workspaceUsageRows.reduce((s, r) => s + r.value, 0);
    const tokenUsage = tokenUsageFromCalls > 0 ? tokenUsageFromCalls : tokenUsageFromWorkspace;

    const dayMap: Record<string, { date: string; calls: number; avgDuration: number; tokens: number }> = {};
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: key, calls: 0, avgDuration: 0, tokens: 0 };
    }
    for (const c of calls) {
      const key = new Date(c.startedAt).toISOString().slice(0, 10);
      if (dayMap[key]) {
        dayMap[key].calls += 1;
        dayMap[key].tokens += c.tokensUsed ?? 0;
      }
    }
    for (const key of Object.keys(dayMap)) {
      const dayCalls = calls.filter((c) => new Date(c.startedAt).toISOString().slice(0, 10) === key && c.status === 'ENDED' && c.durationSeconds != null);
      dayMap[key].avgDuration =
        dayCalls.length > 0 ? dayCalls.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / dayCalls.length : 0;
    }
    const callsPerDay = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      averageCallDuration: Math.round(averageCallDuration * 10) / 10,
      toolUsageCounts,
      tokenUsage,
      callsPerDay,
    };
  });
}
