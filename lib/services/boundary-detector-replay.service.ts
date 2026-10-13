import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { logger } from '@/lib/logger'

/** Events replayed per recompute; the rest are logged and skipped. */
export const MAX_REPLAYED_EVENTS = 200

/**
 * LUM-932 P3 (I1): run the boundary detector on POST_TOOL_USE events that an
 * attribution recompute moved from NO task to a task. At record time such an
 * event had no task, so the post-tool detector never ran on it with one —
 * without this replay that work could reach DONE unchecked.
 *
 * Replays from the STORED payload: credential-redacted and stripped of file
 * content / tool output (LUM-855/859). Command-shaped detectors (forbidden
 * actions, project action rules, sensitive paths) work on it; detectors that
 * need the unredacted payload or the written content — hardcoded-secret
 * scanning, content-based test tampering — cannot be replayed and simply find
 * nothing. The event's CURRENT task is used; events no longer on a task, not
 * POST_TOOL_USE, or with a pruned payload, or that already own a crossing are skipped. Bounded to
 * MAX_REPLAYED_EVENTS, sequential, and fail-soft: never throws.
 */
export async function replayBoundaryDetection(
  sessionId: string,
  eventIds: string[]
): Promise<{ replayed: number; truncated: boolean }> {
  if (eventIds.length === 0) return { replayed: 0, truncated: false }
  const truncated = eventIds.length > MAX_REPLAYED_EVENTS
  if (truncated) {
    logger.warn('boundary detector replay truncated', {
      sessionId,
      replayed: MAX_REPLAYED_EVENTS,
      skipped: eventIds.length - MAX_REPLAYED_EVENTS,
    })
  }
  let rows: Awaited<
    ReturnType<typeof hookEventRepository.findForDetectorReplay>
  >
  let owned: Set<string>
  try {
    const ids = eventIds.slice(0, MAX_REPLAYED_EVENTS)
    rows = await hookEventRepository.findForDetectorReplay(ids)
    // An event that already owns a crossing (e.g. flipped A -> null -> B with
    // its crossing moved along) was detected before — never detect it twice.
    owned = await boundaryCrossingRepository.hookEventIdsWithCrossing(ids)
  } catch (error) {
    logger.error('boundary detector replay load failed', { sessionId, error })
    return { replayed: 0, truncated }
  }
  let replayed = 0
  for (const e of rows) {
    if (
      owned.has(e.id) ||
      !e.taskId ||
      e.type !== 'POST_TOOL_USE' ||
      e.payloadPrunedAt !== null ||
      e.payload === null
    )
      continue
    try {
      await boundaryDetectorService.detectAndRecord({
        taskId: e.taskId,
        hookEventId: e.id,
        toolName: e.toolName,
        filePath: e.filePath,
        payload: e.payload,
        sessionId,
        occurredAt: e.createdAt,
      })
      replayed++
    } catch (error) {
      logger.error('boundary detector replay failed', {
        sessionId,
        hookEventId: e.id,
        error,
      })
    }
  }
  return { replayed, truncated }
}
