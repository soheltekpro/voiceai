/**
 * Real-time pipeline: on final transcript → streaming LLM → sentence-by-sentence TTS.
 * When config.streamingTts: tokens stream → sentence detection → TTS per sentence → immediate playback.
 * Otherwise: full reply → TTS per sentence (existing behavior).
 * Supports abort (barge-in) via AbortSignal.
 */

import type { ServerMessage } from '../types.js';
import { getSystemPromptWithRag } from '../services/rag-prompt.js';
import { getConversationMemory } from '../memory/conversation-memory.js';
import { appendMessage } from '../services/conversation-memory.js';
import type { ChatMessage } from './llm.js';
import { chatWithSystemPrompt, chatWithMessages } from './llm.js';
import { chatWithTools } from './llm-tools.js';
import { extractCompleteSentences } from '../utils/sentence-segmentation.js';
import { SentenceChunker } from '../utils/sentence-detector.js';
import { normalizeTtsText } from '../utils/normalize-tts-text.js';
import { synthesizeSpeechByProvider, synthesizeSpeechByProviderStreamCancelable } from './tts-router.js';
import { config } from '../config.js';
import { SentenceQueue, MAX_SENTENCE_QUEUE } from './sentence-queue.js';
import {
  recordTtsSentenceDuration,
  recordTtsQueueLatency,
  recordTtsWorkerIdleStart,
  recordTtsWorkerIdleEnd,
} from '../metrics/voice-metrics.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const VOICE_DEBUG = process.env['VOICE_DEBUG'] === '1' || process.env['LOG_LEVEL'] === 'debug';

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

const ttsOptsFromOptions = (options: RunStreamingReplyOptions) => ({
  provider: options.ttsProvider ?? 'openai',
  voice: options.ttsVoice ?? options.voiceName ?? 'alloy',
  preferredLatency: config.preferredLatency,
  callSessionId: options.callSessionId ?? undefined,
});

const MEMORY_CONTEXT_PREFIX = `SYSTEM MEMORY CONTEXT:

Previous interactions with this caller:

`;

export type RunStreamingReplyOptions = {
  systemPrompt?: string;
  voiceName?: string;
  knowledgeBaseId?: string | null;
  agentId?: string | null;
  callId?: string | null;
  callSessionId?: string | null;
  /** Agent-configured LLM provider/model/temperature (used by streaming path so provider order respects agent) */
  llmProvider?: string | null;
  llmModel?: string | null;
  temperature?: number | null;
  ttsProvider?: string | null;
  ttsVoice?: string | null;
  /** Workspace and caller phone for persistent conversation memory */
  workspaceId?: string | null;
  phoneNumber?: string | null;
  /** Callback to update call trace with latency metrics */
  onCallTrace?: (partial: { llmFirstTokenMs?: number; llmTotalDurationMs?: number; ttsFirstAudioMs?: number; ttsTotalDurationMs?: number }) => void;
  /** Callback to report voice usage for billing (LLM tokens estimated from streamed text, TTS chars = length) */
  onVoiceUsage?: (u: { llmInputTokens?: number; llmOutputTokens?: number; ttsCharacters?: number }) => void;
};

/**
 * Run LLM (streaming) then TTS per sentence. When config.streamingTts: stream tokens → detect sentences → TTS each sentence immediately.
 * Otherwise: full reply → TTS per sentence. Respects signal for barge-in.
 */
export async function runStreamingReply(
  transcript: string,
  send: SendMessage,
  signal: AbortSignal,
  options?: RunStreamingReplyOptions
): Promise<void> {
  const controller = new AbortController();
  signal.onAbort(() => controller.abort());

  send({ type: 'agent_audio_start', payload: {} });

  const fullText: string[] = [];
  let basePrompt = options?.systemPrompt ?? 'You are a helpful voice assistant.';
  if (options?.workspaceId && options?.phoneNumber) {
    const memory = await getConversationMemory(options.workspaceId, options.phoneNumber);
    if (memory) {
      basePrompt = MEMORY_CONTEXT_PREFIX + memory + '\n\n' + basePrompt;
    }
  }
  const systemPrompt = await getSystemPromptWithRag(
    basePrompt,
    options?.knowledgeBaseId,
    transcript
  );

  const useSentenceStreaming = config.streamingTts;
  let tokenBuffer = '';
  const pendingSentences: string[] = [];
  let llmDone = false;

  const onCallTrace = options?.onCallTrace;
  const llmStartTime = Date.now();
  let llmFirstTokenTime: number | null = null;

  const sentenceQueue = useSentenceStreaming ? new SentenceQueue() : null;
  const sentenceChunker = useSentenceStreaming ? new SentenceChunker({ minChars: 20, maxChars: 30 }) : null;
  signal.onAbort(() => sentenceQueue?.close());

  const onChunk = (chunk: string) => {
    if (signal.aborted) return;
    if (fullText.length === 0 && llmFirstTokenTime === null) {
      llmFirstTokenTime = Date.now();
      onCallTrace?.({ llmFirstTokenMs: llmFirstTokenTime - llmStartTime });
      console.info('[voice] LLM token', { first: true });
    }
    if (VOICE_DEBUG && fullText.length < 5) console.info('[voice] LLM token', { chunk: chunk.slice(0, 40) });
    fullText.push(chunk);
    send({ type: 'agent_text_delta', payload: { text: chunk } });
    if (sentenceQueue && sentenceChunker) {
      const speakable = sentenceChunker.pushAndPull(chunk);
      for (const s of speakable) pendingSentences.push(s);
    } else if (sentenceQueue) {
      tokenBuffer += chunk;
      const { sentences, remaining } = extractCompleteSentences(tokenBuffer);
      tokenBuffer = remaining;
      for (const s of sentences) pendingSentences.push(s);
    }
  };

  /** Producer: drains pendingSentences into the queue with backpressure. */
  const runProducer = async () => {
    if (!sentenceQueue) return;
    while (!llmDone || pendingSentences.length > 0) {
      if (signal.aborted) break;
      if (pendingSentences.length > 0) {
        const s = pendingSentences.shift()!;
        await sentenceQueue.enqueue(normalizeTtsText(s));
        if (sentenceQueue.size >= MAX_SENTENCE_QUEUE) await sleep(20);
      } else {
        await sleep(20);
      }
    }
  };

  const runLlm = async () => {
    if (VOICE_DEBUG) console.info('[voice] LLM started', { hasTools: !!options?.agentId });
    if (options?.callId) {
      const { getRecentMessages } = await import('../services/conversation-memory.js');
      const history = await getRecentMessages(options.callId, 20);
      const messages = historyToMessages(systemPrompt, history, transcript);
      if (options?.agentId) {
        await chatWithTools(options.agentId, messages, onChunk, controller.signal, {
          callSessionId: options?.callSessionId ?? undefined,
          provider: options?.llmProvider ?? undefined,
          model: options?.llmModel ?? undefined,
          temperature: options?.temperature ?? undefined,
        });
      } else {
        await chatWithMessages(messages, onChunk, controller.signal);
      }
    } else {
      if (options?.agentId) {
        await chatWithTools(options.agentId, [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }], onChunk, controller.signal, {
          callSessionId: options?.callSessionId ?? undefined,
          provider: options?.llmProvider ?? undefined,
          model: options?.llmModel ?? undefined,
          temperature: options?.temperature ?? undefined,
        });
      } else {
        await chatWithSystemPrompt(transcript, systemPrompt, onChunk, controller.signal);
      }
    }
    onCallTrace?.({ llmTotalDurationMs: Date.now() - llmStartTime });
  };

  /**
   * TTS worker: dequeues sentences one at a time, synthesizes and streams audio.
   * Processes in order so audio is not overlapping; runs in parallel with LLM.
   * Records queue latency, sentence duration, and idle time.
   */
  const processSentenceQueue = async () => {
    if (!sentenceQueue) return;
    const ttsOpts = ttsOptsFromOptions(options ?? {});
    let firstSentenceStartTime: number | null = null;
    let firstAudioChunkSent = false;
    let ttsStartedLogged = false;
    while (true) {
      recordTtsWorkerIdleStart();
      const item = await sentenceQueue.dequeue();
      recordTtsWorkerIdleEnd();
      if (item === null) break;
      if (signal.aborted) break;
      if (!ttsStartedLogged) {
        console.info('[voice] TTS started', { provider: ttsOpts.provider });
        ttsStartedLogged = true;
      }
      console.info('[voice] TTS sentence', { provider: ttsOpts.provider, sentence: item.sentence.slice(0, 60), length: item.sentence.length });
      recordTtsQueueLatency(Date.now() - item.enqueuedAt);
      const sentenceStart = Date.now();
      if (firstSentenceStartTime === null) firstSentenceStartTime = sentenceStart;
      const { stream, cancel } = synthesizeSpeechByProviderStreamCancelable(item.sentence, ttsOpts);
      signal.onAbort(cancel);
      let chunkCount = 0;
      try {
        for await (const audioChunk of stream) {
          if (signal.aborted) {
            cancel();
            break;
          }
          if (audioChunk?.length) {
            chunkCount++;
            if (!firstAudioChunkSent && firstSentenceStartTime !== null) {
              firstAudioChunkSent = true;
              console.info('[voice] TTS first audio chunk received', { provider: ttsOpts.provider, bytes: audioChunk.length });
              console.info('[voice] sending audio to client');
              onCallTrace?.({ ttsFirstAudioMs: Date.now() - firstSentenceStartTime });
            }
            send({ type: 'agent_audio_chunk', payload: { base64: audioChunk.toString('base64') } });
            console.info('[voice] audio chunk sent', { bytes: audioChunk.length });
          }
        }
        if (chunkCount === 0) console.warn('[voice] TTS stream ended with no chunks', { provider: ttsOpts.provider, sentenceLength: item.sentence.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[voice] TTS stream error', { provider: ttsOpts.provider, error: msg });
        cancel();
        throw err;
      }
      recordTtsSentenceDuration(Date.now() - sentenceStart);
    }
    if (firstSentenceStartTime !== null) {
      onCallTrace?.({ ttsTotalDurationMs: Date.now() - firstSentenceStartTime });
    }
  };

  try {
    if (useSentenceStreaming && sentenceQueue) {
      const processPromise = processSentenceQueue();
      const producerPromise = runProducer();
      await runLlm();
      llmDone = true;
      if (sentenceChunker) {
        const trailing = sentenceChunker.flush();
        if (trailing.trim()) pendingSentences.push(trailing.trim());
      } else if (tokenBuffer.trim()) pendingSentences.push(tokenBuffer.trim());
      await producerPromise;
      sentenceQueue.close();
      await processPromise;
    } else {
      await runLlm();
      if (signal.aborted) return;
      const full = fullText.join('').trim();
      if (options?.callId && full) void appendMessage(options.callId, 'ASSISTANT', full);
      if (!full) {
        send({ type: 'agent_audio_end', payload: {} });
        return;
      }
      const ttsOpts = ttsOptsFromOptions(options ?? {});
      console.info('[voice] TTS started', { provider: ttsOpts.provider ?? 'openai' });
      const ttsStartFallback = Date.now();
      let ttsFirstAudioSent = false;
      for (const sentence of splitSentences(full)) {
        if (signal.aborted) break;
        console.info('[voice] TTS sentence', { provider: ttsOpts.provider ?? 'openai', sentence: sentence.slice(0, 60), length: sentence.length });
        const audioBase64 = await synthesizeSpeechByProvider(sentence, ttsOpts);
        if (signal.aborted) break;
        if (audioBase64) {
          if (!ttsFirstAudioSent) {
            ttsFirstAudioSent = true;
            onCallTrace?.({ ttsFirstAudioMs: Date.now() - ttsStartFallback });
          }
          send({ type: 'agent_audio_chunk', payload: { base64: audioBase64 } });
          console.info('[voice] audio chunk sent', { bytes: Buffer.byteLength(audioBase64, 'base64') });
        }
      }
      onCallTrace?.({ ttsTotalDurationMs: Date.now() - ttsStartFallback });
    }

    if (options?.callId && fullText.length) {
      const full = fullText.join('').trim();
      if (full) void appendMessage(options.callId, 'ASSISTANT', full);
    }

    const full = fullText.join('').trim();
    if (full && options?.onVoiceUsage) {
      const ttsCharacters = full.length;
      const llmOutputTokens = Math.ceil(ttsCharacters / 4);
      options.onVoiceUsage({ llmOutputTokens, ttsCharacters });
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
