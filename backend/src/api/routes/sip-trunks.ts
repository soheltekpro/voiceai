import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema } from '../schemas.js';

const CreateSipTrunkSchema = z.object({
  provider: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  config: z.record(z.unknown()),
});

export async function registerSipTrunkRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sip-trunks', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = CreateSipTrunkSchema.parse(req.body);
    const trunk = await prisma.sipTrunk.create({
      data: {
        workspaceId,
        provider: body.provider,
        name: body.name,
        config: body.config as any,
      },
    });
    return reply.code(201).send(trunk);
  });

  app.get('/sip-trunks', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const { limit, offset } = PaginationSchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.sipTrunk.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { _count: { select: { phoneNumbers: true } } },
      }),
      prisma.sipTrunk.count({ where: { workspaceId } }),
    ]);
    return { items, total, limit, offset };
  });
}
