import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';
import { PipelineEngine, type PipelineStartResult } from './pipeline-engine.js';
import { RealtimeEngine, type RealtimeStartResult } from './realtime-engine.js';

export type AgentType = 'PIPELINE' | 'V2V';

export type CallStartRequest = {
  agentId: string;
  clientType: 'BROWSER' | 'PHONE' | 'UNKNOWN';
};

export type CallStartResult = (PipelineStartResult | RealtimeStartResult) & {
  agentType: AgentType;
};

export class AgentOrchestrator {
  private pipeline: PipelineEngine;
  private realtime: RealtimeEngine;

  constructor(private log: FastifyBaseLogger) {
    this.pipeline = new PipelineEngine(log);
    this.realtime = new RealtimeEngine(log);
  }

  async startCall(req: CallStartRequest): Promise<CallStartResult> {
    const agent = await prisma.agent.findUnique({
      where: { id: req.agentId },
      select: { id: true, agentType: true },
    });
    if (!agent) {
      throw new Error('Agent not found');
    }

    const agentType = (agent.agentType as AgentType) ?? 'PIPELINE';

    if (agentType === 'V2V') {
      const res = await this.realtime.startCall({ agentId: agent.id });
      return { ...res, agentType };
    }

    const res = await this.pipeline.startCall({ agentId: agent.id, clientType: req.clientType });
    return { ...res, agentType };
  }
}

