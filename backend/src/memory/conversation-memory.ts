/**
 * Persistent conversation memory per workspace and per caller phone number.
 * Used to give the voice agent context from previous calls with the same caller.
 */

import { prisma } from '../db/prisma.js';

export async function getConversationMemory(
  workspaceId: string,
  phoneNumber: string
): Promise<string | null> {
  const normalized = phoneNumber.replace(/\s/g, '').trim();
  if (!normalized) return null;
  const row = await prisma.voiceConversationMemory.findUnique({
    where: {
      workspaceId_phoneNumber: { workspaceId, phoneNumber: normalized },
    },
    select: { summary: true },
  });
  return row?.summary ?? null;
}

export async function saveConversationMemory(
  workspaceId: string,
  phoneNumber: string,
  summary: string,
  callId: string
): Promise<void> {
  const normalized = phoneNumber.replace(/\s/g, '').trim();
  if (!normalized) return;
  await prisma.voiceConversationMemory.upsert({
    where: {
      workspaceId_phoneNumber: { workspaceId, phoneNumber: normalized },
    },
    create: {
      workspaceId,
      phoneNumber: normalized,
      summary,
      lastCallId: callId,
    },
    update: {
      summary,
      lastCallId: callId,
      updatedAt: new Date(),
    },
  });
}
