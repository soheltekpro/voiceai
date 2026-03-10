/**
 * AI call outcome detection: analyze transcript after call ends and classify outcome.
 * Uses the agent's configured LLM to avoid quota errors when agent uses non-OpenAI.
 * Outcomes: LEAD, INTERESTED, NOT_INTERESTED, CALLBACK_REQUESTED, APPOINTMENT_BOOKED, SALE, UNKNOWN.
 */

import { prisma } from '../db/prisma.js';
import { chatWithMessagesByProvider } from '../pipeline/llm-router.js';
import type { ChatMessage } from '../pipeline/llm.js';

const OUTCOMES = ['LEAD', 'INTERESTED', 'NOT_INTERESTED', 'CALLBACK_REQUESTED', 'APPOINTMENT_BOOKED', 'SALE', 'UNKNOWN'] as const;

const CLASSIFICATION_PROMPT = `Analyze this sales call transcript and determine the outcome.

Possible outcomes:
LEAD
INTERESTED
NOT_INTERESTED
CALLBACK_REQUESTED
APPOINTMENT_BOOKED
SALE
UNKNOWN

Return only valid JSON with no markdown or extra text:

{
  "outcome": "one of the outcomes above",
  "confidence": 0.0 to 1.0,
  "summary": "short explanation in one sentence"
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

function parseOutcomeResponse(text: string): { outcome: string; confidence: number; summary: string } | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as { outcome?: string; confidence?: number; summary?: string };
    const outcome = typeof obj.outcome === 'string' && OUTCOMES.includes(obj.outcome as any)
      ? obj.outcome
      : 'UNKNOWN';
    const confidence = typeof obj.confidence === 'number'
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.5;
    const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 2000) : 'No summary.';
    return { outcome, confidence, summary };
  } catch {
    return null;
  }
}

/**
 * Load transcript, run LLM classification (using agent's configured LLM), upsert VoiceCallOutcome.
 * No-op if call not found, no transcript, or LLM/parse fails.
 */
export async function detectCallOutcome(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { workspaceId: true, promptVersionId: true, agentId: true },
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
    console.info('[outcome-detection] using agent LLM', { provider: llmProvider, model: llmModel });
    const messages: ChatMessage[] = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      { role: 'user', content: transcript },
    ];
    const raw = await chatWithMessagesByProvider(messages, {
      provider: llmProvider ?? undefined,
      model: llmModel ?? undefined,
      temperature: 0.2,
    });
    const parsed = parseOutcomeResponse(raw);
    if (!parsed) return;

    await prisma.voiceCallOutcome.upsert({
      where: { callId },
      create: {
        callId,
        workspaceId: call.workspaceId,
        promptVersionId: call.promptVersionId ?? undefined,
        outcome: parsed.outcome,
        confidence: parsed.confidence,
        summary: parsed.summary,
      },
      update: {
        promptVersionId: call.promptVersionId ?? undefined,
        outcome: parsed.outcome,
        confidence: parsed.confidence,
        summary: parsed.summary,
      },
    });
  } catch (err) {
    console.error('[outcome-detection] detectCallOutcome failed:', err);
  }
}
