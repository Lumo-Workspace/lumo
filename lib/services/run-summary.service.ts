import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { logger } from '@/lib/logger'

/**
 * LUM-481: generate per-session run summaries for a just-completed task so the
 * delivery tab can show a plain-language recap of each Claude Code run.
 *
 * Runs inside a DONE-hook `waitUntil` (fire-and-forget), so it must NEVER throw
 * — every failure is logged and swallowed, both at the per-session level (one
 * bad session can't sink the rest) and at the outer level (a repo failure can't
 * surface to the caller).
 */
export const runSummaryService = {
  async generateForTask(taskId: string): Promise<void> {
    try {
      const sessions =
        await sessionRepository.listForTaskMissingRunSummary(taskId)
      if (sessions.length === 0) return

      const task = await taskRepository.getTitleAndStatus(taskId)
      const taskTitle = task?.title ?? ''

      for (const s of sessions) {
        const turnSummaries = s.events
          .map(e => e.turnSummary)
          .filter((t): t is string => !!t && t.trim().length > 0)

        // No usable turn notes → leave runSummary null; nothing to summarize.
        if (turnSummaries.length === 0) continue

        try {
          const summary = await callRunSummaryLLM({ taskTitle, turnSummaries })
          await sessionRepository.setRunSummary(s.id, summary, new Date())
        } catch (err) {
          logger.warn(
            `[run-summary] failed to generate summary for session ${s.id}`,
            err
          )
        }
      }
    } catch (err) {
      logger.warn(
        `[run-summary] failed to generate run summaries for task ${taskId}`,
        err
      )
    }
  },
}
