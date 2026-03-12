import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { CallSession, Paginated } from '../types';

export function CallSessionsPage() {
  const [data, setData] = useState<Paginated<CallSession> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ENDED' | 'ERROR' | ''>('');
  const [clientType, setClientType] = useState<'BROWSER' | 'PHONE' | 'UNKNOWN' | ''>('');

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '100', offset: '0' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (clientType) params.set('clientType', clientType);
    return params.toString();
  }, [q, status, clientType]);

  const load = async () => {
    setError(null);
    try {
      const res = await apiGet<Paginated<CallSession>>(`/api/v1/call-sessions?${queryString}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load call sessions');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Call sessions</h1>
          <p className="text-sm text-slate-600">Real-time session list (browser + phone later).</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-2 rounded-md bg-slate-200 hover:bg-slate-300 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-400/50 text-red-800 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-600">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm"
              placeholder="Search transcript / metadata"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="mt-1 w-full rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ENDED">ENDED</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600">Client</label>
            <select
              value={clientType}
              onChange={(e) => setClientType(e.target.value as any)}
              className="mt-1 w-full rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="BROWSER">BROWSER</option>
              <option value="PHONE">PHONE</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-slate-900"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              setQ('');
              setStatus('');
              setClientType('');
            }}
            className="px-4 py-2 rounded-md bg-slate-200 hover:bg-slate-300 text-sm font-semibold text-slate-900"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="text-left text-slate-600">
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Cost/min (USD)</th>
              <th className="px-4 py-3">Cost/min (₹)</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-50">
            {data?.items?.length ? (
              data.items.map((s) => (
                <tr key={s.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-800">
                    {new Date(s.startedAt).toLocaleString()}
                    {s.endedAt && (
                      <div className="text-xs text-slate-500">
                        Ended: {new Date(s.endedAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{s.status}</td>
                  <td className="px-4 py-3 text-slate-700">{s.clientType}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {s.durationSeconds != null ? `${s.durationSeconds}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {s.estimatedCostUsd != null ? `$${Number(s.estimatedCostUsd).toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {s.costPerMinuteUsd != null ? `$${s.costPerMinuteUsd.toFixed(4)}/min` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {s.costBreakdown?.costPerMinuteInr != null
                      ? `₹${s.costBreakdown.costPerMinuteInr.toFixed(2)}/min`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {s.agent ? (
                      <div>
                        <div className="font-semibold text-slate-900">{s.agent.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{s.agent.id.slice(0, 8)}…</div>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/call-sessions/${s.id}`}
                      className="px-3 py-1.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-900 font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={9}>
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

