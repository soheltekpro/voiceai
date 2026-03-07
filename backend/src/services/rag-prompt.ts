/**
 * Build system prompt with optional RAG context from knowledge base.
 */

import { retrieveChunks } from './knowledge-retrieval.js';

const RAG_PREFIX = '\n\nRelevant context from knowledge base:\n';

export async function getSystemPromptWithRag(
  basePrompt: string,
  knowledgeBaseId: string | null | undefined,
  userQuery: string
): Promise<string> {
  if (!knowledgeBaseId || !userQuery.trim()) return basePrompt;
  try {
    const chunks = await retrieveChunks(knowledgeBaseId, userQuery);
    if (chunks.length === 0) return basePrompt;
    const context = chunks.map((c) => c.content).join('\n\n');
    return basePrompt + RAG_PREFIX + context;
  } catch {
    return basePrompt;
  }
}
