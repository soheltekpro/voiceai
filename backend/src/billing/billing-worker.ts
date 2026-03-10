/**
 * BullMQ worker for Stripe billing webhook events. Processes invoice and subscription events.
 */

import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { createRedis } from '../infra/redis.js';
import { hasProcessedStripeEvent, processStripeEvent } from './stripe-webhook.js';
import type { BillingWebhookJob } from './billing-queue.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const QUEUE_NAME = 'voiceai-billing-webhooks';

function buildEventFromJob(data: BillingWebhookJob): { id: string; type: string; data: { object: unknown } } {
  return {
    id: data.eventId,
    type: data.eventType,
    data: { object: data.data.object },
  };
}

const worker = new Worker<BillingWebhookJob>(
  QUEUE_NAME,
  async (job) => {
    const { eventId, eventType, data } = job.data;
    if (await hasProcessedStripeEvent(eventId)) {
      log.info({ eventId, eventType }, 'Billing event already processed (idempotent skip)');
      return { received: true, skipped: true };
    }
    const event = buildEventFromJob(job.data);
    await processStripeEvent(event as any);
    log.info({ eventId, eventType }, 'Billing event processed');
    return { received: true };
  },
  {
    connection: createRedis() as any,
    concurrency: 5,
  }
);

worker.on('completed', (job) => {
  log.debug({ jobId: job.id }, 'Billing job completed');
});

worker.on('failed', (job, err) => {
  log.warn({ jobId: job?.id, failedReason: err?.message }, 'Billing job failed');
});

worker.on('error', (err) => {
  log.error({ err }, 'Billing worker error');
});

log.info({ queue: QUEUE_NAME }, 'Billing worker started');
