import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCallQueue } from '../../infra/queues.js';

const ParamsSchema = z.object({
  jobId: z.string().min(1),
});

type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

function normalizeState(state: string): JobStatus {
  // BullMQ can return: completed, failed, active, waiting, delayed, paused, etc.
  if (state === 'active') return 'active';
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  return 'waiting';
}

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /jobs/:jobId
   * Looks up a job from the call queue (used by POST /calls/start).
   */
  app.get('/jobs/:jobId', async (req, reply) => {
    const { jobId } = ParamsSchema.parse(req.params);
    const queue = getCallQueue();
    const job = await queue.getJob(jobId);
    if (!job) return reply.code(404).send({ message: 'Job not found' });

    const state = await job.getState();
    const status = normalizeState(state);
    const result = status === 'completed' ? (job.returnvalue ?? null) : null;

    return {
      jobId: String(job.id),
      status,
      result,
    };
  });
}

