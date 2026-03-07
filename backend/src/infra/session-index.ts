import type { Redis as RedisClient } from 'ioredis';

/**
 * Redis-backed session index for horizontal scaling.
 *
 * Stores which backend instance owns a callSessionId.
 * This supports:
 * - ops/debugging ("where is this call running?")
 * - future: routing decisions for /events fanout across nodes
 */
export class RedisSessionIndex {
  constructor(private redis: RedisClient, private instanceId: string) {}

  private key(callSessionId: string) {
    return `voiceai:callSession:${callSessionId}:owner`;
  }

  async setOwner(callSessionId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(callSessionId), this.instanceId, 'EX', ttlSeconds);
  }

  async getOwner(callSessionId: string): Promise<string | null> {
    return this.redis.get(this.key(callSessionId));
  }

  async clearOwner(callSessionId: string): Promise<void> {
    await this.redis.del(this.key(callSessionId));
  }
}

