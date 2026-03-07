/**
 * Phase 10: Unified call monitoring dashboard.
 * Live events timeline (all calls), call history table, usage analytics.
 * Events work for both pipeline and v2v agents via central event bus.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { CallSession, Paginated } from '../types';

type LiveEvent = {
  id: string;
  callSessionId: string;
  name: string;
  ts: number;
  payload?: Record<string, unknown>;
};

type AnalyticsSummary = {
  calls: number;
  ended: number;
  active: number;
  error: number;
  totalDurationSeconds: number;
  totalEstimatedCostUsd: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
};

const LIVE_EVENTS_MAX = 150;

function getEventsWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/events';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/events`;
}

export function MonitoringPage() {
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [sessions, setSessions] = useState<Paginated<CallSession> | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiGet<Paginated<CallSession>>('/api/v1/call-sessions?limit=50&offset=0');
      setSessions(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await apiGet<AnalyticsSummary>('/api/v1/analytics/summary');
      setAnalytics(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadAnalytics();
  }, [loadSessions, loadAnalytics]);

  useEffect(() => {
    const url = getEventsWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setLiveConnected(false);

    ws.onopen = () => {
      setLiveConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', callSessionId: '*' }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; evt?: LiveEvent };
        if (msg.type === 'event' && msg.evt) {
          setLiveEvents((prev) => {
            const next = [msg.evt!, ...prev].slice(0, LIVE_EVENTS_MAX);
            return next;
          });
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => setLiveConnected(false);
    ws.onerror = () => setLiveConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Call monitoring</h1>
          <p className="text-sm text-slate-400 mt-1">
            Live events, call history, and usage analytics (pipeline + v2v)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { void loadSessions(); void loadAnalytics(); }}
            className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm font-medium"
          >
            Refresh
          </button>
          <span
            className={`inline-flex items-center px-2 py-1 rounded border text-sm ${
              liveConnected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            {liveConnected ? 'Live events on' : 'Live events off'}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Usage analytics */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Usage analytics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Calls</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">{analytics?.calls ?? '—'}</div>
            <div className="text-xs text-slate-400 mt-1">
              {analytics?.active != null && analytics.active > 0 ? `${analytics.active} active` : ''}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Duration</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">
              {analytics?.totalDurationSeconds != null
                ? formatDuration(analytics.totalDurationSeconds)
                : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Est. cost</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">
              {analytics?.totalEstimatedCostUsd != null
                ? `$${Number(analytics.totalEstimatedCostUsd).toFixed(4)}`
                : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Input tokens</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">
              {analytics?.totalInputTokens != null ? analytics.totalInputTokens.toLocaleString() : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Output tokens</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">
              {analytics?.totalOutputTokens != null ? analytics.totalOutputTokens.toLocaleString() : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Ended / Error</div>
            <div className="text-2xl font-semibold text-slate-100 mt-1">
              {analytics?.ended ?? '—'} / {analytics?.error ?? '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Live events timeline */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Live events timeline</h2>
        <p className="text-xs text-slate-500 mb-3">
          All events from pipeline and v2v agents (last {LIVE_EVENTS_MAX})
        </p>
        <div className="rounded-lg bg-slate-950 border border-slate-800 max-h-[320px] overflow-y-auto p-4">
          {liveEvents.length === 0 ? (
            <div className="text-sm text-slate-400 py-4">
              {liveConnected ? 'Waiting for events…' : 'Connect to see live events.'}
            </div>
          ) : (
            <ol className="space-y-2">
              {liveEvents.map((e) => (
                <li key={e.id} className="flex gap-3 items-start text-sm">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-200">{e.name}</span>
                      <span className="text-xs text-slate-500 font-mono">
                        {e.callSessionId.slice(0, 8)}…
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
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
        </div>
      </section>

      {/* Call history table */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Call history</h2>
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr className="text-left text-slate-400">
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Tokens</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-slate-950">
              {sessions?.items?.length ? (
                sessions.items.map((s) => (
                  <tr key={s.id} className="border-t border-slate-900">
                    <td className="px-4 py-3 text-slate-200">
                      {new Date(s.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{s.status}</td>
                    <td className="px-4 py-3 text-slate-300">{s.clientType}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {s.durationSeconds != null ? `${s.durationSeconds}s` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {s.estimatedCostUsd != null
                        ? `$${Number(s.estimatedCostUsd).toFixed(4)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {s.inputTokens != null || s.outputTokens != null
                        ? `${s.inputTokens ?? 0} / ${s.outputTokens ?? 0}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {s.agent ? (
                        <span className="text-slate-200">{s.agent.name}</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/admin/call-sessions/${s.id}`}
                        className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium"
                      >
                        View · Transcript
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={8}>
                    No sessions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
