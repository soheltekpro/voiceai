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
  llmModel?: string | null;
  ttsProvider?: string | null;
  voice?: string;
  temperature?: number | null;
  language?: string;
  voiceProvider?: 'OPENAI' | 'ELEVENLABS';
  maxCallDurationSeconds?: number;
  interruptionBehavior?: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING';
  knowledgeBaseId?: string | null;
  /** V2V realtime: provider (e.g. openai, google). */
  v2vProvider?: string | null;
  /** V2V realtime: model id. */
  v2vModel?: string | null;
  /** V2V realtime: voice id. */
  v2vVoice?: string | null;
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
    v2vProvider: payload.v2vProvider ?? null,
    v2vModel: payload.v2vModel ?? null,
    v2vVoice: payload.v2vVoice ?? null,
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
    v2vProvider: payload.v2vProvider ?? null,
    v2vModel: payload.v2vModel ?? null,
    v2vVoice: payload.v2vVoice ?? null,
  });
}

/** Delete an agent. */
export async function deleteAgent(id: string): Promise<void> {
  return apiDelete(`${BASE}/agents/${id}`);
}

export type PromptOptimizationItem = {
  id: string;
  suggestion: string;
  createdAt: string;
};

/** Fetch latest AI prompt optimization suggestions for an agent. */
export async function fetchPromptOptimizations(
  agentId: string,
  limit?: number
): Promise<{ items: PromptOptimizationItem[] }> {
  const q = limit != null ? `?limit=${limit}` : '';
  return apiGet<{ items: PromptOptimizationItem[] }>(`${BASE}/agents/${agentId}/prompt-optimization${q}`);
}

/** Generate a new prompt optimization suggestion from recent call evaluations. */
export async function generatePromptOptimization(agentId: string): Promise<PromptOptimizationItem> {
  return apiPost<PromptOptimizationItem>(`${BASE}/agents/${agentId}/prompt-optimization`, {});
}

// --- Prompt versions (A/B testing) ---

export type PromptVersionItem = {
  id: string;
  version: number;
  systemPrompt: string;
  isActive: boolean;
  trafficShare: number;
  createdAt: string;
};

export type PromptPerformanceItem = {
  promptVersionId: string;
  version: number;
  trafficShare: number;
  isActive: boolean;
  callsTotal: number;
  conversionRate: number | null;
  avgScore: number | null;
  avgDurationSeconds: number | null;
};

export async function fetchPromptVersions(agentId: string): Promise<{ items: PromptVersionItem[] }> {
  return apiGet<{ items: PromptVersionItem[] }>(`${BASE}/agents/${agentId}/prompt-versions`);
}

export async function createPromptVersion(
  agentId: string,
  payload: { systemPrompt: string; isActive?: boolean; trafficShare?: number }
): Promise<PromptVersionItem> {
  return apiPost<PromptVersionItem>(`${BASE}/agents/${agentId}/prompt-version`, payload);
}

export async function fetchPromptPerformance(agentId: string): Promise<{ items: PromptPerformanceItem[] }> {
  return apiGet<{ items: PromptPerformanceItem[] }>(`${BASE}/agents/${agentId}/prompt-performance`);
}

export async function updatePromptVersion(
  agentId: string,
  versionId: string,
  payload: { isActive?: boolean; trafficShare?: number }
): Promise<PromptVersionItem> {
  return apiPatch<PromptVersionItem>(`${BASE}/agents/${agentId}/prompt-versions/${versionId}`, payload);
}
