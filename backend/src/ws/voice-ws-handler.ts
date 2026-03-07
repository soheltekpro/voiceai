/**
 * WebSocket connection handler for /voice.
 * Phase 1: buffer audio → STT → LLM → TTS (batch).
 * Phase 2 (when Deepgram configured): stream audio → streaming STT → on final → streaming LLM → sentence TTS; supports interrupt (barge-in).
 */

import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../types.js';
import { createSession, getSession, deleteSession, updateSession } from './session-manager.js';
import { appendAudio, takeBufferIfReady } from './audio-stream-handler.js';
import { runPipeline } from '../pipeline/index.js';
import { prisma } from '../db/prisma.js';
import { persistAndPublish } from '../events/persist.js';
import { recordAssistantMessage, recordUserMessage, finalizeCallSession } from '../calls/analytics.js';
import { recordCallUsage } from '../services/usage.js';
import { metrics } from '../infra/metrics.js';
import {
  createStreamingSTT,
  isStreamingSTTAvailable,
} from '../pipeline/stt-streaming.js';
import {
  runStreamingReply,
  createAbortSignal,
} from '../pipeline/streaming-pipeline.js';

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }));
}

function handleClientMessage(
  ws: WebSocket,
  sessionId: string,
  raw: string | Buffer
): void {
  if (Buffer.isBuffer(raw)) {
    appendAudio(sessionId, raw);
    const session = getSession(sessionId);
    if (session?.streamingSTT) {
      session.streamingSTT.pushPcm(raw, session.sampleRate);
    } else {
      tryRunPipeline(ws, sessionId);
    }
    return;
  }

  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw as string) as ClientMessage;
  } catch {
    send(ws, { type: 'error', payload: { message: 'Invalid JSON' } });
    return;
  }

  switch (msg.type) {
    case 'audio': {
      const chunk = Buffer.from(msg.payload.base64, 'base64');
      if (chunk.length > 0) {
        appendAudio(sessionId, chunk);
        const session = getSession(sessionId);
        if (session?.streamingSTT) {
          session.streamingSTT.pushPcm(chunk, session.sampleRate);
        } else {
          tryRunPipeline(ws, sessionId);
        }
      }
      break;
    }
    case 'config': {
      const session = getSession(sessionId);
      if (session) {
        if (msg.payload.sampleRate) updateSession(sessionId, { sampleRate: msg.payload.sampleRate });
        if (msg.payload.language) updateSession(sessionId, { language: msg.payload.language });
        if (msg.payload.agentId) updateSession(sessionId, { agentId: msg.payload.agentId });
        if (msg.payload.clientType) updateSession(sessionId, { clientType: msg.payload.clientType });
        if (msg.payload.callSessionId) updateSession(sessionId, { callSessionId: msg.payload.callSessionId as string });
      }

      void ensureCallSession(sessionId, msg.payload.clientType, msg.payload.callSessionId as string | undefined);

      if (msg.payload.agentId) {
        void loadAgentSettings(sessionId, msg.payload.agentId).then(() => {
          // lazily start streaming STT after agent settings applied
          maybeStartStreamingStt(ws, sessionId);
          ensureMaxDurationTimer(ws, sessionId);
        });
      } else {
        maybeStartStreamingStt(ws, sessionId);
        ensureMaxDurationTimer(ws, sessionId);
      }
      break;
    }
    case 'interrupt':
      handleInterrupt(ws, sessionId);
      break;
    case 'ping':
      send(ws, { type: 'pong', payload: {} });
      break;
    default:
      break;
  }
}

function ensureMaxDurationTimer(ws: WebSocket, sessionId: string): void {
  const s = getSession(sessionId);
  if (!s) return;
  if (s.maxDurationTimer) return;
  const seconds = s.maxCallDurationSeconds ?? 15 * 60;
  const timer = setTimeout(() => {
    try {
      ws.close(1000, 'max call duration reached');
    } catch {
      // ignore
    }
  }, Math.max(1, seconds) * 1000);
  updateSession(sessionId, { maxDurationTimer: timer });
}

function maybeStartStreamingStt(ws: WebSocket, sessionId: string): void {
  const s = getSession(sessionId);
  if (!s) return;
  if (!isStreamingSTTAvailable()) return;
  if (s.streamingSTT) return;

  const controller = createStreamingSTT((text, isFinal) => {
    const session = getSession(sessionId);
    if (!session) return;

    if (!isFinal) {
      send(ws, { type: 'transcript_partial', payload: { text } });
      void logEvent(sessionId, 'TRANSCRIPT_PARTIAL', { text });
      if (session.callSessionId) {
        void persistAndPublish(session.callSessionId, 'speech.detected', { text });
        void persistAndPublish(session.callSessionId, 'transcript.partial', { text });
      }
      // Auto barge-in: if user starts speaking while agent is talking
      if (
        session.phase === 'processing' &&
        session.interruptionBehavior === 'BARGE_IN_STOP_AGENT' &&
        session.replyAbort
      ) {
        session.replyAbort.abort();
        updateSession(sessionId, { replyAbort: undefined });
        send(ws, { type: 'agent_stopped', payload: {} });
        void logEvent(sessionId, 'AGENT_STOPPED', { reason: 'barge_in' });
      }
      return;
    }

    send(ws, { type: 'transcript_final', payload: { text } });
    if (session.callSessionId) {
      void persistAndPublish(session.callSessionId, 'transcription.completed', { text });
      void persistAndPublish(session.callSessionId, 'transcript.final', { text });
    }
    onFinalTranscript(ws, sessionId, text);
  }, s.language);

  if (controller) updateSession(sessionId, { streamingSTT: controller, phase: 'listening' });
}

function handleInterrupt(ws: WebSocket, sessionId: string): void {
  const session = getSession(sessionId);
  if (session?.interruptionBehavior === 'IGNORE_WHILE_SPEAKING') return;
  if (session?.replyAbort) {
    session.replyAbort.abort();
    updateSession(sessionId, { replyAbort: undefined });
    send(ws, { type: 'agent_stopped', payload: {} });
    void logEvent(sessionId, 'AGENT_STOPPED', {});
    if (session.callSessionId) void persistAndPublish(session.callSessionId, 'speech.detected', { reason: 'interrupt' });
  }
}

async function ensureCallSession(
  sessionId: string,
  clientType?: 'BROWSER' | 'PHONE' | 'UNKNOWN',
  existingCallSessionId?: string
): Promise<void> {
  const s = getSession(sessionId);
  if (!s) return;
  if (existingCallSessionId) {
    if (!s.callSessionId) {
      updateSession(sessionId, { callSessionId: existingCallSessionId });
      await persistAndPublish(existingCallSessionId, 'call.connected', { wsSessionId: sessionId });
      metrics.activeCalls.inc({ type: s.clientType ?? clientType ?? 'UNKNOWN' });
    }
    return;
  }
  if (s.callSessionId) return;
  const row = await prisma.callSession.create({
    data: {
      agentId: s.agentId ?? null,
      clientType: clientType ?? 'UNKNOWN',
      status: 'ACTIVE',
      metadata: { sessionId },
    },
  });
  updateSession(sessionId, { callSessionId: row.id });
  await persistAndPublish(row.id, 'call.started', { wsSessionId: sessionId, clientType: clientType ?? 'UNKNOWN' });
  await persistAndPublish(row.id, 'call.connected', { wsSessionId: sessionId });
  metrics.activeCalls.inc({ type: clientType ?? 'UNKNOWN' });
}

async function logEvent(wsSessionId: string, type: any, payload: any): Promise<void> {
  const s = getSession(wsSessionId);
  if (!s?.callSessionId) return;
  try {
    await prisma.callEvent.create({
      data: {
        sessionId: s.callSessionId,
        type,
        payload,
      },
    });
  } catch {
    // best-effort
  }
}

async function loadAgentSettings(wsSessionId: string, agentId: string): Promise<void> {
  const s = getSession(wsSessionId);
  if (!s) return;
  const settings = await prisma.agentSettings.findUnique({ where: { agentId } });
  if (!settings) return;
  updateSession(wsSessionId, {
    agentId,
    systemPrompt: settings.systemPrompt,
    voiceName: settings.voiceName,
    knowledgeBaseId: settings.knowledgeBaseId ?? undefined,
    language: settings.language,
    maxCallDurationSeconds: settings.maxCallDurationSeconds,
    interruptionBehavior: settings.interruptionBehavior,
  });
}

function tryRunPipeline(ws: WebSocket, sessionId: string): void {
  const buffer = takeBufferIfReady(sessionId);
  if (!buffer) return;

  const sendMsg: (m: ServerMessage) => void = (m) => send(ws, m);
  runPipeline(sessionId, buffer, sendMsg).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', payload: { message } });
  });
}

function onFinalTranscript(
  ws: WebSocket,
  sessionId: string,
  transcript: string
): void {
  const session = getSession(sessionId);
  if (!session || !transcript.trim()) return;
  if (session.phase === 'processing') return;

  if (session.callSessionId) {
    void recordUserMessage(session.callSessionId, transcript);
  }

  updateSession(sessionId, { phase: 'processing', pipelineBusy: true });
  const signal = createAbortSignal();
  updateSession(sessionId, { replyAbort: signal });

  let assistantText = '';
  let agentReplyEmitted = false;

  const sendMsg: (m: ServerMessage) => void = (m) => {
    send(ws, m);
    // best-effort event persistence (don’t block audio loop)
    if (m.type === 'agent_text_delta') void logEvent(sessionId, 'AGENT_TEXT_DELTA', { text: m.payload.text });
    if (m.type === 'agent_audio_start') void logEvent(sessionId, 'AGENT_AUDIO_START', {});
    if (m.type === 'agent_audio_chunk') void logEvent(sessionId, 'AGENT_AUDIO_CHUNK', { bytes: (m.payload.base64 ?? '').length });
    if (m.type === 'agent_audio_end') void logEvent(sessionId, 'AGENT_AUDIO_END', {});

    const s = getSession(sessionId);
    if (!s?.callSessionId) return;
    if ((m.type === 'agent_text_delta' || m.type === 'agent_audio_start') && !agentReplyEmitted) {
      agentReplyEmitted = true;
      void persistAndPublish(s.callSessionId, 'agent.reply', {});
      void persistAndPublish(s.callSessionId, 'assistant.reply', {});
    }
    if (m.type === 'agent_text_delta') void persistAndPublish(s.callSessionId, 'ai.response.generated', { text_delta: m.payload.text });
    if (m.type === 'agent_audio_chunk') void persistAndPublish(s.callSessionId, 'audio.played', { bytes: (m.payload.base64 ?? '').length });
    if (m.type === 'agent_text_delta') assistantText += (m.payload.text ?? '');
    if (m.type === 'agent_audio_end') {
      void recordAssistantMessage(s.callSessionId, assistantText);
    }
  };

  void logEvent(sessionId, 'TRANSCRIPT_FINAL', { text: transcript });

  void (async () => {
    let callId: string | null = null;
    if (session.callSessionId) {
      const { getCallIdByCallSessionId, appendMessage } = await import('../services/conversation-memory.js');
      callId = await getCallIdByCallSessionId(session.callSessionId);
      if (callId) void appendMessage(callId, 'USER', transcript);
    }
    return runStreamingReply(transcript, sendMsg, signal, {
      systemPrompt: session.systemPrompt,
      voiceName: session.voiceName,
      knowledgeBaseId: session.knowledgeBaseId ?? undefined,
      agentId: session.agentId ?? undefined,
      callId: callId ?? undefined,
      callSessionId: session.callSessionId ?? undefined,
    });
  })()
    .catch((err) => {
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        send(ws, { type: 'error', payload: { message } });
        void logEvent(sessionId, 'ERROR', { message });
      }
    })
    .finally(() => {
      updateSession(sessionId, {
        phase: 'idle',
        pipelineBusy: false,
        replyAbort: undefined,
      });
    });
}

export function handleVoiceConnection(ws: WebSocket): void {
  const session = createSession();
  const { sessionId } = session;

  metrics.wsConnectionsTotal.inc({ path: '/voice' });

  send(ws, { type: 'session', payload: { sessionId } });

  ws.on('message', (data: Buffer | string) => {
    handleClientMessage(ws, sessionId, data);
  });

  ws.on('close', () => {
    const s = getSession(sessionId);
    s?.streamingSTT?.close();
    if (s?.maxDurationTimer) clearTimeout(s.maxDurationTimer);
    if (s?.callSessionId) {
      const endedAt = new Date();
      const startedAt = new Date(s.createdAt);
      const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
      void prisma.callSession.update({
        where: { id: s.callSessionId },
        data: { status: 'ENDED', endedAt, durationSeconds },
      });
      void persistAndPublish(s.callSessionId, 'call.ended', {});
      void finalizeCallSession(s.callSessionId, startedAt, endedAt);
      // Update calls table if this session was started via POST /calls/start
      void prisma.callSession.findUnique({
        where: { id: s.callSessionId },
        select: { transcriptText: true, inputTokens: true, outputTokens: true, agent: { select: { workspaceId: true } } },
      }).then(async (row) => {
        if (!row) return;
        const tokensUsed = (row.inputTokens ?? 0) + (row.outputTokens ?? 0) || 0;
        const workspaceId = row.agent?.workspaceId;
        if (workspaceId) {
          const toolCallsCount = await prisma.callEvent.count({ where: { sessionId: s.callSessionId!, type: 'TOOL_CALLED' } });
          const callMinutes = durationSeconds / 60;
          const sttTtsSeconds = Math.floor(durationSeconds / 2);
          await recordCallUsage(workspaceId, {
            callMinutes,
            llmTokens: tokensUsed,
            sttSeconds: sttTtsSeconds,
            ttsSeconds: sttTtsSeconds,
            toolCalls: toolCallsCount,
          });
        }
        return prisma.call.updateMany({
          where: { callSessionId: s.callSessionId! },
          data: { status: 'ENDED', endedAt, durationSeconds, transcript: row.transcriptText ?? undefined, tokensUsed: tokensUsed || undefined },
        });
      });
      metrics.activeCalls.dec({ type: s.clientType ?? 'UNKNOWN' });
    }
    deleteSession(sessionId);
  });

  ws.on('error', () => {
    const s = getSession(sessionId);
    s?.streamingSTT?.close();
    if (s?.maxDurationTimer) clearTimeout(s.maxDurationTimer);
    deleteSession(sessionId);
  });
}
