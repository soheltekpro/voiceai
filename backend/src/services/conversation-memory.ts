/**
 * Conversation memory: persist and load messages per call for LLM context.
 */

import { prisma } from '../db/prisma.js';

const RECENT_LIMIT = 20;

export type ConversationRole = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';

/** Resolve callId from callSessionId (call was started via POST /calls/start). */
export async function getCallIdByCallSessionId(callSessionId: string): Promise<string | null> {
  const call = await prisma.call.findFirst({
    where: { callSessionId },
    select: { id: true },
  });
  return call?.id ?? null;
}

/** Append a message to the call's conversation. */
export async function appendMessage(
  callId: string,
  role: ConversationRole,
  content: string
): Promise<void> {
  await prisma.conversationMessage.create({
    data: { callId, role, content },
  });
}

/** Get the last N messages for a call (chronological order). */
export async function getRecentMessages(
  callId: string,
  limit: number = RECENT_LIMIT
): Promise<Array<{ role: string; content: string }>> {
  const rows = await prisma.conversationMessage.findMany({
    where: { callId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { role: true, content: true },
  });
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}
