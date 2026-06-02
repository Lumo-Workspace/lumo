import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectService } from '@/lib/services/project.service'
import {
  buildMilestoneSlugBase,
  resolveUniqueMilestoneSlug,
} from '@/lib/utils/milestone-slug'
import type { MilestoneStatus } from '@prisma/client'

interface CreateInput {
  name: string
  description?: string | null | undefined
  startDate?: Date | undefined
  targetDate?: Date | undefined
}

interface UpdateInput {
  name?: string | undefined
  description?: string | null | undefined
  status?: MilestoneStatus | undefined
  startDate?: Date | null | undefined
  targetDate?: Date | null | undefined
}

/**
 * Fire-and-forget milestone retro generation, triggered when a milestone
 * transitions to COMPLETED (mirrors sprint close). The dynamic imports keep
 * `@ai-sdk/gateway` (pulled transitively by the LLM client) out of
 * milestone.service's static dependency graph, so jest test files importing
 * milestone.service don't crash loading the gateway transform.
 */
async function generateMilestoneRetro(milestoneId: string): Promise<void> {
  try {
    const { generationJobRepository } = await import(
      '@/lib/repositories/generation-job.repository'
    )
    await generationJobRepository.createMilestonePending(milestoneId)

    const { milestoneSummaryService } = await import(
      '@/lib/services/milestone-summary.service'
    )
    await milestoneSummaryService.generate(milestoneId)
  } catch (err) {
    void err
  }
}

export const milestoneService = {
  async listMilestones(projectId: string, memberId: string) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.findByProject(projectId)
  },

  async getMilestone(milestoneId: string, memberId: string) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(milestone.projectId, memberId)
    return milestone
  },

  async getMilestoneBySlug(projectId: string, slug: string, memberId: string) {
    await projectService.getProject(projectId, memberId)
    const milestone = await milestoneRepository.findByProjectAndSlug(
      projectId,
      slug
    )
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    return milestone
  },

  async createMilestone(
    projectId: string,
    memberId: string,
    input: CreateInput
  ) {
    await projectService.getProject(projectId, memberId)
    const existingSlugs = new Set(
      await milestoneRepository.findSlugsByProject(projectId)
    )
    const slug = resolveUniqueMilestoneSlug(
      buildMilestoneSlugBase(input.name),
      existingSlugs
    )
    return milestoneRepository.create({
      projectId,
      name: input.name,
      slug,
      description: input.description ?? null,
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    })
  },

  async updateMilestone(
    milestoneId: string,
    memberId: string,
    input: UpdateInput
  ) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.startDate !== undefined) data.startDate = input.startDate
    if (input.targetDate !== undefined) data.targetDate = input.targetDate

    let transitionedToCompleted = false
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status
      if (input.status === 'COMPLETED') {
        data.completedAt = new Date()
        transitionedToCompleted = true
      } else if (existing.status === 'COMPLETED') {
        data.completedAt = null
      }
      // CANCELLED: do not touch completedAt
    } else if (input.status !== undefined) {
      data.status = input.status
    }

    const updated = await milestoneRepository.update(milestoneId, data)

    // Kick off retro generation without blocking the HTTP response. The
    // GenerationJob (status: 'pending') created inside the helper is updated to
    // 'completed' or 'failed' by milestoneSummaryService.generate.
    if (transitionedToCompleted) {
      void generateMilestoneRetro(milestoneId)
    }

    return updated
  },

  async deleteMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    await milestoneRepository.delete(milestoneId)
  },

  async listTasks(
    milestoneId: string,
    memberId: string,
    opts: { assigneeActorId?: string }
  ) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(milestone.projectId, memberId)
    return taskRepository.findByMilestone({
      milestoneId,
      ...(opts.assigneeActorId && { assigneeActorId: opts.assigneeActorId }),
    })
  },
}

export type MilestoneService = typeof milestoneService
