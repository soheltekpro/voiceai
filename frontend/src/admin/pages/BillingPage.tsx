import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { getBilling, type BillingResponse, type UsageMetrics } from '../../api/billing';
import { CreditCard } from 'lucide-react';

function MetricRow({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}) {
  const pct = limit != null && limit > 0 ? Math.min(100, (used / limit) * 100) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="text-white">
          {used.toLocaleString()} {limit != null ? `/ ${limit.toLocaleString()}` : ''} {unit}
        </span>
      </div>
      {pct != null && (
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function BillingPage() {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getBilling();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing');
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
        <h1 className="text-2xl font-bold text-white">Billing</h1>
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
  const plan = data?.plan;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-slate-400">
          Current plan and usage for this billing period.
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
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-slate-400" />
              <CardTitle className="text-white">Current plan</CardTitle>
            </div>
            <CardDescription>
              {plan ? (
                <>
                  <span className="font-medium text-white">{plan.name}</span>
                  {plan.price === 0 ? ' — Free' : ` — $${plan.price.toFixed(2)}/mo`}
                </>
              ) : (
                'No plan assigned (unlimited)'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan && (
              <div className="text-sm text-slate-400 space-y-1">
                {plan.callMinutesLimit != null && <p>Call minutes: {plan.callMinutesLimit.toLocaleString()} / month</p>}
                {plan.tokenLimit != null && <p>LLM tokens: {plan.tokenLimit.toLocaleString()} / month</p>}
                {plan.toolCallsLimit != null && <p>Tool calls: {plan.toolCallsLimit.toLocaleString()} / month</p>}
                {(plan.sttSecondsLimit != null || plan.ttsSecondsLimit != null) && (
                  <p>
                    STT/TTS: {plan.sttSecondsLimit ?? '—'} / {plan.ttsSecondsLimit ?? '—'} sec
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-white">Usage this period</CardTitle>
            <CardDescription>Tracked metrics against your plan limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan?.callMinutesLimit != null && (
              <MetricRow label="Call minutes" used={usage.call_minutes} limit={plan.callMinutesLimit} unit="min" />
            )}
            {plan?.tokenLimit != null && (
              <MetricRow label="LLM tokens" used={usage.llm_tokens} limit={plan.tokenLimit} unit="" />
            )}
            {plan?.toolCallsLimit != null && (
              <MetricRow label="Tool calls" used={usage.tool_calls} limit={plan.toolCallsLimit} unit="" />
            )}
            {(plan?.sttSecondsLimit != null || plan?.ttsSecondsLimit != null) && (
              <>
                {plan?.sttSecondsLimit != null && (
                  <MetricRow label="STT seconds" used={usage.stt_seconds} limit={plan.sttSecondsLimit} unit="sec" />
                )}
                {plan?.ttsSecondsLimit != null && (
                  <MetricRow label="TTS seconds" used={usage.tts_seconds} limit={plan.ttsSecondsLimit} unit="sec" />
                )}
              </>
            )}
            {!plan && (
              <div className="space-y-3 text-sm text-slate-400">
                <p>Call minutes: {usage.call_minutes.toLocaleString()} min</p>
                <p>LLM tokens: {usage.llm_tokens.toLocaleString()}</p>
                <p>STT seconds: {usage.stt_seconds.toLocaleString()} s</p>
                <p>TTS seconds: {usage.tts_seconds.toLocaleString()} s</p>
                <p>Tool calls: {usage.tool_calls.toLocaleString()}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
