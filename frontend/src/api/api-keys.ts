import { apiGet, apiPost, apiDelete } from './client';

export type ApiKeySummary = { id: string; name: string; createdAt: string };

export async function fetchApiKeys(): Promise<{ items: ApiKeySummary[] }> {
  return apiGet<{ items: ApiKeySummary[] }>('/api/v1/api-keys');
}

export async function createApiKey(name: string): Promise<{ id: string; name: string; key: string; createdAt: string; message: string }> {
  return apiPost<{ id: string; name: string; key: string; createdAt: string; message: string }>('/api/v1/api-keys', { name });
}

export async function revokeApiKey(id: string): Promise<void> {
  return apiDelete(`/api/v1/api-keys/${id}`);
}
