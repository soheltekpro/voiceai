import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Redis as RedisClient } from 'ioredis';

export async function registerRateLimiting(app: FastifyInstance, redis: RedisClient): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    redis: redis as any,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  // Per-route configs are applied via route options, but we expose helpers in code.
}

