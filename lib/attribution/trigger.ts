import { logger } from '@/lib/logger'
import type { RecomputeResult } from '@/lib/services/attribution.service'

/**
 * LUM-932 P2: recompute a session family's attribution segments, best-effort.
 * Dynamic import keeps the attribution stack out of every hook route's static
 * import graph (and out of unrelated jest suites). Never throws; null when the
 * recompute failed or there was no family.
 */
export async function recomputeAttributionOnly(
  sessionId: string
): Promise<RecomputeResult | null> {
  try {
    const { attributionService } =
      await import('@/lib/services/attribution.service')
    const res = await attributionService.recomputeFamily(sessionId)
    // P3: the recompute now rewrites event tags and moves open crossings.
    if (res && (res.eventsUpdated > 0 || res.crossingsMoved > 0)) {
      logger.info('attribution recompute retagged events', {
        sessionId,
        eventsUpdated: res.eventsUpdated,
        crossingsMoved: res.crossingsMoved,
        crossingsMovedToNull: res.crossingsMovedToNull,
      })
    }
    return res ?? null
  } catch (error) {
    logger.error('attribution recompute failed', { sessionId, error })
    return null
  }
}

/**
 * I1: POST_TOOL_USE events backfilled from no task to a task never met the
 * boundary detector with one — replay it on their stored payload. Never throws.
 */
export async function replayBackfilledEvents(
  sessionId: string,
  res: RecomputeResult | null
): Promise<void> {
  try {
    if (!res || res.backfilledPostToolEventIds.length === 0) return
    const { replayBoundaryDetection } =
      await import('@/lib/services/boundary-detector-replay.service')
    await replayBoundaryDetection(sessionId, res.backfilledPostToolEventIds)
  } catch (error) {
    logger.error('attribution recompute failed', { sessionId, error })
  }
}

/** Recompute then replay — for callers with nothing to run in between. */
export async function recomputeAttributionSafely(
  sessionId: string
): Promise<void> {
  const res = await recomputeAttributionOnly(sessionId)
  await replayBackfilledEvents(sessionId, res)
}
