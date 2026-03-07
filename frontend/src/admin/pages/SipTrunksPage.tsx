import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { fetchSipTrunks, createSipTrunk } from '../../api/telephony';
import type { SipTrunk } from '../../api/telephony';

const PROVIDERS = ['TWILIO', 'PLIVO', 'TELNYX'];

export function SipTrunksPage() {
  const [items, setItems] = useState<SipTrunk[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('TWILIO');
  const [name, setName] = useState('');
  const [configJson, setConfigJson] = useState('{}');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchSipTrunks({ limit: 100, offset: 0 });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SIP trunks');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(configJson || '{}');
    } catch {
      setError('Invalid JSON in config');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createSipTrunk({ provider, name: name.trim(), config });
      setName('');
      setConfigJson('{}');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create SIP trunk');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SIP Trunks</h1>
        <p className="mt-1 text-slate-400">
          Configure SIP trunks (Twilio, Plivo, Telnyx). Use the trunk name as the PJSIP endpoint in Asterisk.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-white">Add SIP trunk</CardTitle>
            <CardDescription>Provider-specific config (e.g. credentials) goes in config JSON.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label className="text-slate-300">Provider</Label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-200"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-slate-300">Name (PJSIP endpoint)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. twilio-trunk"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">Config (JSON)</Label>
                <textarea
                  value={configJson}
                  onChange={(e) => setConfigJson(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-800 p-3 font-mono text-sm text-slate-200"
                  placeholder='{"authToken": "..."}'
                />
              </div>
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? 'Creating…' : 'Create trunk'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-white">Trunks ({total})</CardTitle>
            <CardDescription>Trunks are used for outbound calls and to associate phone numbers.</CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No trunks yet. Create one to get started.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-slate-700 bg-slate-800/50 p-4"
                  >
                    <div className="font-medium text-slate-200">{t.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
                      <span>{t.provider}</span>
                      {t._count != null && (
                        <span>· {t._count.phoneNumbers} number(s)</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(t.createdAt).toLocaleString()}
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
