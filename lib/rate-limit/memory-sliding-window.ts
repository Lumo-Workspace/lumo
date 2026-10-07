import type { SlidingWindowOptions, SlidingWindowStore } from './types'

/** Cap on tracked keys so a key-spraying client can't grow memory unbounded. */
export const MEMORY_MAX_KEYS = 10_000

/**
 * In-process sliding-window log (fallback when neither KV nor Redis is
 * configured).
 *
 * SINGLE-INSTANCE SEMANTICS: state lives in this process's memory. It is
 * exact for one long-lived server process, but it is NOT shared across
 * instances, serverless invocations or deploys — N instances admit up to
 * N × `max` requests per window, and a restart resets every key. Configure
 * `REDIS_URL` (or Vercel KV) for multi-instance deployments.
 *
 * `now` is injectable for tests.
 */
export function createMemorySlidingWindow(
  options: SlidingWindowOptions,
  now: () => number = Date.now
): SlidingWindowStore {
  const hits = new Map<string, number[]>()

  return {
    async limit(key) {
      const ts = now()
      const windowStart = ts - options.windowMs

      const previous = hits.get(key)
      // Re-insert to refresh recency for the "oldest first" eviction below.
      if (previous) hits.delete(key)
      const live = (previous ?? []).filter(t => t > windowStart)

      if (live.length >= options.max) {
        hits.set(key, live)
        return { success: false, remaining: 0 }
      }

      live.push(ts)
      hits.set(key, live)

      while (hits.size > MEMORY_MAX_KEYS) {
        const oldestKey = hits.keys().next().value
        if (oldestKey === undefined) break
        hits.delete(oldestKey)
      }

      return { success: true, remaining: options.max - live.length }
    },
    reset() {
      hits.clear()
    },
  }
}
