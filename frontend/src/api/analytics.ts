import { apiGet } from './client';

export type AnalyticsResponse = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageCallDuration: number;
  toolUsageCounts: Record<string, number>;
  tokenUsage: number;
  callsPerDay: Array<{ date: string; calls: number; avgDuration: number; tokens: number }>;
};

export async function getAnalytics(days = 30): Promise<AnalyticsResponse> {
  return apiGet<AnalyticsResponse>(`/api/v1/analytics?days=${days}`);
}
