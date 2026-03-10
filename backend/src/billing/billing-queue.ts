/**
 * BullMQ queue for async Stripe webhook processing. Retries: 5, exponential backoff.
 */

import { Queue } from 'bullmq';
import type { Redis as RedisClient } from 'ioredis';
import { createRedis } from '../infra/redis.js';

export type BillingWebhookJob = {
  eventId: string;
  eventType: string;
  data: { object: unknown };
};

const QUEUE_NAME = 'voiceai-billing-webhooks';

let billingQueue: Queue<BillingWebhookJob> | null = null;

function getConnection(): RedisClient {
  return createRedis();
}

export function getBillingQueue(): Queue<BillingWebhookJob> {
  if (!billingQueue) {
    billingQueue = new Queue<BillingWebhookJob>(QUEUE_NAME, {
      connection: getConnection() as any,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 2000,
        removeOnFail: 10000,
      },
    });
  }
  return billingQueue;
}

/** Push a Stripe event to the billing queue for async processing. */
export async function addBillingWebhookJob(event: { id: string; type: string; data: { object: unknown } }): Promise<void> {
  const queue = getBillingQueue();
  await queue.add(
    'stripe.event',
    {
      eventId: event.id,
      eventType: event.type,
      data: event.data,
    },
    { jobId: event.id }
  );
}
