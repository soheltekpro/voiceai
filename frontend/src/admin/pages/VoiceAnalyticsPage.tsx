/**
 * Voice analytics and monitoring dashboard.
 * Active calls, recent calls, latency metrics, provider usage, live monitor, and call inspector.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../api/client';
import {
  getVoiceAnalyticsOverview,
  getVoiceAnalyticsRecent,
  getVoiceAnalyticsActive,
  getVoiceMonitorWsUrl,
  type VoiceCallMetrics,
  type VoiceAnalyticsOverview,
  type VoiceMonitorEvent,
} from '../../api/voice-analytics';
import type { Paginated } from '../types';
import type { CallMessage } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Phone, Mic, Cpu, Volume2, Activity, X, Target, Lightbulb, Star } from 'lucide-react';
import { fetchCallSessionOutcome, fetchCallSessionGuidance, fetchCallSessionEvaluation, type CallOutcome, type CallGuidanceItem } from '../../api/calls';

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function formatMs(ms: number | undefined | null): string {
  if (ms == null) return '—';
  return `${Math.round(ms)} ms`;
}

function formatDuration(ms: number | undefined | null): string {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function VoiceAnalyticsPage() {
  const [overview, setOverview] = useState<VoiceAnalyticsOverview | null>(null);
  const [recentCalls, setRecentCalls] = useState<VoiceCallMetrics[]>([]);
  const [activeCalls, setActiveCalls] = useState<VoiceCallMetrics[]>([]);
  const [monitorConnected, setMonitorConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inspectorCall, setInspectorCall] = useState<VoiceCallMetrics | null>(null);
  const [inspectorMessages, setInspectorMessages] = useState<CallMessage[]>([]);
  const [inspectorOutcome, setInspectorOutcome] = useState<CallOutcome | null | false>(null);
  const [inspectorGuidance, setInspectorGuidance] = useState<CallGuidanceItem[]>([]);
  const [inspectorEvaluation, setInspectorEvaluation] = useState<{ score: number; strengths: string; improvements: string } | null | false>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const data = await getVoiceAnalyticsOverview();
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const { calls } = await getVoiceAnalyticsRecent(50);
      setRecentCalls(calls);
    } catch {
      // keep previous
    }
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [o, { calls: recent }, { calls: active }] = await Promise.all([
        getVoiceAnalyticsOverview(),
        getVoiceAnalyticsRecent(50),
        getVoiceAnalyticsActive(),
      ]);
      setOverview(o);
      setRecentCalls(recent);
      setActiveCalls(active);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const t = setInterval(loadAll, 15000);
    return () => clearInterval(t);
  }, [loadAll]);

  // Poll guidance while call inspector is open (live call suggestions)
  useEffect(() => {
    if (!inspectorCall) return;
    const poll = async () => {
      try {
        const { items } = await fetchCallSessionGuidance(inspectorCall.callId);
        setInspectorGuidance(items ?? []);
      } catch {
        // keep previous
      }
    };
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [inspectorCall?.callId]);

  useEffect(() => {
    const url = getVoiceMonitorWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setMonitorConnected(true);
    ws.onclose = () => setMonitorConnected(false);
    ws.onerror = () => setMonitorConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type?: string; evt?: VoiceMonitorEvent };
        if (msg.type !== 'voice_monitor' || !msg.evt) return;
        const e = msg.evt;
        if (e.type === 'call_started') {
          setActiveCalls((prev) => {
            if (prev.some((c) => c.callId === e.callId)) return prev;
            return [
              ...prev,
              {
                callId: e.callId,
                agentId: e.agentId,
                workspaceId: e.workspaceId,
                startedAt: e.ts,
              },
            ];
          });
        } else if (e.type === 'call_ended') {
          setActiveCalls((prev) => prev.filter((c) => c.callId !== e.callId));
          void loadRecent();
          void loadOverview();
        }
      } catch {
        // ignore
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [loadRecent, loadOverview]);

  const openInspector = useCallback(async (call: VoiceCallMetrics) => {
    setInspectorCall(call);
    setInspectorMessages([]);
    setInspectorOutcome(null);
    setInspectorGuidance([]);
    setInspectorEvaluation(null);
    try {
      const messages = await apiGet<Paginated<CallMessage>>(
        `/api/v1/call-sessions/${call.callId}/messages?limit=200&offset=0`
      );
      setInspectorMessages(messages.items ?? []);
    } catch {
      // leave messages empty
    }
    try {
      const outcome = await fetchCallSessionOutcome(call.callId);
      setInspectorOutcome(outcome);
    } catch {
      setInspectorOutcome(false);
    }
    try {
      const { items } = await fetchCallSessionGuidance(call.callId);
      setInspectorGuidance(items ?? []);
    } catch {
      setInspectorGuidance([]);
    }
    try {
      const ev = await fetchCallSessionEvaluation(call.callId);
      setInspectorEvaluation(ev);
    } catch {
      setInspectorEvaluation(false);
    }
  }, []);

  const callsPerHour = useMemo(() => {
    const byHour: Record<string, number> = {};
    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now);
      t.setHours(t.getHours() - i, 0, 0, 0);
      const key = t.toISOString().slice(0, 13);
      byHour[key] = 0;
    }
    recentCalls.forEach((c) => {
      const key = new Date(c.startedAt).toISOString().slice(0, 13);
      if (byHour[key] != null) byHour[key]++;
    });
    return Object.entries(byHour)
      .map(([hour, count]) => ({ hour: hour.slice(11, 13) + ':00', count }))
      .slice(-24);
  }, [recentCalls]);

  const avgLatencyByHour = useMemo(() => {
    const byHour: Record<string, { sum: number; n: number }> = {};
    recentCalls.forEach((c) => {
      const lat = (c.sttLatencyMs ?? 0) + (c.llmFirstTokenMs ?? 0) + (c.ttsFirstAudioMs ?? 0);
      if (lat <= 0) return;
      const key = new Date(c.startedAt).toISOString().slice(0, 13);
      if (!byHour[key]) byHour[key] = { sum: 0, n: 0 };
      byHour[key].sum += lat;
      byHour[key].n++;
    });
    return Object.entries(byHour).map(([hour, v]) => ({
      hour: hour.slice(11, 13) + ':00',
      avgLatency: Math.round(v.sum / v.n),
    }));
  }, [recentCalls]);

  const providerDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    recentCalls.forEach((c) => {
      const p = c.providerUsed?.llm ?? c.providerUsed?.stt ?? c.providerUsed?.tts ?? 'unknown';
      counts[p] = (counts[p] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [recentCalls]);

  if (loading && !overview) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Voice Analytics</h1>
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Voice Analytics</h1>
          <p className="mt-1 text-slate-400">Live call metrics, latency, and provider usage</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              monitorConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/50 text-slate-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${monitorConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {monitorConnected ? 'Live' : 'Offline'}
          </span>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-400">
              <Phone className="h-4 w-4" />
              Active calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-white">{overview?.activeCalls ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total calls today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-white">{overview?.totalCallsToday ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Avg call duration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-white">
              {overview?.avgCallDurationMs != null ? formatDuration(overview.avgCallDurationMs) : '—'}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Avg latency (STT+LLM+TTS)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-white">
              {overview?.avgLatencyMs != null ? formatMs(overview.avgLatencyMs) : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active calls */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Activity className="h-5 w-5" />
            Active calls
          </CardTitle>
          <CardDescription>Currently active voice sessions (live)</CardDescription>
        </CardHeader>
        <CardContent>
          {activeCalls.length === 0 ? (
            <p className="text-slate-400">No active calls</p>
          ) : (
            <ul className="space-y-2">
              {activeCalls.map((c) => (
                <li
                  key={c.callId}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2"
                >
                  <span className="font-mono text-sm text-slate-300">{c.callId.slice(0, 8)}…</span>
                  <span className="text-xs text-slate-500">Agent: {c.agentId?.slice(0, 8) ?? '—'}…</span>
                  <button
                    type="button"
                    onClick={() => openInspector(c)}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Details
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white">Calls per hour</CardTitle>
            <CardDescription>Recent call volume by hour (last 24h)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={callsPerHour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white">Avg latency trend</CardTitle>
            <CardDescription>Average STT+LLM+TTS latency by hour</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={avgLatencyByHour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(v: number | undefined) => [`${v != null ? v : 0} ms`, 'Avg latency']}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgLatency"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6' }}
                    name="Avg latency (ms)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider distribution */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Provider usage</CardTitle>
          <CardDescription>Distribution by LLM/STT/TTS provider (recent calls)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={providerDistribution}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {providerDistribution.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent calls table */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Recent calls</CardTitle>
          <CardDescription>Last 50 calls — click a row to open details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="pb-2 pr-4">Call ID</th>
                  <th className="pb-2 pr-4">Agent</th>
                  <th className="pb-2 pr-4">Started</th>
                  <th className="pb-2 pr-4">Duration</th>
                  <th className="pb-2 pr-4">STT</th>
                  <th className="pb-2 pr-4">LLM 1st</th>
                  <th className="pb-2 pr-4">TTS 1st</th>
                  <th className="pb-2 pr-4">Interruptions</th>
                  <th className="pb-2">Providers</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c) => (
                  <tr
                    key={c.callId}
                    className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/50"
                    onClick={() => openInspector(c)}
                  >
                    <td className="py-2 pr-4 font-mono text-slate-300">{c.callId.slice(0, 12)}…</td>
                    <td className="py-2 pr-4 text-slate-400">{c.agentId?.slice(0, 8) ?? '—'}…</td>
                    <td className="py-2 pr-4 text-slate-400">{formatTime(c.startedAt)}</td>
                    <td className="py-2 pr-4 text-slate-400">{formatDuration(c.durationMs)}</td>
                    <td className="py-2 pr-4 text-slate-400">{formatMs(c.sttLatencyMs)}</td>
                    <td className="py-2 pr-4 text-slate-400">{formatMs(c.llmFirstTokenMs)}</td>
                    <td className="py-2 pr-4 text-slate-400">{formatMs(c.ttsFirstAudioMs)}</td>
                    <td className="py-2 pr-4 text-slate-400">{c.interruptions ?? 0}</td>
                    <td className="py-2 text-slate-500">
                      {[c.providerUsed?.stt, c.providerUsed?.llm, c.providerUsed?.tts].filter(Boolean).join(' / ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Call inspector modal */}
      {inspectorCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setInspectorCall(null)}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Call details</h2>
                <p className="mt-1 font-mono text-sm text-slate-400">{inspectorCall.callId}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectorCall(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Agent ID</dt>
              <dd className="font-mono text-slate-300">{inspectorCall.agentId || '—'}</dd>
              <dt className="text-slate-500">Started</dt>
              <dd className="text-slate-300">{new Date(inspectorCall.startedAt).toLocaleString()}</dd>
              <dt className="text-slate-500">Duration</dt>
              <dd className="text-slate-300">{formatDuration(inspectorCall.durationMs)}</dd>
              <dt className="text-slate-500 flex items-center gap-1"><Mic className="h-3.5 w-3.5" /> STT latency</dt>
              <dd className="text-slate-300">{formatMs(inspectorCall.sttLatencyMs)}</dd>
              <dt className="text-slate-500 flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> LLM first token</dt>
              <dd className="text-slate-300">{formatMs(inspectorCall.llmFirstTokenMs)}</dd>
              <dt className="text-slate-500 flex items-center gap-1"><Volume2 className="h-3.5 w-3.5" /> TTS first audio</dt>
              <dd className="text-slate-300">{formatMs(inspectorCall.ttsFirstAudioMs)}</dd>
              <dt className="text-slate-500">Interruptions</dt>
              <dd className="text-slate-300">{inspectorCall.interruptions ?? 0}</dd>
              <dt className="text-slate-500">Providers</dt>
              <dd className="text-slate-300">
                STT: {inspectorCall.providerUsed?.stt ?? '—'} / LLM: {inspectorCall.providerUsed?.llm ?? '—'} / TTS: {inspectorCall.providerUsed?.tts ?? '—'}
              </dd>
            </dl>
            {inspectorOutcome && (
              <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2">
                  <Target className="h-3.5 w-3.5" /> Call outcome
                </h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Outcome:</span>
                    <span className="font-semibold text-emerald-300">{inspectorOutcome.outcome}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Confidence:</span>
                    <span className="text-slate-200">{Math.round(inspectorOutcome.confidence * 100)}%</span>
                  </div>
                  <p className="text-slate-300 pt-2 border-t border-slate-700 mt-2">{inspectorOutcome.summary}</p>
                </div>
              </div>
            )}
            {inspectorOutcome === false && (
              <div className="mt-6 text-sm text-slate-500">Call outcome: not yet detected</div>
            )}
            {inspectorEvaluation && (
              <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2">
                  <Star className="h-3.5 w-3.5" /> Call Quality
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="font-semibold text-slate-200">
                    Call Quality Score: {Math.round(inspectorEvaluation.score)}%
                  </div>
                  <div>
                    <span className="text-slate-500">Strengths:</span>
                    <p className="text-slate-300 mt-0.5">{inspectorEvaluation.strengths}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Improvements:</span>
                    <p className="text-slate-300 mt-0.5">{inspectorEvaluation.improvements}</p>
                  </div>
                </div>
              </div>
            )}
            {inspectorEvaluation === false && (
              <div className="mt-6 text-sm text-slate-500">Call quality: evaluation not yet available</div>
            )}
            <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2">
                <Lightbulb className="h-3.5 w-3.5" /> AI Suggestions
              </h3>
              {inspectorGuidance.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-slate-200">
                    <span className="text-slate-500">Suggestion:</span>{' '}
                    {inspectorGuidance[0].suggestion}
                  </p>
                  {inspectorGuidance.length > 1 && (
                    <p className="text-xs text-slate-500">
                      {inspectorGuidance.length} suggestion(s) — showing latest
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No suggestions yet. Guidance updates every 30s during the call.</p>
              )}
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-400">Transcript</h3>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                {inspectorMessages.length === 0 ? (
                  <p className="text-slate-500">No messages loaded</p>
                ) : (
                  <ul className="space-y-2">
                    {inspectorMessages.map((m) => (
                      <li key={m.id} className="text-sm">
                        <span className="font-medium text-slate-400">{m.role}:</span>{' '}
                        <span className="text-slate-200">{m.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
