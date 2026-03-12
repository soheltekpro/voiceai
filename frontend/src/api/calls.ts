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

export type CallsStatsParams = {
  agent_id?: string;
  agentId?: string;
  status?: 'ACTIVE' | 'ENDED' | 'ERROR';
};

export type CallsStats = {
  totalCalls: number;
  totalDurationSeconds: number;
  totalMinutes: number;
  totalCostUsd: number;
  totalCostInr: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
};

export async function fetchCallsStats(params?: CallsStatsParams): Promise<CallsStats> {
  const search = new URLSearchParams();
  if (params?.agent_id) search.set('agent_id', params.agent_id);
  else if (params?.agentId) search.set('agent_id', params.agentId);
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return apiGet<CallsStats>(`${BASE}/calls/stats${qs ? `?${qs}` : ''}`);
}

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

export type CallOutcome = {
  outcome: string;
  confidence: number;
  summary: string;
};

export async function fetchCallOutcome(callId: string): Promise<CallOutcome> {
  return apiGet<CallOutcome>(`${BASE}/calls/${callId}/outcome`);
}

/** Outcome by call session id (for Voice Analytics modal). */
export async function fetchCallSessionOutcome(sessionId: string): Promise<CallOutcome> {
  return apiGet<CallOutcome>(`${BASE}/call-sessions/${encodeURIComponent(sessionId)}/outcome`);
}

export type CallGuidanceItem = {
  id: string;
  suggestion: string;
  createdAt: string;
};

export type CallGuidanceResponse = {
  items: CallGuidanceItem[];
};

export async function fetchCallGuidance(callId: string): Promise<CallGuidanceResponse> {
  return apiGet<CallGuidanceResponse>(`${BASE}/calls/${callId}/guidance`);
}

/** Guidance by call session id (for Voice Analytics / live call inspector). */
export async function fetchCallSessionGuidance(sessionId: string): Promise<CallGuidanceResponse> {
  return apiGet<CallGuidanceResponse>(`${BASE}/call-sessions/${encodeURIComponent(sessionId)}/guidance`);
}

export type CallEvaluation = {
  score: number;
  strengths: string;
  improvements: string;
};

export async function fetchCallEvaluation(callId: string): Promise<CallEvaluation> {
  return apiGet<CallEvaluation>(`${BASE}/calls/${callId}/evaluation`);
}

/** Evaluation by call session id (for Voice Analytics inspector). */
export async function fetchCallSessionEvaluation(sessionId: string): Promise<CallEvaluation> {
  return apiGet<CallEvaluation>(`${BASE}/call-sessions/${encodeURIComponent(sessionId)}/evaluation`);
}
