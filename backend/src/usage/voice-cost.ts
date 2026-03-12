/**
 * Voice cost calculation from usage and provider pricing.
 * Uses ProviderPricing table: providerName, pricingType (per_minute | per_token | per_character), pricePerUnit.
 */

import { prisma } from '../db/prisma.js';

export type VoiceUsageForCost = {
  audioInputSeconds: number;
  audioOutputSeconds: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  ttsCharacters: number;
  sttProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
};

export type VoiceCostResult = {
  totalCost: number;
  sttCost: number;
  llmCost: number;
  ttsCost: number;
};

let pricingCache: Map<string, number> | null = null;

async function getPricePerUnit(providerName: string, pricingType: 'PER_MINUTE' | 'PER_TOKEN' | 'PER_CHARACTER'): Promise<number> {
  const key = `${providerName}:${pricingType}`;
  if (pricingCache?.has(key)) return pricingCache.get(key)!;
  const row = await prisma.providerPricing.findUnique({
    where: { providerName_pricingType: { providerName, pricingType } },
    select: { pricePerUnit: true },
  });
  const price = row ? Number(row.pricePerUnit) : 0;
  if (!pricingCache) pricingCache = new Map();
  pricingCache.set(key, price);
  return price;
}

/** Clear in-memory pricing cache (e.g. after admin updates pricing). */
export function clearPricingCache(): void {
  pricingCache = null;
}

/**
 * Cost per minute (USD) for a call. Returns null if duration is missing or zero.
 * Use for both Pipeline and V2V: total cost and duration come from CallSession.
 */
export function costPerMinuteUsd(estimatedCostUsd: number | null | undefined, durationSeconds: number | null | undefined): number | null {
  const cost = estimatedCostUsd != null ? Number(estimatedCostUsd) : null;
  const sec = durationSeconds != null && durationSeconds > 0 ? durationSeconds : 0;
  if (cost == null || cost < 0 || sec <= 0) return null;
  const minutes = sec / 60;
  return Math.round((cost / minutes) * 1e6) / 1e6;
}

/**
 * Compute STT, LLM, and TTS cost for a single call usage.
 * STT: audio input minutes × provider per_minute rate.
 * LLM: (input + output) tokens × provider per_token rate.
 * TTS: characters × provider per_character rate.
 */
export async function calculateVoiceCost(usage: VoiceUsageForCost): Promise<VoiceCostResult> {
  const providerStt = (usage.sttProvider ?? 'openai').toLowerCase();
  const providerLlm = (usage.llmProvider ?? 'openai').toLowerCase();
  const providerTts = (usage.ttsProvider ?? 'openai').toLowerCase();

  const [sttPricePerMin, llmPricePerToken, ttsPricePerChar] = await Promise.all([
    getPricePerUnit(providerStt, 'PER_MINUTE'),
    getPricePerUnit(providerLlm, 'PER_TOKEN'),
    getPricePerUnit(providerTts, 'PER_CHARACTER'),
  ]);

  const sttMinutes = usage.audioInputSeconds / 60;
  const sttCost = sttMinutes * sttPricePerMin;

  const llmTokens = usage.llmInputTokens + usage.llmOutputTokens;
  const llmCost = llmTokens * llmPricePerToken;

  const ttsCost = usage.ttsCharacters * ttsPricePerChar;

  const totalCost = sttCost + llmCost + ttsCost;

  return {
    totalCost: Math.round(totalCost * 1e6) / 1e6,
    sttCost: Math.round(sttCost * 1e6) / 1e6,
    llmCost: Math.round(llmCost * 1e6) / 1e6,
    ttsCost: Math.round(ttsCost * 1e6) / 1e6,
  };
}
