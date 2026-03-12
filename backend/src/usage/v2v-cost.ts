/**
 * Approximate cost for V2V (realtime) models that charge by token.
 * Used when we have input/output token counts from the agent (e.g. Gemini native audio).
 *
 * Pricing source: Google AI Studio — Gemini 2.5 Flash Native Audio (Live API)
 * gemini-2.5-flash-native-audio-preview-12-2025, Paid Tier per 1M tokens:
 * - Input (audio/video): $3.00 per 1M tokens
 * - Output (audio):       $12.00 per 1M tokens (including thinking tokens)
 * See docs/V2V-COST-ESTIMATE.md for details and updates.
 */

export const GEMINI_NATIVE_AUDIO_INPUT_USD_PER_1M = 3.0;
export const GEMINI_NATIVE_AUDIO_OUTPUT_USD_PER_1M = 12.0;

/** Text input (system prompt + RAG) if we ever have separate count — $0.50/1M */
export const GEMINI_TEXT_INPUT_USD_PER_1M = 0.5;

/**
 * Estimate cost (USD) for Gemini 2.5 Flash Native Audio from token counts.
 * Use this when the agent sends input_audio_tokens and output_audio_tokens (or inputTokens / outputTokens).
 */
export function estimateGeminiNativeAudioCost(
  inputTokens: number,
  outputTokens: number
): number {
  const inCost = (inputTokens / 1_000_000) * GEMINI_NATIVE_AUDIO_INPUT_USD_PER_1M;
  const outCost = (outputTokens / 1_000_000) * GEMINI_NATIVE_AUDIO_OUTPUT_USD_PER_1M;
  return Math.round((inCost + outCost) * 1e6) / 1e6;
}

export type V2VCostBreakdown = {
  /** Audio input tokens (user speech). */
  audioInputTokens: number;
  /** Audio output tokens (model speech). */
  audioOutputTokens: number;
  /** RAG/text input: not separately reported by Live API; included in input. */
  ragTextTokensNote: string;
  /** Total tokens (audio in + audio out). */
  totalTokens: number;
  /** Input rate USD per 1M tokens. */
  inputRatePer1MUsd: number;
  /** Output rate USD per 1M tokens. */
  outputRatePer1MUsd: number;
  /** Input price USD per single token. */
  inputPricePerTokenUsd: number;
  /** Output price USD per single token. */
  outputPricePerTokenUsd: number;
  /** Input cost USD. */
  inputCostUsd: number;
  /** Output cost USD. */
  outputCostUsd: number;
  /** Total cost USD. */
  totalCostUsd: number;
  /** Call duration minutes. */
  durationMinutes: number | null;
  /** Cost per minute USD. */
  costPerMinuteUsd: number | null;
  /** USD to INR rate used. */
  usdToInr: number;
  /** Cost per minute INR. */
  costPerMinuteInr: number | null;
  /** Total cost INR. */
  totalCostInr: number | null;
  /** V2V provider (e.g. google, openai). */
  v2vProvider?: string | null;
  /** V2V model (e.g. gemini-2.5-flash-native-audio-*). */
  v2vModel?: string | null;
};

const DEFAULT_USD_TO_INR = 83;

export function getUsdToInr(): number {
  const raw = process.env['USD_TO_INR'] ?? process.env['COST_USD_TO_INR'] ?? '';
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_INR;
}

/**
 * Build a transparent cost breakdown for V2V (Gemini native audio).
 * Use when session has inputTokens, outputTokens, estimatedCostUsd, durationSeconds.
 */
export function buildV2VCostBreakdown(params: {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  durationSeconds: number | null;
  v2vProvider?: string | null;
  v2vModel?: string | null;
}): V2VCostBreakdown {
  const { inputTokens, outputTokens, totalCostUsd, durationSeconds, v2vProvider, v2vModel } = params;
  const usdToInr = getUsdToInr();
  const totalTokens = inputTokens + outputTokens;
  const inputCostUsd =
    totalTokens > 0
      ? Math.round((inputTokens / 1_000_000) * GEMINI_NATIVE_AUDIO_INPUT_USD_PER_1M * 1e6) / 1e6
      : 0;
  const outputCostUsd =
    totalTokens > 0
      ? Math.round((outputTokens / 1_000_000) * GEMINI_NATIVE_AUDIO_OUTPUT_USD_PER_1M * 1e6) / 1e6
      : 0;
  const durationMinutes =
    durationSeconds != null && durationSeconds > 0 ? durationSeconds / 60 : null;
  const costPerMinuteUsd =
    durationMinutes != null && durationMinutes > 0
      ? Math.round((totalCostUsd / durationMinutes) * 1e6) / 1e6
      : null;
  const costPerMinuteInr =
    costPerMinuteUsd != null ? Math.round(costPerMinuteUsd * usdToInr * 100) / 100 : null;
  const totalCostInr = Math.round(totalCostUsd * usdToInr * 100) / 100;

  const inputRatePer1M = GEMINI_NATIVE_AUDIO_INPUT_USD_PER_1M;
  const outputRatePer1M = GEMINI_NATIVE_AUDIO_OUTPUT_USD_PER_1M;
  const inputPricePerTokenUsd = Math.round((inputRatePer1M / 1_000_000) * 1e9) / 1e9;
  const outputPricePerTokenUsd = Math.round((outputRatePer1M / 1_000_000) * 1e9) / 1e9;

  return {
    audioInputTokens: inputTokens,
    audioOutputTokens: outputTokens,
    ragTextTokensNote:
      'RAG / system prompt text is part of input; Live API does not report text vs audio tokens separately.',
    totalTokens,
    inputRatePer1MUsd: inputRatePer1M,
    outputRatePer1MUsd: outputRatePer1M,
    inputPricePerTokenUsd,
    outputPricePerTokenUsd,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    durationMinutes,
    costPerMinuteUsd,
    usdToInr,
    costPerMinuteInr,
    totalCostInr,
    v2vProvider: v2vProvider ?? null,
    v2vModel: v2vModel ?? null,
  };
}

/**
 * Approximate cost per minute (USD) for a V2V call.
 * Returns null if durationSeconds is missing or zero.
 */
export function estimateV2VCostPerMinute(
  costUsd: number,
  durationSeconds: number | null | undefined
): number | null {
  if (durationSeconds == null || durationSeconds <= 0) return null;
  const minutes = durationSeconds / 60;
  return Math.round((costUsd / minutes) * 1e6) / 1e6;
}
