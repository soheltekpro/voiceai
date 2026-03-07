/**
 * Resolve workspace from JWT or API key and attach to request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, findWorkspaceByApiKey } from '../services/auth.js';

export type AuthUser = {
  id: string;
  email: string;
  workspaceId: string;
  role: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    workspaceId?: string;
    user?: AuthUser;
  }
}

export async function requireWorkspaceContext(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!bearer) {
    return reply.code(401).send({ message: 'Missing Authorization: Bearer <token>' });
  }
  const payload = verifyToken(bearer);
  if (payload) {
    req.workspaceId = payload.workspaceId;
    req.user = {
      id: payload.sub,
      email: payload.email,
      workspaceId: payload.workspaceId,
      role: payload.role,
    };
    return;
  }
  const byKey = await findWorkspaceByApiKey(bearer);
  if (byKey) {
    req.workspaceId = byKey.workspaceId;
    return;
  }
  return reply.code(401).send({ message: 'Invalid or expired token' });
}

export function getWorkspaceId(req: FastifyRequest): string {
  const id = req.workspaceId;
  if (!id) throw new Error('Workspace context not set');
  return id;
}
