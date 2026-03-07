/**
 * Tools and agent-tools APIs.
 */

import { apiGet, apiPost } from './client';

const BASE = '/api/v1';

export type ToolType = 'WEBHOOK' | 'HTTP_REQUEST' | 'DATABASE_LOOKUP';

export type Tool = {
  id: string;
  name: string;
  description: string | null;
  type: ToolType;
  config: Record<string, unknown>;
  createdAt: string;
};

export type Paginated<T> = { items: T[]; total: number; limit: number; offset: number };

export async function fetchTools(params?: { limit?: number; offset?: number }): Promise<Paginated<Tool>> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return apiGet<Paginated<Tool>>(`${BASE}/tools${qs ? `?${qs}` : ''}`);
}

export type ToolCreatePayload = {
  name: string;
  description?: string | null;
  type: ToolType;
  config: Record<string, unknown>;
};

export async function createTool(payload: ToolCreatePayload): Promise<Tool> {
  return apiPost<Tool>(`${BASE}/tools`, payload);
}

export async function fetchAgentTools(agentId: string): Promise<{ items: Tool[] }> {
  return apiGet<{ items: Tool[] }>(`${BASE}/agents/${agentId}/tools`);
}

export async function setAgentTools(agentId: string, toolIds: string[]): Promise<{ items: Tool[] }> {
  return apiPost<{ items: Tool[] }>(`${BASE}/agents/${agentId}/tools`, { toolIds });
}
