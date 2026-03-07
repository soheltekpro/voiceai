/**
 * Knowledge base upload: extract text → chunk → embed → store.
 */

import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';
import { chunkText } from './chunking.js';
import { extractText, type SourceType } from './text-extractor.js';
import { getEmbeddingQueue } from '../infra/queues.js';

export type UploadInput =
  | { sourceType: 'pdf'; buffer: Buffer; name: string }
  | { sourceType: 'text'; text: string; name: string }
  | { sourceType: 'url'; url: string; name: string };

export async function processUpload(
  knowledgeBaseId: string,
  input: UploadInput,
  log: FastifyBaseLogger
): Promise<{ documentId: string; chunkCount: number }> {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id: knowledgeBaseId },
    select: { workspaceId: true },
  });
  if (!kb) throw new Error('Knowledge base not found');
  const name = input.name || (input.sourceType === 'url' ? input.url : 'document');
  const sourceRef = input.sourceType === 'url' ? input.url : null;

  const doc = await prisma.document.create({
    data: {
      workspaceId: kb.workspaceId,
      knowledgeBaseId,
      name,
      sourceType: input.sourceType,
      sourceRef,
    },
  });

  let rawText: string;
  if (input.sourceType === 'pdf') {
    rawText = await extractText('pdf', input.buffer);
  } else if (input.sourceType === 'text') {
    rawText = await extractText('text', input.text);
  } else {
    rawText = await extractText('url', input.url);
  }

  const chunks = chunkText(rawText);
  if (chunks.length === 0) {
    log.info({ documentId: doc.id }, 'No chunks extracted');
    return { documentId: doc.id, chunkCount: 0 };
  }

  const docId = doc.id;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    const id = crypto.randomUUID();
    // Insert chunk with embedding NULL (embedding-worker will fill it in).
    await prisma.$executeRawUnsafe(
      `INSERT INTO document_chunks (id, "documentId", content, "index")
       VALUES ($1, $2, $3, $4)`,
      id,
      docId,
      content,
      i
    );
  }

  // Enqueue embedding generation so API server stays fast.
  await getEmbeddingQueue().add('document.embed', { type: 'document.embed', documentId: docId });

  log.info({ documentId: doc.id, chunkCount: chunks.length }, 'Knowledge base document queued for embedding');
  return { documentId: doc.id, chunkCount: chunks.length };
}
