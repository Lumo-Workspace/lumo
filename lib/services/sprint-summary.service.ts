import { sprintRepository } from '@/lib/repositories/sprint.repository'
import {
  sprintSummaryRepository,
  type SprintStats,
} from '@/lib/repositories/sprint-summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { callSprintSummaryLLM } from '@/lib/llm/sprint-summary-client'
import { taskStatusService } from '@/lib/services/task-status.service'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type { SprintStats }

export const sprintSummaryService = {
  async generate(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status !== 'CLOSED') httpError(400, 'sprint is not closed')

    const pendingJob =
      await generationJobRepository.findPendingSprintJob(sprintId)

    try {
      const { stats, tasks } =
        await sprintSummaryRepository.computeStatsData(sprintId)

      // LUM-506: roll the negative-class struggle signals up across the
      // sprint's tasks so the retro reports reopens / extra PR cycles instead of an
      // all-green title list.
      const struggle = await taskStatusService.aggregateStruggleForTasks(
        tasks.map(t => t.id)
      )

      const { tldr, report } = await callSprintSummaryLLM({
        subject: sprint.name,
        window: { start: sprint.startDate, end: sprint.endDate },
        stats,
        tasks,
        struggle,
      })

      const savedSummary = await sprintSummaryRepository.save(sprintId, {
        stats,
        tldr,
        report,
      })

      if (pendingJob) {
        await generationJobRepository.markCompleted(
          pendingJob.id,
          savedSummary.id
        )
      }

      return savedSummary
    } catch (err) {
      if (pendingJob) {
        await generationJobRepository.markFailed(pendingJob.id)
      }
      throw err
    }
  },
}
