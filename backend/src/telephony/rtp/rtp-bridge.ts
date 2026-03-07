/**
 * RTP <-> PCM bridge for Asterisk ExternalMedia.
 *
 * Assumptions (production defaults):
 * - inbound RTP payload: PCMU (pt=0), 8kHz, 20ms frames (160 samples)
 * - outbound RTP payload: PCMU (pt=0), 8kHz, 20ms frames
 */

import dgram from 'dgram';
import { randomUUID } from 'crypto';
import { parseRtpPacket, buildRtpPacket } from './rtp.js';
import { decodePcmuToPcm16, encodePcm16ToPcmu, PT_PCMU } from './audio-frame.js';

export type RtpRemote = { address: string; port: number };

export type RtpBridgeOptions = {
  bindAddress: string;
  bindPort: number;
  /** Expected incoming payload type (default PCMU) */
  inboundPayloadType?: number;
  /** Outbound payload type (default PCMU) */
  outboundPayloadType?: number;
  /** RTP clock rate for PCMU */
  clockRate?: number;
};

export class RtpBridge {
  readonly id = randomUUID();
  private socket = dgram.createSocket('udp4');
  private remote: RtpRemote | null = null;

  private seq = Math.floor(Math.random() * 65535);
  private ts = Math.floor(Math.random() * 0xffffffff);
  private ssrc = Math.floor(Math.random() * 0xffffffff);

  private readonly inboundPt: number;
  private readonly outboundPt: number;
  private readonly clockRate: number;

  constructor(private opts: RtpBridgeOptions) {
    this.inboundPt = opts.inboundPayloadType ?? PT_PCMU;
    this.outboundPt = opts.outboundPayloadType ?? PT_PCMU;
    this.clockRate = opts.clockRate ?? 8000;
  }

  async start(onPcm16_8k: (pcm16: Buffer) => void): Promise<void> {
    this.socket.on('message', (msg, rinfo) => {
      // First packet defines remote for return audio (Asterisk ExternalMedia)
      if (!this.remote) this.remote = { address: rinfo.address, port: rinfo.port };

      const pkt = parseRtpPacket(msg);
      if (!pkt) return;
      if (pkt.payloadType !== this.inboundPt) return;
      if (!pkt.payload || pkt.payload.length === 0) return;

      const pcm16 = decodePcmuToPcm16(pkt.payload); // 8k PCM16
      onPcm16_8k(pcm16);
    });

    await new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.opts.bindPort, this.opts.bindAddress, () => resolve());
    });
  }

  stop(): void {
    try {
      this.socket.close();
    } catch {
      // ignore
    }
  }

  /** Send 8kHz PCM16 (mono) as RTP PCMU frames back to the remote. */
  sendPcm16_8k(pcm16: Buffer): void {
    if (!this.remote) return;
    const pcmu = encodePcm16ToPcmu(pcm16);
    const payload = Buffer.from(pcmu);

    const packet = buildRtpPacket({
      payloadType: this.outboundPt,
      sequenceNumber: this.seq++,
      timestamp: this.ts,
      ssrc: this.ssrc,
      payload,
    });

    // For PCMU @ 8kHz, timestamp increments by number of samples (bytes in PCMU)
    this.ts = (this.ts + payload.length) >>> 0;

    this.socket.send(packet, this.remote.port, this.remote.address);
  }
}

