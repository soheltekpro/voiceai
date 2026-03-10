/**
 * Agent worker pool: run pipeline (or other call) tasks with bounded concurrency.
 */

const DEFAULT_POOL_SIZE = 10;

let concurrency = DEFAULT_POOL_SIZE;
let running = 0;
const pending: Array<{ run: () => Promise<void> }> = [];

function pump(): void {
  while (running < concurrency && pending.length > 0) {
    const job = pending.shift();
    if (!job) break;
    running++;
    void job.run().finally(() => {
      running--;
      pump();
    });
  }
}

/**
 * Set pool size (concurrent workers). Default 10.
 */
export function setPoolSize(size: number): void {
  concurrency = Math.max(1, size);
  pump();
}

/**
 * Submit a task. Runs when a worker is free.
 */
export function submit(task: () => Promise<void>): void {
  pending.push({
    run: task,
  });
  pump();
}

/**
 * Run a function with pool concurrency (acquires one worker for the duration of fn).
 */
export function runWithPool<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({
      run: () => fn().then(resolve, reject),
    });
    pump();
  });
}

/** Current number of running tasks. */
export function getRunningCount(): number {
  return running;
}

/** Current number of queued tasks. */
export function getPendingCount(): number {
  return pending.length;
}
