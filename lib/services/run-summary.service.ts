import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { logger } from '@/lib/logger'

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
  async generateForTask(taskId: string): Promise<RunSummaryResult> {
    let generated = 0
    let failed = 0
    let skippedEmpty = 0
    try {
      const sessions =
        await sessionRepository.listForTaskMissingRunSummary(taskId)
      if (sessions.length === 0) {
        return { generated, failed, skippedEmpty, degraded: false }
      }

      const task = await taskRepository.getTitleAndStatus(taskId)
      const taskTitle = task?.title ?? ''

      for (const s of sessions) {
        const turnSummaries = s.events
          .map(e => e.turnSummary)
          .filter((t): t is string => !!t && t.trim().length > 0)

        // No usable turn notes → leave runSummary null; nothing to summarize.
        if (turnSummaries.length === 0) {
          skippedEmpty++
          continue
        }

        try {
          const summary = await callRunSummaryLLM({ taskTitle, turnSummaries })
          await sessionRepository.setRunSummary(s.id, summary, new Date())
          generated++
        } catch (err) {
          failed++
          logger.warn(
            `[run-summary] failed to generate summary for session ${s.id}`,
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
  },
}
