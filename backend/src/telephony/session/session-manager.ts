import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerMessage } from '../../types.js';
import { TelephonySession } from './telephony-session.js';
import { prisma } from '../../db/prisma.js';
import { persistAndPublish } from '../../events/persist.js';

export type TelephonyAgentConfig = {
  agentId?: string;
  systemPrompt: string;
  voiceName: string;
  language: string;
  interruptionBehavior: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING';
};

export class TelephonySessionManager {
  private sessions = new Map<string, TelephonySession>();
  private allocated = new Set<number>();

  constructor(
    private opts: { bindAddress: string; portStart: number; portEnd: number },
    private log: FastifyBaseLogger
  ) {}

  allocatePort(): number {
    for (let p = this.opts.portStart; p <= this.opts.portEnd; p++) {
      if (!this.allocated.has(p)) {
        this.allocated.add(p);
        return p;
      }
    }
    throw new Error('No RTP ports available');
  }

  releasePort(port: number): void {
    this.allocated.delete(port);
  }

  async startSession(params: {
    callSessionId: string;
    channelId: string;
    agent: TelephonyAgentConfig;
  }): Promise<{ wsSessionId: string; rtpPort: number }> {
    const rtpPort = this.allocatePort();
    const wsSessionId = randomUUID();

    const session = new TelephonySession({
      wsSessionId,
      agent: {
        systemPrompt: params.agent.systemPrompt,
        voiceName: params.agent.voiceName,
        language: params.agent.language,
        interruptionBehavior: params.agent.interruptionBehavior,
      },
      rtp: { bindAddress: this.opts.bindAddress, bindPort: rtpPort },
      onEvent: (m: ServerMessage) => {
        if (m.type === 'transcript_partial') void persistAndPublish(params.callSessionId, 'speech.detected', { text: m.payload.text });
        else if (m.type === 'transcript_final') void persistAndPublish(params.callSessionId, 'transcription.completed', { text: m.payload.text });
        else if (m.type === 'agent_text_delta') void persistAndPublish(params.callSessionId, 'ai.response.generated', { text_delta: m.payload.text });
        else if (m.type === 'agent_audio_chunk') void persistAndPublish(params.callSessionId, 'audio.played', { bytes: (m.payload.base64 ?? '').length });
      },
    });

    await session.start();
    this.sessions.set(params.channelId, session);
    this.log.info({ channelId: params.channelId, rtpPort }, 'Telephony session started');
    return { wsSessionId, rtpPort };
  }

  stopSession(channelId: string): void {
    const s = this.sessions.get(channelId);
    if (!s) return;
    s.stop();
    this.sessions.delete(channelId);
    this.log.info({ channelId }, 'Telephony session stopped');
  }
}

