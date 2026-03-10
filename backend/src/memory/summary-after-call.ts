/**
 * Generate a short summary of the call from transcript and save to persistent conversation memory.
 * Used when a call ends so the next call from the same number can have context.
 */

import { prisma } from '../db/prisma.js';
import { complete } from '../pipeline/llm.js';
import { getCallIdByCallSessionId } from '../services/conversation-memory.js';
import { getConversationMemory, saveConversationMemory } from './conversation-memory.js';

const SUMMARY_PROMPT = `Summarize the important facts about this caller in 3-5 sentences.
Focus on:
• their goals
• questions asked
• preferences
• personal details`;

const COMPRESS_PROMPT = `Compress this memory summary into 5 sentences. Keep only the most important facts.`;

const MAX_SUMMARY_CHARS = 1000;

/** Build a single transcript string from conversation messages for the call. */
async function getTranscriptForCall(callId: string): Promise<string> {
  const rows = await prisma.conversationMessage.findMany({
    where: { callId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  return rows.map((r) => `${r.role}: ${r.content}`).join('\n\n').trim();
}

/** If summary exceeds max length, compress via LLM. */
async function compressSummaryIfNeeded(summary: string): Promise<string> {
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  try {
    const compressed = await complete(COMPRESS_PROMPT, summary);
    return compressed.length > 0 ? compressed : summary.slice(0, MAX_SUMMARY_CHARS);
  } catch {
    return summary.slice(0, MAX_SUMMARY_CHARS);
  }
}

/**
 * Generate summary from call transcript and save to voice conversation memory.
 * Call when the call ends. No-op if no workspaceId, phoneNumber, or transcript.
 */
export async function generateAndSaveConversationMemory(callSessionId: string): Promise<void> {
  const callId = await getCallIdByCallSessionId(callSessionId);
  if (!callId) return;

  const [call, session] = await Promise.all([
    prisma.call.findUnique({
      where: { id: callId },
      select: { workspaceId: true },
    }),
    prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: { metadata: true },
    }),
  ]);

  const workspaceId = call?.workspaceId;
  const meta = session?.metadata as { callerPhoneNumber?: string } | null;
  const phoneNumber = meta?.callerPhoneNumber;
  if (!workspaceId || !phoneNumber?.trim()) return;

  const transcript = await getTranscriptForCall(callId);
  if (!transcript || transcript.length < 50) return;

  try {
    let summary = await complete(SUMMARY_PROMPT, transcript);
    if (!summary.trim()) return;

    summary = await compressSummaryIfNeeded(summary);

    const existing = await getConversationMemory(workspaceId, phoneNumber);
    const combined = existing ? `${existing}\n\n--- Latest call ---\n\n${summary}` : summary;
    const toStore = combined.length > MAX_SUMMARY_CHARS ? await compressSummaryIfNeeded(combined) : combined;

    await saveConversationMemory(workspaceId, phoneNumber, toStore, callId);
  } catch (err) {
    console.error('[memory] generateAndSaveConversationMemory failed:', err);
  }
}
