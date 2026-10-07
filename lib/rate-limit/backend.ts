import type { RateLimitBackendKind } from './types'

type RateLimitEnv = Readonly<Record<string, string | undefined>>

/**
 * Picks the rate-limit backend from the environment (LUM-1020), in priority
 * order:
 *
 * 1. `kv` — `KV_REST_API_URL` + `KV_REST_API_TOKEN` set: Vercel KV / Upstash
 *    over REST. This is the hosted SaaS path and is unchanged.
 * 2. `redis` — `REDIS_URL` set: any standard Redis (self-hosting,
 *    docker-compose).
 * 3. `memory` — nothing configured: a per-process in-memory window. Only
 *    correct for a single-instance deployment; with several instances (or
 *    serverless fan-out) each process counts on its own, so the effective
 *    limit is `max × instances` and restarts forget all history.
 *
 * Read on every check (not at module load), so env changes in tests and a
 * late-provisioned KV take effect without a reimport.
 */
export function selectRateLimitBackend(
  env: RateLimitEnv = process.env
): RateLimitBackendKind {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return 'kv'
  if (env.REDIS_URL) return 'redis'
  return 'memory'
}
