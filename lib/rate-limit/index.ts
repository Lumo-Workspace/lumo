import { selectRateLimitBackend } from './backend'
import { createMemorySlidingWindow } from './memory-sliding-window'
import { getSharedRedisClient } from './redis-client'
import { createRedisSlidingWindow } from './redis-sliding-window'
import type {
  RateLimitBackendKind,
  SlidingWindowOptions,
  SlidingWindowResult,
  SlidingWindowStore,
} from './types'
import { createUpstashSlidingWindow } from './upstash-sliding-window'

export { selectRateLimitBackend } from './backend'
export type {
  RateLimitBackendKind,
  SlidingWindowOptions,
  SlidingWindowResult,
} from './types'

export interface SlidingWindow {
  /**
   * Records a hit for `key` on the backend selected *now* from the env
   * (KV → Redis → memory, see `selectRateLimitBackend`). Backend errors
   * propagate — callers decide whether to fail open or closed.
   */
  limit(key: string): Promise<SlidingWindowResult>
  /** Test-only: drop every backend's local state. */
  reset(): void
}

function buildStore(
  kind: RateLimitBackendKind,
  options: SlidingWindowOptions
): SlidingWindowStore {
  switch (kind) {
    case 'kv':
      return createUpstashSlidingWindow(options)
    case 'redis':
      return createRedisSlidingWindow(options, () =>
        getSharedRedisClient(process.env.REDIS_URL ?? '')
      )
    case 'memory':
      return createMemorySlidingWindow(options)
  }
}

/**
 * Pluggable sliding-window rate limiter (LUM-1020): the single entry point
 * for app code — never import `@upstash/ratelimit`, `@vercel/kv` or `redis`
 * directly. Each backend's store is built lazily on first use.
 */
export function createSlidingWindow(
  options: SlidingWindowOptions
): SlidingWindow {
  const stores = new Map<RateLimitBackendKind, SlidingWindowStore>()

  return {
    async limit(key) {
      const backend = selectRateLimitBackend()
      let store = stores.get(backend)
      if (!store) {
        store = buildStore(backend, options)
        stores.set(backend, store)
      }
      const res = await store.limit(key)
      return { ...res, backend }
    },
    reset() {
      for (const store of stores.values()) store.reset()
      stores.clear()
    },
  }
}
