import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { createOutboundCall } from '../../api/telephony';
import { fetchAgents } from '../../api/agents';
import type { Agent } from '../types';
import { Phone } from 'lucide-react';

export function OutboundCallsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ channelId: string; phoneNumber: string; agentId: string } | null>(null);
  const [calling, setCalling] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetchAgents({ limit: 100 });
      setAgents(res.items ?? []);
      if (!agentId && res.items?.length) setAgentId(res.items[0].id);
    } catch {
      setError('Failed to load agents');
    }
  }, [agentId]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !agentId) return;
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      const res = await createOutboundCall({ phoneNumber: phoneNumber.trim(), agentId });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outbound call failed');
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Outbound Calls</h1>
        <p className="mt-1 text-slate-400">
          Place an outbound call: dial a phone number and connect it to an agent (voice pipeline or realtime).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <p className="font-medium">Call initiated</p>
          <p className="mt-1">Channel: {result.channelId}</p>
          <p>To: {result.phoneNumber} · Agent: {result.agentId}</p>
        </div>
      )}

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Place outbound call
          </CardTitle>
          <CardDescription>
            Requires a SIP trunk and at least one phone number configured. Telephony (Asterisk) must be running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCall} className="space-y-4">
            <div>
              <Label className="text-slate-300">Phone number (to)</Label>
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+14155551234"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-slate-300">Agent</Label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-200"
              >
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.agentType})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={calling || !phoneNumber.trim() || !agentId} className="w-full">
              {calling ? 'Calling…' : 'Place call'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
