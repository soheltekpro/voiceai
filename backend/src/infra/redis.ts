import * as IORedis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';

export function createRedis(): RedisClient {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  const Ctor: any = (IORedis as any).default ?? (IORedis as any);
  return new Ctor(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

