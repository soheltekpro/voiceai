/**
 * Provider models/voices API – fetches available models from provider APIs
 * with 5-minute cache. Used by agent configuration UI.
 * Applies voice-capability filtering so only models suitable for voice agents are returned.
 */

import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type ModelItem = { id: string; name: string };

const cache = new Map<string, { items: ModelItem[]; expires: number }>();

/** Separate cache for TTS voices endpoint (key: tts_voices_<provider>). */
const ttsVoicesCache = new Map<string, { voices: ModelItem[]; expires: number }>();

function getCached(provider: string, type: string): ModelItem[] | null {
  const key = `${provider}:${type}`;
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.items;
}

function setCache(provider: string, type: string, items: ModelItem[]): void {
  cache.set(`${provider}:${type}`, { items, expires: Date.now() + CACHE_TTL_MS });
}

function getTtsVoicesCached(provider: string): ModelItem[] | null {
  const key = `tts_voices_${provider.toLowerCase()}`;
  const entry = ttsVoicesCache.get(key);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.voices;
}

function setTtsVoicesCache(provider: string, voices: ModelItem[]): void {
  ttsVoicesCache.set(`tts_voices_${provider.toLowerCase()}`, { voices, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Voice-capable LLM: must support streaming for real-time voice.
 * Gemini: require generateContent and generateContentStream (case-insensitive).
 */
function isGeminiVoiceCapable(supported: string[]): boolean {
  const lower = supported.map((s) => s.toLowerCase());
  return (
    lower.includes('generatecontent') &&
    lower.includes('generatecontentstream')
  );
}

/**
 * OpenAI model IDs that are chat-capable and support streaming (suitable for voice).
 * Excludes embedding, deprecated, and non-streaming models.
 */
const OPENAI_VOICE_CHAT_PREFIXES = [
  'gpt-4o',      // gpt-4o, gpt-4o-mini, gpt-4o-2024-*
  'gpt-4.1',     // gpt-4.1-mini, etc.
  'gpt-4-turbo',
  'gpt-4-1106',
  'gpt-4-0125',
  'gpt-4-0613',
  'gpt-4',
  'gpt-3.5-turbo',
];

function isOpenAIModelVoiceCapable(id: string): boolean {
  if (!id.startsWith('gpt')) return false;
  const lower = id.toLowerCase();
  if (lower.includes('embedding') || lower.includes('vision-preview')) return false;
  return OPENAI_VOICE_CHAT_PREFIXES.some((prefix) => id === prefix || id.startsWith(prefix + '-'));
}

/** Google Gemini – list models that support streaming (voice-suitable); fallback to generateContent if none have stream */
async function fetchGoogleModels(): Promise<ModelItem[]> {
  const key = config.google.apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
  if (!key) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  const models = data.models ?? [];
  const out: ModelItem[] = [];
  const fallback: ModelItem[] = [];
  for (const m of models) {
    const supported = m.supportedGenerationMethods ?? [];
    const rawName = m.name ?? '';
    const id = rawName.replace(/^models\//, '');
    if (!id) continue;
    const name = id
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
    const item = { id, name };
    if (isGeminiVoiceCapable(supported)) {
      out.push(item);
    } else if (supported.some((s) => s.toLowerCase() === 'generatecontent')) {
      fallback.push(item);
    }
  }
  const result = out.length > 0 ? out : fallback;
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/** OpenAI – list chat models that are voice-capable (streaming, chat, no embedding/vision-only) */
async function fetchOpenAIModels(): Promise<ModelItem[]> {
  const key = config.openai.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
  if (!key) return [];
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const list = data.data ?? [];
  const out: ModelItem[] = [];
  for (const m of list) {
    const id = m.id ?? '';
    if (!isOpenAIModelVoiceCapable(id)) continue;
    const name = id.replace(/^gpt-/, 'GPT-').replace(/-/g, ' ');
    out.push({ id, name });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Anthropic – no public list API; maintained list (chat/streaming, voice-suitable) */
const ANTHROPIC_MODELS: ModelItem[] = [
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
  { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
];

/** Deepgram STT – maintained list (all voice-suitable) */
const DEEPGRAM_MODELS: ModelItem[] = [
  { id: 'nova-2', name: 'Nova 2' },
  { id: 'nova', name: 'Nova' },
  { id: 'nova-3', name: 'Nova 3' },
  { id: 'enhanced', name: 'Enhanced' },
];

/** AssemblyAI STT */
const ASSEMBLYAI_MODELS: ModelItem[] = [{ id: 'default', name: 'Default' }];

/** OpenAI STT */
const OPENAI_STT_MODELS: ModelItem[] = [{ id: 'whisper-1', name: 'Whisper 1' }];

/** OpenAI TTS voices */
const OPENAI_TTS_VOICES: ModelItem[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
];

/** Result of fetching ElevenLabs voices: list + optional error for UI. */
type ElevenLabsVoicesResult = { voices: ModelItem[]; error?: string };

/** ElevenLabs – list voices from API (GET https://api.elevenlabs.io/v1/voices) */
async function fetchElevenLabsVoices(): Promise<ElevenLabsVoicesResult> {
  const key = (config.elevenlabs.apiKey ?? process.env['ELEVENLABS_API_KEY'] ?? '').trim();
  if (!key) {
    console.warn('[tts] ElevenLabs voices: ELEVENLABS_API_KEY is missing or empty. Set it in backend/.env');
    return {
      voices: [],
      error: 'ELEVENLABS_API_KEY is not set. Add ELEVENLABS_API_KEY=your_key to backend/.env and restart the server.',
    };
  }
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  });
  const raw = await res.text();
  if (!res.ok) {
    console.warn('[tts] ElevenLabs voices API error', { status: res.status, statusText: res.statusText, body: raw.slice(0, 300) });
    const hint = res.status === 401 || res.status === 403
      ? ' Check that ELEVENLABS_API_KEY in backend/.env is correct and has not expired.'
      : '';
    return {
      voices: [],
      error: `ElevenLabs API error (${res.status}).${hint}`,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn('[tts] ElevenLabs voices: invalid JSON response', { body: raw.slice(0, 200) });
    return { voices: [], error: 'Invalid response from ElevenLabs API.' };
  }

  const obj = data as Record<string, unknown>;
  let voices: Array<Record<string, unknown>> = [];
  if (Array.isArray(obj.voices)) {
    voices = obj.voices as Array<Record<string, unknown>>;
  } else if (Array.isArray(data)) {
    voices = data as Array<Record<string, unknown>>;
  }

  const out = voices.map((v) => {
    const id = (v.voice_id ?? v.voiceId ?? '') as string;
    const name = (v.name ?? id ?? 'Unknown') as string;
    return { id: String(id), name: String(name) };
  }).filter((v) => v.id);

  if (out.length === 0 && voices.length > 0) {
    console.warn('[tts] ElevenLabs voices: no voice_id in items; first item keys', {
      keys: Object.keys(voices[0] ?? {}),
    });
  }
  return { voices: out };
}

/** PlayHT TTS – no public list in task; maintained list */
const PLAYHT_VOICES: ModelItem[] = [
  { id: 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json', name: 'Female (CS)' },
];

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { provider: string };
    Querystring: { type?: string };
  }>('/providers/:provider/models', async (req, reply) => {
    const provider = (req.params.provider ?? '').toLowerCase().trim();
    const type = ((req.query as { type?: string }).type ?? 'llm').toLowerCase().trim() as 'llm' | 'stt' | 'tts';

    const cached = getCached(provider, type);
    if (cached !== null) {
      console.info('[providers] models loaded (cached)', { provider, type, count: cached.length });
      return reply.send({ models: cached });
    }

    let items: ModelItem[];

    switch (provider) {
      case 'google':
        items = type === 'llm' ? await fetchGoogleModels() : [];
        break;
      case 'openai':
        if (type === 'llm') items = await fetchOpenAIModels();
        else if (type === 'stt') items = OPENAI_STT_MODELS;
        else if (type === 'tts') items = OPENAI_TTS_VOICES;
        else items = await fetchOpenAIModels();
        break;
      case 'anthropic':
        items = type === 'llm' ? ANTHROPIC_MODELS : [];
        break;
      case 'deepgram':
        items = type === 'stt' ? DEEPGRAM_MODELS : [];
        break;
      case 'assemblyai':
        items = type === 'stt' ? ASSEMBLYAI_MODELS : [];
        break;
      case 'elevenlabs':
        if (type === 'tts') {
          const elevenResult = await fetchElevenLabsVoices();
          items = elevenResult.voices;
        } else {
          items = [];
        }
        break;
      case 'playht':
        items = type === 'tts' ? PLAYHT_VOICES : [];
        break;
      default:
        return reply.status(400).send({ error: 'Unknown provider', provider });
    }

    setCache(provider, type, items);
    console.info('[providers] models loaded', { provider, type, count: items.length, voiceCapabilityFilter: type === 'llm' });
    return reply.send({ models: items });
  });

  /** GET /providers/tts/voices?provider=elevenlabs – fetch TTS voices (ElevenLabs from API), 5-min cache. */
  app.get<{
    Querystring: { provider?: string };
  }>('/providers/tts/voices', async (req, reply) => {
    const provider = ((req.query as { provider?: string }).provider ?? '').toLowerCase().trim();
    if (provider !== 'elevenlabs') {
      return reply.status(400).send({ error: 'Only provider=elevenlabs is supported for TTS voices' });
    }

    const cached = getTtsVoicesCached(provider);
    if (cached !== null) {
      console.info('[tts] voices loaded', { provider: 'elevenlabs', count: cached.length, cached: true });
      return reply.send({ voices: cached });
    }

    const result = await fetchElevenLabsVoices();
    setTtsVoicesCache(provider, result.voices);
    console.info('[tts] voices loaded', { provider: 'elevenlabs', count: result.voices.length });
    const payload: { voices: ModelItem[]; error?: string } = { voices: result.voices };
    if (result.error) payload.error = result.error;
    else if (result.voices.length === 0) {
      payload.error = 'No voices returned. Set ELEVENLABS_API_KEY in backend/.env and ensure the key is valid.';
    }
    return reply.send(payload);
  });
}
