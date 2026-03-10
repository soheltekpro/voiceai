/**
 * AI call quality evaluation: analyze completed call transcript and score agent performance.
 * Uses the agent's configured LLM (llmProvider, llmModel) to avoid quota errors when agent uses non-OpenAI.
 */

import { prisma } from '../db/prisma.js';
import { chatWithMessagesByProvider } from '../pipeline/llm-router.js';
import type { ChatMessage } from '../pipeline/llm.js';

const EVALUATION_PROMPT = `Evaluate the performance of the voice AI agent in this call.

Score from 0 to 100.

Consider:
- clarity
- helpfulness
- handling objections
- achieving the goal

Return only valid JSON with no markdown or extra text:

{
  "score": 0-100,
  "strengths": "brief summary of what went well",
  "improvements": "brief suggestions for improvement"
}`;

function buildTranscriptForCall(callId: string): Promise<string> {
  return prisma.conversationMessage
    .findMany({
      where: { callId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    })
    .then((rows) => rows.map((r) => `${r.role}: ${r.content}`).join('\n\n').trim());
}

function parseEvaluationResponse(
  text: string
): { score: number; strengths: string; improvements: string } | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as {
      score?: number;
      strengths?: string;
      improvements?: string;
    };
    const score =
      typeof obj.score === 'number'
        ? Math.max(0, Math.min(100, obj.score))
        : 50;
    const strengths =
      typeof obj.strengths === 'string' ? obj.strengths.slice(0, 4000) : '—';
    const improvements =
      typeof obj.improvements === 'string'
        ? obj.improvements.slice(0, 4000)
        : '—';
    return { score, strengths, improvements };
  } catch {
    return null;
  }
}

/**
 * Load transcript, run LLM evaluation (using agent's configured LLM), upsert VoiceCallEvaluation.
 * No-op if call not found, transcript too short, or LLM/parse fails.
 */
export async function evaluateCallQuality(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { workspaceId: true, agentId: true },
  });
  if (!call) return;

  const transcript = await buildTranscriptForCall(callId);
  if (!transcript || transcript.length < 20) return;

  const agent = await prisma.agent.findUnique({
    where: { id: call.agentId },
    include: { settings: true },
  });
  const settings = agent?.settings;
  const llmProvider = settings?.llmProvider ?? null;
  const llmModel = settings?.llmModel ?? null;

  try {
    console.info('[call-evaluation] using agent LLM', { provider: llmProvider, model: llmModel });
    const messages: ChatMessage[] = [
      { role: 'system', content: EVALUATION_PROMPT },
      { role: 'user', content: transcript },
    ];
    const raw = await chatWithMessagesByProvider(messages, {
      provider: llmProvider ?? undefined,
      model: llmModel ?? undefined,
      temperature: 0.3,
    });
    const parsed = parseEvaluationResponse(raw);
    if (!parsed) return;

    await prisma.voiceCallEvaluation.upsert({
      where: { callId },
      create: {
        callId,
        workspaceId: call.workspaceId,
        score: parsed.score,
        strengths: parsed.strengths,
        improvements: parsed.improvements,
      },
      update: {
        score: parsed.score,
        strengths: parsed.strengths,
        improvements: parsed.improvements,
      },
    });
  } catch (err) {
    console.error('[call-evaluation] evaluateCallQuality failed:', err);
  }
}
