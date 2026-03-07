import { Worker } from 'bullmq';
import { createRedis } from '../infra/redis.js';
import { prisma } from '../db/prisma.js';

const redis = createRedis();

// Minimal worker scaffold: extend with summarization, indexing, webhook retries, etc.
new Worker(
  'voiceai-postcall',
  async (job) => {
    const { type, callSessionId } = job.data as any;
    if (type === 'transcript.compact') {
      // Example: compress transcriptText from messages (noop placeholder)
      const msgs = await prisma.callMessage.findMany({
        where: { sessionId: callSessionId, role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: { createdAt: 'asc' },
        select: { role: true, text: true },
      });
      const compact = msgs.map((m) => `${m.role}: ${m.text}`).join('\n');
      await prisma.callSession.update({ where: { id: callSessionId }, data: { metadata: { transcript_compact: compact } as any } });
      return;
    }

    if (type === 'call.summary') {
      // Placeholder: generate a summary later (LLM) and store in metadata
      await prisma.callSession.update({
        where: { id: callSessionId },
        data: { metadata: { summary: 'TODO' } as any },
      });
      return;
    }
  },
  { connection: redis as any }
);

console.log('postcall-worker running');

