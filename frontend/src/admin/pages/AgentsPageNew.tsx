import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Phone, Pencil, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { fetchAgents, createAgent, deleteAgent } from '../../api/agents';
import { fetchKnowledgeBases } from '../../api/knowledge-bases';
import { fetchTools, setAgentTools } from '../../api/tools';
import type { KnowledgeBase } from '../../api/knowledge-bases';
import type { Tool } from '../../api/tools';
import type { Agent, Paginated } from '../types';

export function AgentsPageNew() {
  const [data, setData] = useState<Paginated<Agent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const res = await fetchAgents({ limit: 100, offset: 0 });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-slate-400 mt-1">Create and manage voice agents (Pipeline or V2V)</p>
        </div>
        <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Create Agent
            </Button>
          </DialogTrigger>
          <AgentBuilderModal onClose={() => setBuilderOpen(false)} onSuccess={load} />
        </Dialog>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items?.length ? (
          data.items.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onDelete={load} onError={setError} />
          ))
        ) : (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bot className="h-12 w-12 text-slate-600 mb-4" />
              <p className="text-slate-400">No agents yet.</p>
              <Button className="mt-4" onClick={() => setBuilderOpen(true)}>
                <Plus className="h-4 w-4" />
                Create your first agent
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onDelete,
  onError,
}: {
  agent: Agent;
  onDelete: () => void;
  onError?: (message: string | null) => void;
}) {
  const isV2V = agent.agentType === 'V2V';
  const features = isV2V
    ? ['Realtime voice', 'LiveKit']
    : [
        agent.settings?.language ?? 'en',
        agent.settings?.voiceName ?? 'alloy',
        agent.settings?.interruptionBehavior === 'BARGE_IN_STOP_AGENT' ? 'Barge-in' : 'No barge-in',
      ];

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg text-white">{agent.name}</CardTitle>
            <CardDescription className="mt-1">
              {agent.description || (isV2V ? 'Realtime voice-to-voice agent' : 'STT → LLM → TTS pipeline')}
            </CardDescription>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isV2V ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {isV2V ? 'V2V' : 'Pipeline'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</p>
          <p className="text-sm text-slate-300">Active</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Features</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {features.map((f) => (
              <li
                key={f}
                className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
        <Separator className="bg-slate-800" />
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/admin/agents/${agent.id}`}>
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button asChild size="sm" className="flex-1">
            <Link to="/admin/web-call" state={{ agentId: agent.id }}>
              <Phone className="h-4 w-4" />
              Call
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm('Delete this agent?')) return;
              try {
                await deleteAgent(agent.id);
                onError?.(null);
                onDelete();
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to delete agent';
                onError?.(msg);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentBuilderModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [agentType, setAgentType] = useState<'PIPELINE' | 'V2V'>('PIPELINE');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personaTemplate, setPersonaTemplate] = useState('support');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful voice assistant.');
  const [language, setLanguage] = useState('en');
  const [voiceName, setVoiceName] = useState('alloy');
  const [sttProvider, setSttProvider] = useState('deepgram');
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [ttsProvider, setTtsProvider] = useState('openai');
  const [vadSensitivity, setVadSensitivity] = useState('medium');
  const [maxDuration, setMaxDuration] = useState(900);
  const [interruptionBehavior, setInterruptionBehavior] = useState<'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING'>('BARGE_IN_STOP_AGENT');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchKnowledgeBases().then((res) => setKnowledgeBases(res.items)).catch(() => {});
  }, []);
  useEffect(() => {
    fetchTools({ limit: 100 }).then((res) => setTools(res.items)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const agent = await createAgent({
        name: name.trim(),
        description: description.trim() || null,
        agentType,
        systemPrompt,
        language,
        voice: voiceName,
        voiceProvider: 'OPENAI',
        sttProvider: agentType === 'PIPELINE' ? sttProvider : null,
        llmProvider: llmModel,
        ttsProvider: agentType === 'PIPELINE' ? ttsProvider : null,
        maxCallDurationSeconds: maxDuration,
        interruptionBehavior,
        knowledgeBaseId: knowledgeBaseId ?? undefined,
      });
      if (selectedToolIds.length > 0) {
        await setAgentTools(agent.id, selectedToolIds);
      }
      onSuccess();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Agent Builder</DialogTitle>
        <DialogDescription>Configure your voice agent. For V2V, STT and TTS are handled by the realtime engine.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 pt-4">
            {/* Agent Type */}
            <div>
              <Label className="text-slate-300">Agent Type</Label>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAgentType('PIPELINE')}
                  className={`flex-1 rounded-lg border p-4 text-left transition-colors ${
                    agentType === 'PIPELINE'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold">Pipeline</div>
                  <div className="text-xs opacity-80">STT → LLM → TTS</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAgentType('V2V')}
                  className={`flex-1 rounded-lg border p-4 text-left transition-colors ${
                    agentType === 'V2V'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold">V2V</div>
                  <div className="text-xs opacity-80">Realtime voice-to-voice</div>
                </button>
              </div>
            </div>

            {/* Persona Template */}
            <div>
              <Label htmlFor="persona">Persona Template</Label>
              <Select value={personaTemplate} onValueChange={setPersonaTemplate}>
                <SelectTrigger id="persona" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="support">Support Agent</SelectItem>
                  <SelectItem value="sales">Sales Agent</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Basic Configuration */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Agent Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Agent"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="desc">Description</Label>
                <Input
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <textarea
                id="systemPrompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="mt-1 flex w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                placeholder="You are a helpful assistant..."
              />
            </div>
          </TabsContent>

          <TabsContent value="voice" className="space-y-4 pt-4">
            {agentType === 'PIPELINE' && (
              <>
                <div>
                  <Label className="text-slate-300">STT (Speech-to-Text)</Label>
                  <Select value={sttProvider} onValueChange={setSttProvider}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deepgram">Deepgram</SelectItem>
                      <SelectItem value="whisper">OpenAI Whisper</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator className="bg-slate-800" />
              </>
            )}

            <div>
              <Label className="text-slate-300">LLM</Label>
              <Select value={llmModel} onValueChange={setLlmModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {agentType === 'PIPELINE' && (
              <>
                <Separator className="bg-slate-800" />
                <div>
                  <Label className="text-slate-300">TTS (Text-to-Speech)</Label>
                  <Select value={ttsProvider} onValueChange={setTtsProvider}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="voiceName">Voice Name</Label>
                  <Input
                    id="voiceName"
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    className="mt-1"
                    placeholder="alloy"
                  />
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 pt-4">
            <div>
              <Label className="text-slate-300">VAD (Voice Activity Detection)</Label>
              <Select value={vadSensitivity} onValueChange={setVadSensitivity}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low sensitivity</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High sensitivity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4 pt-4">
            <div>
              <Label htmlFor="maxDuration">Max Call Duration (seconds)</Label>
              <Input
                id="maxDuration"
                type="number"
                min={60}
                max={3600}
                value={maxDuration}
                onChange={(e) => setMaxDuration(parseInt(e.target.value, 10) || 900)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-slate-300">Interruption Behavior</Label>
              <Select
                value={interruptionBehavior}
                onValueChange={(v: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING') => setInterruptionBehavior(v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BARGE_IN_STOP_AGENT">Barge-in (stop agent when user speaks)</SelectItem>
                  <SelectItem value="IGNORE_WHILE_SPEAKING">Ignore while agent is speaking</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {agentType === 'PIPELINE' && (
              <div>
                <Label htmlFor="language">Language</Label>
                <Input
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1"
                  placeholder="en"
                />
              </div>
            )}
            <div>
              <Label className="text-slate-300">Knowledge Base (RAG)</Label>
              <select
                value={knowledgeBaseId ?? ''}
                onChange={(e) => setKnowledgeBaseId(e.target.value || null)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="">None</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Optional. When set, top chunks are retrieved and added to the LLM context.</p>
            </div>
            <div>
              <Label className="text-slate-300">Tools</Label>
              <p className="mt-1 text-xs text-slate-500 mb-2">When the LLM calls a tool, it will be executed and the result returned to the model. Pipeline agents only.</p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-2 space-y-2">
                {tools.length === 0 ? (
                  <p className="text-xs text-slate-500">No tools defined. Create tools via API or Tools page.</p>
                ) : (
                  tools.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedToolIds.includes(t.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedToolIds((ids) => [...ids, t.id]);
                          else setSelectedToolIds((ids) => ids.filter((id) => id !== t.id));
                        }}
                        className="rounded border-slate-600"
                      />
                      <span className="text-sm text-slate-200">{t.name}</span>
                      <span className="text-xs text-slate-500">({t.type})</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {err && (
          <p className="mt-4 text-sm text-rose-400">{err}</p>
        )}
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create Agent'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
