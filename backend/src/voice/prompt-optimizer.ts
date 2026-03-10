/**
 * AI Prompt Optimization: suggest system prompt improvements from past call evaluations.
 */

import { prisma } from '../db/prisma.js';
import { complete } from '../pipeline/llm.js';

const EVALUATIONS_LIMIT = 100;

const OPTIMIZATION_PROMPT = `Analyze these voice AI call evaluations.

Suggest improvements to the system prompt for the voice agent.

Focus on:
- handling objections
- explaining features
- improving clarity

Return only valid JSON with no markdown or extra text:

{
  "suggestion": "one clear, actionable suggestion for the system prompt (e.g. what to add or rephrase)"
}`;

function parseSuggestionResponse(text: string): string | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as { suggestion?: string };
    return typeof obj.suggestion === 'string' ? obj.suggestion.slice(0, 8000) : null;
  } catch {
    return null;
  }
}

/**
 * Load recent call evaluations for an agent (via calls that used this agent),
 * build context from improvements/strengths, run LLM, and save suggestion.
 * Returns the created VoicePromptOptimization or null if insufficient data or LLM fails.
 */
export async function generatePromptOptimization(agentId: string): Promise<{
  id: string;
  suggestion: string;
  createdAt: Date;
} | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { workspaceId: true },
  });
  if (!agent) return null;

  const callIds = await prisma.call.findMany({
    where: { agentId },
    orderBy: { startedAt: 'desc' },
    take: EVALUATIONS_LIMIT,
    select: { id: true },
  });
  const ids = callIds.map((c) => c.id);
  if (ids.length === 0) return null;

  const evaluations = await prisma.voiceCallEvaluation.findMany({
    where: { callId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    select: { score: true, strengths: true, improvements: true },
  });
  if (evaluations.length === 0) return null;

  const context = evaluations
    .map((e, i) => `[${i + 1}] Score: ${e.score}\nStrengths: ${e.strengths}\nImprovements: ${e.improvements}`)
    .join('\n\n');

  const userMessage = `Call evaluations for this agent:\n\n${context}`;

  try {
    const raw = await complete(OPTIMIZATION_PROMPT, userMessage);
    const suggestion = parseSuggestionResponse(raw);
    if (!suggestion?.trim()) return null;

    const created = await prisma.voicePromptOptimization.create({
      data: {
        workspaceId: agent.workspaceId,
        agentId,
        suggestion: suggestion.trim(),
      },
    });
    return {
      id: created.id,
      suggestion: created.suggestion,
      createdAt: created.createdAt,
    };
  } catch (err) {
    console.error('[prompt-optimizer] generatePromptOptimization failed:', err);
    return null;
  }
}

/**
 * Get latest prompt optimization suggestions for an agent (most recent first).
 */
export async function getPromptOptimizations(
  agentId: string,
  limit: number = 20
): Promise<Array<{ id: string; suggestion: string; createdAt: Date }>> {
  const list = await prisma.voicePromptOptimization.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, suggestion: true, createdAt: true },
  });
  return list;
}
