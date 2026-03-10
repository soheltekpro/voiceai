/**
 * Async sentence queue for parallel LLM + TTS pipeline.
 * FIFO with resolver pattern; enqueue waits when queue is at capacity (backpressure).
 */

export const MAX_SENTENCE_QUEUE = 5;

export type QueuedSentence = { sentence: string; enqueuedAt: number };

export class SentenceQueue {
  private readonly items: QueuedSentence[] = [];
  private waiters: Array<(value: QueuedSentence | null) => void> = [];
  private enqueueWaiters: Array<() => void> = [];
  private closed = false;

  /** Current number of items in the queue (excluding items already taken by waiters). */
  get size(): number {
    return this.items.length;
  }

  /**
   * Add a sentence to the queue. Resolves the next waiting dequeue() if any.
   * When queue size >= MAX_SENTENCE_QUEUE, waits until an item is dequeued before pushing.
   */
  async enqueue(sentence: string): Promise<void> {
    if (this.closed) return;
    const trimmed = sentence.trim();
    if (!trimmed) return;

    while (this.items.length >= MAX_SENTENCE_QUEUE && !this.closed) {
      await new Promise<void>((resolve) => {
        this.enqueueWaiters.push(resolve);
      });
    }
    if (this.closed) return;

    const item: QueuedSentence = { sentence: trimmed, enqueuedAt: Date.now() };
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift()!;
      resolve(item);
    } else {
      this.items.push(item);
    }
    if (this.enqueueWaiters.length > 0) this.enqueueWaiters.shift()!();
  }

  /**
   * Take the next sentence. Resolves immediately if queue has items, otherwise waits until enqueue() or close().
   * Returns null when the queue has been closed and no items remain.
   */
  async dequeue(): Promise<QueuedSentence | null> {
    if (this.items.length > 0) {
      const item = this.items.shift()!;
      if (this.enqueueWaiters.length > 0) this.enqueueWaiters.shift()!();
      return item;
    }
    if (this.closed) return null;
    return new Promise<QueuedSentence | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Close the queue. Any waiting dequeue() will resolve with null.
   * Further enqueue() calls are no-ops.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiters) resolve(null);
    this.waiters = [];
    for (const resolve of this.enqueueWaiters) resolve();
    this.enqueueWaiters = [];
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
