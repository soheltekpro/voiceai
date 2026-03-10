import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import {
  getBillingStatus,
  subscribeBilling,
  cancelBilling,
  type BillingStatusResponse,
} from '../../api/billing';
import { CreditCard, Receipt, TrendingUp, ArrowUpCircle, XCircle } from 'lucide-react';

function MetricRow({
  label,
  used,
  unit,
}: {
  label: string;
  used: number;
  unit: string;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">
        {used.toLocaleString()} {unit}
      </span>
    </div>
  );
}

const PLANS = [
  { id: 'starter', name: 'Starter', description: 'For small projects' },
  { id: 'pro', name: 'Pro', description: 'For growing teams' },
  { id: 'enterprise', name: 'Enterprise', description: 'Unlimited usage' },
];

export function BillingPage() {
  const [data, setData] = useState<BillingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getBillingStatus();
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

  const handleSubscribe = useCallback(
    async (planId: string) => {
      setActionLoading(planId);
      setError(null);
      try {
        await subscribeBilling(planId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Subscribe failed');
      } finally {
        setActionLoading(null);
      }
    },
    [load]
  );

  const handleCancel = useCallback(
    async (immediately: boolean) => {
      setActionLoading('cancel');
      setError(null);
      try {
        await cancelBilling(immediately);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Cancel failed');
      } finally {
        setActionLoading(null);
      }
    },
    [load]
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  const plan = data?.plan ?? null;
  const nextInvoice = data?.nextInvoice ?? null;
  const subscription = data?.subscription ?? null;
  const usage = data?.usage ?? {
    call_minutes: 0,
    llm_tokens: 0,
    stt_seconds: 0,
    tts_seconds: 0,
    tool_calls: 0,
    callMinutesUsed: 0,
    llmTokensUsed: 0,
    ttsCharsUsed: 0,
  };
  const hasActiveSubscription = plan?.stripeSubscriptionId && subscription?.status === 'active';
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-slate-400">
          Manage your plan, view usage, and upgrade or downgrade.
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
                  <span className="text-slate-400"> — {plan.status}</span>
                  {cancelAtPeriodEnd && (
                    <span className="block mt-1 text-amber-400">Canceling at period end</span>
                  )}
                </>
              ) : (
                'No subscription — usage-based billing when you subscribe'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasActiveSubscription && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-600 text-slate-200"
                  onClick={() => handleCancel(false)}
                  disabled={!!actionLoading}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Cancel at period end
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-800 text-red-300"
                  onClick={() => handleCancel(true)}
                  disabled={!!actionLoading}
                >
                  Cancel immediately
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-slate-400" />
              <CardTitle className="text-white">Next invoice</CardTitle>
            </div>
            <CardDescription>Estimated amount for the current period</CardDescription>
          </CardHeader>
          <CardContent>
            {nextInvoice ? (
              <div className="space-y-1 text-sm">
                {nextInvoice.amountDue != null && (
                  <p className="text-white font-medium">
                    {nextInvoice.currency?.toUpperCase() ?? 'USD'} {(nextInvoice.amountDue ?? 0).toFixed(2)}
                  </p>
                )}
                {nextInvoice.periodEnd && (
                  <p className="text-slate-400">Period end: {new Date(nextInvoice.periodEnd).toLocaleDateString()}</p>
                )}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No upcoming invoice</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-white">Usage this period</CardTitle>
          </div>
          <CardDescription>Voice and API usage for billing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <MetricRow label="Call minutes" used={usage.callMinutesUsed ?? usage.call_minutes} unit="min" />
          <MetricRow label="LLM tokens" used={usage.llmTokensUsed ?? usage.llm_tokens} unit="" />
          <MetricRow label="TTS characters" used={usage.ttsCharsUsed} unit="" />
          <MetricRow label="STT seconds" used={usage.stt_seconds} unit="s" />
          <MetricRow label="TTS seconds" used={usage.tts_seconds} unit="s" />
          <MetricRow label="Tool calls" used={usage.tool_calls} unit="" />
        </CardContent>
      </Card>
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Upgrade or downgrade</CardTitle>
          <CardDescription>Choose a plan. Subscribing creates a Stripe subscription; usage is reported at period end.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {PLANS.map((p) => {
              const isCurrent = plan?.name?.toLowerCase() === p.id;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 flex flex-col gap-2"
                >
                  <div>
                    <p className="font-medium text-white">{p.name}</p>
                    <p className="text-sm text-slate-400">{p.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isCurrent ? 'secondary' : 'default'}
                    disabled={isCurrent || !!actionLoading}
                    onClick={() => handleSubscribe(p.id)}
                  >
                    {actionLoading === p.id ? 'Processing…' : isCurrent ? 'Current plan' : (
                      <>
                        <ArrowUpCircle className="h-4 w-4 mr-1" />
                        {plan ? 'Switch' : 'Subscribe'}
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
