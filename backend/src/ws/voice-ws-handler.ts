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
  startStreamingTranscription,
  isStreamingSTTAvailable,
} from '../pipeline/stt-stream-router.js';
import { startCallTrace, updateCallTrace, finishCallTrace, getCallTrace } from '../voice/call-trace.js';
import {
  startCallMetrics,
  updateCallMetrics,
  finishCallMetrics,
  getCallMetrics,
} from '../voice/call-analytics.js';
import { broadcastVoiceMonitorEvent } from '../voice/voice-monitor.js';
import {
  startVoiceUsage,
  updateVoiceUsage,
  finishVoiceUsage,
  addVoiceUsageAudioInput,
  addVoiceUsageAudioOutput,
  checkVoiceQuota,
} from '../usage/voice-usage.js';
import {
  runStreamingReply,
  createAbortSignal,
} from '../pipeline/streaming-pipeline.js';

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }));
}

const VOICE_DEBUG = process.env['VOICE_DEBUG'] === '1' || process.env['LOG_LEVEL'] === 'debug';

const GUIDANCE_INTERVAL_MS = 30_000;

function startGuidanceInterval(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s?.callSessionId) return;
  if (s.guidanceIntervalId) return; // already running
  const id = setInterval(async () => {
    const session = getSession(sessionId);
    if (!session?.callSessionId) return;
    try {
      const { getCallIdByCallSessionId } = await import('../services/conversation-memory.js');
      const { generateCallGuidance } = await import('../voice/guidance.js');
      const callId = await getCallIdByCallSessionId(session.callSessionId);
      if (callId) await generateCallGuidance(callId);
    } catch {
      // best-effort
    }
  }, GUIDANCE_INTERVAL_MS);
  updateSession(sessionId, { guidanceIntervalId: id });
}
const audioLoggedSessions = new Set<string>();

/** Turn prediction: minimum partial length before considering end-of-sentence */
const MIN_PREFILL_LENGTH = 10;
/** Punctuation or pause (trailing space) suggesting end of phrase */
const END_OF_PHRASE = /[.!?,]\s*$|\s{2,}$/;

function looksLikeEndOfSentence(text: string): boolean {
  const t = text.trim();
  return t.length >= MIN_PREFILL_LENGTH && (END_OF_PHRASE.test(t) || /[.!?]$/.test(t));
}

function isCompatibleFinal(final: string, partial: string): boolean {
  const f = final.trim().toLowerCase();
  const p = partial.trim().toLowerCase();
  if (!p) return false;
  return f === p || f.startsWith(p);
}

function clearPrefill(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  session.prefillAbort?.abort();
  updateSession(sessionId, {
    prefillAbort: undefined,
    prefillPromise: undefined,
    prefillBuffer: undefined,
    prefillPartial: undefined,
  });
}

async function startPrefill(ws: WebSocket, sessionId: string, partial: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.prefillPromise) return;
  const buffer: ServerMessage[] = [];
  const ac = new AbortController();
  const signal = createAbortSignal();
  ac.signal.addEventListener('abort', () => signal.abort());

  const promise = (async () => {
    const s = getSession(sessionId);
    if (!s) return;
    let callId: string | null = null;
    if (s.callSessionId) {
      const { getCallIdByCallSessionId } = await import('../services/conversation-memory.js');
      callId = await getCallIdByCallSessionId(s.callSessionId);
    }
    await runStreamingReply(partial, (m) => buffer.push(m), signal, {
      systemPrompt: s.systemPrompt,
      voiceName: s.voiceName,
      knowledgeBaseId: s.knowledgeBaseId ?? undefined,
      agentId: s.agentId ?? undefined,
      callId: callId ?? undefined,
      callSessionId: s.callSessionId ?? undefined,
      llmProvider: s.llmProvider ?? undefined,
      llmModel: s.llmModel ?? undefined,
      temperature: s.temperature ?? undefined,
    });
  })();

  updateSession(sessionId, {
    prefillAbort: ac,
    prefillPromise: promise,
    prefillBuffer: buffer,
    prefillPartial: partial,
  });
}

/**
 * Normalize incoming WebSocket payload to a string for JSON parsing.
 * With ws v8 / @fastify/websocket, text frames are delivered as Buffer (UTF-8 bytes), not string.
 * If we treat every Buffer as raw PCM, we append JSON bytes to the audio buffer and STT gets garbage → empty transcript.
 */
function rawToMessageString(raw: string | Buffer): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return raw as string;
}

function handleClientMessage(
  ws: WebSocket,
  sessionId: string,
  raw: string | Buffer
): void {
  const rawStr = rawToMessageString(raw);

  // If it looks like JSON (client sends config/audio as text), parse and dispatch by type
  const trimmed = rawStr.trim();
  if (trimmed.startsWith('{')) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawStr) as ClientMessage;
    } catch {
      send(ws, { type: 'error', payload: { message: 'Invalid JSON' } });
      return;
    }
    switch (msg.type) {
      case 'audio': {
        const chunk = Buffer.from(msg.payload.base64, 'base64');
        if (chunk.length > 0) {
          if (VOICE_DEBUG && !audioLoggedSessions.has(sessionId)) {
            audioLoggedSessions.add(sessionId);
            console.info('[voice] first audio chunk received', { sessionId: sessionId.slice(0, 8), bytes: chunk.length });
          }
          appendAudio(sessionId, chunk);
          const session = getSession(sessionId);
          if (session?.callSessionId) addVoiceUsageAudioInput(session.callSessionId, chunk.length, session.sampleRate);
          if (session?.streamingSTT) {
            session.streamingSTT.pushPcm(chunk, session.sampleRate);
          } else {
            tryRunPipeline(ws, sessionId);
          }
        }
        return;
      }
      case 'config': {
        if (VOICE_DEBUG) {
          console.info('[voice] config', { sessionId: sessionId.slice(0, 8), agentId: msg.payload.agentId, callSessionId: msg.payload.callSessionId });
        }
        const session = getSession(sessionId);
        if (session) {
          const rate = msg.payload.sampleRate;
          const isBrowser = msg.payload.clientType === 'BROWSER';
          if (rate && rate !== 16000) {
            updateSession(sessionId, { sampleRate: rate });
          } else if (isBrowser && (!rate || rate === 16000)) {
            updateSession(sessionId, { sampleRate: 48000 });
          }
          if (msg.payload.language) updateSession(sessionId, { language: msg.payload.language });
          if (msg.payload.agentId) updateSession(sessionId, { agentId: msg.payload.agentId });
          if (msg.payload.clientType) updateSession(sessionId, { clientType: msg.payload.clientType });
          if (msg.payload.callSessionId) updateSession(sessionId, { callSessionId: msg.payload.callSessionId as string });
        }
        void ensureCallSession(ws, sessionId, msg.payload.clientType, msg.payload.callSessionId as string | undefined);
        const agentIdFromPayload = msg.payload.agentId != null && String(msg.payload.agentId).trim() !== '' ? (msg.payload.agentId as string) : null;
        const sessionAlreadyHasAgent = session?.agentId != null && String(session.agentId).trim() !== '';
        if (agentIdFromPayload) {
          void loadAgentSettings(sessionId, agentIdFromPayload).then(() => {
            if (VOICE_DEBUG) console.info('[voice] agent settings loaded', sessionId.slice(0, 8));
            maybeStartStreamingStt(ws, sessionId);
            ensureMaxDurationTimer(ws, sessionId);
          });
        } else if (sessionAlreadyHasAgent) {
          if (VOICE_DEBUG) console.info('[voice] config without agentId (e.g. mic started); session already has agent', sessionId.slice(0, 8));
          maybeStartStreamingStt(ws, sessionId);
          ensureMaxDurationTimer(ws, sessionId);
        } else {
          if (VOICE_DEBUG) console.info('[voice] no agentId in config, starting STT without agent settings', sessionId.slice(0, 8));
          maybeStartStreamingStt(ws, sessionId);
          ensureMaxDurationTimer(ws, sessionId);
        }
        return;
      }
      case 'interrupt':
        handleInterrupt(ws, sessionId);
        return;
      case 'ping':
        send(ws, { type: 'pong', payload: {} });
        return;
      default:
        return;
    }
  }

  // Not JSON: treat as raw binary PCM (e.g. telephony or client that sends raw bytes)
  if (Buffer.isBuffer(raw)) {
    appendAudio(sessionId, raw);
    const session = getSession(sessionId);
    if (session?.callSessionId) addVoiceUsageAudioInput(session.callSessionId, raw.length, session.sampleRate);
    if (session?.streamingSTT) {
      session.streamingSTT.pushPcm(raw, session.sampleRate);
    } else {
      tryRunPipeline(ws, sessionId);
    }
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
  const sttProvider = s.sttProvider ?? 'deepgram';
  if (!isStreamingSTTAvailable(sttProvider)) return;
  if (s.streamingSTT) return;
  const streamProvider: 'deepgram' | 'assemblyai' = sttProvider === 'assemblyai' ? 'assemblyai' : 'deepgram';

  const opts = {
    provider: streamProvider,
    language: s.language ?? 'en',
    model: s.sttModel ?? undefined,
    onPartialTranscript(text: string) {
      const session = getSession(sessionId);
      if (!session) return;
      updateSession(sessionId, { partialTranscript: text });
      if (session.callSessionId) {
        const trace = getCallTrace(session.callSessionId);
        if (trace && trace.sttLatencyMs === undefined) {
          const sttLatencyMs = Date.now() - trace.startedAt;
          updateCallTrace(session.callSessionId, {
            sttLatencyMs,
            providerUsed: { stt: streamProvider },
          });
          updateCallMetrics(session.callSessionId, {
            sttLatencyMs,
            providerUsed: { stt: streamProvider },
          });
        }
        void persistAndPublish(session.callSessionId, 'speech.detected', { text });
        void persistAndPublish(session.callSessionId, 'transcript.partial', { text });
      }
      send(ws, { type: 'user_transcript_partial', payload: { text } });
      send(ws, { type: 'transcript_partial', payload: { text } });
      void logEvent(sessionId, 'TRANSCRIPT_PARTIAL', { text });
      if (
        session.phase === 'processing' &&
        session.interruptionBehavior === 'BARGE_IN_STOP_AGENT' &&
        (session.isAgentSpeaking || session.replyAbort)
      ) {
        session.ttsCancel?.();
        session.replyAbort?.abort();
        clearPrefill(sessionId);
        updateSession(sessionId, { isAgentSpeaking: false, ttsCancel: undefined, replyAbort: undefined });
        if (session.callSessionId) {
          const m = getCallMetrics(session.callSessionId);
          updateCallMetrics(session.callSessionId, { interruptions: (m?.interruptions ?? 0) + 1 });
          broadcastVoiceMonitorEvent({ type: 'agent_interrupted', callId: session.callSessionId, ts: Date.now() });
        }
        send(ws, { type: 'agent_speech_interrupted', payload: {} });
        send(ws, { type: 'agent_stopped', payload: {} });
        void logEvent(sessionId, 'AGENT_STOPPED', { reason: 'barge_in' });
      } else if (
        session.phase === 'listening' &&
        !session.prefillPromise &&
        looksLikeEndOfSentence(text)
      ) {
        void startPrefill(ws, sessionId, text);
      }
    },
    // speakingGuard: when agent is speaking and barge-in is enabled, abort then process this final (don't buffer).
    onFinalTranscript(text: string) {
      const session = getSession(sessionId);
      if (!session) return;
      const isBusy = session.phase === 'processing' || session.isAgentSpeaking;
      const bargeInEnabled = session.interruptionBehavior === 'BARGE_IN_STOP_AGENT';

      if (isBusy && bargeInEnabled) {
        // Barge-in: stop current reply, then process this final immediately so the agent stops and we respond once.
        console.info('[voice] barge-in on final transcript', { textLength: text.length });
        clearPrefill(sessionId);
        session.ttsCancel?.();
        session.replyAbort?.abort();
        updateSession(sessionId, {
          phase: 'idle',
          pipelineBusy: false,
          isAgentSpeaking: false,
          replyAbort: undefined,
          ttsCancel: undefined,
          pendingUserTranscript: undefined,
        });
        if (session.callSessionId) {
          const m = getCallMetrics(session.callSessionId);
          updateCallMetrics(session.callSessionId, { interruptions: (m?.interruptions ?? 0) + 1 });
          broadcastVoiceMonitorEvent({ type: 'agent_interrupted', callId: session.callSessionId, ts: Date.now() });
          void persistAndPublish(session.callSessionId, 'speech.detected', { reason: 'barge_in' });
        }
        send(ws, { type: 'agent_speech_interrupted', payload: {} });
        send(ws, { type: 'agent_stopped', payload: {} });
        void logEvent(sessionId, 'AGENT_STOPPED', { reason: 'barge_in_final' });
        // Process this final as the new user turn after abort has taken effect.
        setImmediate(() => {
          send(ws, { type: 'user_transcript_final', payload: { text } });
          send(ws, { type: 'transcript_final', payload: { text } });
          const s = getSession(sessionId);
          if (s?.callSessionId) {
            void persistAndPublish(s.callSessionId, 'transcription.completed', { text });
            void persistAndPublish(s.callSessionId, 'transcript.final', { text });
          }
          onFinalTranscript(ws, sessionId, text);
        });
        return;
      }

      if (isBusy) {
        const existing = (session.pendingUserTranscript ?? '').trim();
        const combined = existing ? `${existing} ${text.trim()}` : text.trim();
        updateSession(sessionId, { pendingUserTranscript: combined || undefined });
        console.info('[voice] buffering STT while pipeline processing', { textLength: text.length });
        return;
      }

      if (VOICE_DEBUG) console.info('[voice] streaming STT final', { sessionId: sessionId.slice(0, 8), text: text.slice(0, 60) });
      send(ws, { type: 'user_transcript_final', payload: { text } });
      send(ws, { type: 'transcript_final', payload: { text } });
      if (session.callSessionId) {
        void persistAndPublish(session.callSessionId, 'transcription.completed', { text });
        void persistAndPublish(session.callSessionId, 'transcript.final', { text });
      }
      onFinalTranscript(ws, sessionId, text);
    },
  };

  const result = startStreamingTranscription(opts);
  const applyController = (controller: { pushPcm: (pcm: Buffer, sampleRate: number) => void; close: () => void } | null) => {
    if (controller) updateSession(sessionId, { streamingSTT: controller, phase: 'listening' });
  };
  if (result instanceof Promise) {
    void result.then(applyController);
  } else {
    applyController(result);
  }
}

function handleInterrupt(ws: WebSocket, sessionId: string): void {
  const session = getSession(sessionId);
  if (session?.interruptionBehavior === 'IGNORE_WHILE_SPEAKING') return;
  if (session?.replyAbort || session?.isAgentSpeaking || session?.prefillPromise) {
    clearPrefill(sessionId);
    session.ttsCancel?.();
    session.replyAbort?.abort();
    updateSession(sessionId, { isAgentSpeaking: false, ttsCancel: undefined, replyAbort: undefined });
    if (session.callSessionId) {
      const m = getCallMetrics(session.callSessionId);
      updateCallMetrics(session.callSessionId, { interruptions: (m?.interruptions ?? 0) + 1 });
      broadcastVoiceMonitorEvent({ type: 'agent_interrupted', callId: session.callSessionId, ts: Date.now() });
      void persistAndPublish(session.callSessionId, 'speech.detected', { reason: 'interrupt' });
    }
    send(ws, { type: 'agent_speech_interrupted', payload: {} });
    send(ws, { type: 'agent_stopped', payload: {} });
    void logEvent(sessionId, 'AGENT_STOPPED', {});
  }
}

async function ensureCallSession(
  ws: WebSocket,
  sessionId: string,
  clientType?: 'BROWSER' | 'PHONE' | 'UNKNOWN',
  existingCallSessionId?: string
): Promise<void> {
  const s = getSession(sessionId);
  if (!s) return;
  if (existingCallSessionId) {
    if (!s.callSessionId) {
      const agentId = s.agentId ?? '';
      let workspaceId: string | undefined;
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
        workspaceId = agent?.workspaceId ?? undefined;
      }
      if (workspaceId) {
        const quota = await checkVoiceQuota(workspaceId);
        if (!quota.allowed) {
          send(ws, { type: 'error', payload: { message: 'quota_exceeded' } });
          return;
        }
      }
      let callerPhoneNumber: string | undefined;
      let region: string | undefined;
      try {
        const cs = await prisma.callSession.findUnique({
          where: { id: existingCallSessionId },
          select: { metadata: true },
        });
        const meta = cs?.metadata as { callerPhoneNumber?: string; region?: string } | null;
        if (meta?.callerPhoneNumber) callerPhoneNumber = meta.callerPhoneNumber;
        if (meta?.region) region = meta.region;
      } catch {
        // ignore
      }
      updateSession(sessionId, { callSessionId: existingCallSessionId, workspaceId, callerPhoneNumber });
      startGuidanceInterval(sessionId);
      startCallTrace(existingCallSessionId);
      startCallMetrics(existingCallSessionId, agentId, workspaceId, region);
      startVoiceUsage(existingCallSessionId, workspaceId ?? '', agentId, {
        sttProvider: s.sttProvider ?? undefined,
        llmProvider: s.llmProvider ?? undefined,
        ttsProvider: s.ttsProvider ?? undefined,
      });
      broadcastVoiceMonitorEvent({
        type: 'call_started',
        callId: existingCallSessionId,
        agentId,
        workspaceId,
        ts: Date.now(),
      });
      await persistAndPublish(existingCallSessionId, 'call.connected', { wsSessionId: sessionId });
      metrics.activeCalls.inc({ type: s.clientType ?? clientType ?? 'UNKNOWN' });
    }
    return;
  }
  if (s.callSessionId) return;
  const agentIdForQuota = s.agentId ?? null;
  let workspaceId: string | undefined;
  if (agentIdForQuota) {
    const agent = await prisma.agent.findUnique({ where: { id: agentIdForQuota }, select: { workspaceId: true } });
    workspaceId = agent?.workspaceId ?? undefined;
  }
  if (workspaceId) {
    const quota = await checkVoiceQuota(workspaceId);
    if (!quota.allowed) {
      send(ws, { type: 'error', payload: { message: 'quota_exceeded' } });
      return;
    }
  }
  const row = await prisma.callSession.create({
    data: {
      agentId: s.agentId ?? null,
      clientType: clientType ?? 'UNKNOWN',
      status: 'ACTIVE',
      metadata: { sessionId },
    },
  });
  updateSession(sessionId, { callSessionId: row.id });
  startGuidanceInterval(sessionId);
  startCallTrace(row.id);
  const agentId = row.agentId ?? s.agentId ?? '';
  if (!workspaceId && agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
    workspaceId = agent?.workspaceId ?? undefined;
  }
  startCallMetrics(row.id, agentId, workspaceId);
  startVoiceUsage(row.id, workspaceId ?? '', agentId, {
    sttProvider: s.sttProvider ?? undefined,
    llmProvider: s.llmProvider ?? undefined,
    ttsProvider: s.ttsProvider ?? undefined,
  });
  if (workspaceId) updateSession(sessionId, { workspaceId });
  broadcastVoiceMonitorEvent({
    type: 'call_started',
    callId: row.id,
    agentId,
    workspaceId,
    ts: Date.now(),
  });
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

  const { selectPromptVersion } = await import('../voice/prompt-version.js');
  const promptVersion = await selectPromptVersion(agentId);
  const systemPrompt = promptVersion?.systemPrompt ?? settings.systemPrompt;
  const promptVersionId = promptVersion?.id ?? null;

  updateSession(wsSessionId, {
    agentId,
    systemPrompt,
    promptVersionId,
    voiceName: settings.voiceName,
    sttProvider: settings.sttProvider ?? undefined,
    sttModel: settings.sttModel ?? undefined,
    llmProvider: settings.llmProvider ?? undefined,
    llmModel: settings.llmModel ?? undefined,
    temperature: settings.temperature ?? undefined,
    ttsProvider: settings.ttsProvider ?? undefined,
    ttsVoice: settings.ttsVoice ?? undefined,
    knowledgeBaseId: settings.knowledgeBaseId ?? undefined,
    language: settings.language,
    maxCallDurationSeconds: settings.maxCallDurationSeconds,
    interruptionBehavior: settings.interruptionBehavior,
  });

  if (VOICE_DEBUG) {
    const after = getSession(wsSessionId);
    if (after) {
      console.info('[voice] agent config full', {
        id: after.agentId ?? agentId,
        sttProvider: after.sttProvider ?? null,
        sttModel: after.sttModel ?? null,
        llmProvider: after.llmProvider ?? null,
        llmModel: after.llmModel ?? null,
        temperature: after.temperature ?? null,
        ttsProvider: after.ttsProvider ?? null,
        ttsVoice: after.ttsVoice ?? after.voiceName ?? null,
        language: after.language ?? null,
      });
    }
  }

  if (s.callSessionId && promptVersionId) {
    await prisma.callSession.update({
      where: { id: s.callSessionId },
      data: { promptVersionId },
    });
    await prisma.call.updateMany({
      where: { callSessionId: s.callSessionId },
      data: { promptVersionId },
    });
  }
}

function tryRunPipeline(ws: WebSocket, sessionId: string): void {
  const session = getSession(sessionId);
  if (!session || session.pipelineBusy) return;
  const buffer = takeBufferIfReady(sessionId);
  if (!buffer) return;

  const sendMsg: (m: ServerMessage) => void = (m) => {
    if (m.type === 'agent_audio_start') {
      updateSession(sessionId, { isAgentSpeaking: true });
      const sess = getSession(sessionId);
      if (sess?.callSessionId) broadcastVoiceMonitorEvent({ type: 'agent_speaking', callId: sess.callSessionId, ts: Date.now() });
    }
    if (m.type === 'agent_audio_end') updateSession(sessionId, { isAgentSpeaking: false, ttsCancel: undefined });
    send(ws, m);
  };
  void (async () => {
    const { acquireCallSlot, releaseCallSlot } = await import('../voice/call-orchestrator.js');
    const { runWithPool } = await import('../voice/agent-worker-pool.js');
    await acquireCallSlot();
    updateSession(sessionId, { pipelineBusy: true });
    if (VOICE_DEBUG) console.info('[voice] pipeline running (batch STT)', { sessionId: sessionId.slice(0, 8), bufferBytes: buffer.length });
    try {
      await runWithPool(() =>
        runPipeline(sessionId, buffer, sendMsg, {
          setTtsCancel: (cancel) => updateSession(sessionId, { ttsCancel: cancel }),
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[voice] pipeline error', { sessionId: sessionId.slice(0, 8), message });
      send(ws, { type: 'error', payload: { message } });
    } finally {
      releaseCallSlot();
      updateSession(sessionId, { pipelineBusy: false });
    }
  })();
}

const FINAL_DEDUPE_MS = 2000;

function onFinalTranscript(
  ws: WebSocket,
  sessionId: string,
  transcript: string
): void {
  const session = getSession(sessionId);
  if (!session || !transcript.trim()) return;
  if (session.phase === 'processing') return;
  if (session.isAgentSpeaking) {
    console.info('[voice] ignoring STT while agent speaking');
    return;
  }

  const trimmed = transcript.trim();
  if (
    session.lastProcessedTranscript === trimmed &&
    session.lastProcessedAt != null &&
    Date.now() - session.lastProcessedAt < FINAL_DEDUPE_MS
  ) {
    console.info('[voice] skipping duplicate final transcript', { text: trimmed.slice(0, 40) });
    return;
  }
  updateSession(sessionId, { lastProcessedTranscript: trimmed, lastProcessedAt: Date.now(), partialTranscript: '' });

  if (session.callSessionId) {
    void recordUserMessage(session.callSessionId, transcript);
    const trace = getCallTrace(session.callSessionId);
    if (trace && trace.sttLatencyMs === undefined) {
      const sttLatencyMs = Date.now() - trace.startedAt;
      updateCallTrace(session.callSessionId, {
        sttLatencyMs,
        providerUsed: { stt: (session.sttProvider ?? 'deepgram').toString() },
      });
      updateCallMetrics(session.callSessionId, { sttLatencyMs, providerUsed: { stt: session.sttProvider ?? 'deepgram' } });
    }
    const providerUsed = {
      stt: session.sttProvider ?? undefined,
      llm: session.llmProvider ?? undefined,
      tts: session.ttsProvider ?? undefined,
    };
    updateCallTrace(session.callSessionId, { providerUsed });
    updateCallMetrics(session.callSessionId, { providerUsed });
    updateVoiceUsage(session.callSessionId, {
      sttProvider: session.sttProvider ?? undefined,
      llmProvider: session.llmProvider ?? undefined,
      ttsProvider: session.ttsProvider ?? undefined,
    });
  }

  updateSession(sessionId, { phase: 'processing', pipelineBusy: true, isAgentSpeaking: true });
  const signal = createAbortSignal();
  updateSession(sessionId, { replyAbort: signal });

  let assistantText = '';
  let agentReplyEmitted = false;

  const sendMsg: (m: ServerMessage) => void = (m) => {
    if (m.type === 'agent_audio_start') {
      updateSession(sessionId, { isAgentSpeaking: true });
      const sess = getSession(sessionId);
      if (sess?.callSessionId) broadcastVoiceMonitorEvent({ type: 'agent_speaking', callId: sess.callSessionId, ts: Date.now() });
    }
    if (m.type === 'agent_audio_end') updateSession(sessionId, { isAgentSpeaking: false, ttsCancel: undefined });
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
    if (m.type === 'agent_audio_chunk') {
      const b64 = m.payload.base64 ?? '';
      if (b64) {
        try {
          const outBytes = Buffer.from(b64, 'base64').length;
          addVoiceUsageAudioOutput(s.callSessionId, outBytes);
        } catch {
          // ignore
        }
      }
      void persistAndPublish(s.callSessionId, 'audio.played', { bytes: (m.payload.base64 ?? '').length });
    }
    if (m.type === 'agent_text_delta') assistantText += (m.payload.text ?? '');
    if (m.type === 'agent_audio_end') {
      void recordAssistantMessage(s.callSessionId, assistantText);
    }
  };

  function syncTraceToMetrics(callSessionId: string, partial: { llmFirstTokenMs?: number; llmTotalDurationMs?: number; ttsFirstAudioMs?: number; ttsTotalDurationMs?: number; providerUsed?: { stt?: string; llm?: string; tts?: string } }): void {
    if (!partial || !callSessionId) return;
    updateCallMetrics(callSessionId, {
      ...(partial.llmFirstTokenMs !== undefined && { llmFirstTokenMs: partial.llmFirstTokenMs }),
      ...(partial.llmTotalDurationMs !== undefined && { llmDurationMs: partial.llmTotalDurationMs }),
      ...(partial.ttsFirstAudioMs !== undefined && { ttsFirstAudioMs: partial.ttsFirstAudioMs }),
      ...(partial.ttsTotalDurationMs !== undefined && { ttsDurationMs: partial.ttsTotalDurationMs }),
      ...(partial.providerUsed && { providerUsed: partial.providerUsed }),
    });
  }

  void logEvent(sessionId, 'TRANSCRIPT_FINAL', { text: transcript });

  void (async () => {
    let callId: string | null = null;
    if (session.callSessionId) {
      const { getCallIdByCallSessionId, appendMessage } = await import('../services/conversation-memory.js');
      callId = await getCallIdByCallSessionId(session.callSessionId);
      if (callId) void appendMessage(callId, 'USER', transcript);
    }

    const s = getSession(sessionId);
    const usePrefill =
      s?.prefillPromise &&
      s.prefillPartial &&
      isCompatibleFinal(transcript, s.prefillPartial);

    if (usePrefill) {
      try {
        await s.prefillPromise;
      } catch {
        // Prefill aborted or failed; fall through to normal flow
      }
      const after = getSession(sessionId);
      if (after?.prefillBuffer?.length) {
        for (const m of after.prefillBuffer) sendMsg(m);
        clearPrefill(sessionId);
        return;
      }
    }

    clearPrefill(sessionId);
    return runStreamingReply(transcript, sendMsg, signal, {
      systemPrompt: session.systemPrompt,
      voiceName: session.voiceName,
      knowledgeBaseId: session.knowledgeBaseId ?? undefined,
      agentId: session.agentId ?? undefined,
      callId: callId ?? undefined,
      callSessionId: session.callSessionId ?? undefined,
      llmProvider: session.llmProvider ?? undefined,
      llmModel: session.llmModel ?? undefined,
      temperature: session.temperature ?? undefined,
      workspaceId: session.workspaceId ?? undefined,
      phoneNumber: session.callerPhoneNumber ?? undefined,
      ttsProvider: session.ttsProvider ?? undefined,
      ttsVoice: session.ttsVoice ?? session.voiceName ?? undefined,
      onCallTrace: (partial) => {
        if (session.callSessionId) {
          updateCallTrace(session.callSessionId, partial);
          syncTraceToMetrics(session.callSessionId, partial);
        }
      },
      onVoiceUsage: (u) => {
        if (session.callSessionId) {
          const inputEst = Math.ceil(((session.systemPrompt?.length ?? 0) + transcript.length) / 4);
          updateVoiceUsage(session.callSessionId, {
            llmInputTokens: u.llmInputTokens ?? inputEst,
            llmOutputTokens: u.llmOutputTokens ?? 0,
            ttsCharacters: u.ttsCharacters ?? 0,
          });
        }
      },
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
        isAgentSpeaking: false,
      });
      const s = getSession(sessionId);
      const pending = s?.pendingUserTranscript?.trim();
      if (pending) {
        updateSession(sessionId, { pendingUserTranscript: undefined });
        setImmediate(() => onFinalTranscript(ws, sessionId, pending));
      }
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
    audioLoggedSessions.delete(sessionId);
    const s = getSession(sessionId);
    s?.streamingSTT?.close();
    if (s?.maxDurationTimer) clearTimeout(s.maxDurationTimer);
    if (s?.guidanceIntervalId) {
      clearInterval(s.guidanceIntervalId);
      updateSession(sessionId, { guidanceIntervalId: null });
    }
    if (s?.callSessionId) {
      finishVoiceUsage(s.callSessionId);
      const finished = finishCallMetrics(s.callSessionId);
      if (finished) {
        broadcastVoiceMonitorEvent({
          type: 'call_ended',
          callId: s.callSessionId,
          agentId: finished.agentId,
          durationMs: finished.durationMs,
          ts: Date.now(),
        });
      }
      finishCallTrace(s.callSessionId);
      const endedAt = new Date();
      const startedAt = new Date(s.createdAt);
      const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
      void prisma.callSession.update({
        where: { id: s.callSessionId },
        data: { status: 'ENDED', endedAt, durationSeconds },
      });
      void persistAndPublish(s.callSessionId, 'call.ended', {});
      void finalizeCallSession(s.callSessionId, startedAt, endedAt);
      void (async () => {
        const { generateAndSaveConversationMemory } = await import('../memory/summary-after-call.js');
        await generateAndSaveConversationMemory(s.callSessionId!);
        const { getCallIdByCallSessionId } = await import('../services/conversation-memory.js');
        const { detectCallOutcome } = await import('../voice/outcome-detection.js');
        const { evaluateCallQuality } = await import('../voice/call-evaluation.js');
        const callId = await getCallIdByCallSessionId(s.callSessionId!);
        if (callId) {
          await detectCallOutcome(callId);
          await evaluateCallQuality(callId);
        }
      })();
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
    if (s?.guidanceIntervalId) {
      clearInterval(s.guidanceIntervalId);
      updateSession(sessionId, { guidanceIntervalId: null });
    }
    deleteSession(sessionId);
  });
}
