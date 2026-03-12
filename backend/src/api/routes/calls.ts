import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema } from '../schemas.js';
import { costPerMinuteUsd } from '../../usage/voice-cost.js';
import { buildV2VCostBreakdown } from '../../usage/v2v-cost.js';
import { z } from 'zod';

export async function registerCallRoutes(app: FastifyInstance): Promise<void> {
  app.get('/call-sessions', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const Query = PaginationSchema.extend({
      agentId: z.string().uuid().optional(),
      clientType: z.enum(['BROWSER', 'PHONE', 'UNKNOWN']).optional(),
      status: z.enum(['ACTIVE', 'ENDED', 'ERROR']).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      q: z.string().min(1).optional(),
    });
    const { limit, offset, agentId, clientType, status, from, to, q } = Query.parse(req.query);

    const where: any = { agent: { workspaceId } };
    if (agentId) where.agentId = agentId;
    if (clientType) where.clientType = clientType;
    if (status) where.status = status;
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    if (q) {
      where.OR = [
        { transcriptText: { contains: q, mode: 'insensitive' } },
        { metadata: { path: ['provider'], string_contains: q } },
      ];
    }

    const [sessions, total] = await Promise.all([
      prisma.callSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: offset,
        take: limit,
        include: { agent: { include: { settings: true } } },
      }),
      prisma.callSession.count({ where }),
    ]);
    const items = sessions.map((s) => {
      const costPerMinuteUsdVal = costPerMinuteUsd(
        s.estimatedCostUsd != null ? Number(s.estimatedCostUsd) : null,
        s.durationSeconds,
      );
      let costBreakdown: ReturnType<typeof buildV2VCostBreakdown> | null = null;
      const agentType = s.agent?.agentType ?? 'PIPELINE';
      const hasTokens =
        (s.inputTokens != null && s.inputTokens > 0) ||
        (s.outputTokens != null && s.outputTokens > 0);
      const costUsd = s.estimatedCostUsd != null ? Number(s.estimatedCostUsd) : 0;
      if (agentType === 'V2V' && hasTokens && costUsd >= 0) {
        const settings = s.agent?.settings;
        costBreakdown = buildV2VCostBreakdown({
          inputTokens: s.inputTokens ?? 0,
          outputTokens: s.outputTokens ?? 0,
          totalCostUsd: costUsd,
          durationSeconds: s.durationSeconds ?? null,
          v2vProvider: settings?.v2vProvider ?? null,
          v2vModel: settings?.v2vModel ?? null,
        });
      }
      return {
        ...s,
        costPerMinuteUsd: costPerMinuteUsdVal,
        costBreakdown,
      };
    });
    return { items, total, limit, offset };
  });

  app.get('/call-sessions/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as any).id as string;
    const session = await prisma.callSession.findFirst({
      where: { id, agent: { workspaceId } },
      include: { agent: { include: { settings: true } } },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });
    const costPerMinuteUsdVal = costPerMinuteUsd(
      session.estimatedCostUsd != null ? Number(session.estimatedCostUsd) : null,
      session.durationSeconds,
    );
    let costBreakdown: ReturnType<typeof buildV2VCostBreakdown> | null = null;
    const agentType = session.agent?.agentType ?? 'PIPELINE';
    const hasTokens =
      (session.inputTokens != null && session.inputTokens > 0) ||
      (session.outputTokens != null && session.outputTokens > 0);
    const costUsd = session.estimatedCostUsd != null ? Number(session.estimatedCostUsd) : 0;
    if (agentType === 'V2V' && hasTokens && costUsd >= 0) {
      const settings = session.agent?.settings;
      costBreakdown = buildV2VCostBreakdown({
        inputTokens: session.inputTokens ?? 0,
        outputTokens: session.outputTokens ?? 0,
        totalCostUsd: costUsd,
        durationSeconds: session.durationSeconds ?? null,
        v2vProvider: settings?.v2vProvider ?? null,
        v2vModel: settings?.v2vModel ?? null,
      });
    }
    return {
      ...session,
      costPerMinuteUsd: costPerMinuteUsdVal,
      costBreakdown,
    };
  });

  app.get('/call-sessions/:id/events', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as any).id as string;
    const { limit, offset } = PaginationSchema.parse(req.query);
    const exists = await prisma.callSession.findFirst({ where: { id, agent: { workspaceId } }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: 'Call session not found' });
    const [items, total] = await Promise.all([
      prisma.callEvent.findMany({
        where: { sessionId: id },
        orderBy: { timestamp: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.callEvent.count({ where: { sessionId: id } }),
    ]);
    return { items, total, limit, offset };
  });

  /** GET /api/v1/call-sessions/:id/outcome - AI-detected outcome (resolve Call by callSessionId) */
  app.get('/call-sessions/:id/outcome', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const sessionId = (req.params as any).id as string;
    const session = await prisma.callSession.findFirst({
      where: { id: sessionId, agent: { workspaceId } },
      select: { id: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });

    const call = await prisma.call.findFirst({
      where: { callSessionId: sessionId, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'No call record for this session' });

    const outcome = await prisma.voiceCallOutcome.findUnique({
      where: { callId: call.id },
      select: { outcome: true, confidence: true, summary: true },
    });
    if (!outcome) return reply.code(404).send({ message: 'Outcome not yet detected for this call' });

    return {
      outcome: outcome.outcome,
      confidence: outcome.confidence,
      summary: outcome.summary,
    };
  });

  /** GET /api/v1/call-sessions/:id/guidance - latest AI suggestions (resolve Call by callSessionId) */
  app.get('/call-sessions/:id/guidance', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const sessionId = (req.params as any).id as string;
    const session = await prisma.callSession.findFirst({
      where: { id: sessionId, agent: { workspaceId } },
      select: { id: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });

    const call = await prisma.call.findFirst({
      where: { callSessionId: sessionId, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'No call record for this session' });

    const items = await prisma.voiceCallGuidance.findMany({
      where: { callId: call.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, suggestion: true, createdAt: true },
    });
    return {
      items: items.map((g) => ({
        id: g.id,
        suggestion: g.suggestion,
        createdAt: g.createdAt.toISOString(),
      })),
    };
  });

  /** GET /api/v1/call-sessions/:id/evaluation - AI call quality (resolve Call by callSessionId) */
  app.get('/call-sessions/:id/evaluation', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const sessionId = (req.params as any).id as string;
    const session = await prisma.callSession.findFirst({
      where: { id: sessionId, agent: { workspaceId } },
      select: { id: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });

    const call = await prisma.call.findFirst({
      where: { callSessionId: sessionId, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'No call record for this session' });

    const evaluation = await prisma.voiceCallEvaluation.findUnique({
      where: { callId: call.id },
      select: { score: true, strengths: true, improvements: true },
    });
    if (!evaluation) return reply.code(404).send({ message: 'Evaluation not yet available for this call' });

    return {
      score: evaluation.score,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
    };
  });

  app.get('/call-sessions/:id/messages', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as any).id as string;
    const { limit, offset } = PaginationSchema.parse(req.query);
    const exists = await prisma.callSession.findFirst({ where: { id, agent: { workspaceId } }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: 'Call session not found' });
    const [items, total] = await Promise.all([
      prisma.callMessage.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.callMessage.count({ where: { sessionId: id } }),
    ]);
    return { items, total, limit, offset };
  });

  app.get('/analytics/summary', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const Query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      agentId: z.string().uuid().optional(),
    });
    const { from, to, agentId } = Query.parse(req.query);
    const where: any = { agent: { workspaceId } };
    if (agentId) where.agentId = agentId;
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }

    const sessions = await prisma.callSession.findMany({
      where,
      select: {
        durationSeconds: true,
        estimatedCostUsd: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        agent: { select: { agentType: true } },
      },
    });

    const totals = sessions.reduce(
      (acc, s) => {
        acc.calls += 1;
        acc.totalDurationSeconds += s.durationSeconds ?? 0;
        acc.totalEstimatedCostUsd += Number(s.estimatedCostUsd ?? 0);
        acc.totalInputTokens += s.inputTokens ?? 0;
        acc.totalOutputTokens += s.outputTokens ?? 0;
        if (s.status === 'ENDED') acc.ended += 1;
        if (s.status === 'ACTIVE') acc.active += 1;
        if (s.status === 'ERROR') acc.error += 1;
        const agentType = s.agent?.agentType ?? 'PIPELINE';
        if (!acc.byAgentType[agentType]) {
          acc.byAgentType[agentType] = { totalCostUsd: 0, totalDurationSeconds: 0, calls: 0 };
        }
        acc.byAgentType[agentType].totalCostUsd += Number(s.estimatedCostUsd ?? 0);
        acc.byAgentType[agentType].totalDurationSeconds += s.durationSeconds ?? 0;
        acc.byAgentType[agentType].calls += 1;
        return acc;
      },
      {
        calls: 0,
        ended: 0,
        active: 0,
        error: 0,
        totalDurationSeconds: 0,
        totalEstimatedCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        byAgentType: {} as Record<string, { totalCostUsd: number; totalDurationSeconds: number; calls: number }>,
      }
    );

    const totalMinutes = totals.totalDurationSeconds / 60;
    const averageCostPerMinuteUsd =
      totalMinutes > 0 && totals.totalEstimatedCostUsd > 0
        ? Math.round((totals.totalEstimatedCostUsd / totalMinutes) * 1e6) / 1e6
        : null;

    const costPerMinuteByAgentType: Record<string, { costPerMinuteUsd: number; totalCostUsd: number; totalMinutes: number; calls: number }> = {};
    for (const [type, agg] of Object.entries(totals.byAgentType)) {
      const minutes = agg.totalDurationSeconds / 60;
      costPerMinuteByAgentType[type] = {
        totalCostUsd: Math.round(agg.totalCostUsd * 1e6) / 1e6,
        totalMinutes: Math.round(minutes * 1e2) / 1e2,
        calls: agg.calls,
        costPerMinuteUsd: minutes > 0 && agg.totalCostUsd > 0 ? Math.round((agg.totalCostUsd / minutes) * 1e6) / 1e6 : 0,
      };
    }

    const { byAgentType: _by, ...restTotals } = totals;
    return {
      ...restTotals,
      averageCostPerMinuteUsd,
      costPerMinuteByAgentType,
    };
  });
}

