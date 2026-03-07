/**
 * Generate embeddings via OpenAI for RAG.
 */

import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/** OpenAI text-embedding-3-small dimension */
export const EMBEDDING_DIM = 1536;

export async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.slice(0, 8191),
  });
  const vec = res.data[0]?.embedding;
  if (!vec || vec.length !== EMBEDDING_DIM) throw new Error('Unexpected embedding shape');
  return vec;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: texts.map((t) => t.slice(0, 8191)),
  });
  const byIndex = res.data
    .filter((d) => d.index != null)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return byIndex.map((d) => {
    const vec = d.embedding;
    if (!vec || vec.length !== EMBEDDING_DIM) throw new Error('Unexpected embedding shape');
    return vec;
  });
}
