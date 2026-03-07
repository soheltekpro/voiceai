import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalls } from '../../api/calls';
import { fetchAgents } from '../../api/agents';
import type { Call, Paginated } from '../types';
import type { Agent } from '../types';

export function CallHistoryPage() {
  const [data, setData] = useState<Paginated<Call> | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'ACTIVE' | 'ENDED' | 'ERROR' | ''>('');
  const [agentId, setAgentId] = useState<string>('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchCalls({
        limit,
        offset,
        ...(status && { status }),
        ...(agentId && { agent_id: agentId }),
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load call history');
    }
  }, [limit, offset, status, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchAgents({ limit: 500 })
      .then((p) => setAgents(p.items))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Call History</h1>
          <p className="text-sm text-slate-400">Calls from the calls table with filters.</p>
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-slate-400">Agent</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
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
            <label className="text-xs text-slate-400">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ENDED">ENDED</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => {
                setAgentId('');
                setStatus('');
                setOffset(0);
              }}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-left text-slate-400">
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-950">
            {data?.items?.length ? (
              data.items.map((c) => (
                <tr key={c.id} className="border-t border-slate-900">
                  <td className="px-4 py-3 text-slate-200">
                    {new Date(c.startedAt).toLocaleString()}
                    {c.endedAt && (
                      <div className="text-xs text-slate-500">
                        Ended: {new Date(c.endedAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{c.agentId.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-slate-300">{c.agentType}</td>
                  <td className="px-4 py-3 text-slate-300">{c.status}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.durationSeconds != null ? `${c.durationSeconds}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.tokensUsed != null ? c.tokensUsed.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/calls/${c.id}`}
                      className="rounded-md bg-slate-800 px-3 py-1.5 font-medium text-slate-100 hover:bg-slate-700"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={7}>
                  No calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data && data.total > limit && (
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-400">
            <span>
              {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
                className="rounded bg-slate-800 px-2 py-1 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + data.items.length >= data.total}
                onClick={() => setOffset((o) => o + limit)}
                className="rounded bg-slate-800 px-2 py-1 disabled:opacity-50"
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
