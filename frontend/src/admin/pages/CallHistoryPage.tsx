import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalls, fetchCallsStats, type CallsStats } from '../../api/calls';
import { fetchAgents } from '../../api/agents';
import type { Call, Paginated } from '../types';
import type { Agent } from '../types';

/** Format duration as "127s (2 min 7 sec)". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${seconds}s (${min} min ${sec} sec)`;
}

/** Format total duration for stats: "X min" or "X h Y min". */
function formatTotalDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const totalMin = totalSeconds / 60;
  if (totalMin < 60) return `${totalMin.toFixed(1)} min`;
  const h = Math.floor(totalMin / 60);
  const m = Math.floor(totalMin % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

export function CallHistoryPage() {
  const [data, setData] = useState<Paginated<Call> | null>(null);
  const [stats, setStats] = useState<CallsStats | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'ACTIVE' | 'ENDED' | 'ERROR' | ''>('');
  const [agentId, setAgentId] = useState<string>('');
  const [appliedStatus, setAppliedStatus] = useState<'ACTIVE' | 'ENDED' | 'ERROR' | ''>('');
  const [appliedAgentId, setAppliedAgentId] = useState<string>('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [res, statsRes] = await Promise.all([
        fetchCalls({
          limit,
          offset,
          ...(appliedStatus && { status: appliedStatus }),
          ...(appliedAgentId && { agent_id: appliedAgentId }),
        }),
        fetchCallsStats({
          ...(appliedStatus && { status: appliedStatus }),
          ...(appliedAgentId && { agent_id: appliedAgentId }),
        }),
      ]);
      setData(res);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load call history');
    }
  }, [limit, offset, appliedStatus, appliedAgentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchAgents({ limit: 500 })
      .then((p) => setAgents(p.items))
      .catch(() => {});
  }, []);

  const handleApplyFilters = () => {
    setAppliedAgentId(agentId);
    setAppliedStatus(status);
    setOffset(0);
  };

  const handleClearFilters = () => {
    setAgentId('');
    setStatus('');
    setAppliedAgentId('');
    setAppliedStatus('');
    setOffset(0);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Call History</h1>
          <p className="text-xs text-slate-600 sm:text-sm">Calls from the calls table with filters.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="w-full rounded-md bg-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-300 sm:w-auto touch-manipulation"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {stats != null && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total calls</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{stats.totalCalls.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total duration</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{formatTotalDuration(stats.totalDurationSeconds)}</p>
            <p className="text-xs text-slate-500">{stats.totalMinutes.toFixed(1)} min</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total cost (USD)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">${stats.totalCostUsd.toFixed(4)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total cost (₹)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">₹{stats.totalCostInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total tokens</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{stats.totalTokens.toLocaleString()}</p>
            {stats.totalTokens > 0 && (
              <p className="text-xs text-slate-500">in {stats.totalInputTokens.toLocaleString()} / out {stats.totalOutputTokens.toLocaleString()}</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Avg cost/call (USD)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">
              {stats.totalCalls > 0 ? `$${(stats.totalCostUsd / stats.totalCalls).toFixed(4)}` : '—'}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
        <strong className="text-slate-700">V2V cost:</strong> Realtime voice model cost includes audio input and output (transcription + response in one pipeline).
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 md:gap-4">
          <div>
            <label htmlFor="filter-agent" className="block text-xs font-medium text-slate-600 mb-1">
              Agent
            </label>
            <select
              id="filter-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="mt-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-slate-600 mb-1">
              Status
            </label>
            <select
              id="filter-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="mt-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ENDED">ENDED</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-end md:col-span-2">
            <button
              type="button"
              onClick={handleApplyFilters}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 sm:w-auto touch-manipulation"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 sm:w-auto touch-manipulation"
            >
              Clear
            </button>
          </div>
        </div>
        {(appliedAgentId || appliedStatus) && (
          <p className="mt-3 text-xs text-slate-500">
            Filtering by {appliedAgentId ? 'agent' : ''}{appliedAgentId && appliedStatus ? ' and ' : ''}{appliedStatus ? `status: ${appliedStatus}` : ''}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-100">
            <tr className="text-left text-slate-600">
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3">Audio in</th>
              <th className="px-4 py-3">Audio out</th>
              <th className="px-4 py-3">Total tokens</th>
              <th className="px-4 py-3">Cost/min (USD)</th>
              <th className="px-4 py-3">Cost/min (₹)</th>
              <th className="px-4 py-3">Total (₹)</th>
              <th className="px-4 py-3">Provider & model</th>
              <th className="px-4 py-3">Model price</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-50">
            {data?.items?.length ? (
              data.items.map((c) => (
                <tr key={c.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-800">
                    {new Date(c.startedAt).toLocaleString()}
                    {c.endedAt && (
                      <div className="text-xs text-slate-500">
                        Ended: {new Date(c.endedAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{c.agentName ?? '—'}</div>
                    {c.agentName && (
                      <div className="text-xs text-slate-500 font-mono">{c.agentId.slice(0, 8)}…</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{c.agentType}</td>
                  <td className="px-4 py-3 text-slate-700">{c.status}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {c.durationSeconds != null ? formatDuration(c.durationSeconds) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {c.tokensUsed != null ? c.tokensUsed.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                    {c.costBreakdown != null ? c.costBreakdown.audioInputTokens.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                    {c.costBreakdown != null ? c.costBreakdown.audioOutputTokens.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                    {c.costBreakdown != null ? c.costBreakdown.totalTokens.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {c.costBreakdown?.costPerMinuteUsd != null
                      ? `$${c.costBreakdown.costPerMinuteUsd.toFixed(4)}/min`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {c.costBreakdown?.costPerMinuteInr != null
                      ? `₹${c.costBreakdown.costPerMinuteInr.toFixed(2)}/min`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {c.costBreakdown?.totalCostInr != null
                      ? `₹${c.costBreakdown.totalCostInr.toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {c.costBreakdown?.v2vProvider || c.costBreakdown?.v2vModel
                      ? [c.costBreakdown.v2vProvider, c.costBreakdown.v2vModel].filter(Boolean).join(' · ')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {c.costBreakdown != null ? (
                      <div>
                        <div>${c.costBreakdown.inputRatePer1MUsd}/1M in, ${c.costBreakdown.outputRatePer1MUsd}/1M out</div>
                        <div className="text-slate-500 mt-0.5">
                          ${c.costBreakdown.inputPricePerTokenUsd.toFixed(6)}/tok in, ${c.costBreakdown.outputPricePerTokenUsd.toFixed(6)}/tok out
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/calls/${c.id}`}
                      className="rounded-md bg-slate-200 px-3 py-1.5 font-medium text-slate-900 hover:bg-slate-300"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={15}>
                  No calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data && data.total > limit && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <span className="text-center sm:text-left">
              {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
                className="rounded bg-slate-200 px-4 py-2.5 disabled:opacity-50 touch-manipulation min-w-[80px]"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + data.items.length >= data.total}
                onClick={() => setOffset((o) => o + limit)}
                className="rounded bg-slate-200 px-4 py-2.5 disabled:opacity-50 touch-manipulation min-w-[80px]"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
