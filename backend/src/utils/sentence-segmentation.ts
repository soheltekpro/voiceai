/**
 * Sentence segmentation for streaming LLM output.
 * Detects complete sentences by punctuation (. ! ?) and returns them plus remaining text.
 * Long sentences are split at MAX_SENTENCE_LENGTH for TTS efficiency.
 */

export const MAX_SENTENCE_LENGTH = 200;

export type ExtractResult = {
  sentences: string[];
  remaining: string;
};

/**
 * Split a long string at the nearest punctuation or whitespace so no part exceeds maxLen.
 */
function splitLongAtBoundary(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > maxLen) {
    const chunk = rest.slice(0, maxLen + 1);
    const punct = chunk.search(/[.!?,]\s*$/);
    const space = chunk.slice(0, maxLen).lastIndexOf(' ');
    const splitAt = punct >= 0 ? punct + 1 : space >= 0 ? space + 1 : maxLen;
    const part = rest.slice(0, splitAt).trim();
    if (part) out.push(part);
    rest = rest.slice(splitAt).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Apply length guard: if any sentence exceeds MAX_SENTENCE_LENGTH, split it at boundaries.
 */
function applyLengthGuard(sentences: string[]): string[] {
  const result: string[] = [];
  for (const s of sentences) {
    if (s.length <= MAX_SENTENCE_LENGTH) {
      result.push(s);
    } else {
      result.push(...splitLongAtBoundary(s, MAX_SENTENCE_LENGTH));
    }
  }
  return result;
}

/**
 * Extract complete sentences from a text buffer.
 * A sentence is considered complete when it ends with . ! or ?
 * Sentences longer than MAX_SENTENCE_LENGTH are split at punctuation/whitespace.
 *
 * @example
 * Input: "Hello there! I can help you with that. Our course"
 * Output: { sentences: ["Hello there!", "I can help you with that."], remaining: "Our course" }
 */
export function extractCompleteSentences(buffer: string): ExtractResult {
  const trimmed = buffer.trim();
  if (!trimmed) {
    return { sentences: [], remaining: buffer };
  }

  const sentences: string[] = [];
  let rest = trimmed;

  while (rest.length > 0) {
    const idx = rest.search(/[.!?]/);
    if (idx === -1) break;
    const end = idx + 1;
    const sentence = rest.slice(0, end).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(end).trimStart();
  }

  return {
    sentences: applyLengthGuard(sentences),
    remaining: rest,
  };
}
