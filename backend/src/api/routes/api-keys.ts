import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { generateApiKey } from '../../services/auth.js';

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(200),
});

export async function registerApiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api-keys', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = CreateApiKeySchema.parse(req.body);
    const { raw, hash } = generateApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        workspaceId,
        name: body.name,
        key: hash,
      },
    });
    return reply.code(201).send({
      id: apiKey.id,
      name: apiKey.name,
      key: raw,
      createdAt: apiKey.createdAt,
      message: 'Save this key; it will not be shown again.',
    });
  });

  app.get('/api-keys', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const items = await prisma.apiKey.findMany({
      where: { workspaceId },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  });

  app.delete('/api-keys/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const deleted = await prisma.apiKey.deleteMany({
      where: { id, workspaceId },
    });
    if (deleted.count === 0) return reply.code(404).send({ message: 'API key not found' });
    return reply.code(204).send();
  });
}
