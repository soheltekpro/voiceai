/**
 * Anthropic Claude tool use (stub). Pipeline tool-calling with Claude not yet implemented.
 * Falls back to LLM-only (no tools) when provider is Anthropic and agent has tools.
 */

import type { ChatMessage } from '../llm.js';
import type { ToolDef } from '../../services/agent-tools-loader.js';
import { chatWithMessagesByProvider } from '../llm-router.js';

export type AnthropicToolsOptions = {
  callSessionId?: string;
  model?: string | null;
  temperature?: number | null;
};

/** Anthropic tool use not yet implemented; falls back to chat without tools. */
export async function chatWithToolsAnthropic(
  _tools: ToolDef[],
  messages: ChatMessage[],
  options: AnthropicToolsOptions,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  return chatWithMessagesByProvider(messages, {
    provider: 'anthropic',
    model: options.model ?? null,
    temperature: options.temperature ?? null,
    callSessionId: options.callSessionId ?? undefined,
  }, onChunk, signal);
}
