import { createSlidingWindow } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * Generic sliding-window rate limiter for app endpoints (extracted from the
 * SARIF ingest limiter in LUM-983). Each caller builds its own limiter with
 * its own `prefix` and limits.
 *
 * The storage backend is pluggable (LUM-1020, `@/lib/rate-limit`) and chosen
 * per check from the env: Vercel KV / Upstash when
 * `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set (hosted SaaS), a standard
 * Redis when `REDIS_URL` is set (self-hosting), otherwise a per-instance
 * in-memory window — weaker (not shared across instances/deploys), but it
 * keeps the endpoint alive with nothing configured. A one-time warning is
 * logged when the memory fallback is in use.
 *
 * Rate limiting is a mitigation, never the auth boundary: when the KV/Redis
 * call itself fails, `check` fails open (allows the request) and logs a
 * warning.
 */
export interface SlidingWindowRateLimitOptions {
  /** Backend key prefix, unique per limiter (e.g. `sarif:rate`). */
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

export function createSlidingWindowRateLimiter(
  options: SlidingWindowRateLimitOptions
): SlidingWindowRateLimiter {
  const window = createSlidingWindow({
    prefix: options.prefix,
    max: options.max,
    windowMs: options.windowMs,
  })
  let warnedMemory = false

  return {
    async check(key: string): Promise<boolean> {
      try {
        const res = await window.limit(key)
        if (res.backend === 'memory' && !warnedMemory) {
          warnedMemory = true
          logger.warn(
            `[${options.logTag}] KV not configured (no KV_REST_API_URL/KV_REST_API_TOKEN or REDIS_URL) — using per-instance in-memory limiter`
          )
        }
        return res.success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(
          `[${options.logTag}] rate limit backend check failed, allowing request: ${message.slice(0, 200)}`
        )
        return true
      }
    },
    reset(): void {
      window.reset()
      warnedMemory = false
    },
  }
}
