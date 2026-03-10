/**
 * Per-call voice usage metering for billing and quota.
 * Tracks audio I/O, LLM tokens, TTS characters, and providers.
 * In-memory store with DB persistence on finish. Cost computed via voice-cost.ts.
 */

import { prisma } from '../db/prisma.js';
import { calculateVoiceCost } from './voice-cost.js';

export interface VoiceUsage {
  callId: string;
  workspaceId: string;
  agentId: string;
  startedAt: number;
  endedAt?: number;

  audioInputSeconds: number;
  audioOutputSeconds: number;

  llmInputTokens: number;
  llmOutputTokens: number;

  ttsCharacters: number;

  sttProvider?: string;
  llmProvider?: string;
  ttsProvider?: string;

  sttCost?: number;
  llmCost?: number;
  ttsCost?: number;
  totalCost?: number;
}

const usageByCallId = new Map<string, VoiceUsage>();
const completedUsage: VoiceUsage[] = [];
const COMPLETED_CAP = 5000;

/** 16-bit mono: bytes per second = sampleRate * 2 */
function bytesToSeconds(bytes: number, sampleRate: number): number {
  if (sampleRate <= 0) return 0;
  return bytes / (sampleRate * 2);
}

export function startVoiceUsage(
  callId: string,
  workspaceId: string,
  agentId: string,
  providers?: { sttProvider?: string; llmProvider?: string; ttsProvider?: string }
): VoiceUsage {
  const u: VoiceUsage = {
    callId,
    workspaceId,
    agentId,
    startedAt: Date.now(),
    audioInputSeconds: 0,
    audioOutputSeconds: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    ttsCharacters: 0,
    ...providers,
  };
  usageByCallId.set(callId, u);
  return u;
}

export function updateVoiceUsage(
  callId: string,
  partial: Partial<
    Pick<
      VoiceUsage,
      | 'endedAt'
      | 'audioInputSeconds'
      | 'audioOutputSeconds'
      | 'llmInputTokens'
      | 'llmOutputTokens'
      | 'ttsCharacters'
      | 'sttProvider'
      | 'llmProvider'
      | 'ttsProvider'
    >
  >
): void {
  const u = usageByCallId.get(callId);
  if (!u) return;
  if (partial.endedAt !== undefined) u.endedAt = partial.endedAt;
  if (partial.audioInputSeconds !== undefined) u.audioInputSeconds += partial.audioInputSeconds;
  if (partial.audioOutputSeconds !== undefined) u.audioOutputSeconds += partial.audioOutputSeconds;
  if (partial.llmInputTokens !== undefined) u.llmInputTokens += partial.llmInputTokens;
  if (partial.llmOutputTokens !== undefined) u.llmOutputTokens += partial.llmOutputTokens;
  if (partial.ttsCharacters !== undefined) u.ttsCharacters += partial.ttsCharacters;
  if (partial.sttProvider !== undefined) u.sttProvider = partial.sttProvider;
  if (partial.llmProvider !== undefined) u.llmProvider = partial.llmProvider;
  if (partial.ttsProvider !== undefined) u.ttsProvider = partial.ttsProvider;
}

/** Add PCM input bytes (16-bit mono) to call usage. */
export function addVoiceUsageAudioInput(callId: string, bytes: number, sampleRate: number): void {
  const sec = bytesToSeconds(bytes, sampleRate);
  updateVoiceUsage(callId, { audioInputSeconds: sec });
}

/** Add PCM output bytes (16-bit mono). Default 24kHz if not specified. */
export function addVoiceUsageAudioOutput(callId: string, bytes: number, sampleRate = 24000): void {
  const sec = bytesToSeconds(bytes, sampleRate);
  updateVoiceUsage(callId, { audioOutputSeconds: sec });
}

export function finishVoiceUsage(callId: string): VoiceUsage | undefined {
  const u = usageByCallId.get(callId);
  if (!u) return undefined;
  u.endedAt = u.endedAt ?? Date.now();
  usageByCallId.delete(callId);
  const copy = { ...u };
  completedUsage.unshift(copy);
  if (completedUsage.length > COMPLETED_CAP) completedUsage.pop();
  void persistVoiceUsage(copy);
  return copy;
}

/** Persist a voice usage record to the database. Computes cost from pricing table before saving. */
export async function persistVoiceUsage(u: VoiceUsage): Promise<void> {
  try {
    const cost = await calculateVoiceCost({
      audioInputSeconds: u.audioInputSeconds,
      audioOutputSeconds: u.audioOutputSeconds,
      llmInputTokens: u.llmInputTokens,
      llmOutputTokens: u.llmOutputTokens,
      ttsCharacters: u.ttsCharacters,
      sttProvider: u.sttProvider,
      llmProvider: u.llmProvider,
      ttsProvider: u.ttsProvider,
    });
    Object.assign(u, cost);
    await prisma.voiceUsage.create({
      data: {
        callId: u.callId,
        workspaceId: u.workspaceId,
        agentId: u.agentId,
        startedAt: new Date(u.startedAt),
        endedAt: u.endedAt != null ? new Date(u.endedAt) : null,
        audioInputSeconds: u.audioInputSeconds,
        audioOutputSeconds: u.audioOutputSeconds,
        llmInputTokens: u.llmInputTokens,
        llmOutputTokens: u.llmOutputTokens,
        ttsCharacters: u.ttsCharacters,
        sttProvider: u.sttProvider ?? null,
        llmProvider: u.llmProvider ?? null,
        ttsProvider: u.ttsProvider ?? null,
        sttCost: cost.sttCost,
        llmCost: cost.llmCost,
        ttsCost: cost.ttsCost,
        totalCost: cost.totalCost,
      },
    });
  } catch (err) {
    console.warn('[voice-usage] persist failed', u.callId, err);
  }
}

/** Load voice usage rows from DB for a workspace and period (for aggregation). */
export async function getVoiceUsageFromDb(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<VoiceUsage[]> {
  const rows = await prisma.voiceUsage.findMany({
    where: {
      workspaceId,
      endedAt: { gte: periodStart, lte: periodEnd },
    },
    orderBy: { endedAt: 'asc' },
  });
  return rows.map((r) => ({
    callId: r.callId,
    workspaceId: r.workspaceId,
    agentId: r.agentId,
    startedAt: r.startedAt.getTime(),
    endedAt: r.endedAt?.getTime(),
    audioInputSeconds: r.audioInputSeconds,
    audioOutputSeconds: r.audioOutputSeconds,
    llmInputTokens: r.llmInputTokens,
    llmOutputTokens: r.llmOutputTokens,
    ttsCharacters: r.ttsCharacters,
    sttProvider: r.sttProvider ?? undefined,
    llmProvider: r.llmProvider ?? undefined,
    ttsProvider: r.ttsProvider ?? undefined,
    sttCost: r.sttCost,
    llmCost: r.llmCost,
    ttsCost: r.ttsCost,
    totalCost: r.totalCost,
  }));
}

export function getVoiceUsage(callId: string): VoiceUsage | undefined {
  return usageByCallId.get(callId);
}

/** Get completed usage records for a workspace in a period (for aggregation). */
export function getVoiceUsageForWorkspace(
  workspaceId: string,
  periodStart?: Date,
  periodEnd?: Date
): VoiceUsage[] {
  const startTs = periodStart?.getTime() ?? 0;
  const endTs = periodEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  return completedUsage.filter((u) => {
    if (u.workspaceId !== workspaceId) return false;
    const t = u.endedAt ?? u.startedAt;
    return t >= startTs && t <= endTs;
  });
}

export type VoiceUsageAggregate = {
  totalCallMinutes: number;
  totalLLMTokens: number;
  totalTTSCharacters: number;
  providerUsage: Record<string, { callMinutes: number; llmTokens: number; ttsCharacters: number }>;
};

export function aggregateVoiceUsage(rows: VoiceUsage[]): VoiceUsageAggregate {
  let totalCallMinutes = 0;
  let totalLLMTokens = 0;
  let totalTTSCharacters = 0;
  const providerUsage: Record<string, { callMinutes: number; llmTokens: number; ttsCharacters: number }> = {};

  for (const u of rows) {
    const callMinutes = (u.audioInputSeconds + u.audioOutputSeconds) / 60;
    totalCallMinutes += callMinutes;
    totalLLMTokens += u.llmInputTokens + u.llmOutputTokens;
    totalTTSCharacters += u.ttsCharacters;

    const key = [u.sttProvider ?? 'unknown', u.llmProvider ?? 'unknown', u.ttsProvider ?? 'unknown'].join('|');
    if (!providerUsage[key]) providerUsage[key] = { callMinutes: 0, llmTokens: 0, ttsCharacters: 0 };
    providerUsage[key].callMinutes += callMinutes;
    providerUsage[key].llmTokens += u.llmInputTokens + u.llmOutputTokens;
    providerUsage[key].ttsCharacters += u.ttsCharacters;
  }

  return {
    totalCallMinutes: Math.round(totalCallMinutes * 100) / 100,
    totalLLMTokens,
    totalTTSCharacters,
    providerUsage,
  };
}

/** Current calendar month period for voice quota. */
function getCurrentMonthPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { periodStart, periodEnd };
}

export type VoiceQuotaResult = {
  plan: string | null;
  callMinutesUsed: number;
  callMinutesLimit: number | null;
  llmTokensUsed: number;
  llmTokensLimit: number | null;
  ttsCharsUsed: number;
  ttsCharsLimit: number | null;
};

/** Get voice quota and usage for a workspace (current month). */
export async function getVoiceQuota(workspaceId: string): Promise<VoiceQuotaResult> {
  const { periodStart, periodEnd } = getCurrentMonthPeriod();
  const [planRow, rows] = await Promise.all([
    prisma.workspaceVoicePlan.findUnique({ where: { workspaceId } }),
    getVoiceUsageFromDb(workspaceId, periodStart, periodEnd),
  ]);
  const agg = aggregateVoiceUsage(rows);
  const callMinutesUsed = agg.totalCallMinutes;
  const llmTokensUsed = agg.totalLLMTokens;
  const ttsCharsUsed = agg.totalTTSCharacters;

  return {
    plan: planRow?.planName ?? null,
    callMinutesUsed,
    callMinutesLimit: planRow?.monthlyCallMinutes ?? null,
    llmTokensUsed,
    llmTokensLimit: planRow?.monthlyLLMTokens ?? null,
    ttsCharsUsed,
    ttsCharsLimit: planRow?.monthlyTTSCharacters ?? null,
  };
}

export type CheckVoiceQuotaResult = { allowed: boolean; reason?: string };

/** Check if workspace is within voice quota. Use before starting a call. */
export async function checkVoiceQuota(workspaceId: string): Promise<CheckVoiceQuotaResult> {
  const q = await getVoiceQuota(workspaceId);
  if (q.callMinutesLimit != null && q.callMinutesLimit > 0 && q.callMinutesUsed >= q.callMinutesLimit) {
    return { allowed: false, reason: 'quota_exceeded' };
  }
  if (q.llmTokensLimit != null && q.llmTokensLimit > 0 && q.llmTokensUsed >= q.llmTokensLimit) {
    return { allowed: false, reason: 'quota_exceeded' };
  }
  if (q.ttsCharsLimit != null && q.ttsCharsLimit > 0 && q.ttsCharsUsed >= q.ttsCharsLimit) {
    return { allowed: false, reason: 'quota_exceeded' };
  }
  return { allowed: true };
}

export type VoiceCostSummary = {
  workspaceCost: number;
  costBreakdownByProvider: {
    stt: Record<string, number>;
    llm: Record<string, number>;
    tts: Record<string, number>;
  };
  costPerCall: Array<{ callId: string; totalCost: number; sttCost: number; llmCost: number; ttsCost: number }>;
  period: { start: Date; end: Date };
};

/** Get cost summary for a workspace in a period (for GET /usage/cost). */
export async function getVoiceCostSummary(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<VoiceCostSummary> {
  const rows = await getVoiceUsageFromDb(workspaceId, periodStart, periodEnd);
  const stt: Record<string, number> = {};
  const llm: Record<string, number> = {};
  const tts: Record<string, number> = {};
  let workspaceCost = 0;
  const costPerCall: VoiceCostSummary['costPerCall'] = [];

  for (const r of rows) {
    const total = r.totalCost ?? 0;
    const sttC = r.sttCost ?? 0;
    const llmC = r.llmCost ?? 0;
    const ttsC = r.ttsCost ?? 0;
    workspaceCost += total;
    costPerCall.push({
      callId: r.callId,
      totalCost: total,
      sttCost: sttC,
      llmCost: llmC,
      ttsCost: ttsC,
    });
    const sttP = r.sttProvider ?? 'unknown';
    const llmP = r.llmProvider ?? 'unknown';
    const ttsP = r.ttsProvider ?? 'unknown';
    stt[sttP] = (stt[sttP] ?? 0) + sttC;
    llm[llmP] = (llm[llmP] ?? 0) + llmC;
    tts[ttsP] = (tts[ttsP] ?? 0) + ttsC;
  }

  return {
    workspaceCost: Math.round(workspaceCost * 1e6) / 1e6,
    costBreakdownByProvider: { stt, llm, tts },
    costPerCall,
    period: { start: periodStart, end: periodEnd },
  };
}
