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
 *   - Always attaches a `.catch` to a *derived* promise and logs the rejection
 *     through `@/lib/logger`, so a failed background task never surfaces as an
 *     unhandled rejection. The caller's own promise is untouched: anyone else
 *     observing it still sees the rejection.
 *   - Always hands that derived promise to Vercel's `waitUntil`. Inside a
 *     Vercel request context this extends the function lifetime until the task
 *     settles; anywhere else it is the no-op described above. Deciding by the
 *     request context (not an env var such as `VERCEL`) means a context that
 *     exists is never skipped.
 *   - Self-hosted Node: the promise simply runs in the background of the
 *     long-lived server process. Work still in flight when the process exits
 *     (deploy, SIGTERM, crash) is lost — there is no drain on shutdown.
 */
import { waitUntil as vercelWaitUntil } from '@vercel/functions'
import { logger } from '@/lib/logger'

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
    // The logger itself must not be able to throw out of this handler: a throw
    // here would reject `observed` and recreate the very unhandled rejection
    // this wrapper exists to prevent (e.g. a broken console / log transport).
    try {
      logger.error('[waitUntil] background task failed:', err)
    } catch {
      // Swallowed on purpose — there is nowhere safer left to report it.
    }
  })
  vercelWaitUntil(observed)
}
