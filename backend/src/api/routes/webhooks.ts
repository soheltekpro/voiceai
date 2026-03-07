import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';

const CreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secret: z.string().min(8).optional(),
});

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = CreateSchema.parse(req.body);
    const secret = body.secret ?? randomBytes(32).toString('hex');
    const row = await prisma.webhook.create({
      data: {
        workspaceId,
        url: body.url,
        events: body.events,
        secret,
      },
    });
    // Return secret once (best practice)
    return reply.code(201).send({
      id: row.id,
      url: row.url,
      events: row.events,
      secret,
      createdAt: row.createdAt.toISOString(),
    });
  });

  app.get('/webhooks', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const rows = await prisma.webhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, createdAt: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        events: r.events,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.delete('/webhooks/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const exists = await prisma.webhook.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: 'Webhook not found' });
    await prisma.webhook.delete({ where: { id } });
    return reply.code(204).send();
  });
}

