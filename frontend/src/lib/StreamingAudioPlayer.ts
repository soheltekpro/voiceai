/**
 * StreamingAudioPlayer: Exact timing queue to eliminate crackling/pops.
 *
 * Schedules each decoded chunk with startTime = Math.max(nextStartTime, context.currentTime)
 * so chunks play back-to-back with no gap and no overlap.
 * nextStartTime is set to startTime + buffer.duration after each schedule.
 * stop() clears the queue and stops current playback (barge-in).
 * AudioContext must be resumed on first user interaction (handled by useStreamingAudioPlayer).
 */

export class StreamingAudioPlayer {
  private ctx: AudioContext;
  private chunkQueue: string[] = [];
  private nextStartTime = 0;
  private currentSource: AudioBufferSourceNode | null = null;
  private stopped = false;
  private processing = false;

  constructor(context: AudioContext) {
    this.ctx = context;
    this.nextStartTime = context.currentTime;
  }

  /** Queue a base64-encoded audio chunk for playback. */
  playChunk(base64: string): void {
    if (this.stopped || !base64) return;
    this.chunkQueue.push(base64);
    this.processNext();
  }

  /** Alias for playChunk (same entry point for WebSocket data). */
  pushChunk(base64: string): void {
    this.playChunk(base64);
  }

  /** Stop playback and clear the queue (barge-in). */
  stop(): void {
    this.stopped = true;
    this.chunkQueue = [];
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource = null;
    }
  }

  /** Reset for a new agent reply (call on agent_audio_start). */
  reset(): void {
    this.stopped = false;
    this.chunkQueue = [];
    this.nextStartTime = this.ctx.currentTime;
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource = null;
    }
  }

  private scheduleBuffer(buffer: AudioBuffer): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    const startTime = Math.max(this.nextStartTime, now);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      this.currentSource = null;
      this.processNext();
    };
    this.currentSource = source;
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;
  }

  private processNext(): void {
    if (this.processing || this.stopped || this.chunkQueue.length === 0) return;
    this.processing = true;
    const base64 = this.chunkQueue.shift()!;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.ctx
      .decodeAudioData(buf)
      .then((buffer) => {
        this.processing = false;
        if (!this.stopped) this.scheduleBuffer(buffer);
        else this.processNext();
      })
      .catch(() => {
        this.processing = false;
        this.processNext();
      });
  }
}
