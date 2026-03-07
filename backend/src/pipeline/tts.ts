/**
 * Text-to-Speech using OpenAI TTS.
 * Returns MP3 audio as base64 for sending over WebSocket.
 */

import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function synthesize(text: string, voiceOverride?: string): Promise<string> {
  if (!text.trim()) return '';

  const voice = (voiceOverride ?? config.openai.ttsVoice) as
    | 'alloy'
    | 'echo'
    | 'fable'
    | 'onyx'
    | 'nova'
    | 'shimmer';

  const response = await openai.audio.speech.create({
    model: config.openai.ttsModel,
    voice,
    input: text.trim(),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}
