/**
 * Knowledge Base RAG APIs.
 * POST/GET /api/v1/knowledge-bases, upload, documents, DELETE document.
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { prisma } from '../../db/prisma.js';
import { getWorkspaceId } from '../auth-context.js';
import { processUpload } from '../../services/knowledge-base-upload.js';
import { z } from 'zod';

const KnowledgeBaseCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
});

const UploadJsonSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('text'), text: z.string(), name: z.string().optional() }),
  z.object({ sourceType: z.literal('url'), url: z.string().url(), name: z.string().optional() }),
]);

export async function registerKnowledgeBaseRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

  /** POST /api/v1/knowledge-bases */
  app.post('/knowledge-bases', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const body = KnowledgeBaseCreateSchema.parse(req.body);
    const kb = await prisma.knowledgeBase.create({
      data: { workspaceId, name: body.name, description: body.description ?? null },
    });
    return reply.code(201).send({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
    });
  });

  /** DELETE /api/v1/knowledge-bases/:id - Deletes KB and all documents, chunks, embeddings (DB cascade). */
  app.delete('/knowledge-bases/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, workspaceId } });
    if (!kb) return reply.code(404).send({ message: 'Knowledge base not found' });
    await prisma.knowledgeBase.delete({ where: { id } });
    return reply.send({ success: true });
  });

  /** GET /api/v1/knowledge-bases */
  app.get('/knowledge-bases', async (req) => {
    const workspaceId = getWorkspaceId(req);
    const list = await prisma.knowledgeBase.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: list.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        createdAt: kb.createdAt.toISOString(),
        updatedAt: kb.updatedAt.toISOString(),
      })),
    };
  });

  /** POST /api/v1/knowledge-bases/:id/upload - PDF (multipart), or JSON { sourceType: 'text'|'url', ... } */
  app.post('/knowledge-bases/:id/upload', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, workspaceId } });
    if (!kb) return reply.code(404).send({ message: 'Knowledge base not found' });

    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      const body = UploadJsonSchema.parse(req.body);
      const name = body.name ?? (body.sourceType === 'url' ? body.url : 'document');
      if (body.sourceType === 'text') {
        const result = await processUpload(
          id,
          { sourceType: 'text', text: body.text, name },
          req.log
        );
        return reply.code(201).send(result);
      }
      const result = await processUpload(
        id,
        { sourceType: 'url', url: body.url, name },
        req.log
      );
      return reply.code(201).send(result);
    }

    const data = await req.file();
    if (!data) return reply.code(400).send({ message: 'Expected multipart file or JSON body' });

    const buf = await data.toBuffer();
    const mimetype = data.mimetype ?? '';
    const name = data.filename || 'document.pdf';
    if (!mimetype.includes('pdf')) {
      return reply.code(400).send({ message: 'File must be application/pdf' });
    }

    const result = await processUpload(
      id,
      { sourceType: 'pdf', buffer: buf, name },
      req.log
    );
    return reply.code(201).send(result);
  });

  /** GET /api/v1/knowledge-bases/:id/documents */
  app.get('/knowledge-bases/:id/documents', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, workspaceId } });
    if (!kb) return reply.code(404).send({ message: 'Knowledge base not found' });

    const docs = await prisma.document.findMany({
      where: { knowledgeBaseId: id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
    return {
      items: docs.map((d) => ({
        id: d.id,
        name: d.name,
        sourceType: d.sourceType,
        sourceRef: d.sourceRef,
        createdAt: d.createdAt.toISOString(),
        chunkCount: d._count.chunks,
      })),
    };
  });

  /** DELETE /api/v1/documents/:id */
  app.delete('/documents/:id', async (req, reply) => {
    const workspaceId = getWorkspaceId(req);
    const id = (req.params as { id: string }).id;
    const doc = await prisma.document.findFirst({ where: { id, workspaceId } });
    if (!doc) return reply.code(404).send({ message: 'Document not found' });
    await prisma.document.delete({ where: { id } });
    return reply.code(204).send();
  });
}
