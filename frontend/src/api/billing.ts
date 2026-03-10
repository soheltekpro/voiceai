import { apiGet, apiPost } from './client';

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

export type VoiceUsageResponse = {
  totalCallMinutes: number;
  totalLLMTokens: number;
  totalTTSCharacters: number;
  providerUsage: Record<string, { callMinutes: number; llmTokens: number; ttsCharacters: number }>;
  period: { start: string; end: string };
};

export async function getVoiceUsage(params?: { periodStart?: string; periodEnd?: string }): Promise<VoiceUsageResponse> {
  const q = params?.periodStart && params?.periodEnd
    ? `?periodStart=${encodeURIComponent(params.periodStart)}&periodEnd=${encodeURIComponent(params.periodEnd)}`
    : '';
  return apiGet<VoiceUsageResponse>(`/api/v1/usage/voice${q}`);
}

export type QuotaResponse = {
  plan: string | null;
  callMinutesUsed: number;
  callMinutesLimit: number | null;
  llmTokensUsed: number;
  llmTokensLimit: number | null;
  ttsCharsUsed: number;
  ttsCharsLimit: number | null;
};

export async function getQuota(): Promise<QuotaResponse> {
  return apiGet<QuotaResponse>('/api/v1/usage/quota');
}

export type CostResponse = {
  workspaceCost: number;
  costBreakdownByProvider: {
    stt: Record<string, number>;
    llm: Record<string, number>;
    tts: Record<string, number>;
  };
  costPerCall: Array<{ callId: string; totalCost: number; sttCost: number; llmCost: number; ttsCost: number }>;
  period: { start: string; end: string };
};

export async function getCost(params?: { periodStart?: string; periodEnd?: string }): Promise<CostResponse> {
  const q =
    params?.periodStart && params?.periodEnd
      ? `?periodStart=${encodeURIComponent(params.periodStart)}&periodEnd=${encodeURIComponent(params.periodEnd)}`
      : '';
  return apiGet<CostResponse>(`/api/v1/usage/cost${q}`);
}

// --- Stripe billing (subscribe, cancel, status) ---

export type BillingStatusResponse = {
  plan: {
    name: string;
    status: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  } | null;
  nextInvoice: {
    amountDue?: number;
    currency?: string;
    periodEnd?: string;
  } | null;
  subscription: {
    status?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: number;
  } | null;
  usage: {
    call_minutes: number;
    llm_tokens: number;
    stt_seconds: number;
    tts_seconds: number;
    tool_calls: number;
    callMinutesUsed: number;
    llmTokensUsed: number;
    ttsCharsUsed: number;
  };
  period: { start: string; end: string };
};

export async function getBillingStatus(): Promise<BillingStatusResponse> {
  return apiGet<BillingStatusResponse>('/api/v1/billing/status');
}

export async function subscribeBilling(plan: string): Promise<{ subscriptionId: string; plan: string; itemIds?: Record<string, string> }> {
  return apiPost<{ subscriptionId: string; plan: string; itemIds?: Record<string, string> }>('/api/v1/billing/subscribe', { plan });
}

export async function cancelBilling(immediately = false): Promise<{ ok: boolean; message: string }> {
  return apiPost<{ ok: boolean; message: string }>('/api/v1/billing/cancel', { immediately });
}
