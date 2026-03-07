import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Phone, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { apiGet, apiPatch, apiPut } from '../../api/client';
import { fetchTools, fetchAgentTools, setAgentTools } from '../../api/tools';
import { fetchKnowledgeBases } from '../../api/knowledge-bases';
import type { Tool } from '../../api/tools';
import type { KnowledgeBase } from '../../api/knowledge-bases';
import type { Agent, AgentSettings } from '../types';

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

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
      setMaxCallDurationSeconds(s.maxCallDurationSeconds ?? 900);
      setInterruptionBehavior(s.interruptionBehavior ?? 'BARGE_IN_STOP_AGENT');
      setKnowledgeBaseId(s.knowledgeBaseId ?? null);
      setKnowledgeBases(kbList.items ?? []);
      await loadTools();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent');
    }
  }, [agentId, loadTools]);

  useEffect(() => {
    if (!agentId) return;
    void load();
  }, [agentId, load]);

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
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Provider</label>
                  <select
                    value={voiceProvider}
                    onChange={(e) => setVoiceProvider(e.target.value as 'OPENAI' | 'ELEVENLABS')}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  >
                    <option value="OPENAI">OpenAI</option>
                    <option value="ELEVENLABS">ElevenLabs</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Voice</label>
                  <select
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                  >
                    {VOICE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
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
