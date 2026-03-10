/**
 * Tools router: OpenAI, Gemini, Anthropic. Each provider has its own function-calling format.
 */

import type { ChatMessage } from '../llm.js';
import { loadToolsForAgent } from '../../services/agent-tools-loader.js';
import { chatWithMessagesByProvider } from '../llm-router.js';
import { chatWithToolsOpenAI } from './openai-tools.js';
import { chatWithToolsGemini } from './gemini-tools.js';
import { chatWithToolsAnthropic } from './anthropic-tools.js';

export type ChatWithToolsOptions = {
  callSessionId?: string;
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
};

/** Default to google when empty so voice pipeline does not call OpenAI (avoid 429). */
function resolveProvider(provider?: string | null): 'openai' | 'google' | 'anthropic' {
  const p = (provider ?? '').toLowerCase().trim();
  if (p === 'google') return 'google';
  if (p === 'anthropic') return 'anthropic';
  if (p === 'openai') return 'openai';
  return 'google';
}

/** Route to the correct tools implementation by provider. */
export async function chatWithToolsByProvider(
  agentId: string,
  messages: ChatMessage[],
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
  options?: ChatWithToolsOptions
): Promise<string> {
  const tools = await loadToolsForAgent(agentId);
  const provider = resolveProvider(options?.provider);

  if (tools.length === 0) {
    return chatWithMessagesByProvider(messages, {
      provider: options?.provider ?? null,
      model: options?.model ?? null,
      temperature: options?.temperature ?? null,
      callSessionId: options?.callSessionId ?? undefined,
    }, onChunk, signal);
  }

  const opts = {
    callSessionId: options?.callSessionId,
    model: options?.model ?? null,
    temperature: options?.temperature ?? null,
  };

  if (provider === 'openai') {
    return chatWithToolsOpenAI(tools, messages, opts, onChunk, signal);
  }
  if (provider === 'google') {
    return chatWithToolsGemini(tools, messages, opts, onChunk, signal);
  }
  return chatWithToolsAnthropic(tools, messages, opts, onChunk, signal);
}
