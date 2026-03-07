import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/team', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const users = await prisma.user.findMany({
      where: { workspaceId },
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { items: users };
  });
}
