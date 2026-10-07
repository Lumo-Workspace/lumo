import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'
import type { SlidingWindowOptions, SlidingWindowStore } from './types'

/**
 * Vercel KV / Upstash sliding window — the hosted SaaS backend, configured
 * exactly as before LUM-1020 (same prefix, limits, analytics off).
 *
 * `@vercel/kv`'s client throws as soon as it is used without
 * `KV_REST_API_URL`/`KV_REST_API_TOKEN`, so the Upstash limiter is built
 * lazily on first use, never at module load.
 */
export function createUpstashSlidingWindow(
  options: SlidingWindowOptions
): SlidingWindowStore {
  let limiter: Ratelimit | null = null

  return {
    async limit(key) {
      if (!limiter) {
        limiter = new Ratelimit({
          redis: kv,
          limiter: Ratelimit.slidingWindow(
            options.max,
            `${options.windowMs / 1000} s`
          ),
          prefix: options.prefix,
          analytics: false,
        })
      }
      const res = await limiter.limit(key)
      return { success: res.success, remaining: res.remaining }
    },
    reset() {
      limiter = null
    },
  }
}
