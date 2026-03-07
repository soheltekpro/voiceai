/**
 * RAG retrieval: embed query and run vector similarity search.
 */

import { prisma } from '../db/prisma.js';
import { embedText } from './embeddings.js';

export type RetrievedChunk = {
  id: string;
  documentId: string;
  content: string;
  index: number;
};

export type RetrievedChunkWithScore = RetrievedChunk & { score: number };

const TOP_K = 5;

/** Format embedding for PostgreSQL vector literal. */
function toVectorLiteral(vec: number[]): string {
  return '[' + vec.join(',') + ']';
}

/**
 * Retrieve top K chunks from a knowledge base by vector similarity.
 */
export async function retrieveChunks(knowledgeBaseId: string, query: string, limit = TOP_K): Promise<RetrievedChunk[]> {
  const withScore = await retrieveChunksWithScore(knowledgeBaseId, query, limit);
  return withScore.map(({ score: _s, ...c }) => c);
}

/**
 * Retrieve top K chunks with similarity score (1 - cosine distance). For API and V2V RAG.
 */
export async function retrieveChunksWithScore(
  knowledgeBaseId: string,
  query: string,
  limit = TOP_K
): Promise<RetrievedChunkWithScore[]> {
  const embedding = await embedText(query);
  const vectorStr = toVectorLiteral(embedding);
  const safeLimit = Math.min(Math.max(1, limit), 20);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; documentId: string; content: string; index: number; distance: number }>
  >(
    `SELECT dc.id, dc."documentId", dc.content, dc."index",
            (dc.embedding <=> $2::vector)::float AS distance
     FROM document_chunks dc
     INNER JOIN documents d ON d.id = dc."documentId"
     WHERE d."knowledgeBaseId" = $1 AND dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $2::vector
     LIMIT ${safeLimit}`,
    knowledgeBaseId,
    vectorStr
  );

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    content: r.content,
    index: r.index,
    score: 1 - r.distance,
  }));
}
