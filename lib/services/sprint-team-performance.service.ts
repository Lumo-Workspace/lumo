import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  computeSprintTeamPerformance,
  type SprintTeamPerformance,
} from '@/lib/summaries/sprint-team-performance'

/**
 * Sprint "Team performance" rollup for an already-authorized sprint: per-member
 * token / agent-time / runs with a per-task drill-down and per-model split.
 *
 * Mirrors `milestoneService.getDeliveryStatsForMilestone` — same reused loaders
 * (`loadMemberActualRowsForTasks`, `labelsByIds`), only the task-id source is
 * the sprint instead of the milestone. Performs NO auth; call only after
 * authorizing the sprint (e.g. via `sprintRepository.findById` + team access).
 */
export const sprintTeamPerformanceService = {
  async getForSprint(sprintId: string): Promise<SprintTeamPerformance> {
    const taskRows = await sprintRepository.taskRowsForPerformance(sprintId)
    const taskIds = taskRows.map(t => t.id)
    const actualRows =
      await retrospectiveRepository.loadMemberActualRowsForTasks(taskIds)
    const memberIds = [
      ...new Set(
        actualRows.sessions
          .map(s => s.workspaceMemberId)
          .filter((id): id is string => !!id)
      ),
    ]
    const memberLabels = await memberRepository.labelsByIds(memberIds)
    return computeSprintTeamPerformance({
      taskRows,
      sessionRows: actualRows.sessions,
      turnEvents: actualRows.turnEvents,
      memberLabels,
    })
  },
}
