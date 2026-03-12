import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCall, fetchCallEvents, fetchCallMessages, fetchCallOutcome, fetchCallGuidance, fetchCallEvaluation, type CallOutcome } from '../../api/calls';
import { apiGet } from '../../api/client';
import type { Call, CallEvent, CallSession, Paginated, V2VCostBreakdown } from '../types';
import type { ConversationMessage } from '../../api/calls';
import { Target, Lightbulb, Star, MessageCircle, Bot } from 'lucide-react';

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const callId = id ?? '';
  const [call, setCall] = useState<Call | null>(null);
  const [eventsData, setEventsData] = useState<Paginated<CallEvent> | null>(null);
  const [messagesData, setMessagesData] = useState<Paginated<ConversationMessage> | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null | false>(null);
  const [guidance, setGuidance] = useState<Array<{ id: string; suggestion: string; createdAt: string }>>([]);
  const [evaluation, setEvaluation] = useState<{ score: number; strengths: string; improvements: string } | null | false>(null);
  const [costBreakdown, setCostBreakdown] = useState<V2VCostBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!callId) return;
    setError(null);
    try {
      const [c, e, m] = await Promise.all([
        fetchCall(callId),
        fetchCallEvents(callId, { limit: 200, offset: 0 }),
        fetchCallMessages(callId, { limit: 200, offset: 0 }),
      ]);
      setCall(c);
      setEventsData(e);
      setMessagesData(m);
      try {
        const o = await fetchCallOutcome(callId);
        setOutcome(o);
      } catch {
        setOutcome(false);
      }
      try {
        const { items } = await fetchCallGuidance(callId);
        setGuidance(items ?? []);
      } catch {
        setGuidance([]);
      }
      try {
        const ev = await fetchCallEvaluation(callId);
        setEvaluation(ev);
      } catch {
        setEvaluation(false);
      }
      if (c.callSessionId) {
        try {
          const session = await apiGet<CallSession>(`/api/v1/call-sessions/${c.callSessionId}`);
          if (session.costBreakdown) setCostBreakdown(session.costBreakdown);
          else setCostBreakdown(null);
        } catch {
          setCostBreakdown(null);
        }
      } else {
        setCostBreakdown(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call');
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!callId) {
    return (
      <div className="space-y-6">
        <p className="text-slate-600">Missing call ID.</p>
        <Link to="/admin/calls" className="text-sm text-slate-600 hover:text-slate-800">
          ← Call History
        </Link>
      </div>
    );
  }

  const events = eventsData?.items ?? [];
  const messages = messagesData?.items ?? [];

  // Build chat-style transcript: from conversation messages (pipeline) or from lifecycle events (V2V)
  const transcriptLines = useMemo(() => {
    if (messages.length > 0) {
      return messages
        .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
        .map((m) => ({
          id: m.id,
          role: m.role as 'USER' | 'ASSISTANT',
          text: m.content,
          time: m.createdAt,
        }));
    }
    const out: { id: string; role: 'USER' | 'ASSISTANT'; text: string; time: string }[] = [];
    const seen = new Set<string>();
    for (const e of events) {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const name = (payload.name as string) ?? e.type ?? '';
      const text = (payload.text as string) ?? (payload.content as string) ?? '';
      const ts = e.timestamp;
      const isUser =
        e.type === 'TRANSCRIPT_FINAL' ||
        name === 'transcript.final' ||
        name === 'transcription.completed' ||
        name === 'speech.detected';
      const isAssistant =
        e.type === 'AGENT_REPLY' ||
        name === 'agent.reply' ||
        name === 'assistant.reply' ||
        name === 'agent.speaking' ||
        name === 'agent.finished';
      const str = String(text ?? '').trim();
      const displayText = str || (isAssistant ? '—' : '');
      if (!displayText && !isAssistant) continue;
      const key = `${ts}-${e.id}-${displayText.slice(0, 30)}`;
      if (seen.has(key)) continue;
      if (isUser && displayText) {
        seen.add(key);
        out.push({ id: e.id, role: 'USER', text: displayText, time: ts });
      } else if (isAssistant) {
        seen.add(key);
        out.push({ id: e.id, role: 'ASSISTANT', text: displayText, time: ts });
      }
    }
    out.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return out;
  }, [events, messages]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/calls" className="text-sm text-slate-600 hover:text-slate-800">
            ← Call History
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Call details</h1>
          <div className="font-mono text-xs text-slate-500">{callId}</div>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {call && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <div className="font-semibold text-slate-800">{call.status}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Agent type</div>
                <div className="text-slate-800">{call.agentType}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Agent ID</div>
                <div className="font-mono text-slate-600">{call.agentId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Started</div>
                <div className="text-slate-800">{new Date(call.startedAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Ended</div>
                <div className="text-slate-800">
                  {call.endedAt ? new Date(call.endedAt).toLocaleString() : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Duration</div>
                <div className="text-slate-800">
                  {call.durationSeconds != null
                    ? `${call.durationSeconds}s (${Math.floor(call.durationSeconds / 60)} min ${Math.floor(call.durationSeconds % 60)} sec)`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Tokens used</div>
                <div className="text-slate-800">
                  {call.tokensUsed != null ? call.tokensUsed.toLocaleString() : '—'}
                </div>
              </div>
            </div>
            {call.transcript && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500">Transcript</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                  {call.transcript}
                </pre>
              </div>
            )}
            {call.recordingUrl && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500 mb-2">Recording</div>
                <audio controls src={call.recordingUrl} className="w-full max-w-md rounded-lg" />
                {call.recordingDuration != null && (
                  <p className="mt-1 text-xs text-slate-500">Duration: {call.recordingDuration}s</p>
                )}
              </div>
            )}
            {outcome && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                  <Target className="h-3.5 w-3.5" /> Call outcome
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-200/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">Outcome:</span>
                    <span className="text-emerald-300">{outcome.outcome}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-600">Confidence:</span>
                    <span className="text-slate-800">{Math.round(outcome.confidence * 100)}%</span>
                  </div>
                  <p className="text-sm text-slate-700 pt-1 border-t border-slate-300">{outcome.summary}</p>
                </div>
              </div>
            )}
            {outcome === false && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500">Call outcome: not yet detected</div>
              </div>
            )}
            {evaluation && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                  <Star className="h-3.5 w-3.5" /> Call Quality
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-200/50 p-3 space-y-3">
                  <div className="font-semibold text-slate-800">
                    Call Quality Score: {Math.round(evaluation.score)}%
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Strengths:</div>
                    <p className="text-sm text-slate-700">{evaluation.strengths}</p>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Improvements:</div>
                    <p className="text-sm text-slate-700">{evaluation.improvements}</p>
                  </div>
                </div>
              </div>
            )}
            {costBreakdown && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">Cost breakdown (transparent)</h3>
                <p className="text-xs text-slate-500 mb-4">V2V cost includes audio in/out (transcription + response). RAG embedding is billed separately.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  {(costBreakdown.v2vProvider || costBreakdown.v2vModel) && (
                    <>
                      <div className="flex justify-between items-baseline border-b border-slate-300 pb-2 col-span-full sm:col-span-1">
                        <span className="text-slate-600">Provider & model</span>
                        <span className="text-slate-800">
                          {[costBreakdown.v2vProvider, costBreakdown.v2vModel].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline border-b border-slate-300 pb-2 col-span-full sm:col-span-1">
                        <span className="text-slate-600">Model price (per 1M tokens)</span>
                        <span className="text-slate-800">
                          ${costBreakdown.inputRatePer1MUsd} in, ${costBreakdown.outputRatePer1MUsd} out
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Audio in (tokens)</span>
                    <span className="text-slate-800 font-mono">{costBreakdown.audioInputTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Audio out (tokens)</span>
                    <span className="text-slate-800 font-mono">{costBreakdown.audioOutputTokens.toLocaleString()}</span>
                  </div>
                  <div className="col-span-full flex justify-between items-start border-b border-slate-300 pb-2 gap-4">
                    <span className="text-slate-600 shrink-0">RAG / text input</span>
                    <span className="text-slate-600 text-xs text-right">{costBreakdown.ragTextTokensNote}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Total tokens</span>
                    <span className="text-slate-800 font-mono">{costBreakdown.totalTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Input rate (per 1M tokens)</span>
                    <span className="text-slate-800">${costBreakdown.inputRatePer1MUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Output rate (per 1M tokens)</span>
                    <span className="text-slate-800">${costBreakdown.outputRatePer1MUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Price per token</span>
                    <span className="text-slate-800 text-right">
                      In ${costBreakdown.inputPricePerTokenUsd.toFixed(6)}/tok · Out ${costBreakdown.outputPricePerTokenUsd.toFixed(6)}/tok
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Input cost</span>
                    <span className="text-slate-800">${costBreakdown.inputCostUsd.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Output cost</span>
                    <span className="text-slate-800">${costBreakdown.outputCostUsd.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Actual cost (total)</span>
                    <span className="text-slate-800 font-semibold">${costBreakdown.totalCostUsd.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Duration</span>
                    <span className="text-slate-800">
                      {costBreakdown.durationMinutes != null
                        ? `${costBreakdown.durationMinutes.toFixed(2)} min`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Cost per minute (USD)</span>
                    <span className="text-slate-800 font-semibold">
                      {costBreakdown.costPerMinuteUsd != null
                        ? `$${costBreakdown.costPerMinuteUsd.toFixed(6)}/min`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Cost per minute (INR)</span>
                    <span className="text-slate-800 font-semibold">
                      {costBreakdown.costPerMinuteInr != null
                        ? `₹${costBreakdown.costPerMinuteInr.toFixed(2)}/min`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline border-b border-slate-300 pb-2">
                    <span className="text-slate-600">Total cost (INR)</span>
                    <span className="text-slate-800 font-semibold">
                      {costBreakdown.totalCostInr != null
                        ? `₹${costBreakdown.totalCostInr.toFixed(2)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="col-span-full flex justify-between items-baseline pt-1">
                    <span className="text-slate-500 text-xs">USD → INR rate used</span>
                    <span className="text-slate-500 text-xs">{costBreakdown.usdToInr}</span>
                  </div>
                </div>
              </div>
            )}
            {evaluation === false && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500">Call quality: evaluation not yet available</div>
              </div>
            )}
            {guidance.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                  <Lightbulb className="h-3.5 w-3.5" /> AI Suggestions
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-200/50 p-3 space-y-2">
                  <p className="text-sm text-slate-800">
                    <span className="text-slate-600">Suggestion:</span> {guidance[0].suggestion}
                  </p>
                  {guidance.length > 1 && (
                    <p className="text-xs text-slate-500">{guidance.length} suggestions recorded during the call.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Transcript: chat-style User said / Agent replied */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <MessageCircle className="h-4 w-4 text-slate-500" />
                Transcript
              </div>
              {transcriptLines.length > 0 && (
                <div className="text-xs text-slate-500">{transcriptLines.length} turns</div>
              )}
            </div>
            {transcriptLines.length === 0 ? (
              <p className="text-sm text-slate-500">
                No transcript for this call. Conversation may not have been captured (e.g. very short or V2V before first reply).
              </p>
            ) : (
              <div className="space-y-4">
                {transcriptLines.map((line) => (
                  <div
                    key={line.id}
                    className={`flex gap-3 ${line.role === 'USER' ? '' : 'flex-row-reverse'}`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        line.role === 'USER'
                          ? 'bg-slate-300 text-slate-700'
                          : 'bg-emerald-500 text-white'
                      }`}
                    >
                      {line.role === 'USER' ? (
                        <span className="text-xs font-medium">U</span>
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${
                        line.role === 'USER'
                          ? 'border-slate-200 bg-white text-slate-800'
                          : 'border-emerald-200 bg-emerald-50 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-600">
                          {line.role === 'USER' ? 'User said' : 'Agent replied'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(line.time).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm">{line.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">Lifecycle events</div>
              <div className="text-xs text-slate-500">{events.length} events</div>
            </div>

            {events.length === 0 ? (
              <div className="text-sm text-slate-600">No events for this call.</div>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-slate-500" />
                      <div className="w-px flex-1 bg-slate-100" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">{e.type}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(e.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      {e.payload != null && Object.keys(e.payload as object).length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-slate-100 p-2 text-xs text-slate-700">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
