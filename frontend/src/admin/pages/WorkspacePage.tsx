import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiGet, apiPatch } from '../../api/client';
import { getStoredWorkspace } from '../../api/auth';

type WorkspaceResp = { id: string; name: string; createdAt: string };

export function WorkspacePage() {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const w = await apiGet<WorkspaceResp>('/api/v1/workspace');
      setName(w.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch<WorkspaceResp>('/api/v1/workspace', { name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const stored = getStoredWorkspace();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workspace</h1>
        <p className="mt-1 text-slate-600">Manage your workspace name and settings.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <Card className="max-w-lg border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Workspace details</CardTitle>
          <CardDescription>
            {stored?.name ?? 'Current workspace'} · ID: {stored?.id ?? '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaded && (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <Label className="text-slate-700">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace name"
                  className="mt-1 bg-slate-200 border-slate-300"
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
