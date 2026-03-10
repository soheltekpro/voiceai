/**
 * Prompt versioning and A/B testing: select prompt by traffic share, create versions, analytics.
 */

import { prisma } from '../db/prisma.js';

/** Weighted random selection: pick one of the items by weight (trafficShare). */
export function selectByTrafficShare<T extends { trafficShare: number }>(items: T[]): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.trafficShare, 0);
  if (total <= 0) return items[0] ?? null;
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.trafficShare;
    if (r <= 0) return item;
  }
  return items[items.length - 1] ?? null;
}

/**
 * Get the prompt to use for this agent: either a selected active version or null (use agent settings).
 * Caller should use agent settings systemPrompt when null.
 */
export async function selectPromptVersion(agentId: string): Promise<{
  id: string;
  version: number;
  systemPrompt: string;
} | null> {
  const versions = await prisma.voicePromptVersion.findMany({
    where: { agentId, isActive: true },
    select: { id: true, version: true, systemPrompt: true, trafficShare: true },
  });
  const selected = selectByTrafficShare(versions);
  return selected ? { id: selected.id, version: selected.version, systemPrompt: selected.systemPrompt } : null;
}

/**
 * Create a new prompt version. version = max(version) + 1 for this agent.
 */
export async function createPromptVersion(
  workspaceId: string,
  agentId: string,
  systemPrompt: string,
  options?: { isActive?: boolean; trafficShare?: number }
): Promise<{ id: string; version: number; systemPrompt: string; isActive: boolean; trafficShare: number }> {
  const max = await prisma.voicePromptVersion.aggregate({
    where: { agentId },
    _max: { version: true },
  });
  const version = (max._max.version ?? 0) + 1;
  const created = await prisma.voicePromptVersion.create({
    data: {
      workspaceId,
      agentId,
      version,
      systemPrompt,
      isActive: options?.isActive ?? false,
      trafficShare: options?.trafficShare ?? 100,
    },
  });
  return {
    id: created.id,
    version: created.version,
    systemPrompt: created.systemPrompt,
    isActive: created.isActive,
    trafficShare: created.trafficShare,
  };
}

/**
 * List prompt versions for an agent.
 */
export async function listPromptVersions(agentId: string): Promise<
  Array<{
    id: string;
    version: number;
    systemPrompt: string;
    isActive: boolean;
    trafficShare: number;
    createdAt: Date;
  }>
> {
  const list = await prisma.voicePromptVersion.findMany({
    where: { agentId },
    orderBy: { version: 'asc' },
    select: { id: true, version: true, systemPrompt: true, isActive: true, trafficShare: true, createdAt: true },
  });
  return list;
}

/**
 * Set isActive for a prompt version (enable/disable for A/B).
 */
export async function setPromptVersionActive(versionId: string, isActive: boolean): Promise<void> {
  await prisma.voicePromptVersion.update({
    where: { id: versionId },
    data: { isActive },
  });
}

/**
 * Update traffic share for a version (percent 0-100).
 */
export async function setPromptVersionTrafficShare(versionId: string, trafficShare: number): Promise<void> {
  const share = Math.max(0, Math.min(100, Math.round(trafficShare)));
  await prisma.voicePromptVersion.update({
    where: { id: versionId },
    data: { trafficShare: share },
  });
}

/**
 * Get performance metrics per prompt version for an agent: conversion rate, avg evaluation score, call duration.
 */
export async function getPromptPerformance(agentId: string): Promise<
  Array<{
    promptVersionId: string;
    version: number;
    trafficShare: number;
    isActive: boolean;
    callsTotal: number;
    conversionRate: number | null;   // % of calls with outcome LEAD or SALE
    avgScore: number | null;          // avg VoiceCallEvaluation.score
    avgDurationSeconds: number | null;
  }>
> {
  const versions = await prisma.voicePromptVersion.findMany({
    where: { agentId },
    orderBy: { version: 'asc' },
    select: { id: true, version: true, trafficShare: true, isActive: true },
  });

  const results: Array<{
    promptVersionId: string;
    version: number;
    trafficShare: number;
    isActive: boolean;
    callsTotal: number;
    conversionRate: number | null;
    avgScore: number | null;
    avgDurationSeconds: number | null;
  }> = [];

  for (const v of versions) {
    const calls = await prisma.call.findMany({
      where: { agentId, promptVersionId: v.id },
      select: { id: true, durationSeconds: true },
    });
    const callsTotal = calls.length;
    const outcomes = await prisma.voiceCallOutcome.findMany({
      where: { callId: { in: calls.map((c) => c.id) } },
      select: { outcome: true },
    });
    const conversions = outcomes.filter((o) => /^(LEAD|SALE)$/i.test(o.outcome)).length;
    const conversionRate = callsTotal > 0 ? (conversions / callsTotal) * 100 : null;

    const evaluations = await prisma.voiceCallEvaluation.findMany({
      where: { callId: { in: calls.map((c) => c.id) } },
      select: { score: true },
    });
    const avgScore =
      evaluations.length > 0
        ? evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length
        : null;

    const durations = calls.filter((c) => c.durationSeconds != null).map((c) => c.durationSeconds!);
    const avgDurationSeconds =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

    results.push({
      promptVersionId: v.id,
      version: v.version,
      trafficShare: v.trafficShare,
      isActive: v.isActive,
      callsTotal,
      conversionRate: conversionRate != null ? Math.round(conversionRate * 100) / 100 : null,
      avgScore: avgScore != null ? Math.round(avgScore * 100) / 100 : null,
      avgDurationSeconds: avgDurationSeconds != null ? Math.round(avgDurationSeconds * 100) / 100 : null,
    });
  }

  return results;
}
