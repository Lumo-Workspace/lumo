import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  foldSpillover,
  latestDestinations,
  type SprintSpilloverItem,
} from '@/lib/summaries/sprint-spillover'

export interface SpilloverSprintRef {
  id: string
  workspaceId: string
}

/**
 * LUM-1281 — the closed-sprint retro's carried-over tasks and where each one
 * went. Read-only; performs NO auth — call only after authorizing the sprint.
 */
export const sprintSpilloverService = {
  async listForSprint(
    sprint: SpilloverSprintRef
  ): Promise<SprintSpilloverItem[]> {
    const activities = await activityRepository.listSpilloverFromSprint(
      sprint.id
    )
    const destinations = latestDestinations(activities)
    const sprintIds = [
      ...new Set(
        [...destinations.values()].filter((id): id is string => id !== null)
      ),
    ]
    const [tasks, sprints] = await Promise.all([
      sprintRepository.spilloverTaskRefs(
        [...destinations.keys()],
        sprint.workspaceId
      ),
      sprintRepository.refsByIds(sprintIds, sprint.workspaceId),
    ])
    return foldSpillover(destinations, tasks, sprints)
  },
}
