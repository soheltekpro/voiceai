import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { CallEvent, CallMessage, CallSession, Paginated } from '../types';

type LiveEventEnvelope =
  | { type: 'subscribed'; callSessionId: string }
  | { type: 'event'; evt: { id: string; callSessionId: string; name: string; ts: number; payload?: unknown } }
  | { type: 'error'; message: string };

export function CallSessionDetailPage() {
  const { id } = useParams();
  const sessionId = id as string;
  const [session, setSession] = useState<CallSession | null>(null);
  const [events, setEvents] = useState<Paginated<CallEvent> | null>(null);
  const [messages, setMessages] = useState<Paginated<CallMessage> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<Array<{ id: string; name: string; ts: number; payload?: unknown }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [tab, setTab] = useState<'timeline' | 'transcript'>('timeline');

  const load = async () => {
    setError(null);
    try {
      const s = await apiGet<CallSession>(`/api/v1/call-sessions/${sessionId}`);
      const e = await apiGet<Paginated<CallEvent>>(`/api/v1/call-sessions/${sessionId}/events?limit=200&offset=0`);
      const m = await apiGet<Paginated<CallMessage>>(`/api/v1/call-sessions/${sessionId}/messages?limit=200&offset=0`);
      setSession(s);
      setEvents(e);
      setMessages(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    // Connect to backend /events websocket for live streaming
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/events`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setLiveConnected(false);

    ws.onopen = () => {
      setLiveConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', callSessionId: sessionId }));
    };
    ws.onclose = () => setLiveConnected(false);
    ws.onerror = () => setLiveConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as LiveEventEnvelope;
        if (msg.type === 'event' && msg.evt?.callSessionId === sessionId) {
          setLiveEvents((prev) => [
            ...prev,
            { id: msg.evt.id, name: msg.evt.name, ts: msg.evt.ts, payload: msg.evt.payload },
          ]);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const timeline = useMemo(() => {
    const historical =
      events?.items?.map((e) => ({
        id: e.id,
        name: (e.payload as any)?.name ?? e.type,
        ts: new Date(e.timestamp).getTime(),
        payload: e.payload,
        source: 'db' as const,
      })) ?? [];
    const live = liveEvents.map((e) => ({ ...e, source: 'live' as const }));
    const merged = [...historical, ...live];
    merged.sort((a, b) => a.ts - b.ts);
    // de-dupe by id (live ids are separate), but keep stable
    return merged;
  }, [events?.items, liveEvents]);

  // Derive transcript from events when call_messages is empty (e.g. V2V calls only send events)
  // Pipeline: agent.reply (with text). V2V: agent.speaking, agent.finished (no text; use placeholder)
  const transcriptFromEvents = useMemo(() => {
    const out: { id: string; role: 'USER' | 'ASSISTANT'; text: string; ts: number }[] = [];
    const seen = new Set<string>();
    for (const e of timeline) {
      const name = (e.payload as Record<string, unknown>)?.name ?? e.name ?? '';
      const text = (e.payload as Record<string, unknown>)?.text as string | undefined;
      const content = (e.payload as Record<string, unknown>)?.content as string | undefined;
      const isUser =
        name === 'transcript.final' ||
        name === 'transcription.completed' ||
        name === 'speech.detected' ||
        String(e.name).includes('TRANSCRIPT');
      const isAssistant =
        name === 'agent.reply' ||
        name === 'assistant.reply' ||
        name === 'agent.speaking' ||
        name === 'agent.finished' ||
        String(e.name).includes('AGENT_REPLY');
      // V2V agent.speaking/agent.finished often have no payload text; use placeholder so we still show a line
      const rawStr = (text ?? content ?? '').trim();
      const str =
        rawStr ||
        (isAssistant && (name === 'agent.speaking' || name === 'agent.finished') ? '—' : '');
      if (!str) continue;
      const key = `${e.ts}-${e.id}-${str.slice(0, 20)}`;
      if (seen.has(key)) continue;
      if (isUser) {
        seen.add(key);
        out.push({ id: e.id, role: 'USER', text: str, ts: e.ts });
      } else if (isAssistant) {
        seen.add(key);
        out.push({ id: e.id, role: 'ASSISTANT', text: str, ts: e.ts });
      }
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [timeline]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/call-sessions" className="text-sm text-slate-400 hover:text-slate-200">
            ← Call sessions
          </Link>
          <h1 className="text-xl font-semibold mt-2">Call events</h1>
          <div className="text-xs text-slate-500 font-mono">{sessionId}</div>
          <div className="mt-2 text-xs">
            <span
              className={`inline-flex items-center px-2 py-1 rounded border ${
                liveConnected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              {liveConnected ? 'Live connected' : 'Live disconnected'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm">
          {error}
        </div>
      )}

      {session && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div className="text-slate-200 font-semibold">{session.status}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Client</div>
              <div className="text-slate-200 font-semibold">{session.clientType}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Started</div>
              <div className="text-slate-200">{new Date(session.startedAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Ended</div>
              <div className="text-slate-200">
                {session.endedAt ? new Date(session.endedAt).toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Duration</div>
              <div className="text-slate-200">{session.durationSeconds != null ? `${session.durationSeconds}s` : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Estimated cost</div>
              <div className="text-slate-200">
                {session.estimatedCostUsd != null ? `$${Number(session.estimatedCostUsd).toFixed(4)}` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('timeline')}
          className={`px-3 py-2 rounded-md text-sm font-medium border ${
            tab === 'timeline'
              ? 'border-slate-600 bg-slate-800 text-slate-50'
              : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900'
          }`}
        >
          Timeline
        </button>
        <button
          type="button"
          onClick={() => setTab('transcript')}
          className={`px-3 py-2 rounded-md text-sm font-medium border ${
            tab === 'transcript'
              ? 'border-slate-600 bg-slate-800 text-slate-50'
              : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900'
          }`}
        >
          Transcript
        </button>
      </div>

      {tab === 'timeline' && (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Live timeline</div>
          <div className="text-xs text-slate-500">{timeline.length} events</div>
        </div>

        {timeline.length === 0 ? (
          <div className="text-sm text-slate-400">No events yet.</div>
        ) : (
          <ol className="space-y-3">
            {timeline.map((e) => (
              <li key={`${e.source}:${e.id}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-slate-500 mt-2" />
                  <div className="w-px flex-1 bg-slate-900" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-200">{e.name}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(e.ts).toLocaleTimeString()} · {e.source === 'live' ? 'live' : 'db'}
                    </div>
                  </div>
                  {e.payload !== undefined && (
                    <pre className="mt-2 text-xs bg-slate-900/60 border border-slate-800 rounded p-2 overflow-auto max-h-40 text-slate-300">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      )}

      {tab === 'transcript' && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold">Call transcript</div>
            <div className="text-xs text-slate-500">
              {(messages?.items?.length ?? 0) > 0
                ? `${messages!.items.length} messages`
                : transcriptFromEvents.length > 0
                  ? `${transcriptFromEvents.length} from events`
                  : '0 messages'}
            </div>
          </div>

          {(messages?.items?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {messages?.items?.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3 ${
                    m.role === 'USER'
                      ? 'border-slate-800 bg-slate-900/40'
                      : 'border-emerald-900/40 bg-emerald-900/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-300">{m.role}</div>
                    <div className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-200 whitespace-pre-wrap">{m.text}</div>
                  {(m.costUsd != null || m.tokensEstimated != null) && (
                    <div className="mt-2 text-xs text-slate-500">
                      {m.tokensEstimated != null ? `tokens≈${m.tokensEstimated}` : ''}
                      {m.costUsd != null ? `  cost≈$${Number(m.costUsd).toFixed(4)}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : transcriptFromEvents.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-2">From call events (e.g. V2V)</p>
              {transcriptFromEvents.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3 ${
                    m.role === 'USER'
                      ? 'border-slate-800 bg-slate-900/40'
                      : 'border-emerald-900/40 bg-emerald-900/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-300">{m.role}</div>
                    <div className="text-xs text-slate-500">{new Date(m.ts).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-200 whitespace-pre-wrap">{m.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              No transcript yet. Pipeline calls use messages; V2V calls show transcript when the agent sends{' '}
              <code className="text-slate-500">transcript.final</code> (user) and{' '}
              <code className="text-slate-500">agent.speaking</code> / <code className="text-slate-500">agent.finished</code> or{' '}
              <code className="text-slate-500">agent.reply</code> (assistant).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

