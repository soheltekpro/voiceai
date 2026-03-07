import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { createRedis } from '../infra/redis.js';
import { prisma } from '../db/prisma.js';
import { embedTexts } from '../services/embeddings.js';

function toVectorLiteral(vec: number[]): string {
  return '[' + vec.join(',') + ']';
}

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const redis = createRedis();

const EmbeddingJobSchema = z.object({
  type: z.literal('document.embed'),
  documentId: z.string().uuid(),
});

new Worker(
  'voiceai-embeddings',
  async (job) => {
    const data = EmbeddingJobSchema.parse(job.data);
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: data.documentId },
      orderBy: { index: 'asc' },
      select: { id: true, content: true },
    });
    if (chunks.length === 0) return { ok: true, embedded: 0 };

    // Compute embeddings for all chunks.
    const embeddings = await embedTexts(chunks.map((c) => c.content));
    if (embeddings.length !== chunks.length) throw new Error('Embedding count mismatch');

    for (let i = 0; i < chunks.length; i++) {
      const vecStr = toVectorLiteral(embeddings[i]);
      await prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = $2::vector WHERE id = $1`,
        chunks[i].id,
        vecStr
      );
    }

    log.info({ documentId: data.documentId, chunkCount: chunks.length }, 'embeddings generated');
    return { ok: true, embedded: chunks.length };
  },
  { connection: redis as any }
);

log.info('embedding-worker running');

