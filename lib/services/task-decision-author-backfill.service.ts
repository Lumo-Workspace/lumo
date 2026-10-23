import { taskDecisionRepository } from '@/lib/repositories/task-decision.repository'

const PAGE = 200

export interface DecisionAuthorBackfillResult {
  /** Decisions with no author that were moved over from a description. */
  candidates: number
  /** Given their task's assignee as author (or, on a dry run, that would be). */
  attributed: number
  /** Left unknown: the task has no assignee, or it is an agent / GitHub user. */
  noMemberAssignee: number
}

/**
 * LUM-1303: decisions moved over from a description have no author (the
 * section never recorded one), so the tab shows "Author unknown". By the
 * user's ruling they are attributed to the task's assignee when that is a
 * workspace member; otherwise they stay unknown. Re-runnable: an attributed
 * decision no longer matches.
 */
export async function backfillDecisionAuthors(opts: {
  dryRun: boolean
  pageSize?: number
}): Promise<DecisionAuthorBackfillResult> {
  const pageSize = opts.pageSize ?? PAGE
  const result: DecisionAuthorBackfillResult = {
    candidates: 0,
    attributed: 0,
    noMemberAssignee: 0,
  }
  let afterId: string | null = null
  for (;;) {
    const page = await taskDecisionRepository.listUnattributed(
      afterId,
      pageSize
    )
    if (page.length === 0) break
    afterId = page[page.length - 1]!.id
    for (const d of page) {
      result.candidates++
      const memberId = d.task.assignee?.memberId ?? null
      if (!memberId) {
        result.noMemberAssignee++
        continue
      }
      if (opts.dryRun) {
        result.attributed++
        continue
      }
      if (
        await taskDecisionRepository.setAuthorIfUnset(
          d.id,
          d.workspaceId,
          memberId
        )
      ) {
        result.attributed++
      }
    }
    if (page.length < pageSize) break
  }
  return result
}
