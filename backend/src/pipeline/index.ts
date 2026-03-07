/**
 * STT → LLM → TTS pipeline.
 * Runs once per "turn": buffer of user audio → transcript → reply text → reply audio.
 */

import type { ServerMessage } from '../types.js';
import { getSession, updateSession } from '../ws/session-manager.js';
import { getCallIdByCallSessionId, appendMessage, getRecentMessages } from '../services/conversation-memory.js';
import { resampleTo16k } from './resample.js';
import { transcribe } from './stt.js';
import type { ChatMessage } from './llm.js';
import { chatWithSystemPrompt, chatWithMessages } from './llm.js';
import { chatWithTools } from './llm-tools.js';
import { getSystemPromptWithRag } from '../services/rag-prompt.js';
import { synthesize } from './tts.js';

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

export type SendMessage = (msg: ServerMessage) => void;

export async function runPipeline(
  sessionId: string,
  pcmBuffer: Buffer,
  send: SendMessage
): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.pipelineBusy) return;

  updateSession(sessionId, { pipelineBusy: true });

  try {
    // Resample to 16kHz if client sent different rate (e.g. 48k from browser)
    const pcm16k = resampleTo16k(pcmBuffer, session.sampleRate);

    // 1. STT
    const transcript = await transcribe(pcm16k);
    if (transcript) {
      send({ type: 'transcript', payload: { text: transcript, isFinal: true } });
    }

    if (!transcript.trim()) {
      updateSession(sessionId, { pipelineBusy: false });
      return;
    }

    // 2. LLM (with optional RAG, tools, and conversation memory)
    const systemPrompt = await getSystemPromptWithRag(
      session.systemPrompt ?? 'You are a helpful voice assistant.',
      session.knowledgeBaseId,
      transcript
    );
    let callId: string | null = null;
    if (session.callSessionId) {
      callId = await getCallIdByCallSessionId(session.callSessionId);
      if (callId) await appendMessage(callId, 'USER', transcript);
    }
    const onChunk = (chunk: string) => send({ type: 'agent_text', payload: { text: chunk } });
    let replyText: string;
    if (callId) {
      const history = await getRecentMessages(callId, 20);
      const messages = historyToMessages(systemPrompt, history, transcript);
      replyText = session.agentId
        ? await chatWithTools(session.agentId, messages, onChunk, undefined, { callSessionId: session.callSessionId ?? undefined })
        : await chatWithMessages(messages, onChunk);
    } else {
      replyText = session.agentId
        ? await chatWithTools(session.agentId, [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }], onChunk, undefined, { callSessionId: session.callSessionId ?? undefined })
        : await chatWithSystemPrompt(transcript, systemPrompt, onChunk);
    }
    if (callId && replyText.trim()) await appendMessage(callId, 'ASSISTANT', replyText.trim());

    if (!replyText.trim()) {
      updateSession(sessionId, { pipelineBusy: false });
      return;
    }

    // 3. TTS
    send({ type: 'agent_audio_start', payload: {} });
    const audioBase64 = await synthesize(replyText, session.voiceName);
    if (audioBase64) {
      send({ type: 'agent_audio', payload: { base64: audioBase64 } });
    }
    send({ type: 'agent_audio_end', payload: {} });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: 'error', payload: { message } });
  } finally {
    updateSession(sessionId, { pipelineBusy: false });
  }
}
