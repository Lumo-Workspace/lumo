/**
 * LUM-1030 — start the self-hosted Postgres World's in-process worker.
 *
 * The Postgres World runs its queue (graphile-worker) inside the Next.js
 * process and must be started once at boot: `world.start()` launches the
 * worker and re-enqueues every pending/running run, which is how an
 * in-flight export resumes after a restart. This follows the official
 * `instrumentation.ts` example (`(await getWorld()).start?.()` — `getWorld()`
 * is async since Workflow SDK 5), but only when the Postgres World is
 * selected — the Vercel World needs no start, and the Vercel deployment path
 * must not change.
 *
 * Node runtime only (imported lazily from `instrumentation.ts`).
 */
import { logger } from '@/lib/logger'
import {
  checkPostgresWorldConfig,
  resolveWorkflowWorld,
} from '@/lib/runtime/workflow-world'

interface StartableWorld {
  start?: () => Promise<void>
}

export interface StartDeps {
  /**
   * Resolves the runtime's world singleton (`workflow/runtime#getWorld`,
   * async since Workflow SDK 5 — a missed `await` would read `.start` off the
   * promise and silently never start the worker).
   */
  getWorld: () => Promise<StartableWorld>
}

async function defaultGetWorld(): Promise<StartableWorld> {
  const { getWorld } = await import('workflow/runtime')
  return await getWorld()
}

/**
 * Returns true when the Postgres World was started, false when another world
 * is selected (nothing to do). Throws on a configuration that cannot work, so
 * a misconfigured deployment fails at boot instead of on the first export.
 */
export async function startSelfHostedWorkflowWorld(
  env: NodeJS.ProcessEnv = process.env,
  deps: StartDeps = { getWorld: defaultGetWorld }
): Promise<boolean> {
  if (resolveWorkflowWorld(env) !== 'postgres') return false

  const { errors, warnings } = checkPostgresWorldConfig(env)
  for (const warning of warnings) logger.warn(`[workflow-world] ${warning}`)
  if (errors.length > 0) {
    throw new Error(`[workflow-world] ${errors.join('; ')}`)
  }

  const world = await deps.getWorld()
  await world.start?.()
  logger.info('[workflow-world] Postgres World started')
  return true
}
