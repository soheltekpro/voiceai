import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { createRedis } from '../infra/redis.js';
import { createHmac } from 'crypto';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const redis = createRedis();

const JobSchema = z.object({
  type: z.literal('webhook.deliver'),
  webhookId: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().min(1),
  event: z.object({
    id: z.string().min(1),
    callSessionId: z.string().min(1),
    name: z.string().min(1),
    ts: z.number(),
    payload: z.record(z.unknown()).optional(),
  }),
});

function sign(secret: string, body: string): string {
  const h = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${h}`;
}

new Worker(
  'voiceai-webhooks',
  async (job) => {
    const data = JobSchema.parse(job.data);
    const body = JSON.stringify({
      id: data.event.id,
      type: data.event.name,
      createdAt: new Date(data.event.ts).toISOString(),
      callSessionId: data.event.callSessionId,
      data: data.event.payload ?? {},
    });
    const signature = sign(data.secret, body);

    const res = await fetch(data.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'voiceai-webhook/1.0',
        'X-VoiceAI-Webhook-Id': data.webhookId,
        'X-VoiceAI-Signature': signature,
      },
      body,
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      log.warn({ webhookId: data.webhookId, status: res.status, body: text.slice(0, 200) }, 'webhook delivery failed');
      throw new Error(`Webhook HTTP ${res.status}`);
    }
    return { ok: true, status: res.status };
  },
  { connection: redis as any }
);

log.info('webhook-worker running');

