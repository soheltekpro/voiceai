import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { fetchTools, createTool } from '../../api/tools';
import type { Tool, ToolType } from '../../api/tools';

const TOOL_TYPES: ToolType[] = ['WEBHOOK', 'HTTP_REQUEST', 'DATABASE_LOOKUP'];

export function ToolsPage() {
  const [items, setItems] = useState<Tool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ToolType>('WEBHOOK');
  const [configJson, setConfigJson] = useState('{}');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchTools({ limit: 100 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tools');
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
      await createTool({ name: name.trim(), description: description.trim() || null, type, config });
      setName('');
      setDescription('');
      setConfigJson('{}');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tool');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tools</h1>
        <p className="mt-1 text-slate-400">Define tools (webhook, http_request, database_lookup) and attach them to agents for LLM tool-calling.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-white">Create tool</CardTitle>
            <CardDescription>Add a tool. Config is type-specific: webhook/http_request need "url", database_lookup needs "table".</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label className="text-slate-300">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. get_weather"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this tool does"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">Type</Label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ToolType)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {TOOL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-slate-300">Config (JSON)</Label>
                <textarea
                  value={configJson}
                  onChange={(e) => setConfigJson(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
                  placeholder='{"url": "https://..."} or {"table": "agents"}'
                />
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Creating…' : 'Create tool'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-white">Tools</CardTitle>
            <CardDescription>Assign tools to agents in the Agent Builder (Settings → Tools).</CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-slate-400">No tools yet. Create one to enable tool-calling for agents.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                  >
                    <div className="font-medium text-slate-200">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.type} · {t.description || '—'}</div>
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
