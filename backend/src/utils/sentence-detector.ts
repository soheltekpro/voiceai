/**
 * Robust sentence chunker for streaming LLM output.
 * Buffers tokens and yields complete sentences on punctuation, avoiding splits after abbreviations (Mr., Dr., etc.).
 */

const MIN_BUFFER_CHARS = 20;
const ABBREV_PATTERN =
  /\b(Mr|Mrs|Ms|Dr|Drs|Sr|Jr|Prof|St|Mt|Ave|Blvd|Rd|Ln|Ct|Pl|No|Inc|Ltd|Co|vs)\.\s*$/i;

function isSentenceEnd(text: string): boolean {
  const t = text.trimEnd();
  if (!t.length) return false;
  const last = t.slice(-1);
  if (last === '!' || last === '?' || t.endsWith('\n')) return true;
  if (last !== '.') return false;
  return !ABBREV_PATTERN.test(t);
}

export interface SentenceChunkerOptions {
  minChars?: number;
  maxChars?: number;
}

/**
 * Buffers streaming text and yields complete sentences when enough content and a sentence boundary is found.
 * Use pushAndPull(chunk) for each token; call flush() when the stream ends to get remaining text.
 */
export class SentenceChunker {
  private buffer = '';
  private readonly minChars: number;
  private readonly maxChars: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this.minChars = options.minChars ?? MIN_BUFFER_CHARS;
    this.maxChars = options.maxChars ?? 30;
  }

  /**
   * Append a chunk and return any complete sentences that can be yielded.
   */
  pushAndPull(chunk: string): string[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const out: string[] = [];
    while (this.buffer.length >= this.minChars) {
      const trimmed = this.buffer.trimStart();
      if (trimmed.length < this.minChars) break;
      let found = false;
      for (let i = this.minChars; i <= Math.min(trimmed.length, this.minChars + this.maxChars); i++) {
        const candidate = trimmed.slice(0, i);
        if (isSentenceEnd(candidate)) {
          const sentence = candidate.trim();
          if (sentence) out.push(sentence);
          this.buffer = trimmed.slice(i).trimStart();
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    return out;
  }

  /**
   * Return any remaining buffered text (call when stream ends).
   */
  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest;
  }
}
