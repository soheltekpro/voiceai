import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { hashPassword, verifyPassword, signToken } from '../../services/auth.js';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  workspaceName: z.string().min(1).max(200),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.code(409).send({ message: 'Email already registered' });
    }
    const passwordHash = await hashPassword(body.password);
    const workspace = await prisma.workspace.create({
      data: { name: body.workspaceName },
    });
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        workspaceId: workspace.id,
        role: 'OWNER',
      },
      select: { id: true, email: true, workspaceId: true, role: true },
    });
    const token = signToken({
      sub: user.id,
      email: user.email,
      workspaceId: user.workspaceId,
      role: user.role,
    });
    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, workspaceId: user.workspaceId, role: user.role },
      workspace: { id: workspace.id, name: workspace.name },
    });
  });

  app.post('/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { workspace: true },
    });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ message: 'Invalid email or password' });
    }
    const token = signToken({
      sub: user.id,
      email: user.email,
      workspaceId: user.workspaceId,
      role: user.role,
    });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, workspaceId: user.workspaceId, role: user.role },
      workspace: { id: user.workspace.id, name: user.workspace.name },
    });
  });
}
