/**
 * Voice call orchestrator: track active calls, enforce max concurrency, queue excess.
 */

export const MAX_CONCURRENT_CALLS = 100;

let activeCalls = 0;
const queue: Array<() => void> = [];

/** Acquire a slot; resolves when a slot is available (may wait if at capacity). */
export function acquireCallSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_CALLS) {
    activeCalls++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      activeCalls++;
      resolve();
    });
  });
}

/** Release a slot and wake next queued call if any. */
export function releaseCallSlot(): void {
  if (activeCalls <= 0) return;
  activeCalls--;
  const next = queue.shift();
  if (next) next();
}

/** Current number of active calls. */
export function getActiveCallCount(): number {
  return activeCalls;
}

/** Current queue length (calls waiting for a slot). */
export function getQueuedCallCount(): number {
  return queue.length;
}
