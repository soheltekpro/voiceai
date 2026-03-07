import { prisma } from '../db/prisma.js';

export const USAGE_METRICS = [
  'call_minutes',
  'llm_tokens',
  'stt_seconds',
  'tts_seconds',
  'tool_calls',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface PlanLimits {
  planId: string;
  planName: string;
  price: number;
  callMinutesLimit: number | null;
  tokenLimit: number | null;
  toolCallsLimit: number | null;
  sttSecondsLimit: number | null;
  ttsSecondsLimit: number | null;
}

export interface UsageSummary {
  call_minutes: number;
  llm_tokens: number;
  stt_seconds: number;
  tts_seconds: number;
  tool_calls: number;
}

/** Current billing period (calendar month). */
export function getCurrentPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { periodStart, periodEnd };
}

/** Get active plan and limits for a workspace. Returns null if no plan or cancelled (unlimited). */
export async function getWorkspacePlan(workspaceId: string): Promise<PlanLimits | null> {
  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!wp || wp.status !== 'ACTIVE') return null;
  const p = wp.plan;
  return {
    planId: p.id,
    planName: p.name,
    price: Number(p.price),
    callMinutesLimit: p.callMinutesLimit ?? null,
    tokenLimit: p.tokenLimit ?? null,
    toolCallsLimit: p.toolCallsLimit ?? null,
    sttSecondsLimit: p.sttSecondsLimit ?? null,
    ttsSecondsLimit: p.ttsSecondsLimit ?? null,
  };
}

/** Get usage totals for a workspace in the given period. */
export async function getUsageForPeriod(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<UsageSummary> {
  const rows = await prisma.workspaceUsage.findMany({
    where: { workspaceId, periodStart, periodEnd },
    select: { metric: true, value: true },
  });
  const out: UsageSummary = {
    call_minutes: 0,
    llm_tokens: 0,
    stt_seconds: 0,
    tts_seconds: 0,
    tool_calls: 0,
  };
  for (const r of rows) {
    if (r.metric in out) (out as unknown as Record<string, number>)[r.metric] = r.value;
  }
  return out;
}

/** Increment a single metric for the current period (upsert). */
export async function incrementUsage(
  workspaceId: string,
  metric: UsageMetric,
  delta: number,
  periodStart?: Date,
  periodEnd?: Date
): Promise<void> {
  const { periodStart: start, periodEnd: end } = periodStart && periodEnd
    ? { periodStart, periodEnd }
    : getCurrentPeriod();
  const rounded = metric === 'call_minutes' ? Math.round(delta) : Math.round(delta);
  const existing = await prisma.workspaceUsage.findUnique({
    where: {
      workspaceId_metric_periodStart: { workspaceId, metric, periodStart: start },
    },
    select: { id: true, value: true },
  });
  const add = Math.round(rounded);
  if (existing) {
    await prisma.workspaceUsage.update({
      where: { id: existing.id },
      data: { value: existing.value + add, updatedAt: new Date() },
    });
  } else {
    await prisma.workspaceUsage.create({
      data: {
        workspaceId,
        metric,
        value: add,
        periodStart: start,
        periodEnd: end,
      },
    });
  }
}

/** Record usage for a completed call. Call after call session is finalized. */
export async function recordCallUsage(
  workspaceId: string,
  opts: {
    callMinutes: number;
    llmTokens: number;
    sttSeconds: number;
    ttsSeconds: number;
    toolCalls: number;
  }
): Promise<void> {
  const { periodStart, periodEnd } = getCurrentPeriod();
  if (opts.callMinutes > 0) await incrementUsage(workspaceId, 'call_minutes', Math.round(opts.callMinutes * 100) / 100, periodStart, periodEnd);
  if (opts.llmTokens > 0) await incrementUsage(workspaceId, 'llm_tokens', opts.llmTokens, periodStart, periodEnd);
  if (opts.sttSeconds > 0) await incrementUsage(workspaceId, 'stt_seconds', opts.sttSeconds, periodStart, periodEnd);
  if (opts.ttsSeconds > 0) await incrementUsage(workspaceId, 'tts_seconds', opts.ttsSeconds, periodStart, periodEnd);
  if (opts.toolCalls > 0) await incrementUsage(workspaceId, 'tool_calls', opts.toolCalls, periodStart, periodEnd);
}

/** Check if workspace can start a new call (under plan limits). Returns { allowed, reason }. */
export async function checkCanStartCall(workspaceId: string): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await getWorkspacePlan(workspaceId);
  const { periodStart, periodEnd } = getCurrentPeriod();
  const usage = await getUsageForPeriod(workspaceId, periodStart, periodEnd);

  if (!limits) return { allowed: true }; // no plan = unlimited

  if (limits.callMinutesLimit != null && usage.call_minutes >= limits.callMinutesLimit) {
    return { allowed: false, reason: `Call minutes limit reached (${limits.callMinutesLimit} min this period). Upgrade your plan.` };
  }
  if (limits.tokenLimit != null && usage.llm_tokens >= limits.tokenLimit) {
    return { allowed: false, reason: `LLM token limit reached (${limits.tokenLimit} this period). Upgrade your plan.` };
  }
  if (limits.toolCallsLimit != null && usage.tool_calls >= limits.toolCallsLimit) {
    return { allowed: false, reason: `Tool calls limit reached (${limits.toolCallsLimit} this period). Upgrade your plan.` };
  }
  if (limits.sttSecondsLimit != null && usage.stt_seconds >= limits.sttSecondsLimit) {
    return { allowed: false, reason: `STT seconds limit reached. Upgrade your plan.` };
  }
  if (limits.ttsSecondsLimit != null && usage.tts_seconds >= limits.ttsSecondsLimit) {
    return { allowed: false, reason: `TTS seconds limit reached. Upgrade your plan.` };
  }
  return { allowed: true };
}
