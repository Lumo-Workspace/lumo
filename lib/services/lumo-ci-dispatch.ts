/**
 * LUM-746 — dispatch helper for the Lumo-managed CI, safe to import
 * statically from the webhook handlers and task-pr-link.service: no GitHub /
 * sandbox / workflow imports at module load (the request service, which has
 * them, is loaded lazily), and best-effort — a failure is logged and
 * swallowed so a PR webhook or a link call never fails because CI is down.
 */
import { logger } from '@/lib/logger'
import type { CiRequestTrigger } from './lumo-ci-request.service'

export async function dispatchLumoCi(
  pullRequestId: string,
  trigger: CiRequestTrigger,
  headSha?: string
): Promise<void> {
  try {
    const { lumoCiRequestService } = await import('./lumo-ci-request.service')
    await lumoCiRequestService.requestRun({
      pullRequestId,
      trigger,
      ...(headSha !== undefined ? { headSha } : {}),
    })
  } catch (error) {
    logger.warn(
      `[lumo-ci] dispatch failed pr=${pullRequestId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
