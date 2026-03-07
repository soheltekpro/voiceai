/**
 * Real-time pipeline: on final transcript → streaming LLM → sentence-by-sentence TTS.
 * Supports abort (barge-in) via AbortSignal.
 */

import type { ServerMessage } from '../types.js';
import { getSystemPromptWithRag } from '../services/rag-prompt.js';
import { appendMessage } from '../services/conversation-memory.js';
import type { ChatMessage } from './llm.js';
import { chatWithSystemPrompt, chatWithMessages } from './llm.js';
import { chatWithTools } from './llm-tools.js';
import { synthesize } from './tts.js';

const SENTENCE_BREAK = /[.!?]\s+/g;

function* splitSentences(text: string): Generator<string> {
  let start = 0;
  let match: RegExpExecArray | null;
  SENTENCE_BREAK.lastIndex = 0;
  while ((match = SENTENCE_BREAK.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) yield sentence;
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) yield rest;
}

export type SendMessage = (msg: ServerMessage) => void;

/** Map DB conversation roles to OpenAI message format. Skips TOOL (no tool_call_id in history). */
function historyToMessages(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  currentUserContent: string
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'TOOL') continue;
    const role = m.role.toLowerCase() as 'user' | 'assistant' | 'system';
    if (role === 'user' || role === 'assistant' || role === 'system') {
      messages.push({ role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: currentUserContent });
  return messages;
}

/**
 * Run LLM (streaming) then TTS per sentence, sending chunks. Respects signal for barge-in.
 * When callId is set, loads last 20 messages for context and persists user/assistant messages.
 */
export async function runStreamingReply(
  transcript: string,
  send: SendMessage,
  signal: AbortSignal,
  options?: {
    systemPrompt?: string;
    voiceName?: string;
    knowledgeBaseId?: string | null;
    agentId?: string | null;
    callId?: string | null;
    callSessionId?: string | null;
  }
): Promise<void> {
  const controller = new AbortController();
  signal.onAbort(() => controller.abort());

  send({ type: 'agent_audio_start', payload: {} });

  const fullText: string[] = [];
  const systemPrompt = await getSystemPromptWithRag(
    options?.systemPrompt ?? 'You are a helpful voice assistant.',
    options?.knowledgeBaseId,
    transcript
  );

  const onChunk = (chunk: string) => {
    if (signal.aborted) return;
    fullText.push(chunk);
    send({ type: 'agent_text_delta', payload: { text: chunk } });
  };

  try {
    if (options?.callId) {
      const { getRecentMessages } = await import('../services/conversation-memory.js');
      const history = await getRecentMessages(options.callId, 20);
      const messages = historyToMessages(systemPrompt, history, transcript);
      if (options?.agentId) {
        await chatWithTools(options.agentId, messages, onChunk, controller.signal, {
          callSessionId: options?.callSessionId ?? undefined,
        });
      } else {
        await chatWithMessages(messages, onChunk, controller.signal);
      }
    } else {
      if (options?.agentId) {
        await chatWithTools(options.agentId, [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }], onChunk, controller.signal, {
          callSessionId: options?.callSessionId ?? undefined,
        });
      } else {
        await chatWithSystemPrompt(transcript, systemPrompt, onChunk, controller.signal);
      }
    }

    if (signal.aborted) return;
    const full = fullText.join('').trim();
    if (options?.callId && full) {
      void appendMessage(options.callId, 'ASSISTANT', full);
    }
    if (!full) {
      send({ type: 'agent_audio_end', payload: {} });
      return;
    }

    for (const sentence of splitSentences(full)) {
      if (signal.aborted) break;
      const audioBase64 = await synthesize(sentence, options?.voiceName);
      if (signal.aborted) break;
      if (audioBase64) {
        send({ type: 'agent_audio_chunk', payload: { base64: audioBase64 } });
      }
    }
  } finally {
    if (!signal.aborted) send({ type: 'agent_audio_end', payload: {} });
  }
}

export function createAbortSignal(): AbortSignal {
  let aborted = false;
  const listeners: Array<() => void> = [];
  return {
    get aborted() {
      return aborted;
    },
    abort() {
      if (aborted) return;
      aborted = true;
      listeners.forEach((fn) => fn());
    },
    onAbort(fn: () => void) {
      if (aborted) fn();
      else listeners.push(fn);
    },
  };
}

export interface AbortSignal {
  readonly aborted: boolean;
  abort(): void;
  onAbort(fn: () => void): void;
}
