import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Phone, History, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { apiGet } from '../../api/client';
import { fetchAgents } from '../../api/agents';

type AnalyticsSummary = {
  calls: number;
  ended: number;
  active: number;
  error: number;
  totalDurationSeconds: number;
  totalEstimatedCostUsd: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
};

export function DashboardPage() {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [agentCount, setAgentCount] = useState<number>(0);

  useEffect(() => {
    apiGet<AnalyticsSummary>('/api/v1/analytics/summary').then(setAnalytics).catch(() => {});
    fetchAgents({ limit: 1, offset: 0 })
      .then((r) => setAgentCount(r.total ?? 0))
      .catch(() => {});
  }, []);

  const successRate =
    analytics && analytics.calls > 0
      ? Math.round((analytics.ended / analytics.calls) * 100)
      : null;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">Overview of your Voice AI platform</p>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{agentCount}</div>
            <p className="text-xs text-slate-500 mt-1">Pipeline & V2V agents</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{analytics?.calls ?? '—'}</div>
            <p className="text-xs text-slate-500 mt-1">{analytics?.active ?? 0} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Call Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {analytics?.totalDurationSeconds != null
                ? formatDuration(analytics.totalDurationSeconds)
                : '—'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Total across all calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {successRate != null ? `${successRate}%` : '—'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Ended successfully</p>
          </CardContent>
        </Card>
      </div>

      {/* Action cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="hover:border-slate-700 transition-colors">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 mb-2">
              <Bot className="h-6 w-6" />
            </div>
            <CardTitle className="text-white">Create Agent</CardTitle>
            <CardDescription>Create and configure voice agents (Pipeline or V2V).</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link to="/admin/agents">
                New Agent
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-slate-700 transition-colors">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 mb-2">
              <Phone className="h-6 w-6" />
            </div>
            <CardTitle className="text-white">Test Call</CardTitle>
            <CardDescription>Start a test call in the browser with any agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link to="/admin/web-call">
                Web Call
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-slate-700 transition-colors">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 mb-2">
              <History className="h-6 w-6" />
            </div>
            <CardTitle className="text-white">Call History</CardTitle>
            <CardDescription>View call sessions, transcripts, and analytics.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link to="/admin/calls">
                View History
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
