import { prisma } from '../db/prisma.js';

// Phase 6: basic cost estimation (configurable later)
const DEFAULT_USD_PER_MIN_STT = 0.006; // placeholder
const DEFAULT_USD_PER_1K_CHARS_TTS = 0.015; // placeholder

export async function recordUserMessage(callSessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await prisma.callMessage.create({
    data: { sessionId: callSessionId, role: 'USER', text: trimmed },
  });
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: { userMessageCount: { increment: 1 } },
  });
  // Append transcriptText for simple search
  const session = await prisma.callSession.findUnique({ where: { id: callSessionId }, select: { transcriptText: true } });
  const next = ((session?.transcriptText ?? '') + '\n' + trimmed).trim();
  await prisma.callSession.update({ where: { id: callSessionId }, data: { transcriptText: next } });
}

export async function recordAssistantMessage(callSessionId: string, text: string, approxTtsChars?: number): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const ttsChars = approxTtsChars ?? trimmed.length;
  const cost = (ttsChars / 1000) * DEFAULT_USD_PER_1K_CHARS_TTS;
  await prisma.callMessage.create({
    data: { sessionId: callSessionId, role: 'ASSISTANT', text: trimmed, costUsd: cost as any },
  });
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      assistantMessageCount: { increment: 1 },
      estimatedCostUsd: { increment: cost } as any,
    } as any,
  });
}

export async function finalizeCallSession(callSessionId: string, startedAt: Date, endedAt: Date): Promise<void> {
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  // Add STT cost placeholder by duration
  const sttCost = (durationSeconds / 60) * DEFAULT_USD_PER_MIN_STT;
  const session = await prisma.callSession.findUnique({ where: { id: callSessionId }, select: { estimatedCostUsd: true } });
  const current = Number(session?.estimatedCostUsd ?? 0);
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      durationSeconds,
      estimatedCostUsd: (current + sttCost) as any,
    } as any,
  });
}

