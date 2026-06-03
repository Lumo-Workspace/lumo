import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { sprintBurnupRepository } from '@/lib/repositories/sprint-burnup.repository'
import {
  computeBurnupSeries,
  type BurnupSeries,
} from '@/lib/services/sprint-burnup'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const sprintBurnupService = {
  async compute(sprintId: string, now: Date): Promise<BurnupSeries> {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status === 'DRAFT') httpError(409, 'sprint not started')

    const { tasks, activities } =
      await sprintBurnupRepository.loadInputs(sprintId)

    return computeBurnupSeries({
      sprintId,
      startDate: sprint.startDate,
      startedAt: sprint.startedAt,
      endDate: sprint.endDate,
      status: sprint.status as 'ACTIVE' | 'CLOSED',
      now,
      tasks,
      activities,
    })
  },
}
