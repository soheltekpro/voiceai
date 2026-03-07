/**
 * TelephonySession bridges RTP audio to the existing real-time pipeline.
 *
 * - Inbound RTP PCMU 8kHz -> PCM16 -> resample 16k -> streaming STT
 * - On transcript_final -> streaming LLM -> sentence TTS -> (for now) send audio chunks back
 *
 * NOTE: For true phone RTP return audio, wire TTS to produce PCM16 8k and call rtpBridge.sendPcm16_8k().
 * This Phase 4 implementation includes the RTP bridge and decoding/encoding primitives; final playout integration
 * is done in controller wiring (next step).
 */

import { RtpBridge } from '../rtp/rtp-bridge.js';
import { resampleTo16k } from '../../pipeline/resample.js';
import { createStreamingSTT } from '../../pipeline/stt-streaming.js';
import { createAbortSignal, runStreamingReply } from '../../pipeline/streaming-pipeline.js';
import type { ServerMessage } from '../../types.js';
import { mp3ToPcm16le8k } from '../audio/ffmpeg.js';

export type TelephonySessionOptions = {
  wsSessionId: string;
  agent: { systemPrompt: string; voiceName: string; language: string; interruptionBehavior: 'BARGE_IN_STOP_AGENT' | 'IGNORE_WHILE_SPEAKING' };
  rtp: { bindAddress: string; bindPort: number };
  onEvent: (msg: ServerMessage) => void;
};

export class TelephonySession {
  private rtp: RtpBridge;
  private stt: ReturnType<typeof createStreamingSTT>;
  private replyAbort = createAbortSignal();
  private playbackAbort = createAbortSignal();

  constructor(private opts: TelephonySessionOptions) {
    this.rtp = new RtpBridge({ bindAddress: opts.rtp.bindAddress, bindPort: opts.rtp.bindPort });
    this.stt = createStreamingSTT((text, isFinal) => this.onTranscript(text, isFinal), this.opts.agent.language);
  }

  async start(): Promise<void> {
    await this.rtp.start((pcm16_8k) => {
      // Convert to 16kHz and push to streaming STT
      const pcm16k = resampleTo16k(pcm16_8k, 8000);
      this.stt?.pushPcm(Buffer.from(pcm16k), 16000);
    });
  }

  stop(): void {
    try {
      this.replyAbort.abort();
    } catch {}
    try {
      this.playbackAbort.abort();
    } catch {}
    this.stt?.close();
    this.rtp.stop();
  }

  interrupt(): void {
    if (this.opts.agent.interruptionBehavior === 'IGNORE_WHILE_SPEAKING') return;
    this.replyAbort.abort();
    this.playbackAbort.abort();
    this.opts.onEvent({ type: 'agent_stopped', payload: {} });
  }

  /** Placeholder for future: send PCM back via RTP */
  sendPcm16_8k(pcm16_8k: Buffer): void {
    this.rtp.sendPcm16_8k(pcm16_8k);
  }

  private onTranscript(text: string, isFinal: boolean) {
    if (!text) return;
    if (!isFinal) {
      this.opts.onEvent({ type: 'transcript_partial', payload: { text } });
      // barge-in: if user speaking while agent responding
      if (this.opts.agent.interruptionBehavior === 'BARGE_IN_STOP_AGENT' && !this.replyAbort.aborted) {
        // If the agent is currently speaking, upstream wiring should call interrupt; this is best-effort.
      }
      return;
    }

    this.opts.onEvent({ type: 'transcript_final', payload: { text } });
    // restart abort signal for this turn
    this.replyAbort = createAbortSignal();
    this.playbackAbort = createAbortSignal();
    void runStreamingReply(
      text,
      (m) => this.handlePipelineEvent(m),
      this.replyAbort,
      { systemPrompt: this.opts.agent.systemPrompt, voiceName: this.opts.agent.voiceName }
    );
  }

  private handlePipelineEvent(m: ServerMessage): void {
    // Persist/forward events
    this.opts.onEvent(m);

    // Phone playout: take sentence-level MP3 chunks and stream back as RTP PCMU.
    if (m.type === 'agent_audio_chunk' && m.payload.base64) {
      void this.playMp3Base64(m.payload.base64);
    }
    if (m.type === 'agent_stopped') {
      this.playbackAbort.abort();
    }
  }

  private async playMp3Base64(base64: string): Promise<void> {
    if (this.playbackAbort.aborted) return;
    const mp3 = Buffer.from(base64, 'base64');
    const pcm8k = await mp3ToPcm16le8k(mp3);
    if (this.playbackAbort.aborted) return;

    // 20ms @ 8kHz = 160 samples = 320 bytes PCM16
    const frameBytes = 320;
    let offset = 0;

    const sendFrame = () => {
      if (this.playbackAbort.aborted) return;
      if (offset >= pcm8k.length) return;
      const frame = pcm8k.subarray(offset, offset + frameBytes);
      offset += frameBytes;
      this.rtp.sendPcm16_8k(frame);
      setTimeout(sendFrame, 20);
    };

    sendFrame();
  }
}

