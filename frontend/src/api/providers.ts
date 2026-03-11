import { apiGet } from './client';

export type ProviderModel = { id: string; name: string };

export type ProviderModelsResponse = { models: ProviderModel[] };

export type TtsVoicesResponse = { voices: ProviderModel[]; error?: string };

/**
 * Fetch available models/voices for a provider. Used by agent config UI.
 * type: 'llm' | 'stt' | 'tts' – determines which list the backend returns (e.g. OpenAI has different lists).
 */
export async function fetchProviderModels(
  provider: string,
  type: 'llm' | 'stt' | 'tts'
): Promise<ProviderModel[]> {
  const p = encodeURIComponent(provider);
  const t = encodeURIComponent(type);
  const res = await apiGet<ProviderModelsResponse>(`/api/v1/providers/${p}/models?type=${t}`);
  return res.models ?? [];
}

/**
 * Fetch TTS voices from the dedicated voices endpoint (e.g. ElevenLabs from API).
 * Use when provider is "elevenlabs" so the Voice dropdown is populated dynamically.
 * Returns { voices, error? } so the UI can show a message when no voices are returned.
 */
export async function fetchTtsVoices(provider: string): Promise<{ voices: ProviderModel[]; error?: string }> {
  const p = encodeURIComponent(provider);
  const res = await apiGet<TtsVoicesResponse>(`/api/v1/providers/tts/voices?provider=${p}`);
  return { voices: res.voices ?? [], error: res.error };
}

export type V2VModelsResponse = { models: ProviderModel[]; voices: ProviderModel[] };

/**
 * Fetch V2V (realtime voice) models and voices for a provider. Used by agent config for V2V agents.
 * provider: 'openai' | 'google'
 */
export async function fetchV2VModels(provider: string): Promise<V2VModelsResponse> {
  const p = encodeURIComponent(provider);
  const res = await apiGet<V2VModelsResponse>(`/api/v1/providers/v2v/models?provider=${p}`);
  return { models: res.models ?? [], voices: res.voices ?? [] };
}
