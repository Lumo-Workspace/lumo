import { sprintRepository } from '@/lib/repositories/sprint.repository'
import {
  sprintSummaryRepository,
  type SprintStats,
} from '@/lib/repositories/sprint-summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { callSprintSummaryLLM } from '@/lib/llm/sprint-summary-client'
import { taskStatusService } from '@/lib/services/task-status.service'
import { collectDoneGateBlockers } from '@/lib/plugins/done-gate'
import { logger } from '@/lib/logger'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

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
      const { stats, tasks } = await sprintSummaryRepository.computeStatsData(
        sprintId,
        {
          // LUM-1280: the DONE gate's plugin plane, for the verified count.
          // A plugin that fails must not sink the whole summary: the task
          // just reads as not verified (null = unreadable).
          securityBlocking: async taskId => {
            try {
              return (await collectDoneGateBlockers(taskId)).length
            } catch (error) {
              logger.warn('sprint-summary: done-gate plugin unavailable', {
                sprintId,
                taskId,
                error: error instanceof Error ? error.message : String(error),
              })
              return null
            }
          },
        }
      )

      // LUM-506: roll the negative-class struggle signals up across the
      // sprint's tasks so the retro reports reopens / extra PR cycles instead of an
      // all-green title list.
      const struggle = await taskStatusService.aggregateStruggleForTasks(
        tasks.map(t => t.id)
      )

      // LUM-1338: retro summaries switched off (or no model) — the stats
      // still save, so the retro shows its figures; a write-up generated
      // earlier is kept, never blanked.
      const { tldr, report } = (await aiFeaturesService.isEnabled(
        { workspaceId: sprint.team.workspaceId },
        'retroSummary'
      ))
        ? await callSprintSummaryLLM({
            subject: sprint.name,
            window: { start: sprint.startDate, end: sprint.endDate },
            stats,
            tasks,
            struggle,
          })
        : ((await sprintSummaryRepository.findBySprintId(sprintId)) ?? {
            tldr: '',
            report: '',
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
