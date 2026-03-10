/**
 * TTS router: OpenAI, ElevenLabs, PlayHT.
 * Returns audio as base64 string for WebSocket payload (pipeline expects base64).
 * Empty provider defaults to openai.
 */

import { config } from '../config.js';
import { withProviderFailover, getOrderedProviders } from '../providers/provider-failover.js';
import { getFastestProvider, recordLatency } from '../providers/latency-monitor.js';
import { metrics } from '../infra/metrics.js';
import { getCallMetrics, updateCallMetrics } from '../voice/call-analytics.js';
import { Readable } from 'stream';

export type TTSOptions = {
  provider?: string | null;
  voice?: string | null;
  model?: string | null;
  preferredLatency?: 'low' | 'balanced' | 'quality';
  /** Optional call session id for failover metrics. */
  callSessionId?: string | null;
};

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
const OPENAI_TTS_BY_LATENCY = { low: 'tts-1', balanced: 'tts-1', quality: 'tts-1-hd' } as const;

function resolveProvider(provider?: string | null): 'openai' | 'elevenlabs' | 'playht' {
  const p = (provider ?? '').toLowerCase();
  if (p === 'elevenlabs') return 'elevenlabs';
  if (p === 'playht') return 'playht';
  return 'openai';
}

function resolveTtsModel(provider: string, options: TTSOptions): string | undefined {
  const m = (options.model ?? '').trim();
  if (m) return m;
  if (provider === 'openai') {
    const latency = options.preferredLatency ?? config.preferredLatency ?? 'balanced';
    return OPENAI_TTS_BY_LATENCY[latency];
  }
  return undefined;
}

/** Extract status and body from SDK/HTTP errors so we can log and preserve PlayHT errors. */
function getErrorStatusAndBody(err: unknown): { status?: number; body?: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const anyErr = err as { status?: number; statusCode?: number; response?: { status?: number; data?: unknown; body?: string } };
  let status: number | undefined;
  let body: string | undefined;
  if (anyErr?.status != null) status = Number(anyErr.status);
  else if (anyErr?.statusCode != null) status = Number(anyErr.statusCode);
  else if (anyErr?.response?.status != null) status = Number(anyErr.response.status);
  const res = anyErr?.response;
  if (res?.body != null) body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  else if (res?.data != null) body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return { status, body, message };
}

async function synthesizeWithProvider(
  provider: string,
  text: string,
  options: TTSOptions
): Promise<string> {
  const p = resolveProvider(provider);
  const voice = (options.voice ?? '').trim() || undefined;
  const model = resolveTtsModel(p, options);
  if (p === 'openai') return synthesizeOpenAI(text, voice, model);
  if (p === 'elevenlabs') return synthesizeElevenLabs(text, voice);
  if (p === 'playht') return synthesizePlayHT(text, voice);
  return synthesizeOpenAI(text, voice, model);
}

/**
 * Synthesize speech and return base64-encoded audio (MP3) for pipeline compatibility.
 */
export async function synthesizeSpeechByProvider(text: string, options: TTSOptions = {}): Promise<string> {
  if (!text.trim()) return '';
  const fastest = getFastestProvider('TTS');
  const preferred = fastest ?? resolveProvider(options.provider);
  const providers = getOrderedProviders(config.providerFallbacks.tts, preferred);
  return withProviderFailover(
    'TTS',
    providers,
    async (provider) => {
      const start = Date.now();
      const result = await synthesizeWithProvider(provider, text, options);
      recordLatency('TTS', provider, Date.now() - start);
      return result;
    },
    { callSessionId: options.callSessionId }
  );
}

/**
 * Synthesize speech and return a Readable stream of audio chunks (for streaming pipeline).
 */
export function synthesizeSpeechByProviderStream(text: string, options: TTSOptions = {}): Readable {
  if (!text.trim()) return Readable.from([]);
  const provider = resolveProvider(options.provider);
  const voice = (options.voice ?? '').trim() || undefined;
  const model = resolveTtsModel(provider, options);

  if (provider === 'openai') {
    return openAIStream(text, voice, model);
  }
  if (provider === 'elevenlabs') {
    return elevenLabsStream(text, voice);
  }
  if (provider === 'playht') {
    return playHTStream(text, voice);
  }
  return openAIStream(text, voice, model);
}

export type TTSStreamResult = { stream: Readable; cancel: () => void };

function createStreamForProvider(provider: string, text: string, options: TTSOptions): TTSStreamResult {
  const p = resolveProvider(provider);
  const voice = (options.voice ?? '').trim() || undefined;
  const model = resolveTtsModel(p, options);
  let stream: Readable;
  if (p === 'openai') stream = openAIStream(text, voice, model);
  else if (p === 'elevenlabs') stream = elevenLabsStream(text, voice);
  else if (p === 'playht') stream = playHTStream(text, voice);
  else stream = openAIStream(text, voice, model);
  return {
    stream,
    cancel() {
      if (!stream.destroyed) stream.destroy();
    },
  };
}

/**
 * Same as synthesizeSpeechByProviderStream but returns { stream, cancel() } for barge-in.
 * Call cancel() to stop the stream immediately (e.g. on user interrupt).
 * Uses provider failover: if the stream errors, tries next TTS provider.
 */
export function synthesizeSpeechByProviderStreamCancelable(text: string, options: TTSOptions = {}): TTSStreamResult {
  if (!text.trim()) {
    const empty = Readable.from([]);
    return { stream: empty, cancel: () => empty.destroy() };
  }
  // Prefer agent's chosen TTS provider first; when agent chose ElevenLabs/PlayHT, exclude OpenAI from failover to avoid 429 in UI
  const agentPreferred = resolveProvider(options.provider);
  const preferred = (agentPreferred && agentPreferred !== 'openai') ? agentPreferred : (getFastestProvider('TTS') ?? agentPreferred);
  const fallbacks = config.providerFallbacks.tts;
  const fallbacksFiltered =
    agentPreferred && agentPreferred !== 'openai'
      ? (fallbacks as readonly string[]).filter((p) => p.toLowerCase() !== 'openai')
      : fallbacks;
  const providers = getOrderedProviders(fallbacksFiltered, preferred);
  const { stream, cancel } = createTtsFailoverStream(providers, text, options);
  return { stream, cancel };
}

/** Create a Readable that tries each TTS provider in order when the current stream errors. Preserves first error so UI shows original failure (e.g. PlayHT) not fallback (e.g. OpenAI 429). */
function createTtsFailoverStream(
  providers: string[],
  text: string,
  options: TTSOptions
): TTSStreamResult {
  const callSessionId = options.callSessionId;
  const currentRef: { current: TTSStreamResult | null } = { current: null };
  let providerIndex = 0;
  let firstError: Error | null = null;
  let firstFailedProvider: string | null = null;

  const r = new Readable({
    read(this: Readable) {
      if (currentRef.current) return;
      if (providerIndex >= providers.length) return;
      const provider = providers[providerIndex];
      console.info('[voice] TTS creating stream for provider', { provider });
      if (providerIndex > 0) {
        const fromProvider = providers[providerIndex - 1];
        console.warn(
          `[provider-failover] Voice provider failover triggered\ntype: TTS\nfrom: ${fromProvider}\nto: ${provider}`
        );
        metrics.providerFailoversTotal.inc({ type: 'TTS' });
        if (callSessionId) {
          const m = getCallMetrics(callSessionId);
          if (m) updateCallMetrics(callSessionId, { failoverCount: 1 });
        }
      }
      const one = createStreamForProvider(provider, text, options);
      currentRef.current = one;
      const ttsStart = Date.now();
      let firstChunkRecorded = false;
      one.stream.on('data', (chunk: Buffer) => {
        if (!firstChunkRecorded) {
          firstChunkRecorded = true;
          recordLatency('TTS', provider, Date.now() - ttsStart);
        }
        if (!r.destroyed) r.push(chunk);
      });
      one.stream.on('end', () => {
        currentRef.current = null;
        r.push(null);
      });
      one.stream.on('error', (err: Error) => {
        if (!firstError) {
          firstError = err;
          firstFailedProvider = provider;
          console.error(
            `[voice] TTS provider "${provider}" failed (this is the error to fix):`,
            err.message
          );
          if (provider === 'playht') {
            console.error('[voice] PlayHT TTS failed. Check: PLAYHT_API_KEY, PLAYHT_USER_ID, voice id, and PlayHT dashboard for quota/errors.');
          }
          if (provider === 'elevenlabs') {
            console.error('[voice] ElevenLabs TTS failed. Check: ELEVENLABS_API_KEY in backend/.env, and that voice ID exists (e.g. 21m00Tcm4TlvDq8ikWAM).');
          }
        } else {
          console.warn('[voice] TTS provider "%s" also failed:', provider, err.message);
        }
        currentRef.current = null;
        providerIndex++;
        if (providerIndex < providers.length) {
          console.info('[voice] TTS failover: trying next provider:', providers[providerIndex]);
          r.read();
        } else {
          const toThrow = firstError ?? err;
          const displayMessage =
            firstFailedProvider
              ? `TTS (${firstFailedProvider}) failed: ${toThrow.message}`
              : toThrow.message;
          console.error('[voice] TTS all providers failed. User will see:', displayMessage);
          r.destroy(new Error(displayMessage));
        }
      });
    },
  });
  return {
    stream: r,
    cancel() {
      if (currentRef.current) {
        currentRef.current.cancel();
        currentRef.current = null;
      }
      if (!r.destroyed) r.destroy();
    },
  };
}

/** OpenAI: no native stream in current SDK usage; push single chunk. */
function openAIStream(text: string, voiceOverride?: string, modelOverride?: string): Readable {
  const r = new Readable({ read() {} });
  (async () => {
    try {
      const base64 = await synthesizeOpenAI(text, voiceOverride, modelOverride);
      if (base64) r.push(Buffer.from(base64, 'base64'));
    } catch (err) {
      r.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    r.push(null);
  })();
  return r;
}

/** ElevenLabs: wrap async iterator in Readable. Use a known voice ID e.g. 21m00Tcm4TlvDq8ikWAM (Rachel). */
function elevenLabsStream(text: string, voiceIdOverride?: string): Readable {
  const r = new Readable({ read() {} });
  const trimmed = text.trim();
  const voiceId = (voiceIdOverride ?? '').trim() || '21m00Tcm4TlvDq8ikWAM';
  console.info('[voice] ElevenLabs request', { voice: voiceId, textLength: trimmed.length });

  (async () => {
    try {
      const apiKey = config.elevenlabs?.apiKey?.trim();
      if (!apiKey) throw new Error('ELEVENLABS_API_KEY required');
      const { ElevenLabsClient } = await import('elevenlabs');
      const elevenlabs = new ElevenLabsClient({ apiKey });
      const stream = await elevenlabs.textToSpeech.convertAsStream(voiceId, {
        text: trimmed,
        model_id: 'eleven_multilingual_v2',
      });
      console.info('[voice] ElevenLabs status', { streamStarted: true });
      let firstChunk = true;
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        if (chunk && chunk.length > 0) {
          if (firstChunk) {
            firstChunk = false;
            console.info('[voice] ElevenLabs audio received', { bytes: chunk.length });
          }
          r.push(Buffer.from(chunk));
        }
      }
    } catch (err) {
      const { status, body, message } = getErrorStatusAndBody(err);
      const errorBody = body ?? message ?? String(err);
      console.error('[voice] ElevenLabs error', { status: status ?? 'unknown', body: errorBody });
      if (status === 401) {
        console.error(
          `CRITICAL: ElevenLabs API Key invalid or Voice ID ${voiceId} not found. Check ELEVENLABS_API_KEY and that the voice exists in your ElevenLabs dashboard.`
        );
      }
      console.error(
        '[voice] To fix ElevenLabs: set ELEVENLABS_API_KEY in backend/.env; ensure voice ID exists (e.g. 21m00Tcm4TlvDq8ikWAM).'
      );
      r.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    r.push(null);
  })();
  return r;
}

/** PlayHT: ReadableStream → Node Readable. Request uses SDK fields (voiceEngine, outputFormat); REST API uses voice_engine, output_format. */
function playHTStream(text: string, voiceIdOverride?: string): Readable {
  const r = new Readable({ read() {} });
  (async () => {
    const trimmed = text.trim();
    const voiceId = voiceIdOverride ?? 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json';
    console.info('[voice] PlayHT request', { voice: voiceId, textLength: trimmed.length });

    try {
      const apiKey = config.playht?.apiKey?.trim();
      const userId = config.playht?.userId?.trim();
      if (!apiKey || !userId) throw new Error('PLAYHT_API_KEY and PLAYHT_USER_ID required');

      const playht = await import('playht');
      const mod = (playht as { default?: unknown }).default ?? playht;
      const api = mod as { init: (o: object) => void; stream: (t: string, o: object) => Promise<{ getReader: () => ReadableStreamDefaultReader<Uint8Array> }> };
      api.init({ apiKey, userId });
      // Request: text, voice, voice_engine (PlayHT2.0), output_format (mp3) — SDK uses camelCase
      const stream = await api.stream(trimmed, {
        voiceEngine: 'PlayHT2.0',
        voiceId,
        outputFormat: 'mp3',
        sampleRate: 24000,
      });

      console.info('[voice] PlayHT status', { resolved: true });
      const reader = stream.getReader();
      let firstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.info('[voice] PlayHT stream end', { textLength: trimmed.length });
          break;
        }
        if (value && value.length > 0) {
          if (firstChunk) {
            firstChunk = false;
            console.info('[voice] PlayHT audio received', { bytes: value.length });
          }
          r.push(Buffer.from(value));
        }
      }
    } catch (err) {
      const { status, body, message } = getErrorStatusAndBody(err);
      const errorBody = body ?? message ?? String(err);
      console.error('[voice] PlayHT error', { status: status ?? 'unknown', body: errorBody });
      console.error(
        '[voice] To fix PlayHT: set PLAYHT_API_KEY and PLAYHT_USER_ID in backend/.env; check PlayHT dashboard for quota and voice ID.'
      );
      r.destroy(new Error(`PlayHT TTS failed: ${errorBody}`));
      return;
    }
    r.push(null);
  })();
  return r;
}

/** Collect stream to buffer and return base64 */
async function streamToBase64(stream: Readable | AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
  } else {
    for await (const chunk of stream as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('base64');
}

async function synthesizeOpenAI(text: string, voiceOverride?: string, modelOverride?: string): Promise<string> {
  const apiKey = config.openai?.apiKey?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for TTS provider openai. Set it in backend/.env');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const voice = (voiceOverride ?? config.openai.ttsVoice) as (typeof OPENAI_VOICES)[number];
  const model = modelOverride ?? config.openai.ttsModel;
  const response = await openai.audio.speech.create({
    model,
    voice: OPENAI_VOICES.includes(voice as any) ? voice : 'alloy',
    input: text.trim(),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

async function synthesizeElevenLabs(text: string, voiceIdOverride?: string): Promise<string> {
  const apiKey = config.elevenlabs?.apiKey?.trim();
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required for TTS provider elevenlabs. Set it in backend/.env');
  const { ElevenLabsClient } = await import('elevenlabs');
  const elevenlabs = new ElevenLabsClient({ apiKey });
  const voiceId = voiceIdOverride ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel default
  const audioStream = await elevenlabs.textToSpeech.convertAsStream(voiceId, {
    text: text.trim(),
    model_id: 'eleven_multilingual_v2',
  });
  const base64 = await streamToBase64(audioStream as AsyncIterable<Uint8Array>);
  return base64;
}

async function synthesizePlayHT(text: string, voiceIdOverride?: string): Promise<string> {
  const apiKey = config.playht?.apiKey?.trim();
  const userId = config.playht?.userId?.trim();
  if (!apiKey || !userId) {
    throw new Error('PLAYHT_API_KEY and PLAYHT_USER_ID are required for TTS provider playht. Set them in backend/.env');
  }
  const voiceId = voiceIdOverride ?? 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json';
  console.info('[voice] TTS request', { provider: 'playht', voice: voiceId, textLength: text.trim().length });
  try {
    const playht = await import('playht');
    const mod = (playht as { default?: unknown }).default ?? playht;
    const api = mod as { init: (o: { apiKey: string; userId: string }) => void; stream: (t: string, o: object) => Promise<{ getReader: () => ReadableStreamDefaultReader<Uint8Array> }> };
    api.init({ apiKey, userId });
    const stream = await api.stream(text.trim(), {
      voiceEngine: 'PlayHT2.0',
      voiceId,
      outputFormat: 'mp3',
      sampleRate: 24000,
    });
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return Buffer.from(out).toString('base64');
  } catch (err) {
    const { status, body, message } = getErrorStatusAndBody(err);
    console.error('[voice] PlayHT error', { status, body: body ?? message });
    const errorBody = body ?? message;
    throw new Error(`PlayHT TTS failed: ${errorBody}`);
  }
}
