import 'dotenv/config';
import { Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { createRedis } from '../infra/redis.js';
import { executeTool } from '../services/tool-handlers.js';
import { publish } from '../services/event-bus.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const redis = createRedis();

const ToolJobSchema = z.object({
  type: z.literal('tool.execute'),
  callSessionId: z.string().uuid(),
  toolName: z.string().min(1),
  toolType: z.enum(['WEBHOOK', 'HTTP_REQUEST', 'DATABASE_LOOKUP', 'HUMAN_HANDOFF']),
  toolConfig: z.record(z.unknown()),
  args: z.record(z.unknown()),
});

new Worker(
  'voiceai-tools',
  async (job) => {
    const data = ToolJobSchema.parse(job.data);
    log.info({ callSessionId: data.callSessionId, toolName: data.toolName }, 'tool-worker executing');

    const result = await executeTool(data.toolType, data.toolConfig, data.args, {
      callSessionId: data.callSessionId,
    });
    await publish(data.callSessionId, 'tool.result', {
      toolName: data.toolName,
      async: true,
      result: JSON.stringify(result),
    });
    return result;
  },
  { connection: redis as any }
);

log.info('tool-worker running');

