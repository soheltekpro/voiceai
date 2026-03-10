import { apiGet } from './client';

export type VoiceCallMetrics = {
  callId: string;
  agentId: string;
  workspaceId?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  sttLatencyMs?: number;
  llmFirstTokenMs?: number;
  llmDurationMs?: number;
  ttsFirstAudioMs?: number;
  ttsDurationMs?: number;
  interruptions?: number;
  providerUsed?: { stt?: string; llm?: string; tts?: string };
};

export type VoiceAnalyticsOverview = {
  activeCalls: number;
  totalCallsToday: number;
  avgCallDurationMs: number | null;
  avgLatencyMs: number | null;
};

export type VoiceMonitorEvent =
  | { type: 'call_started'; callId: string; agentId: string; workspaceId?: string; ts: number }
  | { type: 'call_ended'; callId: string; agentId: string; durationMs?: number; ts: number }
  | { type: 'agent_speaking'; callId: string; ts: number }
  | { type: 'agent_interrupted'; callId: string; ts: number };

export async function getVoiceAnalyticsOverview(): Promise<VoiceAnalyticsOverview> {
  return apiGet<VoiceAnalyticsOverview>('/api/v1/voice/analytics/overview');
}

export async function getVoiceAnalyticsActive(): Promise<{ calls: VoiceCallMetrics[] }> {
  return apiGet<{ calls: VoiceCallMetrics[] }>('/api/v1/voice/analytics/active');
}

export async function getVoiceAnalyticsRecent(limit = 50): Promise<{ calls: VoiceCallMetrics[] }> {
  return apiGet<{ calls: VoiceCallMetrics[] }>(`/api/v1/voice/analytics/recent?limit=${limit}`);
}

export async function getVoiceCallMetrics(callId: string): Promise<VoiceCallMetrics> {
  return apiGet<VoiceCallMetrics>(`/api/v1/voice/analytics/call/${encodeURIComponent(callId)}`);
}

export function getVoiceMonitorWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/api/v1/voice/monitor';
  const base =
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) ||
    '';
  if (base) {
    const wsBase = base.replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${wsBase}/api/v1/voice/monitor`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/voice/monitor`;
}
