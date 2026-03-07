import { apiGet } from './client';

export type BillingPlan = {
  id: string;
  name: string;
  price: number;
  callMinutesLimit: number | null;
  tokenLimit: number | null;
  toolCallsLimit: number | null;
  sttSecondsLimit: number | null;
  ttsSecondsLimit: number | null;
};

export type UsageMetrics = {
  call_minutes: number;
  llm_tokens: number;
  stt_seconds: number;
  tts_seconds: number;
  tool_calls: number;
};

export type BillingResponse = {
  plan: BillingPlan | null;
  usage: UsageMetrics;
  period: { start: string; end: string };
};

export type UsageResponse = {
  usage: UsageMetrics;
  period: { start: string; end: string };
};

export async function getBilling(): Promise<BillingResponse> {
  return apiGet<BillingResponse>('/api/v1/billing');
}

export async function getUsage(params?: { periodStart?: string; periodEnd?: string }): Promise<UsageResponse> {
  const q = params?.periodStart && params?.periodEnd
    ? `?periodStart=${encodeURIComponent(params.periodStart)}&periodEnd=${encodeURIComponent(params.periodEnd)}`
    : '';
  return apiGet<UsageResponse>(`/api/v1/usage${q}`);
}
