/**
 * Configuration from environment.
 */

import { config as loadEnv } from 'dotenv';

loadEnv();

const getEnv = (key: string, defaultValue?: string): string => {
  const v = process.env[key] ?? defaultValue;
  if (v === undefined) throw new Error(`Missing required env: ${key}`);
  return v;
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return defaultValue;
  return n;
};

export const config = {
  port: getEnvNumber('PORT', 3000),
  host: process.env['HOST'] ?? '0.0.0.0',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  openai: {
    apiKey: process.env['OPENAI_API_KEY'] ?? '',
    sttModel: process.env['STT_MODEL'] ?? 'whisper-1',
    llmModel: process.env['LLM_MODEL'] ?? 'gpt-4o-mini',
    ttsModel: process.env['TTS_MODEL'] ?? 'tts-1',
    ttsVoice: process.env['TTS_VOICE'] ?? 'alloy',
    embeddingModel: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
  },

  /** Deepgram – STT when agent sttProvider is "deepgram" */
  deepgram: {
    apiKey: process.env['DEEPGRAM_API_KEY'] ?? '',
    model: process.env['DEEPGRAM_MODEL'] ?? 'nova-2',
    language: process.env['DEEPGRAM_LANGUAGE'] ?? 'en',
  },

  /** AssemblyAI – STT when agent sttProvider is "assemblyai" */
  assemblyai: {
    apiKey: process.env['ASSEMBLYAI_API_KEY'] ?? '',
  },

  /** ElevenLabs – TTS when agent ttsProvider is "elevenlabs" */
  elevenlabs: {
    apiKey: process.env['ELEVENLABS_API_KEY'] ?? '',
  },

  /** PlayHT – TTS when agent ttsProvider is "playht" */
  playht: {
    apiKey: process.env['PLAYHT_API_KEY'] ?? '',
    userId: process.env['PLAYHT_USER_ID'] ?? '',
  },

  /** Preferred latency: low (fast/small models), balanced, quality (larger models). */
  preferredLatency: (process.env['PREFERRED_LATENCY'] ?? 'balanced') as 'low' | 'balanced' | 'quality',

  /** If true, TTS streams audio chunks instead of one base64 blob. */
  streamingTts: process.env['STREAMING_TTS'] === 'true',

  /** Minimum audio duration (ms) before running STT (batch mode). Use ~1500–2500 so full phrases are captured. */
  minAudioMs: getEnvNumber('MIN_AUDIO_MS', 1800),
  /** Maximum buffer (ms) to avoid huge payloads */
  maxBufferMs: getEnvNumber('MAX_BUFFER_MS', 4000),

  /** Google (Gemini) – used when agent llmProvider is "google" */
  google: {
    apiKey: process.env['GOOGLE_API_KEY'] ?? '',
  },

  /** Anthropic (Claude) – used when agent llmProvider is "anthropic" */
  anthropic: {
    apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  },

  /** JWT secret for auth tokens */
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',

  /** Agent worker pool size (concurrent pipeline runs). */
  agentWorkerPoolSize: getEnvNumber('AGENT_WORKER_POOL_SIZE', 10),

  /** Provider failover order: try these in order when primary fails (STT, LLM, TTS). LLM: google first, anthropic fallback; openai excluded to avoid 429 quota when unused. */
  providerFallbacks: {
    stt: ['deepgram', 'assemblyai', 'openai'],
    llm: ['google', 'anthropic'],
    tts: ['openai', 'elevenlabs', 'playht'],
  } as const,

  /** Multi-region voice: base URLs per region for low-latency routing. */
  voiceRegions: [
    { id: 'us-east', url: 'https://voice-us.example.com' },
    { id: 'eu-west', url: 'https://voice-eu.example.com' },
    { id: 'ap-south', url: 'https://voice-in.example.com' },
  ] as const,
} as const;

export function validateConfig(): void {
  // OPENAI required for default pipeline (STT/TTS) and embeddings; Google/Anthropic optional for LLM
  if (!config.openai.apiKey?.trim()) {
    throw new Error(
      'OPENAI_API_KEY is required (STT/TTS/embeddings). Set it in backend/.env. For LLM-only with Gemini/Claude, set GOOGLE_API_KEY or ANTHROPIC_API_KEY as well.'
    );
  }
}
