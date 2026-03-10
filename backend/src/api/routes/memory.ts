import type { FastifyInstance } from 'fastify';
import { getWorkspaceId } from '../auth-context.js';
import { prisma } from '../../db/prisma.js';

/** GET /memory/:phoneNumber — conversation memory for this caller (workspace-scoped). */
export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { phoneNumber: string } }>('/memory/:phoneNumber', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const phoneNumber = req.params.phoneNumber?.trim().replace(/\s/g, '') || '';
    if (!phoneNumber) return reply.code(400).send({ message: 'Phone number required' });

    const row = await prisma.voiceConversationMemory.findUnique({
      where: {
        workspaceId_phoneNumber: { workspaceId, phoneNumber },
      },
      select: { summary: true, lastCallId: true, updatedAt: true, createdAt: true },
    });

    if (!row) {
      return {
        summary: null,
        lastCallId: null,
        lastInteraction: null,
      };
    }

    return {
      summary: row.summary,
      lastCallId: row.lastCallId,
      lastInteraction: {
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      },
    };
  });
}
