import { apiGet, apiPatch } from './client';

export type Workspace = { id: string; name: string; createdAt: string };

export async function fetchWorkspace(): Promise<Workspace> {
  return apiGet<Workspace>('/api/v1/workspace');
}

export async function updateWorkspace(name: string): Promise<Workspace> {
  return apiPatch<Workspace>('/api/v1/workspace', { name });
}
