/**
 * STT → LLM → TTS pipeline.
 * Runs once per "turn": buffer of user audio → transcript → reply text → reply audio.
 */

import type { ServerMessage } from '../types.js';
import { getSession, updateSession } from '../ws/session-manager.js';
import { getCallIdByCallSessionId, appendMessage, getRecentMessages } from '../services/conversation-memory.js';
import { resampleTo16k } from './resample.js';
import { transcribeAudioByProvider } from './stt-router.js';
import { getBestProvider, recordSuccess, recordFailure } from '../providers/provider-health.js';
import type { ChatMessage } from './llm.js';
import { chatWithMessagesByProvider } from './llm-router.js';
import { chatWithTools } from './llm-tools.js';
import { loadToolsForAgent } from '../services/agent-tools-loader.js';
import { getSystemPromptWithRag } from '../services/rag-prompt.js';
import { synthesizeSpeechByProvider, synthesizeSpeechByProviderStreamCancelable } from './tts-router.js';
import { config } from '../config.js';

const VOICE_DEBUG = process.env['VOICE_DEBUG'] === '1' || process.env['LOG_LEVEL'] === 'debug';

/** Browsers typically capture at 48kHz (or 44.1kHz). Default 16k is wrong for browser input. */
const BROWSER_DEFAULT_SAMPLE_RATE = 48000;

function effectiveSampleRate(session: { sampleRate: number; clientType?: string }): number {
  if (session.clientType === 'BROWSER' && session.sampleRate === 16000) {
    return BROWSER_DEFAULT_SAMPLE_RATE;
  }
  return session.sampleRate;
}

/** RMS of 16-bit LE PCM (0..1 scale); for debug logging. */
function pcmRms(pcm: Buffer): number {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

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

export type PipelineOptions = {
  setTtsCancel?: (cancel: () => void) => void;
};

export async function runPipeline(
  sessionId: string,
  pcmBuffer: Buffer,
  send: SendMessage,
  pipelineOptions?: PipelineOptions
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  // pipelineBusy is set by voice-ws-handler tryRunPipeline before calling us, to avoid parallel runs

  const inputRate = effectiveSampleRate(session);
  if (VOICE_DEBUG) {
    const rms = pcmRms(pcmBuffer);
    console.info('[voice] pipeline input', {
      sessionId: sessionId.slice(0, 8),
      sampleRate: session.sampleRate,
      effectiveRate: inputRate,
      bufferBytes: pcmBuffer.length,
      rms: rms.toFixed(4),
    });
  }

  try {
    // PCM16 must have even length (2 bytes per sample); drop trailing byte if odd
    const pcmEven = pcmBuffer.length % 2 === 0 ? pcmBuffer : pcmBuffer.subarray(0, pcmBuffer.length - 1);
    // Resample to 16kHz if client sent different rate (e.g. 48k from browser)
    const pcm16k = resampleTo16k(pcmEven, inputRate);

    // 1. STT (default: best healthy provider when empty)
    const sttProvider = session.sttProvider ?? getBestProvider('stt');
    const sttModel = session.sttModel ?? undefined;
    if (VOICE_DEBUG) console.info('[voice] STT config', { provider: sttProvider, model: sttModel ?? '(default)' });
    const sttStart = Date.now();
    let sttResult: { text: string };
    try {
      sttResult = await transcribeAudioByProvider(pcm16k, {
        provider: sttProvider,
        model: sttModel,
        language: session.language ?? 'en',
        preferredLatency: config.preferredLatency,
        callSessionId: session.callSessionId ?? undefined,
      }, 16000);
    } catch (err) {
      recordFailure(sttProvider);
      throw err;
    }
    recordSuccess(sttProvider, Date.now() - sttStart);
    const transcript = sttResult.text;
    if (VOICE_DEBUG) {
      if (transcript.trim()) {
        console.info('[voice] STT result', { sessionId: sessionId.slice(0, 8), length: transcript.length, preview: transcript.slice(0, 80) });
      } else {
        console.info('[voice] STT returned empty transcript', { sessionId: sessionId.slice(0, 8), bufferBytes: pcmBuffer.length });
      }
    }
    if (transcript) {
      send({ type: 'transcript', payload: { text: transcript, isFinal: true } });
    }

    if (!transcript.trim()) {
      if (VOICE_DEBUG) console.info('[voice] skipping LLM/TTS (empty transcript)', { sessionId: sessionId.slice(0, 8) });
      return;
    }

    // 2. LLM (with optional RAG, tools, and conversation memory)
    if (VOICE_DEBUG) console.info('[voice] pipeline LLM started', { sessionId: sessionId.slice(0, 8) });
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
    const llmOptions = {
      provider: session.llmProvider ?? null,
      model: session.llmModel ?? null,
      temperature: session.temperature ?? null,
      preferredLatency: config.preferredLatency,
    };
    const messages: ChatMessage[] = callId
      ? historyToMessages(systemPrompt, await getRecentMessages(callId, 20), transcript)
      : [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }];
    const tools = session.agentId ? await loadToolsForAgent(session.agentId) : [];
    const llmProvider = session.llmProvider ?? getBestProvider('llm');
    const llmModel = session.llmModel ?? undefined;
    const llmTemperature = session.temperature ?? undefined;
    if (VOICE_DEBUG) console.info('[voice] LLM config', { provider: llmProvider, model: llmModel ?? '(default)', temperature: llmTemperature ?? '(default)' });
    const llmStart = Date.now();
    let replyText: string;
    try {
      if (tools.length > 0 && session.agentId) {
        replyText = await chatWithTools(
          session.agentId,
          messages,
          onChunk,
          undefined,
          { callSessionId: session.callSessionId ?? undefined, ...llmOptions, provider: llmProvider }
        );
      } else {
        replyText = await chatWithMessagesByProvider(messages, { ...llmOptions, provider: llmProvider, callSessionId: session.callSessionId ?? undefined }, onChunk, undefined);
      }
    } catch (err) {
      recordFailure(llmProvider);
      throw err;
    }
    recordSuccess(llmProvider, Date.now() - llmStart);
    if (callId && replyText.trim()) await appendMessage(callId, 'ASSISTANT', replyText.trim());

    if (!replyText.trim()) {
      return;
    }

    // 3. TTS (default: best healthy provider when empty; voice: ttsVoice ?? voiceName)
    const ttsProvider = session.ttsProvider ?? getBestProvider('tts');
    const ttsVoice = session.ttsVoice ?? session.voiceName ?? 'alloy';
    if (VOICE_DEBUG) console.info('[voice] TTS config', { provider: ttsProvider, voice: ttsVoice });
    if (VOICE_DEBUG) console.info('[voice] pipeline TTS started', { sessionId: sessionId.slice(0, 8), replyLength: replyText.length });
    send({ type: 'agent_audio_start', payload: {} });
    const ttsOpts = {
      provider: ttsProvider,
      voice: ttsVoice,
      preferredLatency: config.preferredLatency,
      callSessionId: session.callSessionId ?? undefined,
    };
    const ttsStart = Date.now();
    try {
      if (config.streamingTts) {
        const { stream, cancel } = synthesizeSpeechByProviderStreamCancelable(replyText, ttsOpts);
        pipelineOptions?.setTtsCancel?.(cancel);
        for await (const chunk of stream) {
          if (chunk?.length) send({ type: 'agent_audio_chunk', payload: { base64: chunk.toString('base64') } });
        }
      } else {
        const audioBase64 = await synthesizeSpeechByProvider(replyText, ttsOpts);
        if (audioBase64) send({ type: 'agent_audio', payload: { base64: audioBase64 } });
      }
    } catch (err) {
      recordFailure(ttsProvider);
      throw err;
    }
    recordSuccess(ttsProvider, Date.now() - ttsStart);
    send({ type: 'agent_audio_end', payload: {} });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: 'error', payload: { message } });
  }
  // pipelineBusy is cleared by voice-ws-handler tryRunPipeline .finally()
}
