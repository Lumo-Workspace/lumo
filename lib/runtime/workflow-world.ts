/**
 * LUM-1030 — which Workflow "World" (durable backend) this deployment runs on,
 * and the self-hosting checks for the Postgres World.
 *
 * On Vercel the runtime picks the Vercel World by itself and nothing here
 * changes that. A self-hosted deployment selects the Postgres World with
 *
 *     WORKFLOW_TARGET_WORLD=@workflow/world-postgres
 *     WORKFLOW_POSTGRES_URL=postgres://…   (a DIRECT connection, see below)
 *
 * — the exact names `@workflow/core` (`createWorld`, via `require` of the
 * target package) and `@workflow/world-postgres` (`createWorld` reads
 * `WORKFLOW_POSTGRES_URL`) read. Pure and edge-safe: no Node imports, so
 * `instrumentation.ts` may import it in either runtime.
 */
import { usesVercelWorkflowWorld } from '@/lib/api/workflow-delivery-auth'

export const POSTGRES_WORLD_PACKAGE = '@workflow/world-postgres'

export type WorkflowWorldKind = 'vercel' | 'postgres' | 'local' | 'other'

/**
 * Mirrors `resolveWorkflowTargetWorld` in `@workflow/utils` (explicit
 * `WORKFLOW_TARGET_WORLD` wins, else a Vercel deployment id selects Vercel,
 * else the in-memory Local World).
 */
export function resolveWorkflowWorld(
  env: NodeJS.ProcessEnv
): WorkflowWorldKind {
  if (usesVercelWorkflowWorld(env)) return 'vercel'
  const target = env.WORKFLOW_TARGET_WORLD
  if (!target || target === 'local' || target === '@workflow/world-local') {
    return 'local'
  }
  return target === POSTGRES_WORLD_PACKAGE ? 'postgres' : 'other'
}

/**
 * Ruling ② (LUM-1030): the Postgres World's queue (graphile-worker) wakes on
 * LISTEN/NOTIFY. Through a transaction-mode pooler (PgBouncer, Neon's
 * `-pooler` endpoint) NOTIFY is dropped — LUM-1029 saw pgbouncer log
 * `got packet 'A' from server when not linked` — and every job then waits for
 * graphile's 500 ms poll. Runs still complete, slower, so this is a warning,
 * not a refusal. Heuristic: a `-pooler` host label (Neon, Supabase), the
 * PgBouncer default port 6432, or an explicit `pgbouncer=true` parameter.
 */
export function looksLikePoolerUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (/(^|[.-])pooler([.-]|$)/i.test(parsed.hostname)) return true
  if (parsed.port === '6432') return true
  return parsed.searchParams.get('pgbouncer')?.toLowerCase() === 'true'
}

/** `user:password@` removed, for log lines. */
export function redactConnectionUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1[redacted]@')
}

export interface PostgresWorldConfigCheck {
  /** Misconfigurations that make the world unusable — refuse to start. */
  errors: string[]
  /** Degraded-but-working setups the operator should fix. */
  warnings: string[]
}

/**
 * Startup checks for the Postgres World. Only meaningful when
 * `resolveWorkflowWorld(env) === 'postgres'`.
 */
export function checkPostgresWorldConfig(
  env: NodeJS.ProcessEnv
): PostgresWorldConfigCheck {
  const errors: string[] = []
  const warnings: string[] = []

  const url = env.WORKFLOW_POSTGRES_URL
  if (!url) {
    // world-postgres would silently fall back to postgres://world:world@localhost.
    errors.push(
      'WORKFLOW_POSTGRES_URL is not set; the Postgres World needs a direct (non-pooler) connection string'
    )
  } else if (looksLikePoolerUrl(url)) {
    warnings.push(
      `WORKFLOW_POSTGRES_URL (${redactConnectionUrl(url)}) looks like a connection pooler. ` +
        'LISTEN/NOTIFY does not survive a transaction-mode pooler, so every workflow job waits for the 500 ms poll. ' +
        'Use the direct (unpooled) connection string.'
    )
  }

  // LUM-1031: every delivery is refused (401) without the secret, and the
  // worker presents it only through WORKFLOW_LOCAL_BASE_URL's userinfo.
  if (!env.WORKFLOW_SECRET) {
    warnings.push(
      'WORKFLOW_SECRET is not set; every workflow delivery will be rejected (401). See docs/self-hosting/workflow.md'
    )
  }
  const baseUrl = env.WORKFLOW_LOCAL_BASE_URL
  if (!baseUrl) {
    warnings.push(
      'WORKFLOW_LOCAL_BASE_URL is not set; the worker cannot present WORKFLOW_SECRET and every delivery will be rejected (401)'
    )
  } else {
    let parsed: URL | null = null
    try {
      parsed = new URL(baseUrl)
    } catch {
      warnings.push('WORKFLOW_LOCAL_BASE_URL is not a valid URL')
    }
    if (parsed && !parsed.password) {
      warnings.push(
        'WORKFLOW_LOCAL_BASE_URL carries no credentials (expected http://workflow:<url-encoded WORKFLOW_SECRET>@localhost:<PORT>); every delivery will be rejected (401)'
      )
    }
    if (parsed?.port && env.PORT && parsed.port !== env.PORT) {
      warnings.push(
        `WORKFLOW_LOCAL_BASE_URL port ${parsed.port} differs from PORT ${env.PORT}; the in-process worker delivers to that URL`
      )
    }
  }
  return { errors, warnings }
}
