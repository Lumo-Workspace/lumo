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

let shared: {
  url: string
  client: RedisEvalClient
  ready: Promise<void>
} | null = null

/**
 * Process-wide node-redis client for `REDIS_URL` (LUM-1020), connected on
 * first use and reused by every limiter.
 *
 * `disableOfflineQueue` makes commands reject immediately while the
 * connection is down (node-redis keeps reconnecting in the background)
 * instead of queueing forever, so callers can fail open/closed promptly. The
 * first caller waits at most `CONNECT_WAIT_MS` for the initial connect.
 */
export async function getSharedRedisClient(
  url: string
): Promise<RedisEvalClient> {
  if (!shared || shared.url !== url) {
    const client = createClient({ url, disableOfflineQueue: true })
    client.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`[rate-limit] Redis client error: ${message.slice(0, 200)}`)
    })
    const ready = (async () => {
      try {
        await client.connect()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(
          `[rate-limit] Redis connect failed: ${message.slice(0, 200)}`
        )
      }
    })()
    shared = { url, client, ready }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, CONNECT_WAIT_MS)
    timer.unref?.()
  })
  await Promise.race([shared.ready, timeout])
  if (timer) clearTimeout(timer)
  return shared.client
}

/** Test-only: forget the shared client (does not disconnect it). */
export function __resetSharedRedisClientForTests(): void {
  shared = null
}
