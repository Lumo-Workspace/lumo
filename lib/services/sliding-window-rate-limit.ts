import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'
import { logger } from '@/lib/logger'

/**
 * Generic KV-or-memory sliding-window rate limiter (extracted from the SARIF
 * ingest limiter in LUM-983). Each caller builds its own limiter with its own
 * `prefix` and limits.
 *
 * When `KV_REST_API_URL`/`KV_REST_API_TOKEN` are configured, an Upstash
 * sliding-window limiter backed by @vercel/kv is used (shared across
 * instances). Otherwise this falls back to a per-instance in-memory sliding
 * window — weaker (not shared across instances/deploys), but it keeps the
 * endpoint alive in environments with no KV configured (e.g. this project
 * today). Constructing the Upstash `kv` client throws immediately if those
 * env vars are missing, so the Upstash limiter is lazily constructed on first
 * use rather than at module load time — otherwise merely importing a module
 * that builds a limiter would crash the route.
 *
 * Rate limiting is a mitigation, never the auth boundary: when the Upstash
 * call itself fails, `check` fails open (allows the request) and logs a
 * warning.
 */
export interface SlidingWindowRateLimitOptions {
  /** Upstash key prefix, unique per limiter (e.g. `sarif:rate`). */
  prefix: string
  /** Max requests allowed per key inside the window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Tag used in log lines, e.g. `security-sarif-rate-limit`. */
  logTag: string
}

export interface SlidingWindowRateLimiter {
  /** Records a hit for `key`; resolves `false` when the key is over the limit. */
  check(key: string): Promise<boolean>
  /** Test-only: clear this limiter's state. */
  reset(): void
}

const MEMORY_MAX_KEYS = 10_000

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

export function createSlidingWindowRateLimiter(
  options: SlidingWindowRateLimitOptions
): SlidingWindowRateLimiter {
  let upstashLimiter: Ratelimit | null = null
  let warnedNoKv = false
  const memoryHits = new Map<string, number[]>()

  function getUpstashLimiter(): Ratelimit {
    if (!upstashLimiter) {
      upstashLimiter = new Ratelimit({
        redis: kv,
        limiter: Ratelimit.slidingWindow(
          options.max,
          `${options.windowMs / 1000} s`
        ),
        prefix: options.prefix,
        analytics: false,
      })
    }
    return upstashLimiter
  }

  function checkMemory(key: string): boolean {
    const now = Date.now()
    const windowStart = now - options.windowMs

    let hits = memoryHits.get(key)
    if (hits) {
      // Refresh recency for the map's crude "oldest first" eviction below.
      memoryHits.delete(key)
    }
    hits = (hits ?? []).filter(ts => ts > windowStart)

    if (hits.length >= options.max) {
      memoryHits.set(key, hits)
      return false
    }

    hits.push(now)
    memoryHits.set(key, hits)

    while (memoryHits.size > MEMORY_MAX_KEYS) {
      const oldestKey = memoryHits.keys().next().value
      if (oldestKey === undefined) break
      memoryHits.delete(oldestKey)
    }

    return true
  }

  return {
    async check(key: string): Promise<boolean> {
      if (!kvConfigured()) {
        if (!warnedNoKv) {
          warnedNoKv = true
          logger.warn(
            `[${options.logTag}] KV not configured — using per-instance in-memory limiter`
          )
        }
        return checkMemory(key)
      }

      try {
        const res = await getUpstashLimiter().limit(key)
        return res.success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(
          `[${options.logTag}] Upstash rate limit check failed, allowing request: ${message.slice(0, 200)}`
        )
        return true
      }
    },
    reset(): void {
      upstashLimiter = null
      warnedNoKv = false
      memoryHits.clear()
    },
  }
}
