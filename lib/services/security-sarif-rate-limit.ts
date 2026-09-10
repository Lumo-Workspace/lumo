import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'
import { logger } from '@/lib/logger'

/**
 * SARIF ingest rate limit — spec R1c. This is a mitigation on top of the
 * auth boundary (OIDC / API key verification), not the auth boundary
 * itself, so a limiter failure must never take the ingest path down.
 *
 * When `KV_REST_API_URL`/`KV_REST_API_TOKEN` are configured, an Upstash
 * sliding-window limiter backed by @vercel/kv is used (shared across
 * instances). Otherwise this falls back to a per-instance in-memory
 * sliding window — weaker (not shared across instances/deploys), but it
 * keeps the endpoint alive in environments with no KV configured (e.g.
 * this project today). Constructing the Upstash `kv` client throws
 * immediately if those env vars are missing, so the Upstash limiter is
 * lazily constructed on first use rather than at module load time —
 * otherwise merely importing this module would crash the route.
 */
export const SARIF_INGEST_RATE_LIMIT = { max: 30, windowMs: 60_000 }

let upstashLimiter: Ratelimit | null = null
let warnedNoKv = false

const memoryHits = new Map<string, number[]>()
const MEMORY_MAX_KEYS = 10_000

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

function getUpstashLimiter(): Ratelimit {
  if (!upstashLimiter) {
    upstashLimiter = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(
        SARIF_INGEST_RATE_LIMIT.max,
        `${SARIF_INGEST_RATE_LIMIT.windowMs / 1000} s`
      ),
      prefix: 'sarif:rate',
      analytics: false,
    })
  }
  return upstashLimiter
}

function checkMemoryRateLimit(key: string): boolean {
  const now = Date.now()
  const windowStart = now - SARIF_INGEST_RATE_LIMIT.windowMs

  let hits = memoryHits.get(key)
  if (hits) {
    // Refresh recency for the map's crude "oldest first" eviction below.
    memoryHits.delete(key)
  }
  hits = (hits ?? []).filter(ts => ts > windowStart)

  if (hits.length >= SARIF_INGEST_RATE_LIMIT.max) {
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

export async function checkSarifIngestRateLimit(key: string): Promise<void> {
  if (!kvConfigured()) {
    if (!warnedNoKv) {
      warnedNoKv = true
      logger.warn(
        '[security-sarif-rate-limit] KV not configured — using per-instance in-memory limiter'
      )
    }
    const allowed = checkMemoryRateLimit(key)
    if (!allowed) {
      throw Object.assign(new Error('Rate limit exceeded (30 req/min)'), {
        status: 429,
      })
    }
    return
  }

  let res: { success: boolean }
  try {
    res = await getUpstashLimiter().limit(key)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(
      `[security-sarif-rate-limit] Upstash rate limit check failed, allowing request: ${message.slice(0, 200)}`
    )
    return
  }

  if (!res.success) {
    throw Object.assign(new Error('Rate limit exceeded (30 req/min)'), {
      status: 429,
    })
  }
}

/** Test-only: reset module-level state between test cases. */
export function __resetRateLimiterForTests(): void {
  upstashLimiter = null
  warnedNoKv = false
  memoryHits.clear()
}
