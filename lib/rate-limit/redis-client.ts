import { createClient } from 'redis'
import { logger } from '@/lib/logger'

/** The one command the Redis sliding window needs. */
export interface RedisEvalClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>
}

/** How long the first command waits for the initial connection. */
const CONNECT_WAIT_MS = 2_000

interface SharedClient {
  url: string
  client: ReturnType<typeof createClient>
  ready: Promise<void>
  /** Set once a caller has done the bounded first-connect wait. */
  waited: boolean
}

let shared: SharedClient | null = null

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}

function connectShared(url: string): SharedClient {
  const client = createClient({ url, disableOfflineQueue: true })
  client.on('error', (err: unknown) => {
    logger.warn(`[rate-limit] Redis client error: ${errorMessage(err)}`)
  })
  const entry: SharedClient = {
    url,
    client,
    ready: Promise.resolve(),
    waited: false,
  }
  entry.ready = (async () => {
    try {
      await client.connect()
    } catch (err) {
      logger.warn(`[rate-limit] Redis connect failed: ${errorMessage(err)}`)
      // Drop the dead client so the next check builds a fresh one instead
      // of failing with ClientClosedError forever.
      if (shared === entry) shared = null
    }
  })()
  return entry
}

async function waitBounded(ready: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, CONNECT_WAIT_MS)
    timer.unref?.()
  })
  try {
    await Promise.race([ready, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Process-wide node-redis client for `REDIS_URL` (LUM-1020), connected on
 * first use and reused by every limiter.
 *
 * `disableOfflineQueue` makes commands reject immediately while the
 * connection is down (node-redis keeps reconnecting in the background)
 * instead of queueing forever, so callers can fail open/closed promptly.
 * Only the first caller after (re)creating the client waits — at most
 * `CONNECT_WAIT_MS` — for the initial connect; later calls never stall on it.
 * A client whose initial connect rejects is discarded and rebuilt on the
 * next call; a changed URL disconnects the old client.
 */
export async function getSharedRedisClient(
  url: string
): Promise<RedisEvalClient> {
  if (shared && shared.url !== url) {
    const old = shared.client
    shared = null
    try {
      await old.disconnect()
    } catch {
      // Already closed / never connected — nothing to release.
    }
  }
  if (!shared) shared = connectShared(url)

  const entry = shared
  if (!entry.waited) {
    entry.waited = true
    await waitBounded(entry.ready)
  }
  return entry.client
}

/** Test-only: forget the shared client (does not disconnect it). */
export function __resetSharedRedisClientForTests(): void {
  shared = null
}
