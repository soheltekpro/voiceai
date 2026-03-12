import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiDelete, apiGet, apiPost } from '../../api/client';

type Webhook = {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
};

type ListResp = { items: Webhook[] };
type CreateResp = { id: string; url: string; events: string[]; secret: string; createdAt: string };

const COMMON_EVENTS = [
  'call.started',
  'call.connected',
  'speech.detected',
  'transcript.partial',
  'transcript.final',
  'agent.reply',
  'tool.called',
  'tool.result',
  'call.ended',
  'usage.updated',
];

export function WebhooksPage() {
  const [items, setItems] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['call.started', 'call.ended']);
  const [creating, setCreating] = useState(false);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<ListResp>('/api/v1/webhooks');
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEvent = (evt: string) => {
    setEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSecretOnce(null);
    try {
      const res = await apiPost<CreateResp>('/api/v1/webhooks', {
        url: url.trim(),
        events,
      });
      setSecretOnce(res.secret);
      setUrl('');
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await apiDelete(`/api/v1/webhooks/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete webhook');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Webhooks</h1>
        <p className="mt-1 text-slate-600">Send call and tool events to your systems.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {secretOnce && (
        <div className="rounded-lg border border-emerald-400/50 bg-emerald-50 p-3 text-sm text-emerald-800">
          <div className="font-medium text-emerald-100">Webhook secret (shown once)</div>
          <div className="mt-1 break-all font-mono text-emerald-100">{secretOnce}</div>
        </div>
      )}

      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Create webhook</CardTitle>
          <CardDescription>Choose a URL and which events you want delivered.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <div>
              <Label className="text-slate-700">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/voiceai"
                className="mt-1 bg-slate-200 border-slate-300"
              />
            </div>

            <div>
              <Label className="text-slate-700">Events</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {COMMON_EVENTS.map((evt) => (
                  <label
                    key={evt}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/30 px-3 py-2 text-sm text-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                    />
                    <span className="font-mono text-xs">{evt}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button type="submit" disabled={creating || events.length === 0}>
              {creating ? 'Creating…' : 'Create webhook'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Existing webhooks</CardTitle>
          <CardDescription>Secrets are not shown after creation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <div className="py-10 text-center text-slate-500">No webhooks yet.</div>
          ) : (
            items.map((w) => (
              <div
                key={w.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/30 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-900">{w.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <span key={e} className="rounded bg-slate-200 px-2 py-0.5 font-mono text-[11px] text-slate-800">
                        {e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Created {new Date(w.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => remove(w.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

