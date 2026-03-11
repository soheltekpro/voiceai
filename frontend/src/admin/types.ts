export type AgentSettings = {
  agentId: string;
  systemPrompt: string;
  language: string;
  voiceProvider: 'OPENAI' | 'ELEVENLABS';
  voiceName: string;
  sttProvider?: string | null;
  sttModel?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  ttsProvider?: string | null;
  ttsVoice?: string | null;
  temperature?: number | null;
  maxCallDurationSeconds: number;
  interruptionBehavior: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING';
  knowledgeBaseId?: string | null;
  v2vProvider?: string | null;
  v2vModel?: string | null;
  v2vVoice?: string | null;
  updatedAt: string;
};

/** Agent schema: id, name, description, agent_type, system_prompt, stt_provider, llm_provider, tts_provider, voice, language, created_at */
export type Agent = {
  id: string;
  name: string;
  description: string | null;
  agentType?: 'PIPELINE' | 'V2V';
  agent_type?: 'PIPELINE' | 'V2V';
  systemPrompt?: string | null;
  system_prompt?: string | null;
  sttProvider?: string | null;
  stt_provider?: string | null;
  llmProvider?: string | null;
  llm_provider?: string | null;
  ttsProvider?: string | null;
  tts_provider?: string | null;
  voice?: string | null;
  voiceName?: string | null;
  language?: string | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  settings?: AgentSettings | null;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CallSession = {
  id: string;
  agentId: string | null;
  clientType: 'BROWSER' | 'PHONE' | 'UNKNOWN';
  status: 'ACTIVE' | 'ENDED' | 'ERROR';
  startedAt: string;
  endedAt: string | null;
  durationSeconds?: number | null;
  userMessageCount?: number;
  assistantMessageCount?: number;
  transcriptText?: string | null;
  estimatedCostUsd?: string | number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  agent?: Agent | null;
};

export type CallEvent = {
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  payload: unknown;
};

export type CallMessage = {
  id: string;
  sessionId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  text: string;
  createdAt: string;
  tokensEstimated?: number | null;
  costUsd?: string | number | null;
};

/** Call (calls table) – used by Call History APIs */
export type Call = {
  id: string;
  agentId: string;
  agentType: string;
  status: 'ACTIVE' | 'ENDED' | 'ERROR';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  tokensUsed: number | null;
  transcript: string | null;
  recordingEnabled?: boolean;
  recordingUrl?: string | null;
  recordingDuration?: number | null;
};

