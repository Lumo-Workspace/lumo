import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { sprintBurndownRepository } from '@/lib/repositories/sprint-burndown.repository'
import {
  computeBurndownSeries,
  type BurndownSeries,
} from '@/lib/services/sprint-burndown'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const sprintBurndownService = {
  async compute(sprintId: string, now: Date): Promise<BurndownSeries> {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status === 'DRAFT') httpError(409, 'sprint not started')

    const { tasks, activities } =
      await sprintBurndownRepository.loadInputs(sprintId)

    return computeBurndownSeries({
      sprintId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status as 'ACTIVE' | 'CLOSED',
      now,
      tasks,
      activities,
    })
  },
}
