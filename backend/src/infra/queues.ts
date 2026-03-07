import { QueueEvents } from 'bullmq';
import type { Queue } from 'bullmq';
import type { Redis as RedisClient } from 'ioredis';
import { createRedis } from './redis.js';
import {
  createCallQueue,
  createEmbeddingQueue,
  createToolExecutionQueue,
  createPostCallQueue,
  createWebhookQueue,
} from './queue.js';
import type { CallStartJob, EmbeddingJob, ToolExecutionJob, PostCallJob, WebhookDeliveryJob } from './queue.js';

let redis: RedisClient | null = null;
let callQueue: Queue<CallStartJob> | null = null;
let embeddingQueue: Queue<EmbeddingJob> | null = null;
let toolExecutionQueue: Queue<ToolExecutionJob> | null = null;
let postCallQueue: Queue<PostCallJob> | null = null;
let webhookQueue: Queue<WebhookDeliveryJob> | null = null;
let callQueueEvents: QueueEvents | null = null;

function getRedis(): RedisClient {
  if (!redis) redis = createRedis();
  return redis;
}

export function getCallQueue(): Queue<CallStartJob> {
  if (!callQueue) callQueue = createCallQueue(getRedis());
  return callQueue;
}

export function getCallQueueEvents(): QueueEvents {
  if (!callQueueEvents) {
    callQueueEvents = new QueueEvents('voiceai-calls', { connection: getRedis() as any });
  }
  return callQueueEvents;
}

export function getEmbeddingQueue(): Queue<EmbeddingJob> {
  if (!embeddingQueue) embeddingQueue = createEmbeddingQueue(getRedis());
  return embeddingQueue;
}

export function getToolExecutionQueue(): Queue<ToolExecutionJob> {
  if (!toolExecutionQueue) toolExecutionQueue = createToolExecutionQueue(getRedis());
  return toolExecutionQueue;
}

export function getPostCallQueue(): Queue<PostCallJob> {
  if (!postCallQueue) postCallQueue = createPostCallQueue(getRedis());
  return postCallQueue;
}

export function getWebhookQueue(): Queue<WebhookDeliveryJob> {
  if (!webhookQueue) webhookQueue = createWebhookQueue(getRedis());
  return webhookQueue;
}

