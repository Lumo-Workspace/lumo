import { taskDecisionRepository } from '@/lib/repositories/task-decision.repository'
import { splitDecisionsSection } from '@/lib/task-templates/decisions'

const PAGE = 200

export interface DecisionBackfillResult {
  /** Tasks whose description had a `## Decisions` section. */
  tasks: number
  /** Decisions moved (or, on a dry run, that would be). */
  decisions: number
  /** Tasks skipped because the description changed mid-run. */
  skippedConcurrentEdit: number
}

/**
 * LUM-1303: move every task's LUM-970 `## Decisions` section into the
 * TaskDecision table and strip it from the description. Idempotent: a moved
 * task no longer has the section, so a re-run skips it.
 *
 * A decision with no date of its own takes the task's last update time, and
 * dated ones keep their order within the day by a one-second step.
 */
export async function backfillTaskDecisions(opts: {
  dryRun: boolean
  /** Tasks read per page (tests use a tiny page to cross page boundaries). */
  pageSize?: number
}): Promise<DecisionBackfillResult> {
  const pageSize = opts.pageSize ?? PAGE
  const result: DecisionBackfillResult = {
    tasks: 0,
    decisions: 0,
    skippedConcurrentEdit: 0,
  }
  let afterId: string | null = null
  for (;;) {
    const page = await taskDecisionRepository.listTasksWithDecisionsHeading(
      afterId,
      pageSize
    )
    if (page.length === 0) break
    afterId = page[page.length - 1]!.id
    for (const task of page) {
      const split = splitDecisionsSection(task.description)
      if (!split || !task.description) continue
      result.tasks++
      result.decisions += split.decisions.length
      if (opts.dryRun) continue
      const moved = await taskDecisionRepository.moveFromDescription({
        taskId: task.id,
        workspaceId: task.workspaceId,
        expectedDescription: task.description,
        description: split.description,
        decisions: split.decisions.map((d, i) => ({
          text: d.text,
          createdAt: new Date((d.date ?? task.updatedAt).getTime() + i * 1000),
        })),
      })
      if (!moved) result.skippedConcurrentEdit++
    }
    if (page.length < pageSize) break
  }
  return result
}
