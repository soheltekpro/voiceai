/**
 * OpenAI function calling: tool_calls → execute handlers → continue.
 */

import OpenAI from 'openai';
import { config } from '../../config.js';
import type { ToolDef } from '../../services/agent-tools-loader.js';
import { executeTool, type ToolType } from '../../services/tool-handlers.js';
import { publishAsync } from '../../services/event-bus.js';
import { getToolExecutionQueue } from '../../infra/queues.js';
import type { ChatMessage } from '../llm.js';

const MAX_TOOL_ROUNDS = 5;

export function toFunctionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_') || 'tool';
}

export function buildOpenAITools(tools: ToolDef[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: toFunctionName(t.name),
      description: t.description || `Tool: ${t.name}`,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'JSON string or key for the tool' },
          payload: { type: 'string', description: 'Optional payload (webhook/request body)' },
          key: { type: 'string', description: 'Lookup key (database_lookup)' },
        },
      },
    },
  }));
}

export type OpenAIToolsOptions = {
  callSessionId?: string;
  model?: string | null;
  temperature?: number | null;
};

export async function chatWithToolsOpenAI(
  tools: ToolDef[],
  messages: ChatMessage[],
  options: OpenAIToolsOptions,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const openAITools = buildOpenAITools(tools);
  const toolByName = new Map(tools.map((t) => [toFunctionName(t.name), t]));
  const messagesCopy: ChatMessage[] = [...messages];
  const model = (options.model ?? '').trim() || config.openai.llmModel;
  const temperature = options.temperature != null ? Math.min(2, Math.max(0, options.temperature)) : undefined;
  let finalContent = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await openai.chat.completions.create(
      {
        model,
        messages: messagesCopy,
        tools: openAITools,
        tool_choice: 'auto',
        max_tokens: 500,
        ...(temperature != null && { temperature }),
      },
      { signal }
    );

    const choice = response.choices[0];
    if (!choice?.message) break;

    const msg = choice.message;
    if (msg.content) finalContent = msg.content;

    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) break;

    messagesCopy.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
      })),
    });

    const callSessionId = options.callSessionId;
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? '';
      const argsStr = tc.function?.arguments ?? '{}';
      const tool = name ? toolByName.get(name) : null;
      if (callSessionId) publishAsync(callSessionId, 'tool.called', { toolName: name, args: argsStr });
      let result: string;
      if (tool) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsStr);
        } catch {
          args = { input: argsStr };
        }
        const wantsAsync = (tool.config as { async?: boolean })?.async === true;
        if (wantsAsync && callSessionId) {
          await getToolExecutionQueue().add('tool.execute', {
            type: 'tool.execute',
            callSessionId,
            toolName: name,
            toolType: tool.type as ToolType,
            toolConfig: (tool.config ?? {}) as Record<string, unknown>,
            args,
          });
          result = JSON.stringify({ success: true, data: { queued: true } });
        } else {
          const out = await executeTool(tool.type as ToolType, tool.config, args, { callSessionId });
          result = JSON.stringify(out);
        }
      } else {
        result = JSON.stringify({ success: false, error: 'Unknown tool' });
      }
      if (callSessionId) publishAsync(callSessionId, 'tool.result', { toolName: name, result });
      messagesCopy.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  if (finalContent && onChunk) onChunk(finalContent);
  return finalContent;
}
