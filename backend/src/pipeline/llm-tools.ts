/**
 * LLM with tool calling. Routes to provider-specific implementation (OpenAI, Gemini, Anthropic).
 */

import type { ChatMessage } from './llm.js';
import { chatWithToolsByProvider, type ChatWithToolsOptions } from './tools/index.js';

export type { ChatWithToolsOptions };

/** Call with full message array; routes to openai-tools, gemini-tools, or anthropic-tools by provider. */
export async function chatWithTools(
  agentId: string,
  messages: ChatMessage[],
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
  options?: ChatWithToolsOptions
): Promise<string> {
  return chatWithToolsByProvider(agentId, messages, onChunk, signal, options);
}
