import { apiGet, apiPost } from './client';

export type SipTrunk = {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
  _count?: { phoneNumbers: number };
};

export type PhoneNumber = {
  id: string;
  number: string;
  provider: string;
  sipTrunkId: string;
  agentId: string | null;
  createdAt: string;
  sipTrunk?: SipTrunk;
  agent?: { id: string; name: string } | null;
};

export type Paginated<T> = { items: T[]; total: number; limit: number; offset: number };

export async function fetchSipTrunks(params?: { limit?: number; offset?: number }): Promise<Paginated<SipTrunk>> {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  return apiGet<Paginated<SipTrunk>>(`/api/v1/sip-trunks?${q.toString()}`);
}

export async function createSipTrunk(body: { provider: string; name: string; config: Record<string, unknown> }): Promise<SipTrunk> {
  return apiPost<SipTrunk>('/api/v1/sip-trunks', body);
}

export async function fetchPhoneNumbers(params?: {
  limit?: number;
  offset?: number;
  sipTrunkId?: string;
  agentId?: string;
}): Promise<Paginated<PhoneNumber>> {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  if (params?.sipTrunkId) q.set('sipTrunkId', params.sipTrunkId);
  if (params?.agentId) q.set('agentId', params.agentId);
  return apiGet<Paginated<PhoneNumber>>(`/api/v1/phone-numbers?${q.toString()}`);
}

export async function createPhoneNumber(body: {
  number: string;
  provider: string;
  sipTrunkId: string;
  agentId?: string | null;
}): Promise<PhoneNumber> {
  return apiPost<PhoneNumber>('/api/v1/phone-numbers', body);
}

export type OutboundCallResult = {
  channelId: string;
  phoneNumber: string;
  agentId: string;
};

export async function createOutboundCall(body: { phoneNumber: string; agentId: string }): Promise<OutboundCallResult> {
  return apiPost<OutboundCallResult>('/api/v1/calls/outbound', body);
}
