import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCall, fetchCallEvents, fetchCallMessages } from '../../api/calls';
import type { Call, CallEvent, Paginated } from '../types';
import type { ConversationMessage } from '../../api/calls';

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const callId = id ?? '';
  const [call, setCall] = useState<Call | null>(null);
  const [eventsData, setEventsData] = useState<Paginated<CallEvent> | null>(null);
  const [messagesData, setMessagesData] = useState<Paginated<ConversationMessage> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!callId) return;
    setError(null);
    try {
      const [c, e, m] = await Promise.all([
        fetchCall(callId),
        fetchCallEvents(callId, { limit: 500, offset: 0 }),
        fetchCallMessages(callId, { limit: 500, offset: 0 }),
      ]);
      setCall(c);
      setEventsData(e);
      setMessagesData(m);
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
        <p className="text-slate-400">Missing call ID.</p>
        <Link to="/admin/calls" className="text-sm text-slate-400 hover:text-slate-200">
          ← Call History
        </Link>
      </div>
    );
  }

  const events = eventsData?.items ?? [];
  const messages = messagesData?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/calls" className="text-sm text-slate-400 hover:text-slate-200">
            ← Call History
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-white">Call details</h1>
          <div className="font-mono text-xs text-slate-500">{callId}</div>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {call && (
        <>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <div className="font-semibold text-slate-200">{call.status}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Agent type</div>
                <div className="text-slate-200">{call.agentType}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Agent ID</div>
                <div className="font-mono text-slate-400">{call.agentId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Started</div>
                <div className="text-slate-200">{new Date(call.startedAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Ended</div>
                <div className="text-slate-200">
                  {call.endedAt ? new Date(call.endedAt).toLocaleString() : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Duration</div>
                <div className="text-slate-200">
                  {call.durationSeconds != null ? `${call.durationSeconds}s` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Tokens used</div>
                <div className="text-slate-200">
                  {call.tokensUsed != null ? call.tokensUsed.toLocaleString() : '—'}
                </div>
              </div>
            </div>
            {call.transcript && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <div className="text-xs text-slate-500">Transcript</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300 whitespace-pre-wrap">
                  {call.transcript}
                </pre>
              </div>
            )}
            {call.recordingUrl && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <div className="text-xs text-slate-500 mb-2">Recording</div>
                <audio controls src={call.recordingUrl} className="w-full max-w-md rounded-lg" />
                {call.recordingDuration != null && (
                  <p className="mt-1 text-xs text-slate-500">Duration: {call.recordingDuration}s</p>
                )}
              </div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-200">Conversation history</div>
                <div className="text-xs text-slate-500">{messages.length} messages</div>
              </div>
              <div className="space-y-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-3 ${
                      m.role === 'USER'
                        ? 'border-slate-700 bg-slate-800/50'
                        : m.role === 'ASSISTANT'
                          ? 'border-emerald-900/40 bg-emerald-900/10'
                          : m.role === 'SYSTEM'
                            ? 'border-slate-700 bg-slate-950'
                            : 'border-amber-900/40 bg-amber-900/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-400">{m.role}</span>
                      <span className="text-xs text-slate-500">
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-200">
                      {m.content}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">Lifecycle events</div>
              <div className="text-xs text-slate-500">{events.length} events</div>
            </div>

            {events.length === 0 ? (
              <div className="text-sm text-slate-400">No events for this call.</div>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-slate-500" />
                      <div className="w-px flex-1 bg-slate-900" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-200">{e.type}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(e.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      {e.payload != null && Object.keys(e.payload as object).length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-300">
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
