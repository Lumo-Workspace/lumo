import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'

/**
 * SARIF ingest rate limit — spec R1c. This is a mitigation on top of the
 * auth boundary (OIDC / API key verification), not the auth boundary
 * itself, so a limiter failure must never take the ingest path down.
 *
 * The KV-or-memory sliding-window mechanism (Upstash when
 * `KV_REST_API_URL`/`KV_REST_API_TOKEN` are configured, per-instance
 * in-memory window otherwise, fail-open when Upstash errors, lazy client
 * construction) lives in `sliding-window-rate-limit.ts` (LUM-983); this
 * module only fixes the SARIF prefix and limits.
 */
export const SARIF_INGEST_RATE_LIMIT = { max: 30, windowMs: 60_000 }

const limiter = createSlidingWindowRateLimiter({
  prefix: 'sarif:rate',
  max: SARIF_INGEST_RATE_LIMIT.max,
  windowMs: SARIF_INGEST_RATE_LIMIT.windowMs,
  logTag: 'security-sarif-rate-limit',
})

export async function checkSarifIngestRateLimit(key: string): Promise<void> {
  const allowed = await limiter.check(key)
  if (!allowed) {
    throw Object.assign(new Error('Rate limit exceeded (30 req/min)'), {
      status: 429,
    })
  }
}

/** Test-only: reset module-level state between test cases. */
export function __resetRateLimiterForTests(): void {
  limiter.reset()
}
