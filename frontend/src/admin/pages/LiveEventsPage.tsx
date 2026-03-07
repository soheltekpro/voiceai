/**
 * Live Monitoring: real-time call events via WebSocket /api/v1/events/stream.
 * Displays active calls, streaming events timeline, transcript updates, tool execution logs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Radio, Mic, MessageSquare, Wrench, PhoneOff, Phone } from 'lucide-react';

export type StreamEvent = {
  id: string;
  callSessionId: string;
  name: string;
  ts: number;
  payload?: Record<string, unknown>;
};

const STREAM_EVENTS_MAX = 200;
const TRANSCRIPT_MAX = 50;
const TOOL_LOGS_MAX = 100;

function getEventsStreamWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/api/v1/events/stream';
  const base =
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) ||
    '';
  if (base) {
    const wsBase = base.replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${wsBase}/api/v1/events/stream`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/events/stream`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function LiveEventsPage() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByCleanupRef = useRef(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const handleJoinCall = useCallback((callSessionId: string) => {
    navigate(`/admin/operator-call?callSessionId=${encodeURIComponent(callSessionId)}`);
  }, [navigate]);

  useEffect(() => {
    closedByCleanupRef.current = false;
    setError(null);
    const url = getEventsStreamWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!closedByCleanupRef.current) setConnected(true);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type?: string; evt?: StreamEvent };
        if (msg.type === 'event' && msg.evt) {
          setEvents((prev) => {
            const next = [msg.evt!, ...prev].slice(0, STREAM_EVENTS_MAX);
            return next;
          });
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      if (!closedByCleanupRef.current) setConnected(false);
    };
    ws.onerror = () => {
      if (!closedByCleanupRef.current) {
        setConnected(false);
        setError('WebSocket error');
      }
    };

    return () => {
      closedByCleanupRef.current = true;
      wsRef.current = null;
      ws.close();
    };
  }, []);

  // Derive active calls: callSessionIds that have call.started but no call.ended
  const activeCalls = useMemo(() => {
    const started = new Set<string>();
    const ended = new Set<string>();
    for (const e of events) {
      if (e.name === 'call.started') started.add(e.callSessionId);
      if (e.name === 'call.ended') ended.add(e.callSessionId);
    }
    return [...started].filter((id) => !ended.has(id));
  }, [events]);

  // Transcript updates (partial + final + agent.speaking / agent.finished)
  const transcriptUpdates = useMemo(() => {
    return events.filter(
      (e) =>
        e.name === 'transcript.partial' ||
        e.name === 'transcript.final' ||
        e.name === 'speech.detected' ||
        e.name === 'transcription.completed' ||
        e.name === 'agent.speaking' ||
        e.name === 'agent.finished'
    ).slice(0, TRANSCRIPT_MAX);
  }, [events]);

  // Tool execution logs
  const toolLogs = useMemo(() => {
    return events.filter((e) => e.name === 'tool.called' || e.name === 'tool.result').slice(0, TOOL_LOGS_MAX);
  }, [events]);

  const scrollToBottom = useCallback(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Live Monitoring</h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time call events from <code className="text-slate-300">/api/v1/events/stream</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={scrollToBottom}
            className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-200"
          >
            Scroll to latest
          </button>
          <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
              connected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-slate-600 bg-slate-800/60 text-slate-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {connected ? 'Stream connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm flex items-center gap-2">
          <Radio className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Active calls */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <PhoneOff className="h-5 w-5 text-slate-400" />
          Active calls
        </h2>
        <div className="rounded-lg bg-slate-950 border border-slate-800 p-4 min-h-[80px]">
          {activeCalls.length === 0 ? (
            <p className="text-sm text-slate-500">No active calls. Start a call to see it here.</p>
          ) : (
            <ul className="space-y-2">
              {activeCalls.map((callSessionId) => (
                <li key={callSessionId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-mono text-slate-300 truncate">{callSessionId}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleJoinCall(callSessionId)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Join call
                    </button>
                    <Link
                      to={`/admin/call-sessions/${callSessionId}`}
                      className="text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      View session →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Transcript updates */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Mic className="h-5 w-5 text-slate-400" />
          Transcript updates
        </h2>
        <div className="rounded-lg bg-slate-950 border border-slate-800 max-h-[240px] overflow-y-auto p-4 space-y-3">
          {transcriptUpdates.length === 0 ? (
            <p className="text-sm text-slate-500">Transcript events will appear here (partial and final).</p>
          ) : (
            transcriptUpdates.map((e) => (
              <div key={e.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className={e.name === 'transcript.final' || e.name === 'transcription.completed' ? 'text-emerald-400' : 'text-amber-400'}>
                    {e.name}
                  </span>
                  <span className="font-mono">{e.callSessionId.slice(0, 8)}…</span>
                  <span>{formatTime(e.ts)}</span>
                </div>
                <p className="text-slate-200 text-sm">
                  {(e.payload?.text as string) ?? (e.payload?.text_delta as string) ?? '—'}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Tool execution logs */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Wrench className="h-5 w-5 text-slate-400" />
          Tool execution logs
        </h2>
        <div className="rounded-lg bg-slate-950 border border-slate-800 max-h-[240px] overflow-y-auto p-4 space-y-3">
          {toolLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Tool calls and results will appear here.</p>
          ) : (
            toolLogs.map((e) => (
              <div key={e.id} className="rounded border border-slate-700 bg-slate-900/60 p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <span className={e.name === 'tool.called' ? 'text-amber-400' : 'text-emerald-400'}>{e.name}</span>
                  <span className="font-mono">{e.callSessionId.slice(0, 8)}…</span>
                  <span>{formatTime(e.ts)}</span>
                </div>
                {e.payload?.toolName != null && (
                  <p className="text-slate-200 font-medium mb-1">Tool: {String(e.payload.toolName)}</p>
                )}
                {e.name === 'tool.called' && e.payload?.args != null && (
                  <pre className="text-xs text-slate-400 overflow-auto max-h-20 bg-slate-950 rounded p-2">
                    {typeof e.payload.args === 'string' ? e.payload.args : JSON.stringify(e.payload.args)}
                  </pre>
                )}
                {e.name === 'tool.result' && e.payload?.result != null && (
                  <pre className="text-xs text-slate-400 overflow-auto max-h-20 bg-slate-950 rounded p-2">
                    {typeof e.payload.result === 'string' ? e.payload.result : JSON.stringify(e.payload.result)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Streaming events timeline */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-slate-400" />
          Streaming events timeline
        </h2>
        <p className="text-xs text-slate-500 mb-3">All events (last {STREAM_EVENTS_MAX})</p>
        <div className="rounded-lg bg-slate-950 border border-slate-800 max-h-[400px] overflow-y-auto p-4">
          {events.length === 0 ? (
            <div className="text-sm text-slate-400 py-4">
              {connected ? 'Waiting for events…' : 'Connect to see live events.'}
            </div>
          ) : (
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 items-start text-sm">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-200">{e.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{e.callSessionId.slice(0, 8)}…</span>
                      <span className="text-xs text-slate-500">{formatTime(e.ts)}</span>
                    </div>
                    {e.payload && Object.keys(e.payload).length > 0 && (
                      <pre className="mt-1 text-xs bg-slate-900/60 border border-slate-800 rounded p-2 overflow-auto max-h-24 text-slate-300">
                        {JSON.stringify(e.payload)}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div ref={timelineEndRef} />
        </div>
      </section>
    </div>
  );
}
