import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { prisma } from '../db/prisma.js';
import { persistAndPublish } from '../events/persist.js';

const LIVEKIT_AGENT_NAME = 'realtime-voice-agent';

export type RealtimeStartResult = {
  engine: 'v2v';
  callSessionId: string;
  roomName: string;
  livekitToken: string;
  livekitUrl: string;
};

function getLivekitUrl(): string {
  const url =
    process.env.LIVEKIT_PUBLIC_URL?.trim() || process.env.LIVEKIT_URL?.trim() || '';
  if (!url) {
    throw new Error(
      'LIVEKIT_URL or LIVEKIT_PUBLIC_URL must be set for V2V agents. Use the public WebSocket URL (e.g. wss://your-livekit.example.com).'
    );
  }
  return url.replace(/\/$/, '');
}

/** Extract first spoken greeting from system prompt for the agent to say verbatim. Skips markdown and metadata (e.g. "Agent Name:", "Brand:") and takes only a sentence that looks like a real greeting. */
function extractOpeningLine(systemPrompt: string): string {
  const max = 400;
  let text = systemPrompt.trim();
  if (!text) return '';

  // Strip markdown headers (e.g. "# 🎙️ Title")
  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#+\s*/.test(line.trim()))
    .join('\n')
    .trim();
  if (!text) return '';

  // Find the first phrase that looks like a spoken greeting (anywhere in the prompt, so we skip "Agent Name:", "Brand:", "Platform:", "Tone :" etc.)
  const greetingPattern =
    /\b(Hello[!.]?|Hi[!.]?|Hey[!.]?|Hi there[!.]?|Good (?:morning|afternoon|evening)[!.]?|This is .+? (?:calling|speaking)|(?:I'm|I am) .+? (?:calling|speaking))\s+/i;
  const match = text.match(greetingPattern);
  if (match && typeof match.index === 'number') {
    const afterGreeting = text.slice(match.index);
    const chunk = afterGreeting.length <= max ? afterGreeting : afterGreeting.slice(0, max);
    const lastSentence = Math.max(
      chunk.lastIndexOf('. '),
      chunk.lastIndexOf('! '),
      chunk.lastIndexOf('? ')
    );
    if (lastSentence > 20) return chunk.slice(0, lastSentence + 1).trim();
    return chunk.trim();
  }

  // Do not speak metadata/config: if the text starts with label-like lines (e.g. "Agent Name:", "Brand:"), return empty so on_enter skips TTS
  const metadataLine = /^\s*(Agent Name|Brand|Platform|Tone|Voice|Language|Description)\s*[:：]/im;
  if (metadataLine.test(text)) return '';

  // Fallback: only use first sentence(s) if the first line looks like natural speech (starts with a greeting word)
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? '';
  if (/^(Hello|Hi|Hey|Good morning|Good afternoon|Good evening)/i.test(firstLine)) {
    const chunk = text.length <= max ? text : text.slice(0, max);
    const lastSentence = Math.max(
      chunk.lastIndexOf('. '),
      chunk.lastIndexOf('! '),
      chunk.lastIndexOf('? ')
    );
    if (lastSentence > 60) return chunk.slice(0, lastSentence + 1).trim();
    return chunk.trim();
  }
  return '';
}

function getLivekitCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error(
      'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set for V2V agents.'
    );
  }
  return { apiKey, apiSecret };
}

export class RealtimeEngine {
  constructor(private log: FastifyBaseLogger) {}

  async startCall(params: { agentId: string | null }): Promise<RealtimeStartResult> {
    const roomName = `voice-room-${randomUUID().slice(0, 12)}`;
    const identity = `user-${randomUUID().slice(0, 8)}`;
    const { apiKey, apiSecret } = getLivekitCredentials();
    const livekitUrl = getLivekitUrl();

    let knowledgeBaseId: string | null = null;
    let systemPrompt: string = '';
    let v2vProvider: string | null = null;
    let v2vModel: string | null = null;
    let v2vVoice: string | null = null;
    if (params.agentId) {
      const settings = await prisma.agentSettings.findUnique({
        where: { agentId: params.agentId },
        select: {
          knowledgeBaseId: true,
          systemPrompt: true,
          v2vProvider: true,
          v2vModel: true,
          v2vVoice: true,
        },
      });
      knowledgeBaseId = settings?.knowledgeBaseId ?? null;
      systemPrompt = (settings?.systemPrompt ?? '').trim() || 'You are a helpful voice assistant.';
      v2vProvider = settings?.v2vProvider ?? null;
      v2vModel = settings?.v2vModel ?? null;
      v2vVoice = settings?.v2vVoice ?? null;
    } else {
      systemPrompt = 'You are a helpful voice assistant.';
    }

    this.log.info({ roomName }, 'Dispatching V2V agent with systemPrompt: %s', systemPrompt.slice(0, 120) + (systemPrompt.length > 120 ? '...' : ''));

    // Extract opening line (first sentence(s)) for the agent to say verbatim so the model does not substitute a default greeting
    const openingLine = extractOpeningLine(systemPrompt);

    const sessionMetadata: { roomName: string; engine: string; knowledgeBaseId?: string; agentId?: string; systemPrompt?: string; openingLine?: string } = {
      roomName,
      engine: 'v2v',
    };
    if (knowledgeBaseId) sessionMetadata.knowledgeBaseId = knowledgeBaseId;
    if (params.agentId) sessionMetadata.agentId = params.agentId;
    sessionMetadata.systemPrompt = systemPrompt;
    if (openingLine) sessionMetadata.openingLine = openingLine;

    const callSession = await prisma.callSession.create({
      data: {
        agentId: params.agentId,
        clientType: 'BROWSER',
        status: 'ACTIVE',
        metadata: sessionMetadata,
      },
    });

    const dispatchMetadata: {
      callSessionId: string;
      agentId?: string;
      knowledgeBaseId?: string;
      systemPrompt: string;
      openingLine?: string;
      v2vProvider?: string;
      v2vModel?: string;
      v2vVoice?: string;
    } = {
      callSessionId: callSession.id,
      systemPrompt,
    };
    if (params.agentId) dispatchMetadata.agentId = params.agentId;
    if (knowledgeBaseId) dispatchMetadata.knowledgeBaseId = knowledgeBaseId;
    if (openingLine) dispatchMetadata.openingLine = openingLine;
    if (v2vProvider) dispatchMetadata.v2vProvider = v2vProvider;
    if (v2vModel) dispatchMetadata.v2vModel = v2vModel;
    if (v2vVoice) dispatchMetadata.v2vVoice = v2vVoice;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: 'User',
    });
    at.addGrant({ roomJoin: true, room: roomName });
    const livekitToken = await at.toJwt();

    const dispatchHost = process.env.LIVEKIT_URL?.trim() || livekitUrl;
    const agentDispatch = new AgentDispatchClient(dispatchHost, apiKey, apiSecret);
    try {
      await agentDispatch.createDispatch(roomName, LIVEKIT_AGENT_NAME, {
        metadata: JSON.stringify(dispatchMetadata),
      });
    } catch (err) {
      this.log.warn({ err, roomName }, 'agent dispatch create failed (agent may auto-join via token in some setups)');
    }

    await persistAndPublish(callSession.id, 'call.started', {
      roomName,
      clientType: 'BROWSER',
      engine: 'v2v',
    });

    this.log.info({ callSessionId: callSession.id, roomName }, 'realtime v2v call started');

    return {
      engine: 'v2v',
      callSessionId: callSession.id,
      roomName,
      livekitToken,
      livekitUrl,
    };
  }
}

