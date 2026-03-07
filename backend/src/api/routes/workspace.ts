import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
});

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workspace', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) return reply.code(404).send({ message: 'Workspace not found' });
    return { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt };
  });

  app.patch('/workspace', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = UpdateWorkspaceSchema.parse(req.body);
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: body.name },
    });
    return { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt };
  });
}
