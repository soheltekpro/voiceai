import { apiGet } from './client';

export type TeamMember = { id: string; email: string; role: string; createdAt: string };

export async function fetchTeam(): Promise<{ items: TeamMember[] }> {
  return apiGet<{ items: TeamMember[] }>('/api/v1/team');
}
