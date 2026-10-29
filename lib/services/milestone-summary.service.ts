import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import {
  milestoneSummaryRepository,
  type MilestoneStats,
} from '@/lib/repositories/milestone-summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { callMilestoneSummaryLLM } from '@/lib/llm/milestone-summary-client'
import { taskStatusService } from '@/lib/services/task-status.service'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type { MilestoneStats }

export const milestoneSummaryService = {
  async generate(milestoneId: string) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) httpError(404, 'milestone not found')
    if (milestone.completedAt === null)
      httpError(400, 'milestone is not completed')

    const pendingJob =
      await generationJobRepository.findPendingMilestoneJob(milestoneId)

    try {
      const { stats, tasks } =
        await milestoneSummaryRepository.computeStatsData(milestoneId)

      // LUM-506: roll the negative-class struggle signals up across the
      // milestone's tasks so the retro reports reopens / extra PR cycles instead of an
      // all-green title list.
      const struggle = await taskStatusService.aggregateStruggleForTasks(
        tasks.map(t => t.id)
      )

      // LUM-1338: retro summaries switched off (or no model) — the stats
      // still save; with no write-up there is nothing to distil below.
      const retroOn = await aiFeaturesService.isEnabled(
        { projectId: milestone.projectId },
        'retroSummary'
      )
      const { tldr, report } = retroOn
        ? await callMilestoneSummaryLLM({
            subject: milestone.name,
            window: {
              start: milestone.startDate,
              target: milestone.targetDate,
            },
            stats,
            tasks,
            struggle,
          })
        : { tldr: '', report: '' }

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

      // LUM-647: distil the retro's durable, forward-looking learnings into
      // MILESTONE-scope memories for the next milestone's steward session. Runs
      // AFTER the summary is saved (it reads the persisted report as its source)
      // and is best-effort — it owns its own error handling and never throws, so
      // a distillation failure can't fail the retro generation or the retry job.
      if (retroOn) {
        const { milestoneDistillService } =
          await import('@/lib/services/memory/milestone-distill.service')
        await milestoneDistillService.triggerForMilestoneClose(milestoneId)
      }

      // LUM-648: audit how much of the PRIOR milestones' distilled learning
      // this milestone's steward sessions actually used — the milestone-close
      // analog of the task→DONE usage audit. Independent of the distillation
      // above (that produces THIS milestone's learning for the next one; this
      // judges THIS milestone's consumption of earlier ones). Best-effort —
      // owns its errors, never throws.
      const { milestoneMemoryUsageAuditService } =
        await import('@/lib/services/lineage/milestone-memory-usage-audit.service')
      await milestoneMemoryUsageAuditService.auditForMilestoneClose(milestoneId)

      return savedSummary
    } catch (err) {
      if (pendingJob) {
        await generationJobRepository.markFailed(pendingJob.id)
      }
      throw err
    }
  },
}
