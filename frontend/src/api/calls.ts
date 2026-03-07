/**
 * Call History API – GET /api/v1/calls, GET /api/v1/calls/:id, GET /api/v1/calls/:id/events
 */

import { apiGet } from './client';
import type { Call, CallEvent, Paginated } from '../admin/types';

const BASE = '/api/v1';

export type CallsListParams = {
  limit?: number;
  offset?: number;
  agent_id?: string;
  agentId?: string;
  status?: 'ACTIVE' | 'ENDED' | 'ERROR';
};

export async function fetchCalls(params?: CallsListParams): Promise<Paginated<Call>> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.agent_id) search.set('agent_id', params.agent_id);
  else if (params?.agentId) search.set('agent_id', params.agentId);
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return apiGet<Paginated<Call>>(`${BASE}/calls${qs ? `?${qs}` : ''}`);
}

export async function fetchCall(id: string): Promise<Call> {
  return apiGet<Call>(`${BASE}/calls/${id}`);
}

export type CallEventsListParams = {
  limit?: number;
  offset?: number;
};

export async function fetchCallEvents(
  callId: string,
  params?: CallEventsListParams
): Promise<Paginated<CallEvent>> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return apiGet<Paginated<CallEvent>>(`${BASE}/calls/${callId}/events${qs ? `?${qs}` : ''}`);
}

export type ConversationMessage = {
  id: string;
  callId: string;
  role: 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
  createdAt: string;
};

export async function fetchCallMessages(
  callId: string,
  params?: { limit?: number; offset?: number }
): Promise<Paginated<ConversationMessage>> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return apiGet<Paginated<ConversationMessage>>(`${BASE}/calls/${callId}/messages${qs ? `?${qs}` : ''}`);
}
