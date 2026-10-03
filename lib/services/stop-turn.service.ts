import {
  recomputeAttributionOnly,
  recomputeAttributionSafely,
  replayBackfilledEvents,
} from '@/lib/attribution/trigger'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { parseChildSessionId } from '@/lib/session/child-session-id'
import { logger } from '@/lib/logger'

export interface StopTurnContext {
  sessionId: string
  /** The STOP event's record-time task (explicit, or provisional). */
  taskId: string | null
  workspaceId: string
  eventId: string
}

/** Is the session — or, for a subagent child, its parent — explicitly bound? */
async function isAttached(sessionId: string): Promise<boolean> {
  const own = await sessionRepository.findTaskAndAttribution(sessionId)
  if (own?.taskId) return true
  const child = parseChildSessionId(sessionId)
  if (!child) return false
  const parent = await sessionRepository.findTaskAndAttribution(
    child.parentSessionId
  )
  return !!parent?.taskId
}

/**
 * The task the STOP event belongs to after the recompute: its current
 * HookEvent.taskId. Falls back to the record-time task when the re-read fails.
 */
async function currentStopTask(ctx: StopTurnContext): Promise<string | null> {
  try {
    return await hookEventRepository.findTaskId(ctx.eventId)
  } catch (error) {
    logger.error('stopTurnService: STOP task re-read failed', {
      eventId: ctx.eventId,
      error,
    })
    return ctx.taskId
  }
}

/**
 * Layer 1 (memory + summary) for a task turn, else the summary-only call.
 * LUM-917: a workspace that turned AI-derived content off gets the
 * summary-only call too — the turn line of its session record stays, no
 * memory is extracted.
 */
async function extractOrSummarize(
  ctx: StopTurnContext,
  taskId: string | null
): Promise<void> {
  if (
    taskId &&
    (await aiDerivedContentService.isEnabled({ workspaceId: ctx.workspaceId }))
  ) {
    await layer1Service.triggerLayer1Extraction({
      sessionId: ctx.sessionId,
      taskId,
      workspaceId: ctx.workspaceId,
      stopEventId: ctx.eventId,
    })
    return
  }
  await turnSummaryService.generateAndStore({
    stopEventId: ctx.eventId,
    sessionId: ctx.sessionId,
  })
}

export const stopTurnService = {
  /**
   * Side effects of a STOP (end of a Claude Code turn), run detached by the
   * route. ONE model call per turn (LUM-773): Layer 1 extraction for a turn
   * that belongs to a task, else the summary-only call. Plus the LUM-932
   * attribution recompute.
   *
   * LUM-932 P3 (I4): for an UNATTACHED session the record-time tag may be
   * stale — this is the turn the recompute may move to another task — so the
   * recompute runs FIRST and Layer 1 uses the STOP event's task as re-read
   * afterwards. Attached sessions are unchanged: recompute and Layer 1 run
   * side by side on the bound task. Never throws.
   */
  async afterStop(ctx: StopTurnContext): Promise<void> {
    try {
      let attached: boolean
      try {
        attached = await isAttached(ctx.sessionId)
      } catch (error) {
        logger.error('stopTurnService: binding read failed', {
          sessionId: ctx.sessionId,
          error,
        })
        // Unknown binding: keep the record-time behaviour.
        attached = true
      }
      if (attached) {
        await Promise.all([
          recomputeAttributionSafely(ctx.sessionId),
          extractOrSummarize(ctx, ctx.taskId),
        ])
        return
      }
      // Layer 1 must not wait for the (sequential, bounded) detector replay.
      const res = await recomputeAttributionOnly(ctx.sessionId)
      await extractOrSummarize(ctx, await currentStopTask(ctx))
      await replayBackfilledEvents(ctx.sessionId, res)
    } catch (error) {
      logger.error('stopTurnService.afterStop failed', {
        sessionId: ctx.sessionId,
        error,
      })
    }
  },
}
