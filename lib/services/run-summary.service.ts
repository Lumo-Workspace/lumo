import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { buildRunSummaryInput } from '@/lib/services/run-summary/run-summary-input'
import { taskClaimSnapshotService } from '@/lib/services/task-claim-snapshot.service'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'
import { logger } from '@/lib/logger'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

/**
 * LUM-481: generate per-session run summaries for a just-completed task so the
 * delivery tab can show a plain-language recap of each Claude Code run.
 *
 * LUM-576: this no longer runs in the task route's ~15s post-completion
 * `waitUntil` — it's dispatched to a dedicated foreground worker
 * (POST /api/internal/run-summary, 300s budget). It still must NEVER throw —
 * every failure is logged and swallowed, both at the per-session level (one bad
 * session can't sink the rest) and at the outer level (a repo failure can't
 * surface to the caller). But unlike before, it now RETURNS an observable
 * result so a silent generation failure stops being invisible: `degraded` is
 * true when a session that had material to summarize errored, as distinct from
 * a session legitimately skipped for having no turn notes.
 */
export interface RunSummaryResult {
  /** Sessions that received a freshly generated runSummary. */
  generated: number
  /** Qualified sessions (had turn material) whose generation errored. */
  failed: number
  /** Sessions skipped because they had no turn material — legitimately empty. */
  skippedEmpty: number
  /**
   * True when at least one qualified session's generation errored (per-session
   * LLM failure) or the whole pass aborted (repo failure). A degraded pass is
   * the silent-failure mode the worker logs; a clean all-empty pass is not
   * degraded.
   */
  degraded: boolean
}

export const runSummaryService = {
  /**
   * DONE-time pass: summarize every session on the task that has no run summary
   * yet, then freeze the claim snapshot. Idempotent — already-summarized
   * sessions are skipped by the missing-summary query.
   */
  async generateForTask(taskId: string): Promise<RunSummaryResult> {
    const result = await generateSessionSummaries(taskId, { force: false })
    // LUM-573: once per-session summaries are committed, freeze the task-level
    // claim snapshot from the AUTHORITATIVE (merged-lineage) session so the
    // claim column stops echoing a trailing exploration session. Runs on every
    // pass — including when no session needed a summary — so already-summarized
    // tasks still get a snapshot. Best-effort & idempotent: synthesizeForTask
    // swallows its own errors and overwrites.
    await taskClaimSnapshotService.synthesizeForTask(taskId)
    return result
  },

  /**
   * LUM-579 force-regeneration: rebuild the run summary for EVERY session on the
   * task from its stored event stream, overwriting any existing (stale,
   * early-biased) summary, then re-freeze the claim snapshot. Used by the
   * backfill that repairs the sessions the old sparse-input generation
   * under-reported. Same never-throw / `degraded` contract as the DONE-time
   * pass.
   */
  async regenerateForTask(taskId: string): Promise<RunSummaryResult> {
    const result = await generateSessionSummaries(taskId, { force: true })
    await taskClaimSnapshotService.synthesizeForTask(taskId)
    return result
  },
}

/**
 * The per-session run-summary pass (LUM-481/576/579). Extracted so the
 * task-level claim-snapshot synthesis (LUM-573) always runs afterward regardless
 * of which return path this took. Never throws — every failure is logged and
 * folded into the observable `degraded` flag.
 *
 * `force` selects the session set: false = only sessions still missing a
 * summary (DONE-time); true = all sessions, overwriting stale summaries
 * (regeneration backfill). Either way each session's input is rebuilt from its
 * full compacted event stream (LUM-579), not the sparse `turnSummary` field.
 */
async function generateSessionSummaries(
  taskId: string,
  opts: { force: boolean }
): Promise<RunSummaryResult> {
  let generated = 0
  let failed = 0
  let skippedEmpty = 0
  try {
    // LUM-917: the workspace turned AI-derived content off — no run summary
    // is generated (the claim snapshot below still freezes from turn lines).
    // LUM-1338: likewise when the run-summary switch is off or no model.
    if (
      !(await aiDerivedContentService.isEnabled({ taskId })) ||
      !(await aiFeaturesService.isEnabled({ taskId }, 'runSummary'))
    ) {
      return { generated, failed, skippedEmpty, degraded: false }
    }
    const sessionIds = opts.force
      ? await sessionRepository.listSessionIdsForTask(taskId)
      : await sessionRepository.listForTaskMissingRunSummary(taskId)
    if (sessionIds.length === 0) {
      return { generated, failed, skippedEmpty, degraded: false }
    }

    const task = await taskRepository.getTitleAndStatus(taskId)
    const taskTitle = task?.title ?? ''

    for (const sessionId of sessionIds) {
      const events = (await sessionRepository.listEventsForSession(
        sessionId
      )) as unknown as RawEvent[]
      const eventLog = buildRunSummaryInput(events)

      // No tool calls and no turn narration → nothing to summarize; leave the
      // (possibly null) runSummary untouched.
      if (!eventLog) {
        skippedEmpty++
        continue
      }

      try {
        const summary = await callRunSummaryLLM({ taskTitle, eventLog })
        await sessionRepository.setRunSummary(sessionId, summary, new Date())
        generated++
      } catch (err) {
        failed++
        logger.warn(
          `[run-summary] failed to generate summary for session ${sessionId}`,
          err
        )
      }
    }

    return { generated, failed, skippedEmpty, degraded: failed > 0 }
  } catch (err) {
    logger.warn(
      `[run-summary] failed to generate run summaries for task ${taskId}`,
      err
    )
    // An outer failure (e.g. the session repo threw) is a degraded pass —
    // whatever we managed before the throw, plus an observable failure flag.
    return { generated, failed, skippedEmpty, degraded: true }
  }
}
