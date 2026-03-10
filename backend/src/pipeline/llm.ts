/**
 * LLM using OpenAI Chat Completions with streaming.
 * Supports single turn (transcript + systemPrompt) or full message history.
 */

import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const DEFAULT_SYSTEM_PROMPT = `You are a helpful voice assistant. Keep responses concise and natural for spoken conversation.
Reply in short sentences. Do not use markdown or lists unless necessary.`;

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function chat(
  transcript: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  return chatWithSystemPrompt(transcript, DEFAULT_SYSTEM_PROMPT, onChunk, signal);
}

/** Single turn: system prompt + one user message. */
export async function chatWithSystemPrompt(
  transcript: string,
  systemPrompt: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  return chatWithMessages(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    onChunk,
    signal
  );
}

/** Full message array (system + history + latest user). Use for conversation memory. */
export async function chatWithMessages(
  messages: ChatMessage[],
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const stream = await openai.chat.completions.create(
    {
      model: config.openai.llmModel,
      messages,
      stream: true,
      max_tokens: 500,
    },
    { signal }
  );

  const parts: string[] = [];
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      parts.push(content);
      onChunk?.(content);
    }
  }
  return parts.join('');
}

/** One-off non-streaming completion (e.g. for summarization). Uses same model as streaming. */
export async function complete(
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await openai.chat.completions.create(
    {
      model: config.openai.llmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      max_tokens: 1000,
    },
    { signal }
  );
  return response.choices[0]?.message?.content?.trim() ?? '';
}
