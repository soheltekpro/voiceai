import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { createRedis } from '../infra/redis.js';
import { prisma } from '../db/prisma.js';
import { AgentOrchestrator } from '../services/agent-orchestrator.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const redis = createRedis();
const orchestrator = new AgentOrchestrator(log as any);

const CallStartSchema = z.object({
  type: z.literal('call.start'),
  callId: z.string().uuid(),
  agentId: z.string().uuid(),
  clientType: z.enum(['BROWSER', 'PHONE', 'UNKNOWN']),
});

new Worker(
  'voiceai-calls',
  async (job) => {
    const data = CallStartSchema.parse(job.data);
    try {
      const call = await prisma.call.findUnique({
        where: { id: data.callId },
        select: { id: true, workspaceId: true, agentId: true },
      });
      if (!call) throw new Error('Call not found');

      const result = await orchestrator.startCall({
        agentId: data.agentId,
        clientType: data.clientType,
      });

      const callSessionId = (result as any).callSessionId as string | undefined;

      await prisma.call.update({
        where: { id: call.id },
        data: {
          agentType: result.agentType,
          callSessionId: callSessionId ?? undefined,
        },
      });

      // Keep response compatible with existing frontend (engine + wsSessionId/roomName)
      if (result.agentType === 'V2V' && result.engine === 'v2v') {
        return {
          callId: call.id,
          agentType: result.agentType,
          engine: result.engine,
          callSessionId: result.callSessionId,
          roomName: (result as any).roomName,
          livekitUrl: (result as any).livekitUrl,
          livekitToken: (result as any).livekitToken,
          // legacy aliases
          roomUrl: (result as any).livekitUrl ?? null,
          token: (result as any).livekitToken ?? null,
        };
      }

      return {
        callId: call.id,
        agentType: result.agentType,
        engine: (result as any).engine ?? 'pipeline',
        callSessionId: (result as any).callSessionId,
        wsUrl: (result as any).wsUrl,
        wsSessionId: (result as any).wsSessionId,
        // legacy aliases
        roomUrl: null,
        token: null,
      };
    } catch (err) {
      log.error({ err, jobId: job.id }, 'voice-worker failed');
      // best-effort: mark call failed
      try {
        const data = CallStartSchema.safeParse(job.data);
        if (data.success) {
          await prisma.call.update({
            where: { id: data.data.callId },
            data: { status: 'ERROR', endedAt: new Date() },
          });
        }
      } catch {}
      throw err;
    }
  },
  { connection: redis as any }
);

log.info('voice-worker running');

