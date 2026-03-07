import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';
import { persistAndPublish } from '../events/persist.js';

export type PipelineStartResult = {
  engine: 'pipeline';
  callSessionId: string;
  wsUrl: string;
  wsSessionId: string;
};

export class PipelineEngine {
  constructor(private log: FastifyBaseLogger) {}

  async startCall(params: { agentId: string | null; clientType: 'BROWSER' | 'PHONE' | 'UNKNOWN' }): Promise<PipelineStartResult> {
    const callSession = await prisma.callSession.create({
      data: {
        agentId: params.agentId,
        clientType: params.clientType,
        status: 'ACTIVE',
        metadata: { started_via: 'orchestrator' },
      },
    });

    const wsSessionId = randomUUID();
    const wsUrl = `/voice?sessionId=${wsSessionId}`;

    await persistAndPublish(callSession.id, 'call.started', {
      clientType: params.clientType,
      wsSessionId,
      engine: 'pipeline',
    });

    this.log.info({ callSessionId: callSession.id, wsSessionId }, 'pipeline call started');

    return {
      engine: 'pipeline',
      callSessionId: callSession.id,
      wsUrl,
      wsSessionId,
    };
  }
}

