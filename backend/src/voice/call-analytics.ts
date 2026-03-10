/**
 * In-memory store for voice call metrics (dashboard, analytics, live monitoring).
 * Complements call-trace (debug) with agentId, duration, interruptions, and recent-calls list.
 */

import { metrics } from '../infra/metrics.js';

export interface VoiceCallMetrics {
  callId: string;
  agentId: string;
  workspaceId?: string;
  startedAt: number;
  endedAt?: number;

  /** Resolved voice region for multi-region routing (e.g. us-east, eu-west, ap-south). */
  region?: string;
  durationMs?: number;
  sttLatencyMs?: number;
  llmFirstTokenMs?: number;
  llmDurationMs?: number;
  ttsFirstAudioMs?: number;
  ttsDurationMs?: number;

  interruptions?: number;
  /** Number of provider failovers during this call (STT/LLM/TTS). */
  failoverCount?: number;
  providerUsed?: {
    stt?: string;
    llm?: string;
    tts?: string;
  };
}

const activeMetrics = new Map<string, VoiceCallMetrics>();
const recentList: VoiceCallMetrics[] = [];
const RECENT_MAX = 200;
const RECENT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24h

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

export function startCallMetrics(
  callId: string,
  agentId: string,
  workspaceId?: string,
  region?: string
): VoiceCallMetrics {
  const m: VoiceCallMetrics = {
    callId,
    agentId,
    workspaceId,
    region,
    startedAt: Date.now(),
  };
  activeMetrics.set(callId, m);
  if (region) metrics.callsByRegion.inc({ region });
  return m;
}

export function updateCallMetrics(
  callId: string,
  partial: Partial<Omit<VoiceCallMetrics, 'callId' | 'agentId' | 'startedAt'>>
): void {
  const m = activeMetrics.get(callId);
  if (!m) return;
  if (partial.endedAt !== undefined) m.endedAt = partial.endedAt;
  if (partial.workspaceId !== undefined) m.workspaceId = partial.workspaceId;
  if (partial.region !== undefined) m.region = partial.region;
  if (partial.durationMs !== undefined) m.durationMs = partial.durationMs;
  if (partial.sttLatencyMs !== undefined) m.sttLatencyMs = partial.sttLatencyMs;
  if (partial.llmFirstTokenMs !== undefined) m.llmFirstTokenMs = partial.llmFirstTokenMs;
  if (partial.llmDurationMs !== undefined) m.llmDurationMs = partial.llmDurationMs;
  if (partial.ttsFirstAudioMs !== undefined) m.ttsFirstAudioMs = partial.ttsFirstAudioMs;
  if (partial.ttsDurationMs !== undefined) m.ttsDurationMs = partial.ttsDurationMs;
  if (partial.interruptions !== undefined) m.interruptions = partial.interruptions;
  if (partial.failoverCount !== undefined) m.failoverCount = (m.failoverCount ?? 0) + partial.failoverCount;
  if (partial.providerUsed !== undefined) {
    m.providerUsed = { ...m.providerUsed, ...partial.providerUsed };
  }
}

export function finishCallMetrics(callId: string): VoiceCallMetrics | undefined {
  const m = activeMetrics.get(callId);
  if (!m) return undefined;
  m.endedAt = Date.now();
  m.durationMs = m.endedAt - m.startedAt;
  if (m.region && m.durationMs != null) {
    metrics.callDurationByRegion.observe({ region: m.region }, m.durationMs / 1000);
  }
  activeMetrics.delete(callId);
  recentList.unshift({ ...m });
  if (recentList.length > RECENT_MAX) recentList.pop();
  // Drop very old entries
  const cutoff = Date.now() - RECENT_RETENTION_MS;
  while (recentList.length > 0 && (recentList[recentList.length - 1]?.endedAt ?? 0) < cutoff) {
    recentList.pop();
  }
  return m;
}

export function getCallMetrics(callId: string): VoiceCallMetrics | undefined {
  const active = activeMetrics.get(callId);
  if (active) return { ...active };
  const recent = recentList.find((r) => r.callId === callId);
  return recent ? { ...recent } : undefined;
}

export function getActiveCallCount(): number {
  return activeMetrics.size;
}

export function getRecentCalls(limit = 50, workspaceId?: string): VoiceCallMetrics[] {
  const filtered = workspaceId
    ? recentList.filter((c) => c.workspaceId === workspaceId)
    : recentList;
  return filtered.slice(0, limit).map((c) => ({ ...c }));
}

export function getActiveCalls(workspaceId?: string): VoiceCallMetrics[] {
  const list = Array.from(activeMetrics.values());
  const filtered = workspaceId ? list.filter((c) => c.workspaceId === workspaceId) : list;
  return filtered.map((c) => ({ ...c }));
}
