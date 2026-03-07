import type { VoiceAIClient } from './client.js';

export type KnowledgeUploadResult = {
  documentId: string;
  chunkCount: number;
};

export type KnowledgeUploadInput =
  | {
      knowledgeBaseId: string;
      sourceType: 'text';
      text: string;
      name?: string;
    }
  | {
      knowledgeBaseId: string;
      sourceType: 'url';
      url: string;
      name?: string;
    }
  | {
      knowledgeBaseId: string;
      sourceType: 'pdf';
      file: Buffer | Uint8Array | ArrayBuffer | Blob;
      filename?: string;
    };

function toBlob(file: Buffer | Uint8Array | ArrayBuffer | Blob): Blob {
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file;
  if (file instanceof ArrayBuffer) return new Blob([file], { type: 'application/pdf' });
  if (ArrayBuffer.isView(file)) {
    // Node typings model .buffer as ArrayBufferLike; in practice here it's safe to treat as ArrayBuffer.
    const buf = file.buffer as ArrayBuffer;
    const u8 = new Uint8Array(buf, file.byteOffset, file.byteLength);
    return new Blob([u8 as unknown as BlobPart], { type: 'application/pdf' });
  }
  // Buffer is a Uint8Array in Node; treat as BlobPart.
  return new Blob([file as unknown as BlobPart], { type: 'application/pdf' });
}

export class KnowledgeResource {
  constructor(private client: VoiceAIClient) {}

  /**
   * Upload knowledge base content (text/url/pdf).
   * For PDFs this sends multipart/form-data (file field name: `file`).
   */
  async upload(input: KnowledgeUploadInput): Promise<KnowledgeUploadResult> {
    const kbId = input.knowledgeBaseId;
    const path = `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/upload`;

    if (input.sourceType === 'text') {
      return this.client.request('POST', path, {
        sourceType: 'text',
        text: input.text,
        name: input.name,
      });
    }

    if (input.sourceType === 'url') {
      return this.client.request('POST', path, {
        sourceType: 'url',
        url: input.url,
        name: input.name,
      });
    }

    const fd = new FormData();
    const blob = toBlob(input.file);
    const filename = input.filename ?? 'document.pdf';
    fd.append('file', blob, filename);
    return this.client.request('POST', path, fd);
  }
}

