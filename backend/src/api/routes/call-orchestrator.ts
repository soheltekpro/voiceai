import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { persistAndPublish } from '../../events/persist.js';
import { finalizeCallSession } from '../../calls/analytics.js';
import { checkCanStartCall, recordCallUsage } from '../../services/usage.js';
import { getCallQueue, getCallQueueEvents } from '../../infra/queues.js';
import type { CallEventName } from '../../events/types.js';

/**
 * Call start result (keeps compatibility with existing frontend VoiceAgentPhase1).
 * Worker returns one of:
 * - pipeline: { agentType:'PIPELINE', engine:'pipeline', callSessionId, wsUrl, wsSessionId }
 * - v2v:      { agentType:'V2V', engine:'v2v', callSessionId, roomName, livekitUrl, livekitToken }
 * plus callId and some legacy aliases.
 */
export type CallStartSessionResponse = {
  callId: string;
  agentType: 'PIPELINE' | 'V2V';
  engine: 'pipeline' | 'v2v';
  callSessionId: string;
  wsUrl?: string;
  wsSessionId?: string;
  roomName?: string;
  livekitUrl?: string;
  livekitToken?: string;
  roomUrl?: string | null;
  token?: string | null;
};

export async function registerCallOrchestratorRoutes(app: FastifyInstance): Promise<void> {
  const StartSchema = z.object({
    agent_id: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    clientType: z.enum(['BROWSER', 'PHONE', 'UNKNOWN']).default('BROWSER'),
  }).refine((d) => d.agent_id ?? d.agentId, { message: 'agent_id or agentId required' });

  app.post('/calls/start', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = StartSchema.parse(req.body);
    const agentId = body.agent_id ?? body.agentId!;
    try {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId },
        select: { id: true, workspaceId: true, agentType: true },
      });
      if (!agent) return reply.code(404).send({ message: 'Agent not found' });
      const limitCheck = await checkCanStartCall(workspaceId);
      if (!limitCheck.allowed) {
        return reply.code(403).send({ message: limitCheck.reason ?? 'Usage limit exceeded' });
      }

      // Insert record in calls table (worker will attach callSessionId)
      const call = await prisma.call.create({
        data: {
          workspaceId: agent.workspaceId,
          agentId,
          agentType: agent.agentType ?? 'PIPELINE',
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });

      // Enqueue and let a separate worker actually start the call (pipeline or v2v)
      const queue = getCallQueue();
      const job = await queue.add('call.start', {
        type: 'call.start',
        callId: call.id,
        agentId,
        clientType: body.clientType,
      });

      // Wait for worker to return session details (keeps API response shape intact)
      const events = getCallQueueEvents();
      try {
        const result = await job.waitUntilFinished(events, 15000);
        return reply.code(201).send(result as CallStartSessionResponse);
      } catch (e) {
        // Worker is likely not running yet, or still processing.
        return reply.code(202).send({
          message: 'Call start queued',
          callId: call.id,
          jobId: job.id,
        });
      }
    } catch (err) {
      app.log.error({ err }, 'failed to start call');
      return reply.code(400).send({ message: (err as Error).message });
    }
  });

  const EventSchema = z.object({
    event: z.enum([
      'call.connected',
      'speech.detected',
      'agent.reply',
      'call.ended',
      'usage.updated',
      'transcript.partial',
      'transcript.final',
      'agent.speaking',
      'agent.finished',
      'call.recording.available',
      'call.handoff_requested',
    ]),
    payload: z.record(z.unknown()).optional(),
  });

  const UsagePayloadSchema = z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
  });

  app.post('/calls/:callSessionId/events', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const { callSessionId } = req.params as { callSessionId: string };
    const body = EventSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ message: 'Invalid body', errors: body.error.flatten() });
    }
    const session = await prisma.callSession.findFirst({
      where: { id: callSessionId, agent: { workspaceId } },
      select: { id: true, status: true, startedAt: true },
    });
    if (!session) {
      return reply.code(404).send({ message: 'Call session not found' });
    }
    const eventName = body.data.event as CallEventName;
    const payload = body.data.payload ?? {};

    if (eventName === 'usage.updated') {
      const usage = UsagePayloadSchema.safeParse(payload);
      if (usage.success) {
        const data: Record<string, unknown> = {};
        if (usage.data.inputTokens != null) data.inputTokens = usage.data.inputTokens;
        if (usage.data.outputTokens != null) data.outputTokens = usage.data.outputTokens;
        if (usage.data.durationSeconds != null) data.durationSeconds = usage.data.durationSeconds;
        if (usage.data.estimatedCostUsd != null) data.estimatedCostUsd = usage.data.estimatedCostUsd;
        if (Object.keys(data).length > 0) {
          await prisma.callSession.update({
            where: { id: callSessionId },
            data: data as any,
          });
        }
      }
    }

    await persistAndPublish(callSessionId, eventName, payload);

    if (eventName === 'call.ended') {
      const endedAt = new Date();
      const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000));
      await prisma.callSession.update({
        where: { id: callSessionId },
        data: { status: 'ENDED', endedAt, durationSeconds },
      });
      await finalizeCallSession(callSessionId, session.startedAt, endedAt);
      // Update linked Call record (calls table)
      const callSession = await prisma.callSession.findUnique({
        where: { id: callSessionId },
        select: { transcriptText: true, inputTokens: true, outputTokens: true },
      });
      const tokensUsed = (callSession?.inputTokens ?? 0) + (callSession?.outputTokens ?? 0) || 0;
      const toolCallsCount = await prisma.callEvent.count({
        where: { sessionId: callSessionId, type: 'TOOL_CALLED' },
      });
      const callMinutes = durationSeconds / 60;
      const sttTtsSeconds = Math.floor(durationSeconds / 2); // approximate split
      await recordCallUsage(workspaceId, {
        callMinutes,
        llmTokens: tokensUsed,
        sttSeconds: sttTtsSeconds,
        ttsSeconds: sttTtsSeconds,
        toolCalls: toolCallsCount,
      });
      await prisma.call.updateMany({
        where: { callSessionId },
        data: {
          status: 'ENDED',
          endedAt,
          durationSeconds,
          transcript: callSession?.transcriptText ?? undefined,
          tokensUsed: tokensUsed || undefined,
        },
      });
    }

    return reply.code(204).send();
  });

  // Recording complete: set recordingUrl on call and publish call.recording.available (called by Python/egress when recording is ready)
  const RecordingSchema = z.object({
    recordingUrl: z.string().url(),
    durationSeconds: z.number().int().nonnegative().optional(),
  });
  app.post('/call-sessions/:callSessionId/recording', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const { callSessionId } = req.params as { callSessionId: string };
    const body = RecordingSchema.parse(req.body);
    const session = await prisma.callSession.findFirst({
      where: { id: callSessionId, agent: { workspaceId } },
      select: { id: true, metadata: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });
    await prisma.call.updateMany({
      where: { callSessionId },
      data: {
        recordingUrl: body.recordingUrl,
        recordingDuration: body.durationSeconds ?? undefined,
      },
    });
    await persistAndPublish(callSessionId, 'call.recording.available', {
      recordingUrl: body.recordingUrl,
      duration: body.durationSeconds,
    });
    return reply.code(204).send();
  });

  // Join Call: generate LiveKit token for operator to join existing V2V room (human handoff)
  app.post('/call-sessions/:callSessionId/join', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const { callSessionId } = req.params as { callSessionId: string };
    const session = await prisma.callSession.findFirst({
      where: { id: callSessionId, agent: { workspaceId } },
      select: { id: true, metadata: true, status: true },
    });
    if (!session) return reply.code(404).send({ message: 'Call session not found' });
    if (session.status !== 'ACTIVE') return reply.code(400).send({ message: 'Call is not active' });
    const meta = (session.metadata as { roomName?: string }) ?? {};
    const roomName = meta.roomName;
    if (!roomName) return reply.code(400).send({ message: 'Room name not found for this session' });
    const livekitUrl = process.env.LIVEKIT_PUBLIC_URL?.trim() || process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    if (!livekitUrl || !apiKey || !apiSecret) {
      return reply.code(503).send({ message: 'LiveKit not configured' });
    }
    const identity = `operator-${randomUUID().slice(0, 8)}`;
    const at = new AccessToken(apiKey, apiSecret, { identity, name: 'Operator', ttl: '1h' });
    at.addGrant({ roomJoin: true, room: roomName });
    const token = await at.toJwt();
    return reply.send({ livekitUrl: livekitUrl.replace(/\/$/, ''), token, roomName });
  });
}


