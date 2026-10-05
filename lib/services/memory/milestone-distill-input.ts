import type { MemoryCategory } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'
import { projectRepository } from '@/lib/repositories/project.repository'

export interface MilestoneDistillInput {
  milestone: {
    id: string
    name: string
    projectId: string
    workspaceId: string
  }
  retro: {
    tldr: string
    report: string
  }
  /**
   * MILESTONE-scope memories already distilled from THIS milestone — feeds the
   * dedup decision so a re-close / summary-retry emits nothing already present.
   */
  existingMilestoneMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

/**
 * Gather the input for the milestone-close retro→memory distillation (LUM-647).
 * Returns null — caller treats it as "skip" — when the milestone is missing,
 * its project is missing, or no retro summary has been generated yet (the
 * distillation reads the persisted retro report as its source material, so it
 * cannot run before `milestoneSummaryService.generate` has saved one).
 */
export async function getMilestoneDistillInput(
  milestoneId: string
): Promise<MilestoneDistillInput | null> {
  const milestone = await milestoneRepository.findById(milestoneId)
  if (!milestone) return null

  const project = await projectRepository.findByIdForSystemJob(
    milestone.projectId
  )
  if (!project) return null

  const summary =
    await milestoneSummaryRepository.findByMilestoneId(milestoneId)
  if (!summary || !summary.report.trim()) return null

  const existingMilestoneMemories =
    await memoryRepository.findActiveMilestoneMemories(milestoneId)

  return {
    milestone: {
      id: milestone.id,
      name: milestone.name,
      projectId: project.id,
      workspaceId: project.workspaceId,
    },
    retro: {
      tldr: summary.tldr,
      report: summary.report,
    },
    existingMilestoneMemories: existingMilestoneMemories.map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
  }
}
