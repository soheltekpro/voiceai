import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';
import { persistAndPublish } from '../events/persist.js';

export type PipelineStartResult = {
  engine: 'pipeline';
  callSessionId: string;
  wsUrl: string;
  wsSessionId: string;
  regionId?: string;
};

export class PipelineEngine {
  constructor(private log: FastifyBaseLogger) {}

  async startCall(params: {
    agentId: string | null;
    clientType: 'BROWSER' | 'PHONE' | 'UNKNOWN';
    regionId?: string;
    regionalWsBaseUrl?: string | null;
  }): Promise<PipelineStartResult> {
    const metadata = { started_via: 'orchestrator', ...(params.regionId && { region: params.regionId }) };

    const callSession = await prisma.callSession.create({
      data: {
        agentId: params.agentId,
        clientType: params.clientType,
        status: 'ACTIVE',
        metadata: metadata as object,
      },
    });

    const wsSessionId = randomUUID();
    const relativePath = `/voice?sessionId=${wsSessionId}`;
    const regionalPath = `/api/v1/voice?sessionId=${wsSessionId}`;
    let wsUrl: string;
    if (params.regionalWsBaseUrl) {
      const base = params.regionalWsBaseUrl.replace(/\/+$/, '');
      // Return a proper WebSocket URL: https -> wss, http -> ws
      const wsBase = base.startsWith('https://') ? base.replace('https://', 'wss://') : base.startsWith('http://') ? base.replace('http://', 'ws://') : base;
      wsUrl = `${wsBase}${regionalPath}`;
    } else {
      wsUrl = relativePath;
    }

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
      ...(params.regionId && { regionId: params.regionId }),
    };
  }
}

