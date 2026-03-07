/**
 * Asterisk ARI controller (minimal).
 *
 * - Handles inbound calls into an ARI app
 * - Creates ExternalMedia channel (RTP to Node)
 * - Bridges inbound channel + ExternalMedia
 *
 * This is the production pattern for RTP access without implementing SIP in Node.
 */

import type { FastifyBaseLogger } from 'fastify';
import { connectAri, type AriConfig } from './ari.js';
import { prisma } from '../../db/prisma.js';
import { getAgentForInboundNumberExact } from '../../services/telephony-routing.js';
import type { TelephonySessionManager } from '../session/session-manager.js';
import { persistAndPublish } from '../../events/persist.js';

export type AsteriskControllerOptions = {
  ari: AriConfig;
  /** Node UDP host (reachable by Asterisk) for ExternalMedia to send RTP to */
  rtpHost: string;
};

export class AsteriskController {
  private client: any | null = null;

  constructor(
    private opts: AsteriskControllerOptions,
    private sessions: TelephonySessionManager,
    private log: FastifyBaseLogger
  ) {}

  async start(): Promise<void> {
    this.client = await connectAri(this.opts.ari);
    this.client.on('StasisStart', (event: any, channel: any) => this.onStasisStart(event, channel));
    this.client.on('StasisEnd', (event: any, channel: any) => this.onStasisEnd(event, channel));
    this.client.start(this.opts.ari.appName);
    this.log.info('Asterisk ARI controller started');
  }

  async originate(params: {
    endpoint: string; // e.g. "PJSIP/+14155551212@twilio-trunk"
    callerId: string;
    agentId?: string;
  }): Promise<{ channelId: string }> {
    if (!this.client) throw new Error('ARI not started');
    const variables: Record<string, string> = {};
    if (params.agentId) variables['VOICEAI_AGENT_ID'] = params.agentId;
    const channel = await this.client.channels.originate({
      endpoint: params.endpoint,
      app: this.opts.ari.appName,
      callerId: params.callerId,
      variables,
    });
    return { channelId: channel.id };
  }

  private async onStasisStart(event: any, channel: any): Promise<void> {
    try {
      const args = event?.args ?? [];
      let agentId = channel?.variables?.VOICEAI_AGENT_ID ?? args?.[0];
      // Inbound: if no agent from variables (outbound sets it), resolve by dialed number
      if (!agentId && channel?.dialplan?.exten) {
        const dialed = String(channel.dialplan.exten);
        agentId = await getAgentForInboundNumberExact(dialed) ?? undefined;
        if (agentId) this.log.info({ channelId: channel.id, dialed, agentId }, 'Inbound: agent resolved by phone number');
      }
      this.log.info({ channelId: channel.id, agentId }, 'Inbound channel entered Stasis');

      await channel.answer();

      // Create DB call session
      const callSession = await prisma.callSession.create({
        data: {
          agentId: agentId ? String(agentId) : null,
          clientType: 'PHONE',
          status: 'ACTIVE',
          metadata: { provider: 'SIP', asteriskChannelId: channel.id },
        },
      });
      await persistAndPublish(callSession.id, 'call.started', { channelId: channel.id, clientType: 'PHONE' });

      // Resolve agent settings (fallback defaults)
      const settings = agentId
        ? await prisma.agentSettings.findUnique({ where: { agentId: String(agentId) } })
        : null;
      const agentCfg = {
        agentId: agentId ? String(agentId) : undefined,
        systemPrompt: settings?.systemPrompt ?? 'You are a helpful voice assistant.',
        voiceName: settings?.voiceName ?? 'alloy',
        language: settings?.language ?? 'en',
        interruptionBehavior: (settings?.interruptionBehavior as any) ?? 'BARGE_IN_STOP_AGENT',
      };

      // Start RTP<->AI bridge and allocate a unique UDP port for this call
      const { rtpPort } = await this.sessions.startSession({
        callSessionId: callSession.id,
        channelId: channel.id,
        agent: agentCfg,
      });

      // Create a mixing bridge and attach inbound channel
      const bridge = await this.client.bridges.create({ type: 'mixing' });
      await bridge.addChannel({ channel: channel.id });

      // ExternalMedia: tell Asterisk to send RTP to our UDP listener
      const ext = await this.client.channels.externalMedia({
        app: this.opts.ari.appName,
        external_host: `${this.opts.rtpHost}:${rtpPort}`,
        format: 'ulaw', // PCMU
        direction: 'both',
        variables: {
          ...(agentId ? { VOICEAI_AGENT_ID: String(agentId) } : {}),
          VOICEAI_PARENT_CHANNEL: channel.id,
        },
      });

      await bridge.addChannel({ channel: ext.id });

      // store bridge id on channel for cleanup
      await channel.setChannelVar({ variable: 'VOICEAI_BRIDGE_ID', value: bridge.id });
      await channel.setChannelVar({ variable: 'VOICEAI_EXTMEDIA_ID', value: ext.id });
      await channel.setChannelVar({ variable: 'VOICEAI_CALL_SESSION_ID', value: callSession.id });
    } catch (err) {
      this.log.error(err, 'Failed to handle StasisStart');
    }
  }

  private async onStasisEnd(_event: any, channel: any): Promise<void> {
    try {
      const bridgeId = channel?.variables?.VOICEAI_BRIDGE_ID;
      const extId = channel?.variables?.VOICEAI_EXTMEDIA_ID;
      const callSessionId = channel?.variables?.VOICEAI_CALL_SESSION_ID;

      this.sessions.stopSession(channel.id);
      if (extId) {
        try {
          await this.client.channels.hangup({ channelId: extId });
        } catch {}
      }
      if (bridgeId) {
        try {
          await this.client.bridges.destroy({ bridgeId });
        } catch {}
      }
      if (callSessionId) {
        try {
          await prisma.callSession.update({
            where: { id: String(callSessionId) },
            data: { status: 'ENDED', endedAt: new Date() },
          });
          await persistAndPublish(String(callSessionId), 'call.ended', {});
        } catch {}
      }
      this.log.info({ channelId: channel.id }, 'Channel left Stasis');
    } catch (err) {
      this.log.error(err, 'Failed to handle StasisEnd');
    }
  }
}

