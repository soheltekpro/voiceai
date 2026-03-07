import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema } from '../schemas.js';

const CreatePhoneNumberSchema = z.object({
  number: z.string().min(1).max(32),
  provider: z.string().min(1).max(64),
  sipTrunkId: z.string().uuid(),
  agentId: z.string().uuid().optional().nullable(),
});

export async function registerPhoneNumberRoutes(app: FastifyInstance): Promise<void> {
  app.post('/phone-numbers', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = CreatePhoneNumberSchema.parse(req.body);
    const trunk = await prisma.sipTrunk.findFirst({ where: { id: body.sipTrunkId, workspaceId } });
    if (!trunk) return reply.code(404).send({ message: 'SIP trunk not found' });
    const phone = await prisma.phoneNumber.create({
      data: {
        workspaceId,
        number: body.number,
        provider: body.provider,
        sipTrunkId: body.sipTrunkId,
        agentId: body.agentId ?? null,
      },
      include: { sipTrunk: true, agent: { select: { id: true, name: true } } },
    });
    return reply.code(201).send(phone);
  });

  app.get('/phone-numbers', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const Query = PaginationSchema.extend({
      sipTrunkId: z.string().uuid().optional(),
      agentId: z.string().uuid().optional(),
    });
    const { limit, offset, sipTrunkId, agentId } = Query.parse(req.query);
    const where: Record<string, unknown> = { workspaceId };
    if (sipTrunkId) where.sipTrunkId = sipTrunkId;
    if (agentId) where.agentId = agentId;
    const [items, total] = await Promise.all([
      prisma.phoneNumber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { sipTrunk: true, agent: { select: { id: true, name: true } } },
      }),
      prisma.phoneNumber.count({ where }),
    ]);
    return { items, total, limit, offset };
  });
}
