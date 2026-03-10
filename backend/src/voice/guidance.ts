/**
 * Real-time call guidance: analyze ongoing conversation and suggest next actions for the operator.
 */

import { prisma } from '../db/prisma.js';
import { complete } from '../pipeline/llm.js';
import { getRecentMessages } from '../services/conversation-memory.js';

const GUIDANCE_MESSAGE_LIMIT = 10;

const GUIDANCE_PROMPT = `Analyze this ongoing sales call.

Suggest one helpful next action for the sales agent.

Examples:
- explain pricing
- ask about budget
- schedule follow-up
- address objections

Return only valid JSON with no markdown or extra text:

{
  "suggestion": "..."
}`;

function parseSuggestionResponse(text: string): string | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as { suggestion?: string };
    return typeof obj.suggestion === 'string' ? obj.suggestion.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/**
 * Load last N messages, build transcript, call LLM for suggestion, insert VoiceCallGuidance.
 * No-op if call not found, transcript too short, or LLM/parse fails.
 */
export async function generateCallGuidance(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { workspaceId: true },
  });
  if (!call) return;

  const messages = await getRecentMessages(callId, GUIDANCE_MESSAGE_LIMIT);
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n').trim();
  if (!transcript || transcript.length < 30) return;

  try {
    const raw = await complete(GUIDANCE_PROMPT, transcript);
    const suggestion = parseSuggestionResponse(raw);
    if (!suggestion) return;

    await prisma.voiceCallGuidance.create({
      data: {
        callId,
        workspaceId: call.workspaceId,
        suggestion,
      },
    });
  } catch (err) {
    console.error('[guidance] generateCallGuidance failed:', err);
  }
}
