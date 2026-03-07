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

  /** Deepgram API key for streaming STT (Phase 2). If set, streaming STT is used. */
  deepgram: {
    apiKey: process.env['DEEPGRAM_API_KEY'] ?? '',
    model: process.env['DEEPGRAM_MODEL'] ?? 'nova-2',
    language: process.env['DEEPGRAM_LANGUAGE'] ?? 'en',
  },

  /** Minimum audio duration (ms) before running STT (batch mode). Use ~1500–2500 so full phrases are captured. */
  minAudioMs: getEnvNumber('MIN_AUDIO_MS', 1800),
  /** Maximum buffer (ms) to avoid huge payloads */
  maxBufferMs: getEnvNumber('MAX_BUFFER_MS', 4000),

  /** JWT secret for auth tokens */
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
} as const;

export function validateConfig(): void {
  if (!config.openai.apiKey?.trim()) {
    throw new Error(
      'OPENAI_API_KEY is required. Set it in .env or environment. See backend/.env.example'
    );
  }
}
