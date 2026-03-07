/**
 * Split text into chunks of 500–1000 characters for embedding.
 */

const MIN_CHUNK = 500;
const MAX_CHUNK = 1000;

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized.length) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + MAX_CHUNK, normalized.length);
    if (end < normalized.length) {
      const lastSpace = normalized.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK || start + chunk.length >= normalized.length) {
      chunks.push(chunk);
      start += chunk.length;
    } else {
      // Force advance to avoid infinite loop
      end = Math.min(start + MAX_CHUNK, normalized.length);
      const c = normalized.slice(start, end).trim();
      if (c) chunks.push(c);
      start = end;
    }
  }

  return chunks.filter(Boolean);
}
