import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { fetchPhoneNumbers, createPhoneNumber, fetchSipTrunks } from '../../api/telephony';
import { fetchAgents } from '../../api/agents';
import type { PhoneNumber, SipTrunk } from '../../api/telephony';
import type { Agent } from '../types';

export function PhoneNumbersPage() {
  const [items, setItems] = useState<PhoneNumber[]>([]);
  const [total, setTotal] = useState(0);
  const [trunks, setTrunks] = useState<SipTrunk[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [provider, setProvider] = useState('TWILIO');
  const [sipTrunkId, setSipTrunkId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [numbersRes, trunksRes, agentsRes] = await Promise.all([
        fetchPhoneNumbers({ limit: 100, offset: 0 }),
        fetchSipTrunks({ limit: 100, offset: 0 }),
        fetchAgents({ limit: 100 }),
      ]);
      setItems(numbersRes.items);
      setTotal(numbersRes.total);
      setTrunks(trunksRes.items);
      setAgents(agentsRes.items ?? []);
      if (trunksRes.items.length > 0) {
        setSipTrunkId((prev) => (prev && trunksRes.items.some((t) => t.id === prev) ? prev : trunksRes.items[0].id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim() || !sipTrunkId) return;
    setSaving(true);
    setError(null);
    try {
      await createPhoneNumber({
        number: number.trim(),
        provider,
        sipTrunkId,
        agentId: agentId || null,
      });
      setNumber('');
      setAgentId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create phone number');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Phone Numbers</h1>
        <p className="mt-1 text-slate-600">
          Assign phone numbers to SIP trunks and optionally to an agent for inbound call routing.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900">Add phone number</CardTitle>
            <CardDescription>Inbound calls to this number will route to the assigned agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label className="text-slate-700">Number (E.164 or provider format)</Label>
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="+14155551234"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-700">Provider</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="TWILIO"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-700">SIP trunk</Label>
                <select
                  value={sipTrunkId}
                  onChange={(e) => setSipTrunkId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-200 px-3 py-2 text-slate-800"
                >
                  <option value="">Select trunk</option>
                  {trunks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-slate-700">Agent (inbound)</Label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-200 px-3 py-2 text-slate-800"
                >
                  <option value="">No agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={saving || !sipTrunkId} className="w-full">
                {saving ? 'Adding…' : 'Add phone number'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900">Numbers ({total})</CardTitle>
            <CardDescription>Numbers with an agent receive inbound calls routed to that agent.</CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No phone numbers yet.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-slate-300 bg-slate-200/50 p-4"
                  >
                    <div className="font-medium text-slate-800">{p.number}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                      <span>{p.provider}</span>
                      {p.sipTrunk && <span>· {p.sipTrunk.name}</span>}
                    </div>
                    <div className="mt-1 text-sm text-slate-700">
                      Agent: {p.agent?.name ?? '—'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
