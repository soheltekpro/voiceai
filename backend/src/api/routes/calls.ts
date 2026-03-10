import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema } from '../schemas.js';
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

    const [items, total] = await Promise.all([
      prisma.callSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: offset,
        take: limit,
        include: { agent: true },
      }),
      prisma.callSession.count({ where }),
    ]);
    return { items, total, limit, offset };
  });

  app.get('/call-sessions/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as any).id as string;
    const session = await prisma.callSession.findFirst({
      where: { id, agent: { workspaceId } },
      include: { agent: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });
    return session;
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
      }
    );

    return totals;
  });
}

