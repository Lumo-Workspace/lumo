import { logger } from '@/lib/logger'
import { autoBlockRepository } from '@/lib/repositories/auto-block.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import {
  aggregateSessionFailures,
  FAILURE_PROMPT_THRESHOLD,
  type SessionFailureRow,
} from '@/lib/services/session-failure-aggregate'

/** The shared, team-visible board tag this automation applies/removes. */
export const BLOCKED_TAG_NAME = 'blocked'

/**
 * Server-side automation of the old `lumo session wrap` blocked-tag section
 * (LUM-544, Section 3 — "方案 A"). It runs from the failure hooks
 * (POST_TOOL_USE_FAILURE / STOP_FAILURE) and the success hooks
 * (POST_TOOL_USE / STOP), entirely on the server — no CLI prompt, no `y`.
 *
 * ── This INVERTS LUM-153's manual gate ──────────────────────────────────────
 * LUM-153 deliberately made tagging the bound task `blocked` opt-in: a wrap
 * prompt the human answered `y` to, because `blocked` is SHARED, team-visible
 * board state and LUM-153 didn't want an agent silently flipping a board column.
 * LUM-544 inverts that: crossing the threshold now auto-applies the tag with NO
 * human in the loop. The inversion is safe ONLY because of three safeguards,
 * all enforced here + in auto-block.repository.ts:
 *
 *   (1) IDEMPOTENT — at most once. `insertIfAbsent` relies on the partial
 *       unique index `auto_blocks_active_task_uq` (one ACTIVE row per task).
 *       A second threshold crossing (same or later session) inserts nothing and
 *       returns false, so we never re-tag an already-tagged task. Re-crossing is
 *       a no-op.
 *   (2) AUTO-UNTAG ON PROGRESS — the block is not sticky. The next observable
 *       progress on the task (a SUCCESSFUL tool call or a non-failure turn end)
 *       resolves the ACTIVE auto-block and removes the tag. "Progress" is
 *       defined from what the server can see: a POST_TOOL_USE / STOP success
 *       event on a session bound to the task.
 *   (3) ATTRIBUTION — every auto-block records the triggering session + model
 *       (best-effort, from the session's usageByModel map) on the AutoBlock row,
 *       so the board shows who/what tripped it.
 *
 * The auto-untag NEVER touches a human-applied `blocked`: only a task carrying
 * an ACTIVE AutoBlock row (i.e. one Lumo applied) is cleared on progress — a tag
 * a teammate set by hand has no AutoBlock row and survives.
 *
 * Both entry points are best-effort and never throw — they run detached under
 * `waitUntil` from the hook routes, which have already returned 200.
 */
export const autoBlockService = {
  /**
   * Failure-side entry: called after a POST_TOOL_USE_FAILURE / STOP_FAILURE row
   * lands. Re-aggregate the session's failures; if the dominant group is at/over
   * threshold and the bound task has no live auto-block yet, apply the tag once
   * and record attribution.
   */
  async onFailureRecorded(sessionId: string | null): Promise<void> {
    try {
      if (!sessionId) return
      const session = await sessionRepository.findTaskAndAttribution(sessionId)
      if (!session?.taskId) return // unbound event → nothing to block

      const rows = (await hookEventRepository.findFailuresBySession(
        sessionId
      )) as SessionFailureRow[]
      const top = aggregateSessionFailures(rows)
      if (!top || top.count < FAILURE_PROMPT_THRESHOLD) return

      // Safeguard (1) idempotency: the insert no-ops (returns false) when an
      // ACTIVE auto-block already exists for this task, so we don't re-tag.
      const created = await autoBlockRepository.insertIfAbsent({
        taskId: session.taskId,
        triggeringSessionId: sessionId,
        model: pickModel(session.usageByModel),
        topFailureLabel: `${top.label} ×${top.count}`,
        failureCount: top.count,
      })
      if (!created) return

      const tagId = await ensureBlockedTagId(session.workspaceId)
      await tagRepository.addTaskTags(session.taskId, [tagId])
      logger.info(
        `[autoBlock] task=${session.taskId} blocked by session=${sessionId} (${top.label} ×${top.count})`
      )
    } catch (err) {
      logger.error(
        `[autoBlock] onFailureRecorded session=${sessionId} failed`,
        err
      )
    }
  },

  /**
   * Progress-side entry: called after a SUCCESSFUL tool/turn hook lands. If the
   * bound task carries an ACTIVE auto-block (i.e. one Lumo applied — safeguard
   * (2)), resolve it and remove the shared tag. Human-applied tags have no
   * AutoBlock row and are left alone.
   */
  async onProgressRecorded(sessionId: string | null): Promise<void> {
    try {
      if (!sessionId) return
      const session = await sessionRepository.findTaskAndAttribution(sessionId)
      if (!session?.taskId) return

      const resolved = await autoBlockRepository.resolveActiveByTask(
        session.taskId
      )
      if (resolved === 0) return // no auto-block (or human-applied tag) → leave it

      const tag = await tagRepository.findByName(
        session.workspaceId,
        BLOCKED_TAG_NAME
      )
      if (tag) await tagRepository.removeTaskTags(session.taskId, [tag.id])
      logger.info(
        `[autoBlock] task=${session.taskId} auto-unblocked on progress session=${sessionId}`
      )
    } catch (err) {
      logger.error(
        `[autoBlock] onProgressRecorded session=${sessionId} failed`,
        err
      )
    }
  },
}

/** Find-or-create the workspace `blocked` tag, return its id. */
async function ensureBlockedTagId(workspaceId: string): Promise<string> {
  const tags = await tagRepository.findOrCreateMany(workspaceId, [
    BLOCKED_TAG_NAME,
  ])
  const blocked = tags.find(t => t.name === BLOCKED_TAG_NAME)
  if (!blocked) {
    throw Object.assign(new Error('Failed to resolve blocked tag'), {
      status: 500,
    })
  }
  return blocked.id
}

/**
 * Best-effort raw model string for attribution: the first key of the session's
 * cumulative `usageByModel` map. Null when usage hasn't landed yet.
 */
function pickModel(usageByModel: unknown): string | null {
  if (!usageByModel || typeof usageByModel !== 'object') return null
  const keys = Object.keys(usageByModel as Record<string, unknown>)
  return keys.length > 0 ? keys[0]! : null
}
