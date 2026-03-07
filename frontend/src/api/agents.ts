/**
 * Frontend service for managing voice agents.
 * Uses backend APIs: GET/POST /agents, GET/PUT/DELETE /agents/:id.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client';
import type { Agent, Paginated } from '../admin/types';

const BASE = '/api/v1';

export type AgentCreatePayload = {
  name: string;
  description?: string | null;
  agentType?: 'PIPELINE' | 'V2V';
  systemPrompt?: string;
  sttProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  voice?: string;
  language?: string;
  voiceProvider?: 'OPENAI' | 'ELEVENLABS';
  maxCallDurationSeconds?: number;
  interruptionBehavior?: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING';
  knowledgeBaseId?: string | null;
};

export type AgentUpdatePayload = Partial<AgentCreatePayload>;

/** Fetch paginated list of agents (stored in database). */
export async function fetchAgents(params?: { limit?: number; offset?: number }): Promise<Paginated<Agent>> {
  const limit = params?.limit ?? 100;
  const offset = params?.offset ?? 0;
  return apiGet<Paginated<Agent>>(`${BASE}/agents?limit=${limit}&offset=${offset}`);
}

/** Fetch a single agent by id. */
export async function fetchAgent(id: string): Promise<Agent> {
  return apiGet<Agent>(`${BASE}/agents/${id}`);
}

/** Create an agent and store in database. */
export async function createAgent(payload: AgentCreatePayload): Promise<Agent> {
  return apiPost<Agent>(`${BASE}/agents`, {
    name: payload.name,
    description: payload.description ?? null,
    agentType: payload.agentType ?? 'PIPELINE',
    systemPrompt: payload.systemPrompt,
    sttProvider: payload.sttProvider ?? null,
    llmProvider: payload.llmProvider ?? null,
    ttsProvider: payload.ttsProvider ?? null,
    voice: payload.voice,
    language: payload.language,
    voiceProvider: payload.voiceProvider,
    maxCallDurationSeconds: payload.maxCallDurationSeconds,
    interruptionBehavior: payload.interruptionBehavior,
    knowledgeBaseId: payload.knowledgeBaseId ?? null,
  });
}

/** Update an agent (partial or full). */
export async function updateAgent(id: string, payload: AgentUpdatePayload): Promise<Agent> {
  return apiPatch<Agent>(`${BASE}/agents/${id}`, payload);
}

/** Full replace an agent (PUT). */
export async function replaceAgent(id: string, payload: AgentCreatePayload): Promise<Agent> {
  return apiPut<Agent>(`${BASE}/agents/${id}`, {
    name: payload.name,
    description: payload.description ?? null,
    agentType: payload.agentType ?? 'PIPELINE',
    systemPrompt: payload.systemPrompt,
    sttProvider: payload.sttProvider ?? null,
    llmProvider: payload.llmProvider ?? null,
    ttsProvider: payload.ttsProvider ?? null,
    voice: payload.voice,
    language: payload.language,
    voiceProvider: payload.voiceProvider,
    maxCallDurationSeconds: payload.maxCallDurationSeconds,
    interruptionBehavior: payload.interruptionBehavior,
    knowledgeBaseId: payload.knowledgeBaseId ?? null,
  });
}

/** Delete an agent. */
export async function deleteAgent(id: string): Promise<void> {
  return apiDelete(`${BASE}/agents/${id}`);
}
