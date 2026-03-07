/**
 * Agent Runtime Loader: loads agent and AgentSettings from PostgreSQL
 * and determines runtime type (pipeline vs v2v) for starting a call.
 */

import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';

export type AgentRuntimeType = 'PIPELINE' | 'V2V';

export type LoadedAgentConfig = {
  agentId: string;
  agentType: AgentRuntimeType;
  name: string;
  description: string | null;
  systemPrompt: string;
  language: string;
  voiceName: string;
  voiceProvider: string;
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  maxCallDurationSeconds: number;
  interruptionBehavior: string;
};

export class AgentRuntimeLoader {
  constructor(private log: FastifyBaseLogger) {}

  /**
   * Fetch agent and AgentSettings by id. Throws if not found.
   * Used when a call is started to load configuration and determine runtime.
   */
  async load(agentId: string): Promise<LoadedAgentConfig> {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { settings: true },
    });
    if (!agent) {
      throw new Error('Agent not found');
    }
    const agentType = (agent.agentType as AgentRuntimeType) ?? 'PIPELINE';
    const settings = agent.settings;
    this.log.info({ agentId, agentType }, 'agent runtime loaded');
    return {
      agentId: agent.id,
      agentType,
      name: agent.name,
      description: agent.description,
      systemPrompt: settings?.systemPrompt ?? 'You are a helpful voice assistant.',
      language: settings?.language ?? 'en',
      voiceName: settings?.voiceName ?? 'alloy',
      voiceProvider: settings?.voiceProvider ?? 'OPENAI',
      sttProvider: settings?.sttProvider ?? null,
      llmProvider: settings?.llmProvider ?? null,
      ttsProvider: settings?.ttsProvider ?? null,
      maxCallDurationSeconds: settings?.maxCallDurationSeconds ?? 900,
      interruptionBehavior: settings?.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT',
    };
  }

  /** Resolve runtime type for a loaded config. */
  getRuntimeType(config: LoadedAgentConfig): AgentRuntimeType {
    return config.agentType;
  }
}
