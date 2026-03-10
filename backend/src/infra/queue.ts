import { Queue } from 'bullmq';
import type { Redis as RedisClient } from 'ioredis';

export type PostCallJob =
  | { type: 'transcript.compact'; callSessionId: string }
  | { type: 'call.summary'; callSessionId: string };

export function createPostCallQueue(redis: RedisClient) {
  return new Queue<PostCallJob>('voiceai-postcall', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
}

export type CallStartJob = {
  type: 'call.start';
  callId: string;
  agentId: string;
  clientType: 'BROWSER' | 'PHONE' | 'UNKNOWN';
  /** Resolved region for multi-region voice routing. */
  regionId?: string;
  /** Regional WebSocket base URL (e.g. wss://voice-us.example.com) for client to connect. */
  regionalWsBaseUrl?: string | null;
};

export function createCallQueue(redis: RedisClient) {
  return new Queue<CallStartJob>('voiceai-calls', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
}

export type EmbeddingJob = {
  type: 'document.embed';
  documentId: string;
};

export function createEmbeddingQueue(redis: RedisClient) {
  return new Queue<EmbeddingJob>('voiceai-embeddings', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
}

export type ToolExecutionJob = {
  type: 'tool.execute';
  callSessionId: string;
  toolName: string;
  toolType: 'WEBHOOK' | 'HTTP_REQUEST' | 'DATABASE_LOOKUP' | 'HUMAN_HANDOFF';
  toolConfig: Record<string, unknown>;
  args: Record<string, unknown>;
};

export function createToolExecutionQueue(redis: RedisClient) {
  return new Queue<ToolExecutionJob>('voiceai-tools', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
}

export type WebhookDeliveryJob = {
  type: 'webhook.deliver';
  webhookId: string;
  url: string;
  secret: string;
  event: {
    id: string;
    callSessionId: string;
    name: string;
    ts: number;
    payload?: Record<string, unknown>;
  };
};

export function createWebhookQueue(redis: RedisClient) {
  return new Queue<WebhookDeliveryJob>('voiceai-webhooks', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 5000,
      removeOnFail: 10000,
    },
  });
}

