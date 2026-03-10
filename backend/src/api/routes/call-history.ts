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
import { z } from 'zod';

/** Response shape for a single call (admin UI compatible). */
export type CallResponse = {
  id: string;
  agentId: string;
  agentType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  tokensUsed: number | null;
  transcript: string | null;
  recordingUrl?: string | null;
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
  };
}

export async function registerCallHistoryRoutes(app: FastifyInstance): Promise<void> {
  const ListQuerySchema = PaginationSchema.extend({
    agent_id: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'ENDED', 'ERROR']).optional(),
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

    return {
      items: items.map(toCallResponse),
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
    return toCallResponse(call);
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
