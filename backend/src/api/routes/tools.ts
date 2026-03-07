/**
 * Tools and agent-tools APIs.
 * POST/GET /api/v1/tools, POST/GET /api/v1/agents/:id/tools
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { PaginationSchema, ToolCreateSchema, AgentToolsSetSchema } from '../schemas.js';

export async function registerToolsRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/v1/tools */
  app.post('/tools', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = ToolCreateSchema.parse(req.body);
    const tool = await prisma.tool.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        type: body.type,
        config: body.config as object,
      },
    });
    return reply.code(201).send({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      type: tool.type,
      config: tool.config,
      createdAt: tool.createdAt.toISOString(),
    });
  });

  /** GET /api/v1/tools */
  app.get('/tools', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const { limit, offset } = PaginationSchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.tool.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.tool.count({ where: { workspaceId } }),
    ]);
    return {
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        type: t.type,
        config: t.config,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  /** GET /api/v1/agents/:id/tools */
  app.get('/agents/:id/tools', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const agentId = (req.params as { id: string }).id;
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      include: { agentTools: { include: { tool: true } } },
    });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    const items = agent.agentTools.map((at) => ({
      id: at.tool.id,
      name: at.tool.name,
      description: at.tool.description,
      type: at.tool.type,
      config: at.tool.config,
      createdAt: at.tool.createdAt.toISOString(),
    }));
    return { items };
  });

  /** POST /api/v1/agents/:id/tools - set tools for agent (replaces existing) */
  app.post('/agents/:id/tools', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const agentId = (req.params as { id: string }).id;
    const body = AgentToolsSetSchema.parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
    if (!agent) return reply.code(404).send({ message: 'Agent not found' });
    await prisma.agentTool.deleteMany({ where: { agentId } });
    if (body.toolIds.length > 0) {
      await prisma.agentTool.createMany({
        data: body.toolIds.map((toolId) => ({ agentId, toolId })),
        skipDuplicates: true,
      });
    }
    const agentTools = await prisma.agentTool.findMany({
      where: { agentId },
      include: { tool: true },
    });
    return {
      items: agentTools.map((at) => ({
        id: at.tool.id,
        name: at.tool.name,
        description: at.tool.description,
        type: at.tool.type,
        config: at.tool.config,
        createdAt: at.tool.createdAt.toISOString(),
      })),
    };
  });
}
