import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiGet, apiPost, apiDelete } from '../../api/client';

type ApiKeyItem = { id: string; name: string; createdAt: string };

export function ApiKeysPage() {
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ items: ApiKeyItem[] }>('/api/v1/api-keys');
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await apiPost<{ id: string; name: string; key: string; createdAt: string; message?: string }>(
        '/api/v1/api-keys',
        { name: name.trim() }
      );
      setNewKey(res.key);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? It will stop working immediately.')) return;
    setError(null);
    try {
      await apiDelete(`/api/v1/api-keys/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">API Keys</h1>
        <p className="mt-1 text-slate-600">Create keys for programmatic access. Use as Bearer token.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {newKey && (
        <div className="rounded-lg border border-emerald-400/50 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-medium">Key created. Copy it now — it won’t be shown again:</p>
          <code className="mt-2 block break-all rounded bg-slate-100 p-2 text-xs">{newKey}</code>
        </div>
      )}
      <Card className="max-w-lg border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Create API key</CardTitle>
          <CardDescription>Give the key a name (e.g. production, CLI).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-2">
            <div className="flex-1">
              <Label className="sr-only">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Key name"
                className="bg-slate-200 border-slate-300"
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Keys</CardTitle>
          <CardDescription>Revoke a key to invalidate it immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-slate-600 text-sm">No API keys yet.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-200/50 px-4 py-3"
                >
                  <span className="font-medium text-slate-800">{k.name}</span>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {new Date(k.createdAt).toLocaleString()}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-red-500/50 text-red-300 hover:bg-red-500/20"
                      onClick={() => handleRevoke(k.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
