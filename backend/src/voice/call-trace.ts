/**
 * Call-level tracing for voice pipeline observability.
 * Tracks latency (STT, LLM first token, TTS first audio) and provider usage.
 */

const TRACE_RETENTION_MS = 10 * 60 * 1000; // 10 minutes

export interface CallTrace {
  callId: string;
  startedAt: number;
  endedAt?: number;

  sttLatencyMs?: number;
  llmFirstTokenMs?: number;
  llmTotalDurationMs?: number;
  ttsFirstAudioMs?: number;
  ttsTotalDurationMs?: number;

  totalTurnLatencyMs?: number;

  providerUsed?: {
    stt?: string;
    llm?: string;
    tts?: string;
  };
}

const activeCallTraces = new Map<string, CallTrace>();
const finishedCallTraces = new Map<string, CallTrace>();

export function startCallTrace(callId: string): CallTrace {
  const trace: CallTrace = {
    callId,
    startedAt: Date.now(),
  };
  activeCallTraces.set(callId, trace);
  return trace;
}

export function getCallTrace(callId: string): CallTrace | undefined {
  return activeCallTraces.get(callId) ?? finishedCallTraces.get(callId);
}

export function updateCallTrace(callId: string, partial: Partial<Omit<CallTrace, 'callId' | 'startedAt'>>): void {
  const trace = activeCallTraces.get(callId);
  if (!trace) return;
  if (partial.endedAt !== undefined) trace.endedAt = partial.endedAt;
  if (partial.sttLatencyMs !== undefined) trace.sttLatencyMs = partial.sttLatencyMs;
  if (partial.llmFirstTokenMs !== undefined) trace.llmFirstTokenMs = partial.llmFirstTokenMs;
  if (partial.llmTotalDurationMs !== undefined) trace.llmTotalDurationMs = partial.llmTotalDurationMs;
  if (partial.ttsFirstAudioMs !== undefined) trace.ttsFirstAudioMs = partial.ttsFirstAudioMs;
  if (partial.ttsTotalDurationMs !== undefined) trace.ttsTotalDurationMs = partial.ttsTotalDurationMs;
  if (partial.totalTurnLatencyMs !== undefined) trace.totalTurnLatencyMs = partial.totalTurnLatencyMs;
  if (partial.providerUsed !== undefined) {
    trace.providerUsed = { ...trace.providerUsed, ...partial.providerUsed };
  }
}

export function finishCallTrace(callId: string): CallTrace | undefined {
  const trace = activeCallTraces.get(callId);
  if (!trace) return undefined;
  trace.endedAt = Date.now();
  const stt = trace.sttLatencyMs ?? 0;
  const llm = trace.llmFirstTokenMs ?? 0;
  const tts = trace.ttsFirstAudioMs ?? 0;
  trace.totalTurnLatencyMs = trace.totalTurnLatencyMs ?? stt + llm + tts;
  activeCallTraces.delete(callId);
  finishedCallTraces.set(callId, { ...trace });

  const providers = trace.providerUsed
    ? `stt=${trace.providerUsed.stt ?? '?'},llm=${trace.providerUsed.llm ?? '?'},tts=${trace.providerUsed.tts ?? '?'}`
    : '?';
  console.info(
    '[VOICE TRACE]',
    `callId=${callId}`,
    `sttLatency=${trace.sttLatencyMs ?? '?'}ms`,
    `llmFirstToken=${trace.llmFirstTokenMs ?? '?'}ms`,
    `llmTotal=${trace.llmTotalDurationMs ?? '?'}ms`,
    `ttsFirstAudio=${trace.ttsFirstAudioMs ?? '?'}ms`,
    `ttsTotal=${trace.ttsTotalDurationMs ?? '?'}ms`,
    `totalLatency=${trace.totalTurnLatencyMs ?? '?'}ms`,
    `providers={${providers}}`
  );

  const cutoff = Date.now() - TRACE_RETENTION_MS;
  for (const [id, t] of finishedCallTraces) {
    if ((t.endedAt ?? t.startedAt) < cutoff) finishedCallTraces.delete(id);
  }
  return trace;
}
