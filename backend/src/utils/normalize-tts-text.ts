/**
 * Normalize text before TTS to improve voice quality and remove filler.
 */

const FILLER_PATTERN = /\b(uh|um|er|ah|eh)\b/gi;
const MULTIPLE_SPACES = /\s+/g;
const ELLIPSIS = /\.{2,}/g;

/**
 * Trim whitespace, collapse spaces, replace "..." with ".", remove fillers (uh, um, er),
 * and ensure the sentence ends with punctuation if it has content.
 */
export function normalizeTtsText(text: string): string {
  let out = text.trim();
  if (!out) return out;
  out = out.replace(ELLIPSIS, '.');
  out = out.replace(FILLER_PATTERN, ' ');
  out = out.replace(MULTIPLE_SPACES, ' ').trim();
  if (!out) return out;
  if (!/[.!?]$/.test(out)) {
    out = out + '.';
  }
  return out;
}
