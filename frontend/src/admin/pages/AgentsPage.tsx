import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost } from '../../api/client';
import type { Agent, Paginated } from '../types';

export function AgentsPage() {
  const [data, setData] = useState<Paginated<Agent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentType, setAgentType] = useState<'PIPELINE' | 'V2V'>('PIPELINE');

  const canCreate = useMemo(() => name.trim().length > 0 && !creating, [name, creating]);

  const load = async () => {
    setError(null);
    try {
      const res = await apiGet<Paginated<Agent>>('/api/v1/agents?limit=100&offset=0');
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAgent = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      await apiPost<Agent>('/api/v1/agents', {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        agentType,
      });
      setName('');
      setDescription('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    setError(null);
    try {
      await apiDelete(`/api/v1/agents/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete agent');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="text-sm text-slate-600">
            Create and manage voice agents (prompt, voice, language, max duration, interruption).
          </p>
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
        <div className="text-sm font-semibold mb-3">Create agent</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-1">
            <label className="text-xs text-slate-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm"
              placeholder="Support Agent"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-600">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm"
              placeholder="Short description (optional)"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-slate-600">Agent type</label>
            <div className="mt-1 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setAgentType('PIPELINE')}
                className={`px-3 py-2 rounded-md text-sm border text-left ${
                  agentType === 'PIPELINE'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-100'
                    : 'border-slate-300 bg-slate-100 text-slate-800'
                }`}
              >
                <div className="font-semibold">Voice Pipeline</div>
                <div className="text-xs text-slate-600">STT → LLM → TTS</div>
              </button>
              <button
                type="button"
                onClick={() => setAgentType('V2V')}
                className={`px-3 py-2 rounded-md text-sm border text-left ${
                  agentType === 'V2V'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-100'
                    : 'border-slate-300 bg-slate-100 text-slate-800'
                }`}
              >
                <div className="font-semibold">Realtime Voice (V2V)</div>
                <div className="text-xs text-slate-600">LiveKit voice-to-voice agent</div>
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={createAgent}
            disabled={!canCreate}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="text-left text-slate-600">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Language</th>
              <th className="px-4 py-3">Voice</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-50">
            {data?.items?.length ? (
              data.items.map((a) => (
                <tr key={a.id} className="border-t border-slate-200">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{a.name}</div>
                    {a.description && <div className="text-xs text-slate-600">{a.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {a.agentType === 'V2V' ? 'Realtime V2V' : 'Pipeline'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {a.agentType === 'V2V' ? '— (realtime)' : a.settings?.language ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{a.settings?.voiceName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(a.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link
                      to={`/admin/agents/${a.id}`}
                      className="px-3 py-1.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-900 font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteAgent(a.id)}
                      className="px-3 py-1.5 rounded-md bg-rose-600/80 hover:bg-rose-600 text-white font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={5}>
                  No agents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

