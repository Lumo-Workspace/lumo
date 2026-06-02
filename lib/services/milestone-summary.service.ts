import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import {
  milestoneSummaryRepository,
  type MilestoneStats,
} from '@/lib/repositories/milestone-summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { callMilestoneSummaryLLM } from '@/lib/llm/milestone-summary-client'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type { MilestoneStats }

export const milestoneSummaryService = {
  async generate(milestoneId: string) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) httpError(404, 'milestone not found')
    if (milestone.status !== 'COMPLETED')
      httpError(400, 'milestone is not completed')

    const pendingJob =
      await generationJobRepository.findPendingMilestoneJob(milestoneId)

    try {
      const { stats, tasks } =
        await milestoneSummaryRepository.computeStatsData(milestoneId)

      const { tldr, report } = await callMilestoneSummaryLLM({
        subject: milestone.name,
        window: { start: milestone.startDate, target: milestone.targetDate },
        stats,
        tasks,
      })

      const savedSummary = await milestoneSummaryRepository.save(milestoneId, {
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
