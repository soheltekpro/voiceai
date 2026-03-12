/**
 * Call History APIs - use Prisma models Call and CallEvent.
 * GET /api/v1/calls (paginated, filter by agent_id, status)
 * GET /api/v1/calls/:id
 * GET /api/v1/calls/:id/events (lifecycle events via call_sessions -> call_events)
 */

import type { FastifyInstance } from 'fastify';
import type { CallStatus } from '../../generated/prisma/index.js';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema } from '../schemas.js';
import { buildV2VCostBreakdown, getUsdToInr, type V2VCostBreakdown } from '../../usage/v2v-cost.js';
import { z } from 'zod';

/** Response shape for a single call (admin UI compatible). */
export type CallResponse = {
  id: string;
  agentId: string;
  agentName?: string | null;
  agentType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  tokensUsed: number | null;
  transcript: string | null;
  recordingUrl?: string | null;
  callSessionId?: string | null;
  /** Cost breakdown for V2V calls (list and detail). */
  costBreakdown?: V2VCostBreakdown | null;
  recordingDuration?: number | null;
};

function toCallResponse(row: {
  id: string;
  agentId: string;
  agentType: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  tokensUsed: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  recordingDuration: number | null;
  callSessionId?: string | null;
}): CallResponse {
  return {
    id: row.id,
    agentId: row.agentId,
    agentType: row.agentType,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    tokensUsed: row.tokensUsed,
    transcript: row.transcript,
    recordingUrl: row.recordingUrl,
    recordingDuration: row.recordingDuration ?? null,
    callSessionId: row.callSessionId ?? null,
  };
}

export async function registerCallHistoryRoutes(app: FastifyInstance): Promise<void> {
  const ListQuerySchema = PaginationSchema.extend({
    agent_id: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'ENDED', 'ERROR']).optional(),
  });

  const StatsQuerySchema = z.object({
    agent_id: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'ENDED', 'ERROR']).optional(),
  });

  /** GET /api/v1/calls/stats - workspace aggregates (total calls, duration, cost); same filters as list */
  app.get('/calls/stats', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const query = StatsQuerySchema.parse(req.query);
    const agentId = query.agent_id ?? query.agentId;
    const status = query.status;

    const where: { workspaceId: string; agentId?: string; status?: CallStatus } = { workspaceId };
    if (agentId) where.agentId = agentId;
    if (status) where.status = status as CallStatus;

    const [callAgg, callsWithSession] = await Promise.all([
      prisma.call.aggregate({
        where,
        _count: { id: true },
        _sum: { durationSeconds: true },
      }),
      prisma.call.findMany({
        where: { ...where, callSessionId: { not: null } },
        select: { callSessionId: true },
      }),
    ]);

    const sessionIds = [...new Set((callsWithSession.map((c) => c.callSessionId).filter((id): id is string => id != null)))];
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    if (sessionIds.length > 0) {
      const sessionAgg = await prisma.callSession.aggregate({
        where: { id: { in: sessionIds } },
        _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
      });
      totalCostUsd = sessionAgg._sum.estimatedCostUsd != null ? Number(sessionAgg._sum.estimatedCostUsd) : 0;
      totalInputTokens = sessionAgg._sum.inputTokens ?? 0;
      totalOutputTokens = sessionAgg._sum.outputTokens ?? 0;
    }

    const totalCalls = callAgg._count.id ?? 0;
    const totalDurationSeconds = callAgg._sum.durationSeconds ?? 0;
    const usdToInr = getUsdToInr();
    const totalCostInr = totalCostUsd * usdToInr;
    const totalMinutes = totalDurationSeconds / 60;

    return {
      totalCalls,
      totalDurationSeconds,
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      totalCostUsd: Math.round(totalCostUsd * 1e4) / 1e4,
      totalCostInr: Math.round(totalCostInr * 100) / 100,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    };
  });

  /** GET /api/v1/calls - paginated list, filter by agent_id, status */
  app.get('/calls', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const query = ListQuerySchema.parse(req.query);
    const limit = query.limit;
    const offset = query.offset;
    const agentId = query.agent_id ?? query.agentId;
    const status = query.status;

    const where: { workspaceId: string; agentId?: string; status?: CallStatus } = { workspaceId };
    if (agentId) where.agentId = agentId;
    if (status) where.status = status as CallStatus;

    const [items, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.call.count({ where }),
    ]);

    const agentIds = [...new Set(items.map((c) => c.agentId))];
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds }, workspaceId },
      select: { id: true, name: true },
    });
    const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

    const sessionIds = items.map((c) => c.callSessionId).filter((id): id is string => id != null);
    let sessionBreakdownMap = new Map<string, ReturnType<typeof buildV2VCostBreakdown>>();
    if (sessionIds.length > 0) {
      const sessions = await prisma.callSession.findMany({
        where: { id: { in: sessionIds } },
        select: {
          id: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCostUsd: true,
          durationSeconds: true,
          agent: {
            select: {
              agentType: true,
              settings: { select: { v2vProvider: true, v2vModel: true } },
            },
          },
        },
      });
      for (const s of sessions) {
        const agentType = s.agent?.agentType ?? 'PIPELINE';
        const hasTokens =
          (s.inputTokens != null && s.inputTokens > 0) ||
          (s.outputTokens != null && s.outputTokens > 0);
        const costUsd = s.estimatedCostUsd != null ? Number(s.estimatedCostUsd) : 0;
        if (agentType === 'V2V' && hasTokens && costUsd >= 0) {
          const settings = s.agent?.settings;
          sessionBreakdownMap.set(s.id, buildV2VCostBreakdown({
            inputTokens: s.inputTokens ?? 0,
            outputTokens: s.outputTokens ?? 0,
            totalCostUsd: costUsd,
            durationSeconds: s.durationSeconds ?? null,
            v2vProvider: settings?.v2vProvider ?? null,
            v2vModel: settings?.v2vModel ?? null,
          }));
        }
      }
    }

    const listItems = items.map((row) => {
      const resp = toCallResponse(row);
      const breakdown = row.callSessionId ? sessionBreakdownMap.get(row.callSessionId) : undefined;
      return {
        ...resp,
        agentName: agentNameMap.get(row.agentId) ?? null,
        costBreakdown: breakdown ?? null,
      };
    });

    return {
      items: listItems,
      total,
      limit,
      offset,
    };
  });

  /** GET /api/v1/calls/:id - single call */
  app.get('/calls/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });
    const agent = await prisma.agent.findFirst({
      where: { id: call.agentId, workspaceId },
      select: { name: true },
    });
    const resp = toCallResponse(call);
    return { ...resp, agentName: agent?.name ?? null };
  });

  /** GET /api/v1/calls/:id/events - lifecycle events for the call (via callSessionId -> call_events) */
  app.get('/calls/:id/events', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const { limit, offset } = PaginationSchema.parse(req.query);

    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true, callSessionId: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    if (!call.callSessionId) {
      return { items: [], total: 0, limit, offset };
    }

    const [items, total] = await Promise.all([
      prisma.callEvent.findMany({
        where: { sessionId: call.callSessionId },
        orderBy: { timestamp: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.callEvent.count({ where: { sessionId: call.callSessionId } }),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        type: e.type,
        timestamp: e.timestamp.toISOString(),
        payload: e.payload,
      })),
      total,
      limit,
      offset,
    };
  });

  const ConversationMessageRoleEnum = z.enum(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL']);
  const PostMessageSchema = z.object({
    role: ConversationMessageRoleEnum,
    content: z.string(),
  });

  /** GET /api/v1/calls/:id/messages - conversation history for the call */
  app.get('/calls/:id/messages', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const { limit, offset } = PaginationSchema.parse(req.query);

    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    const [items, total] = await Promise.all([
      prisma.conversationMessage.findMany({
        where: { callId: id },
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.conversationMessage.count({ where: { callId: id } }),
    ]);

    return {
      items: items.map((m) => ({
        id: m.id,
        callId: m.callId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  /** POST /api/v1/calls/:id/messages - append a message (e.g. for testing or manual history) */
  app.post('/calls/:id/messages', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const body = PostMessageSchema.parse(req.body);

    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    const msg = await prisma.conversationMessage.create({
      data: {
        callId: id,
        role: body.role,
        content: body.content,
      },
    });
    return reply.code(201).send({
      id: msg.id,
      callId: msg.callId,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
    });
  });

  /** GET /api/v1/calls/:id/outcome - AI-detected call outcome */
  app.get('/calls/:id/outcome', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    const outcome = await prisma.voiceCallOutcome.findUnique({
      where: { callId: id },
      select: { outcome: true, confidence: true, summary: true },
    });
    if (!outcome) return reply.code(404).send({ message: 'Outcome not yet detected for this call' });

    return {
      outcome: outcome.outcome,
      confidence: outcome.confidence,
      summary: outcome.summary,
    };
  });

  /** GET /api/v1/calls/:id/guidance - latest AI suggestions for the call */
  app.get('/calls/:id/guidance', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    const items = await prisma.voiceCallGuidance.findMany({
      where: { callId: id },
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

  /** GET /api/v1/calls/:id/evaluation - AI call quality evaluation */
  app.get('/calls/:id/evaluation', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const call = await prisma.call.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!call) return reply.code(404).send({ message: 'Call not found' });

    const evaluation = await prisma.voiceCallEvaluation.findUnique({
      where: { callId: id },
      select: { score: true, strengths: true, improvements: true },
    });
    if (!evaluation) return reply.code(404).send({ message: 'Evaluation not yet available for this call' });

    return {
      score: evaluation.score,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
    };
  });
}
