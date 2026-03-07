import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { getUsage, type UsageResponse, type UsageMetrics } from '../../api/billing';
import { BarChart3 } from 'lucide-react';

const METRIC_LABELS: Record<keyof UsageMetrics, string> = {
  call_minutes: 'Call minutes',
  llm_tokens: 'LLM tokens',
  stt_seconds: 'STT seconds',
  tts_seconds: 'TTS seconds',
  tool_calls: 'Tool calls',
};

function MetricCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader className="pb-2">
        <CardDescription className="text-slate-400">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-white">
          {value.toLocaleString()} {unit}
        </p>
      </CardContent>
    </Card>
  );
}

export function UsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getUsage();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Usage</h1>
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  const usage: UsageMetrics = data?.usage ?? {
    call_minutes: 0,
    llm_tokens: 0,
    stt_seconds: 0,
    tts_seconds: 0,
    tool_calls: 0,
  };

  const units: Record<keyof UsageMetrics, string> = {
    call_minutes: 'min',
    llm_tokens: '',
    stt_seconds: 's',
    tts_seconds: 's',
    tool_calls: '',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Usage</h1>
        <p className="mt-1 text-slate-400">
          Usage metrics for your workspace.
          {data?.period && (
            <span className="block mt-1 text-slate-500">
              Period: {new Date(data.period.start).toLocaleDateString()} – {new Date(data.period.end).toLocaleDateString()}
            </span>
          )}
        </p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-white">Current period</CardTitle>
          </div>
          <CardDescription>Tracked usage for the current billing period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {(Object.keys(METRIC_LABELS) as (keyof UsageMetrics)[]).map((key) => (
              <MetricCard
                key={key}
                label={METRIC_LABELS[key]}
                value={usage[key]}
                unit={units[key]}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
