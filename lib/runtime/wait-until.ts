/**
 * Runtime-neutral `waitUntil` (LUM-1022) — the only place in app/ and lib/
 * allowed to touch `@vercel/functions` (guarded by
 * __tests__/lib/runtime/vercel-functions-import-guard.test.ts and the ESLint
 * `no-restricted-imports` rule).
 *
 * Why a wrapper: `@vercel/functions@3.x` `waitUntil` reads the request context
 * from `globalThis[Symbol.for('@vercel/request-context')]` and calls
 * `getContext().waitUntil?.(promise)`. Off Vercel (`next start`, Docker) that
 * symbol is never installed, so the call is a silent no-op: the promise keeps
 * running (promises are eager) but nothing observes it — a rejection becomes an
 * unhandled rejection instead of a log line.
 *
 * Behavior:
 *   - Always attaches a `.catch` that logs the rejection through `@/lib/logger`,
 *     so a failed background task never surfaces as an unhandled rejection.
 *   - On Vercel (`process.env.VERCEL` set — Vercel injects it into every build
 *     and function) the observed promise is also handed to Vercel's
 *     `waitUntil`, which extends the function lifetime until it settles.
 *   - Self-hosted Node: the promise simply runs in the background of the
 *     long-lived server process. Work still in flight when the process exits
 *     (deploy, SIGTERM, crash) is lost — there is no drain on shutdown.
 */
import { waitUntil as vercelWaitUntil } from '@vercel/functions'
import { logger } from '@/lib/logger'

/** True when running on Vercel's platform (build or function runtime). */
export function isVercelRuntime(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.VERCEL)
}

/**
 * Schedule `promise` to finish after the response is sent. Never throws for a
 * rejected promise; the rejection is logged instead.
 */
export function waitUntil(promise: Promise<unknown>): void {
  if (
    promise === null ||
    typeof promise !== 'object' ||
    typeof (promise as { then?: unknown }).then !== 'function'
  ) {
    throw new TypeError(
      `waitUntil can only be called with a Promise, got ${typeof promise}`
    )
  }
  const observed = Promise.resolve(promise).catch((err: unknown) => {
    logger.error('[waitUntil] background task failed:', err)
  })
  if (isVercelRuntime()) vercelWaitUntil(observed)
}
