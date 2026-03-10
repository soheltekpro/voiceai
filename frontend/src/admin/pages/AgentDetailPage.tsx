import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Phone, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { apiGet, apiPatch, apiPut } from '../../api/client';
import { fetchTools, fetchAgentTools, setAgentTools } from '../../api/tools';
import { fetchKnowledgeBases } from '../../api/knowledge-bases';
import {
  fetchPromptOptimizations,
  generatePromptOptimization,
  type PromptOptimizationItem,
  fetchPromptVersions,
  fetchPromptPerformance,
  createPromptVersion as apiCreatePromptVersion,
  updatePromptVersion,
  type PromptVersionItem,
  type PromptPerformanceItem,
} from '../../api/agents';
import type { Tool } from '../../api/tools';
import type { KnowledgeBase } from '../../api/knowledge-bases';
import type { Agent, AgentSettings } from '../types';
import { fetchProviderModels, fetchTtsVoices, type ProviderModel } from '../../api/providers';

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'anthropic', label: 'Anthropic' },
] as const;

const STT_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'assemblyai', label: 'AssemblyAI' },
];

const TTS_PROVIDERS_UI = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'playht', label: 'PlayHT' },
];

function applyVariables(text: string, variables: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(variables)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
  }
  return out;
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left text-sm font-semibold text-slate-200 hover:bg-slate-800/50 transition-colors"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 pt-0 space-y-4">{children}</div>}
    </div>
  );
}

export function AgentDetailPage() {
  const { id } = useParams();
  const agentId = id as string;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [language, setLanguage] = useState('en');
  const [voiceName, setVoiceName] = useState('alloy');
  const [voiceProvider, setVoiceProvider] = useState<'OPENAI' | 'ELEVENLABS'>('OPENAI');
  const [sttProvider, setSttProvider] = useState<string>('openai');
  const [sttModel, setSttModel] = useState<string>('');
  const [llmProvider, setLlmProvider] = useState<string>('openai');
  const [llmModel, setLlmModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [ttsProvider, setTtsProvider] = useState<string>('openai');
  const [ttsVoice, setTtsVoice] = useState<string>('');
  const [sttModels, setSttModels] = useState<ProviderModel[]>([]);
  const [llmModels, setLlmModels] = useState<ProviderModel[]>([]);
  const [ttsVoices, setTtsVoices] = useState<ProviderModel[]>([]);
  const [maxCallDurationSeconds, setMaxCallDurationSeconds] = useState(900);
  const [interruptionBehavior, setInterruptionBehavior] = useState<'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING'>(
    'BARGE_IN_STOP_AGENT'
  );
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null);
  const [introMessage, setIntroMessage] = useState('');
  const [customVariables, setCustomVariables] = useState<Record<string, string>>({});
  const [variableKey, setVariableKey] = useState('');
  const [variableValue, setVariableValue] = useState('');

  const [allTools, setAllTools] = useState<Tool[]>([]);
  const [agentToolIds, setAgentToolIds] = useState<string[]>([]);
  const [savingTools, setSavingTools] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [promptOptimizations, setPromptOptimizations] = useState<PromptOptimizationItem[]>([]);
  const [generatingOptimization, setGeneratingOptimization] = useState(false);
  const [promptVersions, setPromptVersions] = useState<PromptVersionItem[]>([]);
  const [promptPerformance, setPromptPerformance] = useState<PromptPerformanceItem[]>([]);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const loadTools = useCallback(async () => {
    if (!agentId) return;
    try {
      const [toolsRes, agentToolsRes] = await Promise.all([
        fetchTools({ limit: 100 }),
        fetchAgentTools(agentId),
      ]);
      setAllTools(toolsRes.items);
      setAgentToolIds(agentToolsRes.items.map((t) => t.id));
    } catch {
      // ignore
    }
  }, [agentId]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setError(null);
    try {
      const [a, s, kbList] = await Promise.all([
        apiGet<Agent>(`/api/v1/agents/${agentId}`),
        apiGet<AgentSettings & { knowledgeBaseId?: string | null }>(`/api/v1/agents/${agentId}/settings`),
        fetchKnowledgeBases(),
      ]);
      setAgent(a);
      setName(a.name);
      setDescription(a.description ?? '');
      setSystemPrompt(s.systemPrompt ?? '');
      setLanguage(s.language ?? 'en');
      setVoiceName(s.voiceName ?? 'alloy');
      setVoiceProvider(s.voiceProvider ?? 'OPENAI');
      const sttP = (s.sttProvider ?? 'openai').toLowerCase();
      setSttProvider(sttP);
      setSttModel(s.sttModel ?? '');
      const provider = (s.llmProvider ?? 'openai').toLowerCase();
      setLlmProvider(provider);
      setLlmModel(s.llmModel ?? '');
      setTemperature(s.temperature ?? 0.7);
      const ttsP = (s.ttsProvider ?? 'openai').toLowerCase();
      setTtsProvider(ttsP);
      setTtsVoice((s.ttsVoice ?? '') || (s.voiceName ?? ''));
      setMaxCallDurationSeconds(s.maxCallDurationSeconds ?? 900);
      setInterruptionBehavior(s.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT');
      setKnowledgeBaseId(s.knowledgeBaseId ?? null);
      setKnowledgeBases(kbList.items ?? []);
      await loadTools();
      try {
        const [opt, versions, perf] = await Promise.all([
          fetchPromptOptimizations(agentId, 20),
          fetchPromptVersions(agentId),
          fetchPromptPerformance(agentId),
        ]);
        setPromptOptimizations(opt.items ?? []);
        setPromptVersions(versions.items ?? []);
        setPromptPerformance(perf.items ?? []);
      } catch {
        setPromptOptimizations([]);
        setPromptVersions([]);
        setPromptPerformance([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent');
    }
  }, [agentId, loadTools]);

  useEffect(() => {
    if (!agentId) return;
    void load();
  }, [agentId, load]);

  // Fetch STT models when STT provider changes
  useEffect(() => {
    if (!sttProvider) return;
    fetchProviderModels(sttProvider, 'stt')
      .then((models) => {
        setSttModels(models);
        setSttModel((prev) => (prev && models.some((m) => m.id === prev) ? prev : models[0]?.id ?? ''));
      })
      .catch(() => setSttModels([]));
  }, [sttProvider]);

  // Fetch LLM models when LLM provider changes
  useEffect(() => {
    if (!llmProvider) return;
    fetchProviderModels(llmProvider, 'llm')
      .then((models) => {
        setLlmModels(models);
        setLlmModel((prev) => (prev && models.some((m) => m.id === prev) ? prev : models[0]?.id ?? ''));
      })
      .catch(() => setLlmModels([]));
  }, [llmProvider]);

  // Fetch TTS voices when TTS provider changes (ElevenLabs from dedicated voices API, others from models?type=tts)
  useEffect(() => {
    if (!ttsProvider) return;
    if (ttsProvider.toLowerCase() === 'elevenlabs') {
      fetchTtsVoices('elevenlabs')
        .then(({ voices, error }) => {
          setTtsVoices(voices);
          setTtsVoice((prev) => (prev && voices.some((v) => v.id === prev) ? prev : voices[0]?.id ?? ''));
          if (error && voices.length === 0) setError(error);
        })
        .catch((err) => {
          setTtsVoices([]);
          setError(err instanceof Error ? err.message : 'Failed to load ElevenLabs voices');
        });
    } else {
      setError(null);
      fetchProviderModels(ttsProvider, 'tts')
        .then((models) => {
          setTtsVoices(models);
          setTtsVoice((prev) => (prev && models.some((m) => m.id === prev) ? prev : models[0]?.id ?? ''));
        })
        .catch(() => setTtsVoices([]));
    }
  }, [ttsProvider]);

  const saveAgentTools = async () => {
    if (!agentId) return;
    setSavingTools(true);
    try {
      await setAgentTools(agentId, agentToolIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save tools');
    } finally {
      setSavingTools(false);
    }
  };

  const save = async () => {
    if (!agentId) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch<Agent>(`/api/v1/agents/${agentId}`, {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
      });
      await apiPut<AgentSettings>(`/api/v1/agents/${agentId}/settings`, {
        systemPrompt: systemPrompt.trim() || 'You are a helpful voice assistant.',
        language,
        voiceName,
        voiceProvider,
        sttProvider: sttProvider || null,
        sttModel: sttModel.trim() || null,
        llmProvider: llmProvider || null,
        llmModel: llmModel.trim() || null,
        temperature,
        ttsProvider: ttsProvider || null,
        ttsVoice: ttsVoice.trim() || null,
        maxCallDurationSeconds,
        interruptionBehavior,
        knowledgeBaseId: knowledgeBaseId || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addVariable = () => {
    const k = variableKey.trim();
    if (!k) return;
    setCustomVariables((prev) => ({ ...prev, [k]: variableValue.trim() }));
    setVariableKey('');
    setVariableValue('');
  };

  const removeVariable = (key: string) => {
    setCustomVariables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const previewText = applyVariables(systemPrompt, customVariables);

  if (!agentId) {
    return (
      <div className="p-6">
        <p className="text-slate-400">Missing agent ID.</p>
        <Link to="/admin/agents" className="text-sm text-emerald-400 hover:underline mt-2 inline-block">
          ← Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Breadcrumb */}
        <Link to="/admin/agents" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
          ← Agents
        </Link>

        {/* Header: Name, Status, Place Call, Save */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-2xl font-semibold bg-transparent border-b border-slate-700 hover:border-slate-600 focus:border-emerald-500 focus:outline-none px-0 py-1 min-w-[200px]"
              placeholder="Agent name"
            />
            {agent && (
              <>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    agent.agentType === 'V2V'
                      ? 'bg-blue-500/20 text-blue-200'
                      : 'bg-emerald-500/20 text-emerald-200'
                  }`}
                >
                  {agent.agentType === 'V2V' ? 'V2V' : 'Pipeline'}
                </span>
                <span className="text-xs text-slate-500">
                  Active
                </span>
                {agent.updatedAt && (
                  <span className="text-xs text-slate-500">
                    Updated {new Date(agent.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/web-call"
              state={{ agentId }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
            >
              <Phone className="h-4 w-4" />
              Place Call
            </Link>
            <button
              type="button"
              onClick={save}
              disabled={saving || !agent}
              className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Two-column layout: 2fr 1fr on large screens, stack on small */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
          {/* Left column */}
          <div className="space-y-6">
            {/* System Prompt */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">System prompt</h2>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full min-h-[420px] max-h-[500px] rounded-lg bg-slate-950 border border-slate-800 px-4 py-3 text-sm font-mono text-slate-200 placeholder-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none resize-y"
                placeholder="You are a helpful voice assistant. Speak clearly and concisely..."
                spellCheck={false}
              />
              <p className="mt-2 text-xs text-slate-500">
                Optimize for spoken conversation. Use variables like {'{{name}}'} and add them in the right panel.
              </p>
            </div>

            {/* Preview with Variables */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">Preview with variables</h2>
              <div className="min-h-[120px] max-h-[200px] overflow-y-auto rounded-lg bg-slate-950 border border-slate-800 p-4 text-sm font-mono text-slate-300 whitespace-pre-wrap">
                {previewText || <span className="text-slate-500">Enter a system prompt to see the preview.</span>}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <Section title="Voice settings" defaultOpen={true}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description of this agent"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>
                {agent?.agentType === 'PIPELINE' && (
                  <>
                    <div className="border-t border-slate-800 pt-4">
                      <h3 className="text-xs font-semibold text-slate-400 mb-2">Speech to Text</h3>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">STT Provider</label>
                          <select
                            value={sttProvider}
                            onChange={(e) => {
                              const next = e.target.value;
                              setSttProvider(next);
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {STT_PROVIDERS.map((p) => (
                              <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">STT Model</label>
                          <select
                            value={sttModel || (sttModels[0]?.id ?? '')}
                            onChange={(e) => setSttModel(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {sttModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-slate-800 pt-4">
                      <h3 className="text-xs font-semibold text-slate-400 mb-2">Language Model</h3>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">LLM Provider</label>
                          <select
                            value={llmProvider}
                            onChange={(e) => {
                              const next = e.target.value;
                              setLlmProvider(next);
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {LLM_PROVIDERS.map((p) => (
                              <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">Model</label>
                          <select
                            value={llmModel || (llmModels[0]?.id ?? '')}
                            onChange={(e) => setLlmModel(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {llmModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">Temperature ({temperature})</label>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={temperature}
                            onChange={(e) => setTemperature(parseFloat(e.target.value))}
                            className="w-full h-2 rounded-lg bg-slate-800 accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-slate-800 pt-4">
                      <h3 className="text-xs font-semibold text-slate-400 mb-2">Text to Speech</h3>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">TTS Provider</label>
                          <select
                            value={ttsProvider}
                            onChange={(e) => {
                              const next = e.target.value;
                              setTtsProvider(next);
                              if (next.toLowerCase() !== 'elevenlabs') setTtsVoice('');
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {TTS_PROVIDERS_UI.map((p) => (
                              <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-0.5">Voice</label>
                          <select
                            value={ttsVoice || (ttsVoices[0]?.id ?? voiceName)}
                            onChange={(e) => setTtsVoice(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                          >
                            {ttsVoices.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Language</label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                    placeholder="en"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Max call duration (seconds)</label>
                  <input
                    type="number"
                    value={maxCallDurationSeconds}
                    onChange={(e) => setMaxCallDurationSeconds(parseInt(e.target.value || '900', 10))}
                    min={10}
                    max={86400}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Interruption</label>
                  <select
                    value={interruptionBehavior}
                    onChange={(e) =>
                      setInterruptionBehavior(e.target.value as 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING')
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  >
                    <option value="BARGE_IN_STOP_AGENT">Barge-in stops agent</option>
                    <option value="IGNORE_WHILE_SPEAKING">Ignore while agent speaks</option>
                  </select>
                </div>
              </div>
            </Section>

            <Section title="Custom variables" defaultOpen={true}>
              <p className="text-xs text-slate-500 mb-3">
                Use {'{{key}}'} in your system prompt; values appear in the preview.
              </p>
              <div className="space-y-2">
                {Object.entries(customVariables).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 rounded-lg bg-slate-950/80 px-3 py-2 border border-slate-800">
                    <span className="text-sm font-mono text-slate-300 flex-1 truncate">{k}</span>
                    <span className="text-sm text-slate-400 truncate max-w-[120px]">{v}</span>
                    <button
                      type="button"
                      onClick={() => removeVariable(k)}
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                      aria-label="Remove variable"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  value={variableKey}
                  onChange={(e) => setVariableKey(e.target.value)}
                  placeholder="Key"
                  className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none"
                />
                <input
                  type="text"
                  value={variableValue}
                  onChange={(e) => setVariableValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addVariable}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium text-slate-200"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </Section>

            <Section title="Knowledge base" defaultOpen={true}>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">RAG knowledge base</label>
                <select
                  value={knowledgeBaseId ?? ''}
                  onChange={(e) => setKnowledgeBaseId(e.target.value || null)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                >
                  <option value="">None</option>
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Optional. Enables retrieval-augmented responses for this agent.
                </p>
              </div>
            </Section>

            <Section title="Intro message" defaultOpen={false}>
              <p className="text-xs text-slate-500 mb-3">
                Optional. You can add a greeting or first message in your system prompt above (e.g. “Start by saying: Hello, how can I help?”).
              </p>
              <textarea
                value={introMessage}
                onChange={(e) => setIntroMessage(e.target.value)}
                placeholder="e.g. Hello! How can I help you today?"
                rows={3}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none resize-none"
              />
            </Section>

            <Section title="Tools" defaultOpen={true}>
              <p className="text-xs text-slate-500 mb-3">
                Assign tools for the LLM to call during the conversation.
              </p>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {allTools.length === 0 ? (
                  <p className="text-xs text-slate-500">No tools in workspace. Create tools first.</p>
                ) : (
                  allTools.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-slate-800/50">
                      <input
                        type="checkbox"
                        checked={agentToolIds.includes(t.id)}
                        onChange={(e) => {
                          if (e.target.checked) setAgentToolIds((ids) => [...ids, t.id]);
                          else setAgentToolIds((ids) => ids.filter((id) => id !== t.id));
                        }}
                        className="rounded border-slate-600 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-slate-200">{t.name}</span>
                      <span className="text-xs text-slate-500">({t.type})</span>
                    </label>
                  ))
                )}
              </div>
              {allTools.length > 0 && (
                <button
                  type="button"
                  onClick={saveAgentTools}
                  disabled={savingTools}
                  className="mt-3 w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium text-slate-200 disabled:opacity-50"
                >
                  {savingTools ? 'Saving…' : 'Save tools'}
                </button>
              )}
            </Section>

            <Section title="Prompt Versions" defaultOpen={true}>
              <p className="text-xs text-slate-500 mb-3">
                A/B test system prompts. Active versions receive traffic by <em>Traffic %</em>. Create a version from the current prompt above.
              </p>
              {(promptVersions.length === 0 && !creatingVersion) && (
                <p className="text-xs text-slate-500 mb-3">No versions yet. Create one from your current system prompt to start A/B testing.</p>
              )}
              {promptVersions.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60">
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Version</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Traffic</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Conversion</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Avg Score</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {promptVersions.map((v) => {
                        const perf = promptPerformance.find((p) => p.promptVersionId === v.id);
                        return (
                          <tr key={v.id} className="border-b border-slate-800/80 hover:bg-slate-800/30">
                            <td className="py-2 px-3 text-slate-200 font-mono">v{v.version}</td>
                            <td className="py-2 px-3 text-slate-300">{v.trafficShare}%</td>
                            <td className="py-2 px-3 text-slate-300">{perf?.conversionRate != null ? `${perf.conversionRate}%` : '—'}</td>
                            <td className="py-2 px-3 text-slate-300">{perf?.avgScore != null ? Math.round(perf.avgScore) : '—'}</td>
                            <td className="py-2 px-3">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!agentId) return;
                                  try {
                                    await updatePromptVersion(agentId, v.id, { isActive: !v.isActive });
                                    const [versions, perfRes] = await Promise.all([fetchPromptVersions(agentId), fetchPromptPerformance(agentId)]);
                                    setPromptVersions(versions.items ?? []);
                                    setPromptPerformance(perfRes.items ?? []);
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Failed to update');
                                  }
                                }}
                                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${v.isActive ? 'bg-emerald-600/80 text-white' : 'bg-slate-700 text-slate-400'}`}
                              >
                                {v.isActive ? 'On' : 'Off'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!agentId || !systemPrompt.trim()) return;
                  setCreatingVersion(true);
                  try {
                    await apiCreatePromptVersion(agentId, { systemPrompt: systemPrompt.trim(), isActive: false, trafficShare: 0 });
                    const [versions, perf] = await Promise.all([fetchPromptVersions(agentId), fetchPromptPerformance(agentId)]);
                    setPromptVersions(versions.items ?? []);
                    setPromptPerformance(perf.items ?? []);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to create version');
                  } finally {
                    setCreatingVersion(false);
                  }
                }}
                disabled={creatingVersion || !systemPrompt.trim()}
                className="mt-3 w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm font-medium text-slate-200"
              >
                {creatingVersion ? 'Creating…' : 'Create version from current prompt'}
              </button>
            </Section>

            <Section title="AI Prompt Suggestions" defaultOpen={true}>
              <p className="text-xs text-slate-500 mb-3">
                Suggestions to improve the system prompt based on past call evaluations (handling objections, clarity, features).
              </p>
              {promptOptimizations.length === 0 ? (
                <p className="text-xs text-slate-500">No suggestions yet. Run a few calls and generate a suggestion from their evaluations.</p>
              ) : (
                <ul className="space-y-3 max-h-48 overflow-y-auto">
                  {promptOptimizations.map((o) => (
                    <li key={o.id} className="rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2">
                      <p className="text-sm text-slate-200 whitespace-pre-wrap">{o.suggestion}</p>
                      <p className="text-xs text-slate-500 mt-1">{new Date(o.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!agentId) return;
                  setGeneratingOptimization(true);
                  try {
                    await generatePromptOptimization(agentId);
                    const opt = await fetchPromptOptimizations(agentId, 20);
                    setPromptOptimizations(opt.items ?? []);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to generate suggestion');
                  } finally {
                    setGeneratingOptimization(false);
                  }
                }}
                disabled={generatingOptimization}
                className="mt-3 w-full py-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-600/80 disabled:opacity-50 text-sm font-medium text-white"
              >
                {generatingOptimization ? 'Generating…' : 'Generate suggestion'}
              </button>
            </Section>
          </div>
        </div>

        {/* Agent ID footer */}
        <div className="text-xs text-slate-500 font-mono pt-2 border-t border-slate-800">
          Agent ID: {agentId}
        </div>
      </div>
    </div>
  );
}
