import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { apiGet } from '../../api/client';

type TeamMember = { id: string; email: string; role: string; createdAt: string };
type TeamResp = { items: TeamMember[] };

export function TeamPage() {
  const [items, setItems] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<TeamResp>('/api/v1/team');
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Team</h1>
        <p className="mt-1 text-slate-600">Users in your workspace.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-slate-900">Members</CardTitle>
          <CardDescription>Users with access to this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-slate-600 text-sm">No members listed.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-200/50 p-4"
                >
                  <div>
                    <p className="font-medium text-slate-800">{m.email}</p>
                    <p className="text-xs text-slate-500">{m.role} · {new Date(m.createdAt).toLocaleDateString()}</p>
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
