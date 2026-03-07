import type { VoiceAIClient } from './client.js';

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  agentType: 'PIPELINE' | 'V2V' | string;
  systemPrompt: string | null;
  language: string | null;
  voiceName: string | null;
  voiceProvider?: string | null;
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  knowledgeBaseId?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type AgentListParams = {
  limit?: number;
  offset?: number;
};

export type AgentListResponse = {
  items: Agent[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentCreateInput = {
  name: string;
  description?: string | null;
  agentType?: 'PIPELINE' | 'V2V';
  systemPrompt?: string;
  language?: string;
  voice?: string;
  voiceProvider?: string;
  sttProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  maxCallDurationSeconds?: number;
  interruptionBehavior?: string;
  knowledgeBaseId?: string | null;
};

export class AgentsResource {
  constructor(private client: VoiceAIClient) {}

  list(params: AgentListParams = {}): Promise<AgentListResponse> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return this.client.request('GET', `/api/v1/agents?limit=${limit}&offset=${offset}`);
  }

  create(input: AgentCreateInput): Promise<Agent> {
    return this.client.request('POST', '/api/v1/agents', input);
  }
}

