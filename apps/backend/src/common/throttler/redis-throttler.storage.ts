import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../../redis/redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Atomic fixed-window counter with optional block period. Shared across all API instances.
const SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { tonumber(redis.call('GET', hitsKey) or limit + 1), redis.call('PTTL', hitsKey), 1, blockTtl }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local ttlLeft = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  return { hits, ttlLeft, 1, blockMs }
end
return { hits, ttlLeft, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, ttlLeft, blocked, blockLeft] = (await this.redis.client.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlLeft / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockLeft / 1000)),
    };
  }
}
