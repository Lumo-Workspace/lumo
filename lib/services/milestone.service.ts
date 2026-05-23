import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectService } from '@/lib/services/project.service'
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

  async createMilestone(
    projectId: string,
    memberId: string,
    input: CreateInput
  ) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.create({
      projectId,
      name: input.name,
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

    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status
      if (input.status === 'COMPLETED') {
        data.completedAt = new Date()
      } else if (existing.status === 'COMPLETED') {
        data.completedAt = null
      }
      // CANCELLED: do not touch completedAt
    } else if (input.status !== undefined) {
      data.status = input.status
    }

    return milestoneRepository.update(milestoneId, data)
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
