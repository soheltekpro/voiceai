/**
 * RAG retrieve API for V2V and other consumers. Embed query and return top chunks with score.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getWorkspaceId } from '../auth-context.js';
import { prisma } from '../../db/prisma.js';
import { retrieveChunksWithScore } from '../../services/knowledge-retrieval.js';

const RetrieveSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  query: z.string().min(1).max(10000),
  limit: z.number().int().min(1).max(20).optional().default(5),
});

export async function registerRagRoutes(app: FastifyInstance): Promise<void> {
  app.post('/rag/retrieve', async (req: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = getWorkspaceId(req);
    const body = RetrieveSchema.parse(req.body);

    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: body.knowledgeBaseId, workspaceId },
      select: { id: true },
    });
    if (!kb) {
      return reply.code(404).send({ message: 'Knowledge base not found' });
    }

    const chunksWithScore = await retrieveChunksWithScore(
      body.knowledgeBaseId,
      body.query,
      body.limit
    );

    return reply.send({
      chunks: chunksWithScore.map((c) => ({
        content: c.content,
        documentId: c.documentId,
        score: c.score,
      })),
    });
  });
}
