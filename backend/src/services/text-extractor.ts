/**
 * Extract plain text from PDF buffer, raw text, or URL.
 */

export type SourceType = 'pdf' | 'text' | 'url';

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result?.text ?? '').trim();
  } finally {
    await parser.destroy();
  }
}

export function extractTextFromRaw(text: string): string {
  return text.trim();
}

/** Fetch URL and strip HTML to approximate plain text. */
export async function extractTextFromUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VoiceAI-Knowledge-Base/1.0' },
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();
  return stripHtml(html);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractText(sourceType: SourceType, input: Buffer | string): Promise<string> {
  if (sourceType === 'text') return extractTextFromRaw(typeof input === 'string' ? input : Buffer.from(input).toString('utf-8'));
  if (sourceType === 'url') return extractTextFromUrl(typeof input === 'string' ? input : input.toString('utf-8'));
  if (sourceType === 'pdf') return extractTextFromPdf(Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8'));
  throw new Error(`Unsupported source type: ${sourceType}`);
}
