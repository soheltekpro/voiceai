/**
 * Gemini function calling (stub). Pipeline tool-calling with Gemini not yet implemented.
 * Falls back to LLM-only (no tools) when provider is Google and agent has tools.
 */

import type { ChatMessage } from '../llm.js';
import type { ToolDef } from '../../services/agent-tools-loader.js';
import { chatWithMessagesByProvider } from '../llm-router.js';

export type GeminiToolsOptions = {
  callSessionId?: string;
  model?: string | null;
  temperature?: number | null;
};

/** Gemini tool calling not yet implemented; falls back to chat without tools. */
export async function chatWithToolsGemini(
  _tools: ToolDef[],
  messages: ChatMessage[],
  options: GeminiToolsOptions,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  return chatWithMessagesByProvider(messages, {
    provider: 'google',
    model: options.model ?? null,
    temperature: options.temperature ?? null,
    callSessionId: options.callSessionId ?? undefined,
  }, onChunk, signal);
}
