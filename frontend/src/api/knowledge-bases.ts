/**
 * Knowledge Base RAG APIs.
 */

import { apiGet, apiPost, apiPostForm, apiDelete } from './client';

const BASE = '/api/v1';

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Document = {
  id: string;
  name: string;
  sourceType: string;
  sourceRef: string | null;
  createdAt: string;
  chunkCount: number;
};

export async function fetchKnowledgeBases(): Promise<{ items: KnowledgeBase[] }> {
  return apiGet<{ items: KnowledgeBase[] }>(`${BASE}/knowledge-bases`);
}

export async function deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  await apiDelete(`${BASE}/knowledge-bases/${knowledgeBaseId}`);
}

export async function createKnowledgeBase(payload: { name: string; description?: string | null }): Promise<KnowledgeBase> {
  return apiPost<KnowledgeBase>(`${BASE}/knowledge-bases`, payload);
}

export async function uploadToKnowledgeBase(
  knowledgeBaseId: string,
  payload:
    | { sourceType: 'text'; text: string; name?: string }
    | { sourceType: 'url'; url: string; name?: string }
): Promise<{ documentId: string; chunkCount: number }> {
  return apiPost(`${BASE}/knowledge-bases/${knowledgeBaseId}/upload`, payload);
}

export async function uploadPdfToKnowledgeBase(
  knowledgeBaseId: string,
  file: File
): Promise<{ documentId: string; chunkCount: number }> {
  const form = new FormData();
  form.append('file', file);
  return apiPostForm<{ documentId: string; chunkCount: number }>(
    `${BASE}/knowledge-bases/${knowledgeBaseId}/upload`,
    form
  );
}

export async function fetchDocuments(knowledgeBaseId: string): Promise<{ items: Document[] }> {
  return apiGet<{ items: Document[] }>(`${BASE}/knowledge-bases/${knowledgeBaseId}/documents`);
}

export async function deleteDocument(documentId: string): Promise<void> {
  return apiDelete(`${BASE}/documents/${documentId}`);
}
