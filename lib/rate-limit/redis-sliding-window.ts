import { randomUUID } from 'node:crypto'
import type { RedisEvalClient } from './redis-client'
import type { SlidingWindowOptions, SlidingWindowStore } from './types'

/**
 * Atomic sliding-window log on a sorted set: drop entries older than the
 * window, refuse when `max` live entries remain, otherwise record this hit
 * and refresh the key's TTL. Returns `{allowed (1|0), remaining}`.
 */
export const REDIS_SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= max then
  return {0, 0}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, max - count - 1}
`

/**
 * Standard-Redis sliding window (`REDIS_URL`, LUM-1020) — shared across all
 * instances pointing at the same Redis, so it is the backend to use for
 * multi-instance self-hosting. Keys are `<prefix>:<key>`. Timestamps come
 * from the app server's clock, so instances should be NTP-synced.
 *
 * `getClient` and `now` are injectable for tests.
 */
export function createRedisSlidingWindow(
  options: SlidingWindowOptions,
  getClient: () => Promise<RedisEvalClient>,
  now: () => number = Date.now
): SlidingWindowStore {
  return {
    async limit(key) {
      const client = await getClient()
      const ts = now()
      const reply = await client.eval(REDIS_SLIDING_WINDOW_SCRIPT, {
        keys: [`${options.prefix}:${key}`],
        arguments: [
          String(ts),
          String(options.windowMs),
          String(options.max),
          `${ts}:${randomUUID()}`,
        ],
      })
      const [allowed, remaining] = Array.isArray(reply) ? reply : []
      return {
        success: Number(allowed) === 1,
        remaining: Number(remaining ?? 0),
      }
    },
    reset() {
      // Nothing local: the window lives in Redis.
    },
  }
}
