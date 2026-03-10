/**
 * Pipeline LLM router: OpenAI, Google (Gemini), or Anthropic (Claude) based on agent settings.
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import { withProviderFailover, getOrderedProviders } from '../providers/provider-failover.js';
import { getFastestProvider, recordLatency } from '../providers/latency-monitor.js';
import type { ChatMessage } from './llm.js';

const VOICE_DEBUG = process.env['VOICE_DEBUG'] === '1' || process.env['LOG_LEVEL'] === 'debug';

export type LLMOptions = {
  provider?: string | null; // "openai" | "google" | "anthropic"
  model?: string | null;
  temperature?: number | null;
  fallbackModel?: string | null; // retry with this if primary fails
  preferredLatency?: 'low' | 'balanced' | 'quality'; // low=fast/small, balanced=default, quality=larger
  /** Optional call session id for failover metrics. */
  callSessionId?: string | null;
};

const OPENAI_BY_LATENCY = { low: 'gpt-4o-mini', balanced: 'gpt-4o-mini', quality: 'gpt-4o' };
const GOOGLE_BY_LATENCY = { low: 'gemini-2.5-flash', balanced: 'gemini-2.5-flash', quality: 'gemini-2.5-pro' };
const ANTHROPIC_BY_LATENCY = { low: 'claude-3-haiku-20240307', balanced: 'claude-3-haiku-20240307', quality: 'claude-3-5-sonnet-20241022' };

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const GOOGLE_DEFAULT_MODEL = 'gemini-2.5-flash';
const ANTHROPIC_DEFAULT_MODEL = 'claude-3-haiku-20240307';

/** Strip markdown-ish formatting from streamed LLM output before TTS. */
function cleanStreamText(raw: string): string {
  let text = raw;
  // Remove backticks used for code or inline formatting
  text = text.replace(/`+/g, '');
  // Remove common markdown emphasis markers
  text = text.replace(/(\*\*|__|\*|_)/g, '');
  // Strip leading heading markers and bullet markers at line starts
  text = text.replace(/^[#>\-\*\+]\s+/gm, '');
  // Collapse multiple spaces created by removals
  text = text.replace(/\s{2,}/g, ' ');
  return text;
}

/** Map legacy Gemini 1.5 model names to current 2.5 models (API v1beta no longer serves 1.5). */
function resolveGeminiModel(model: string): string {
  const m = model.toLowerCase().trim();
  if (m === 'gemini-1.5-flash' || m === 'gemini-1.5-flash-8b') return 'gemini-2.5-flash';
  if (m === 'gemini-1.5-pro' || m.startsWith('gemini-1.5-pro')) return 'gemini-2.5-pro';
  if (m.includes('gemini')) return model.trim();
  return GOOGLE_DEFAULT_MODEL;
}

/** Resolve provider: null/empty = openai. */
function resolveProvider(provider?: string | null): 'openai' | 'google' | 'anthropic' {
  const p = (provider ?? '').toLowerCase();
  if (p === 'google') return 'google';
  if (p === 'anthropic') return 'anthropic';
  return 'openai';
}

/** Resolve model for the current provider. Use agent model only when it matches this provider; otherwise use provider default. */
function resolveModelForProvider(
  provider: 'openai' | 'google' | 'anthropic',
  options: LLMOptions
): string {
  const latency = options.preferredLatency ?? config.preferredLatency ?? 'balanced';
  const agentModel = (options.model ?? '').trim().toLowerCase();
  if (provider === 'google') {
    if (agentModel && agentModel.includes('gemini')) return (options.model ?? '').trim();
    return GOOGLE_BY_LATENCY[latency] || GOOGLE_DEFAULT_MODEL;
  }
  if (provider === 'openai') {
    if (agentModel && (agentModel.startsWith('gpt') || agentModel.includes('o-mini') || agentModel.includes('o-pro'))) return (options.model ?? '').trim();
    return OPENAI_BY_LATENCY[latency] || OPENAI_DEFAULT_MODEL;
  }
  if (provider === 'anthropic') {
    if (agentModel && agentModel.includes('claude')) return (options.model ?? '').trim();
    return ANTHROPIC_BY_LATENCY[latency] || ANTHROPIC_DEFAULT_MODEL;
  }
  return OPENAI_DEFAULT_MODEL;
}

async function chatWithProvider(
  provider: string,
  messages: ChatMessage[],
  options: LLMOptions,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const p = resolveProvider(provider);
  const model = resolveModelForProvider(p, options);
  const fallbackModel = (options.fallbackModel ?? '').trim() || null;
  const temperature = options.temperature != null ? Math.min(2, Math.max(0, options.temperature)) : undefined;

  if (VOICE_DEBUG) console.info('[voice] LLM call', { provider: p, model });

  const run = (useModel: string) => {
    if (p === 'openai') return chatOpenAI(messages, useModel, temperature, onChunk, signal);
    if (p === 'google') return chatGoogle(messages, useModel, temperature, onChunk, signal);
    return chatAnthropic(messages, useModel, temperature, onChunk, signal);
  };

  try {
    return await run(model);
  } catch (err) {
    if (fallbackModel && fallbackModel !== model) {
      try {
        return await run(fallbackModel);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Async generator: yields LLM tokens immediately (streaming) using the configured provider.
 * Use for pipelined streaming (e.g. Gemini generateContentStream → sentence chunker → TTS).
 */
export async function* streamCompletionByProvider(
  messages: ChatMessage[],
  options: LLMOptions,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const agentPreferred = options.provider != null && String(options.provider).trim() !== ''
    ? resolveProvider(options.provider)
    : null;
  const preferred = agentPreferred ?? getFastestProvider('LLM') ?? 'google';
  const p = resolveProvider(preferred);
  const model = resolveModelForProvider(p, options);
  const temperature = options.temperature != null ? Math.min(2, Math.max(0, options.temperature)) : undefined;

  if (p === 'openai') {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    const stream = await openai.chat.completions.create(
      { model, messages, stream: true, max_tokens: 500, ...(temperature != null && { temperature }) },
      { signal }
    );
    for await (const chunk of stream) {
      if (signal?.aborted) return;
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;
      const cleaned = cleanStreamText(content);
      if (cleaned) yield cleaned;
    }
    return;
  }
  if (p === 'google') {
    const apiKey = config.google?.apiKey?.trim();
    if (!apiKey) throw new Error('GOOGLE_API_KEY is required when LLM provider is google.');
    const modelName = resolveGeminiModel(model);
    let systemPrompt = '';
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    for (const m of messages) {
      const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((c) => (c as { text?: string }).text ?? '').join('') : '';
      if (m.role === 'system') {
        systemPrompt = content;
        continue;
      }
      if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: content }] });
      if (m.role === 'assistant') contents.push({ role: 'model', parts: [{ text: content }] });
    }
    if (systemPrompt) {
      systemPrompt +=
        '\n\nOutput must be raw conversational text ONLY. Do NOT use markdown (no **, no __, no #). Do NOT use bullet points or special characters.';
    }
    const systemInstruction = systemPrompt ? { role: 'system' as const, parts: [{ text: systemPrompt }] } : undefined;
    if (contents.length === 0) return;
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const gemini = genAI.getGenerativeModel({
      model: modelName,
      ...(systemInstruction && { systemInstruction }),
      generationConfig: { maxOutputTokens: 500, ...(temperature != null && { temperature }) },
    });
    const last = contents[contents.length - 1];
    const history = contents.slice(0, -1);
    const lastUserText = last.role === 'user' ? last.parts.map((p) => p.text).join('') : '';
    const chat = gemini.startChat({ history: history.length ? history : undefined, ...(systemInstruction && { systemInstruction }) });
    const result = await chat.sendMessageStream(lastUserText || ' ', { signal });
    for await (const chunk of result.stream) {
      if (signal?.aborted) return;
      try {
        const raw = chunk.text();
        const text = raw ? cleanStreamText(raw) : '';
        if (text) yield text;
      } catch {
        /* blocked or no text */
      }
    }
    return;
  }
  if (p === 'anthropic') {
    const apiKey = config.anthropic?.apiKey?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when LLM provider is anthropic.');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    const system = messages.find((m) => m.role === 'system');
    const systemContent = typeof system?.content === 'string' ? system.content : '';
    const chatMessages = messages.filter((m) => m.role !== 'system').map((m) => {
      const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((c) => c.text ?? '').join('') : '';
      return { role: m.role as 'user' | 'assistant', content };
    });
    const tokenQueue: string[] = [];
    let resolveWait: (() => void) | null = null;
    const waitNext = () => new Promise<void>((r) => { resolveWait = r; });
    let streamEnded = false;
    const stream = client.messages.stream({
      model: model.includes('claude') ? model : 'claude-3-haiku-20240307',
      max_tokens: 500,
      system: systemContent,
      messages: chatMessages,
      ...(temperature != null && { temperature }),
    }, { signal });
    stream.on('text', (textDelta: string) => {
      if (textDelta) {
        tokenQueue.push(textDelta);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      }
    });
    void stream.finalText().then(() => {
      streamEnded = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    }).catch(() => {
      streamEnded = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });
    while (!streamEnded || tokenQueue.length > 0) {
      if (signal?.aborted) return;
      if (tokenQueue.length > 0) {
        const delta = tokenQueue.shift()!;
        const cleaned = cleanStreamText(delta);
        if (cleaned) yield cleaned;
      } else {
        await waitNext();
      }
    }
    return;
  }
  // fallback openai
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const stream = await openai.chat.completions.create(
    { model: OPENAI_DEFAULT_MODEL, messages, stream: true, max_tokens: 500, ...(temperature != null && { temperature }) },
    { signal }
  );
  for await (const chunk of stream) {
    if (signal?.aborted) return;
    const content = chunk.choices[0]?.delta?.content;
    if (!content) continue;
    const cleaned = cleanStreamText(content);
    if (cleaned) yield cleaned;
  }
}

/** Stream chat completion using the appropriate provider. Retries with fallback provider on failure. */
export async function chatWithMessagesByProvider(
  messages: ChatMessage[],
  options: LLMOptions,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  // Agent-configured provider takes priority; then latency-based fastest; default to google (openai excluded from fallback list to avoid 429)
  const agentPreferred = options.provider != null && String(options.provider).trim() !== ''
    ? resolveProvider(options.provider)
    : null;
  const preferred = agentPreferred ?? getFastestProvider('LLM') ?? 'google';
  const fallbacks = config.providerFallbacks.llm;
  const providers = getOrderedProviders(fallbacks, preferred);
  console.info('[voice] LLM provider order', { providers, strict: fallbacks });
  return withProviderFailover(
    'LLM',
    providers,
    async (provider) => {
      const start = Date.now();
      const result = await chatWithProvider(provider, messages, options, onChunk, signal);
      const latency = Date.now() - start;
      console.info('[voice] waiting for LLM response', { provider, latency });
      console.info('[voice] LLM output generated', { provider, length: result?.length ?? 0 });
      recordLatency('LLM', provider, latency);
      return result;
    },
    { callSessionId: options.callSessionId }
  );
}

async function chatOpenAI(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const stream = await openai.chat.completions.create(
    {
      model,
      messages,
      stream: true,
      max_tokens: 500,
      ...(temperature != null && { temperature }),
    },
    { signal }
  );
  const parts: string[] = [];
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      parts.push(content);
      onChunk?.(content);
    }
  }
  return parts.join('');
}

async function chatGoogle(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = config.google?.apiKey?.trim();
  if (!apiKey) throw new Error('GOOGLE_API_KEY is required when LLM provider is google. Set it in backend/.env');
  const modelName = resolveGeminiModel(model);
  let systemPrompt = '';
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((c) => (c as { text?: string }).text ?? '').join('') : '';
    if (m.role === 'system') {
      systemPrompt = content;
      continue;
    }
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: content }] });
    if (m.role === 'assistant') contents.push({ role: 'model', parts: [{ text: content }] });
  }
  if (systemPrompt) {
    systemPrompt +=
      '\n\nOutput must be raw conversational text ONLY. Do NOT use markdown (no **, no __, no #). Do NOT use bullet points or special characters.';
  }
  const systemInstruction = systemPrompt
    ? { role: 'system' as const, parts: [{ text: systemPrompt }] }
    : undefined;
  if (VOICE_DEBUG) console.info('[voice] Gemini request', { model: modelName, systemPromptLength: systemPrompt.length });
  if (contents.length === 0) return '';
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const gemini = genAI.getGenerativeModel({
    model: modelName,
    ...(systemInstruction && { systemInstruction }),
    generationConfig: {
      maxOutputTokens: 500,
      ...(temperature != null && { temperature }),
    },
  });
  const last = contents[contents.length - 1];
  const history = contents.slice(0, -1);
  const lastUserText = last.role === 'user' ? last.parts.map((p) => p.text).join('') : '';
  const chat = gemini.startChat({
    history: history.length ? history : undefined,
    ...(systemInstruction && { systemInstruction }),
  });
  const result = await chat.sendMessageStream(lastUserText || ' ', { signal });
  console.info('[voice] Gemini raw response', { hasStream: !!result?.stream });
  const parts: string[] = [];
  for await (const chunk of result.stream) {
    if (signal?.aborted) break;
    try {
      const text = chunk.text();
      if (text) {
        const cleaned = cleanStreamText(text);
        if (!cleaned) continue;
        parts.push(cleaned);
        onChunk?.(cleaned);
      }
    } catch {
      // blocked or no text
    }
  }
  const text = parts.join('');
  console.info('[voice] Gemini response received');
  console.info('[voice] Gemini parsed text', { text, length: text.length });
  return text;
}

async function chatAnthropic(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  onChunk?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = config.anthropic?.apiKey?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when LLM provider is anthropic. Set it in backend/.env');
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });
  const system = messages.find((m) => m.role === 'system');
  const systemContent = typeof system?.content === 'string' ? system.content : '';
  const chatMessages = messages.filter((m) => m.role !== 'system').map((m) => {
    const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((c) => c.text ?? '').join('') : '';
    return { role: m.role as 'user' | 'assistant', content };
  });
  const stream = client.messages.stream({
    model: model.includes('claude') ? model : 'claude-3-haiku-20240307',
    max_tokens: 500,
    system: systemContent,
    messages: chatMessages,
    ...(temperature != null && { temperature }),
  }, { signal });
  if (onChunk) stream.on('text', (textDelta: string) => onChunk(textDelta));
  return stream.finalText();
}
