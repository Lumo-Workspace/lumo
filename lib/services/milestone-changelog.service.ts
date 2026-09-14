import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  buildMilestoneChangelog,
  type ChangelogTaskRow,
  type MilestoneChangelog,
} from '@/lib/summaries/milestone-changelog'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

/**
 * LUM-649 — assemble a milestone's automatic changelog from its DONE tasks +
 * merged PRs + frozen claimSnapshot. Pure orchestration: fetch the rows, hand
 * them to the DB-free `buildMilestoneChangelog` fold. No LLM, no completion
 * gate (unlike the retro summary) — a running milestone reports what has
 * shipped so far; only DONE tasks ever appear regardless of milestone state.
 */
export const milestoneChangelogService = {
  async assemble(milestoneId: string): Promise<MilestoneChangelog> {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) httpError(404, 'milestone not found')

    // All milestone tasks; filter to DONE here (mirrors computeStatsData) so
    // the honest "DONE only" boundary is enforced in one place and unit-testable.
    const rows = await taskRepository.listByMilestoneForChangelog(milestoneId)
    const doneRows = rows
      .filter(r => r.status === 'DONE')
      // Task has no completedAt column — updatedAt is the best-available "when
      // it last moved" proxy; newest delivery first.
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

    const doneTasks: ChangelogTaskRow[] = doneRows.map(r => ({
      id: r.id,
      identifier: `${r.team.identifier}-${r.number}`,
      title: r.title,
      claimSnapshot: r.claimSnapshot,
      claimSnapshotSource: r.claimSnapshotSource,
      claimSnapshotSessionId: r.claimSnapshotSessionId,
      claimSnapshotAt: r.claimSnapshotAt,
    }))

    const mergedPrs =
      doneTasks.length > 0
        ? await pullRequestRepository.listMergedByTaskIds(
            doneTasks.map(t => t.id)
          )
        : []

    // Baseline reference class: prior completed milestones of the same project.
    const priorIds = await milestoneRepository.listCompletedIdsInProject(
      milestone.projectId,
      milestoneId
    )
    const priorMilestoneCounts = await buildPriorSample(priorIds)

    return buildMilestoneChangelog({
      milestone: {
        name: milestone.name,
        completedAt: milestone.completedAt,
        archivedAt: milestone.archivedAt,
        startDate: milestone.startDate,
        targetDate: milestone.targetDate,
      },
      doneTasks,
      mergedPrs,
      priorMilestoneCounts,
    })
  },
}

/**
 * One sample point per prior COMPLETED milestone: its DONE-task count and
 * merged-PR count. Absent groups read 0 (a completed milestone that shipped
 * nothing is a real 0 in the reference class, not a gap).
 */
async function buildPriorSample(
  priorIds: string[]
): Promise<Array<{ doneTaskCount: number; mergedPrCount: number }>> {
  if (priorIds.length === 0) return []
  const [doneCounts, mergedCounts] = await Promise.all([
    taskRepository.countDoneByMilestones(priorIds),
    pullRequestRepository.countMergedByMilestones(priorIds),
  ])
  const doneByMilestone = new Map(doneCounts.map(c => [c.milestoneId, c.count]))
  const mergedByMilestone = new Map(
    mergedCounts.map(c => [c.milestoneId, c.count])
  )
  return priorIds.map(id => ({
    doneTaskCount: doneByMilestone.get(id) ?? 0,
    mergedPrCount: mergedByMilestone.get(id) ?? 0,
  }))
}

export type MilestoneChangelogService = typeof milestoneChangelogService
