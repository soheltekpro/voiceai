import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { getUsage, getVoiceUsage, getQuota, getCost, type UsageResponse, type UsageMetrics, type VoiceUsageResponse, type QuotaResponse, type CostResponse } from '../../api/billing';
import { BarChart3, Phone, Cpu, Type, AlertTriangle, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

const QUOTA_WARNING_THRESHOLD = 0.8;

function QuotaBar({
  label,
  used,
  limit,
  unit,
  usedLabel,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  usedLabel: string;
}) {
  const hasLimit = limit != null && limit > 0;
  const pct = hasLimit ? Math.min(1, used / limit) : 0;
  const isWarning = hasLimit && used / limit >= QUOTA_WARNING_THRESHOLD;
  const isExceeded = hasLimit && used >= limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-medium">
          {used.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unit}
          {hasLimit ? ` / ${limit.toLocaleString()} ${usedLabel}` : ' (no limit)'}
        </span>
      </div>
      {hasLimit && (
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isExceeded ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function UsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [voiceData, setVoiceData] = useState<VoiceUsageResponse | null>(null);
  const [quotaData, setQuotaData] = useState<QuotaResponse | null>(null);
  const [costData, setCostData] = useState<CostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [res, voice, quota, cost] = await Promise.all([getUsage(), getVoiceUsage(), getQuota(), getCost()]);
      setData(res);
      setVoiceData(voice);
      setQuotaData(quota);
      setCostData(cost);
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

      {quotaData && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white">Voice quota</CardTitle>
                <CardDescription>
                  {quotaData.plan ? `Plan: ${quotaData.plan}` : 'No plan set — limits are unlimited'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const hasLimit =
                (quotaData.callMinutesLimit != null && quotaData.callMinutesLimit > 0) ||
                (quotaData.llmTokensLimit != null && quotaData.llmTokensLimit > 0) ||
                (quotaData.ttsCharsLimit != null && quotaData.ttsCharsLimit > 0);
              const warnMinutes =
                hasLimit &&
                quotaData.callMinutesLimit != null &&
                quotaData.callMinutesLimit > 0 &&
                quotaData.callMinutesUsed / quotaData.callMinutesLimit >= QUOTA_WARNING_THRESHOLD;
              const warnTokens =
                hasLimit &&
                quotaData.llmTokensLimit != null &&
                quotaData.llmTokensLimit > 0 &&
                quotaData.llmTokensUsed / quotaData.llmTokensLimit >= QUOTA_WARNING_THRESHOLD;
              const warnChars =
                hasLimit &&
                quotaData.ttsCharsLimit != null &&
                quotaData.ttsCharsLimit > 0 &&
                quotaData.ttsCharsUsed / quotaData.ttsCharsLimit >= QUOTA_WARNING_THRESHOLD;
              const showWarning = warnMinutes || warnTokens || warnChars;
              return (
                <>
                  {showWarning && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Usage is above 80% of quota. Consider upgrading or reducing usage.</span>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
                    <QuotaBar
                      label="Call minutes"
                      used={quotaData.callMinutesUsed}
                      limit={quotaData.callMinutesLimit}
                      unit="min"
                      usedLabel="min"
                    />
                    <QuotaBar
                      label="LLM tokens"
                      used={quotaData.llmTokensUsed}
                      limit={quotaData.llmTokensLimit}
                      unit=""
                      usedLabel=""
                    />
                    <QuotaBar
                      label="TTS characters"
                      used={quotaData.ttsCharsUsed}
                      limit={quotaData.ttsCharsLimit}
                      unit=""
                      usedLabel=""
                    />
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {costData && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-slate-400" />
              <CardTitle className="text-white">Voice cost</CardTitle>
            </div>
            <CardDescription>
              Cost from provider pricing (STT per minute, LLM per token, TTS per character). Same period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Monthly cost</h3>
              <p className="text-3xl font-semibold text-white">
                ${costData.workspaceCost.toFixed(4)}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Cost by provider</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">STT</div>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-200">
                    {Object.entries(costData.costBreakdownByProvider.stt).map(([name, val]) => (
                      <li key={name}>{name}: ${val.toFixed(4)}</li>
                    ))}
                    {Object.keys(costData.costBreakdownByProvider.stt).length === 0 && (
                      <li className="text-slate-500">—</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">LLM</div>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-200">
                    {Object.entries(costData.costBreakdownByProvider.llm).map(([name, val]) => (
                      <li key={name}>{name}: ${val.toFixed(4)}</li>
                    ))}
                    {Object.keys(costData.costBreakdownByProvider.llm).length === 0 && (
                      <li className="text-slate-500">—</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">TTS</div>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-200">
                    {Object.entries(costData.costBreakdownByProvider.tts).map(([name, val]) => (
                      <li key={name}>{name}: ${val.toFixed(4)}</li>
                    ))}
                    {Object.keys(costData.costBreakdownByProvider.tts).length === 0 && (
                      <li className="text-slate-500">—</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
            {costData.costPerCall.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">Cost per call</h3>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={costData.costPerCall.slice(0, 30).map((c, i) => ({
                        index: i + 1,
                        callId: c.callId.slice(0, 8),
                        cost: c.totalCost,
                      }))}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="callId" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(v) => `$${v.toFixed(4)}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(4)}`, 'Cost']}
                        labelFormatter={(label) => `Call ${label}`}
                      />
                      <Bar dataKey="cost" fill="#10b981" radius={[4, 4, 0, 0]} name="Cost" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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

      {voiceData && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-slate-400" />
              <CardTitle className="text-white">Voice usage</CardTitle>
            </div>
            <CardDescription>
              Per-call voice metering: call minutes, LLM tokens, TTS characters (same period)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Phone className="h-4 w-4" />
                  Call minutes
                </div>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {voiceData.totalCallMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} min
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Cpu className="h-4 w-4" />
                  LLM tokens
                </div>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {voiceData.totalLLMTokens.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Type className="h-4 w-4" />
                  TTS characters
                </div>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {voiceData.totalTTSCharacters.toLocaleString()}
                </p>
              </div>
            </div>
            {Object.keys(voiceData.providerUsage).length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">Provider usage</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-slate-400">
                        <th className="px-3 py-2">Providers (STT | LLM | TTS)</th>
                        <th className="px-3 py-2">Call min</th>
                        <th className="px-3 py-2">LLM tokens</th>
                        <th className="px-3 py-2">TTS chars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(voiceData.providerUsage).map(([key, u]) => (
                        <tr key={key} className="border-b border-slate-800 text-slate-200">
                          <td className="px-3 py-2 font-mono text-xs">{key.replace(/\|/g, ' | ')}</td>
                          <td className="px-3 py-2">{u.callMinutes.toFixed(2)}</td>
                          <td className="px-3 py-2">{u.llmTokens.toLocaleString()}</td>
                          <td className="px-3 py-2">{u.ttsCharacters.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
