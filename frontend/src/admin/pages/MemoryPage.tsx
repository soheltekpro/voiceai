import { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { apiGet } from '../../api/client';
import { Brain, Phone, Calendar } from 'lucide-react';

export type MemoryResponse = {
  summary: string | null;
  lastCallId: string | null;
  lastInteraction: { updatedAt: string; createdAt: string } | null;
};

export function MemoryPage() {
  const [phone, setPhone] = useState('');
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const normalized = phone.replace(/\s/g, '').trim();
    if (!normalized) {
      setError('Enter a phone number');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await apiGet<MemoryResponse>(`/api/v1/memory/${encodeURIComponent(normalized)}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memory');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [phone]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Conversation memory</h1>
        <p className="mt-1 text-slate-400">
          View stored context for a caller by phone number. Used so the agent can remember previous interactions.
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Phone className="h-5 w-5 text-slate-400" />
            Look up caller
          </CardTitle>
          <CardDescription>Enter the caller&apos;s phone number (e.g. +1234567890)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="+1234567890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              className="max-w-xs bg-slate-800 border-slate-700 text-white"
            />
            <Button onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Load memory'}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </CardContent>
      </Card>

      {data && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Brain className="h-5 w-5 text-slate-400" />
              Previous call summaries
            </CardTitle>
            <CardDescription>Context the agent will see for this caller</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.summary ? (
              <div className="rounded-lg bg-slate-800/60 p-4 text-sm text-slate-200 whitespace-pre-wrap">
                {data.summary}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No memory yet for this number.</p>
            )}
            {data.lastInteraction && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Calendar className="h-4 w-4" />
                <span>Last updated: {new Date(data.lastInteraction.updatedAt).toLocaleString()}</span>
              </div>
            )}
            {data.lastCallId && (
              <p className="text-slate-500 text-xs">Last call ID: {data.lastCallId}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
