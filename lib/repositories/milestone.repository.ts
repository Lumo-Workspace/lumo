import { prisma } from '@/lib/db/prisma'
import type { Milestone, TaskStatus } from '@prisma/client'

type MilestoneUpdate = Partial<
  Pick<
    Milestone,
    | 'name'
    | 'description'
    | 'status'
    | 'startDate'
    | 'targetDate'
    | 'completedAt'
  >
>

export const milestoneRepository = {
  async findById(id: string) {
    return prisma.milestone.findUnique({ where: { id } })
  },

  async findByProject(projectId: string) {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: [
        { targetDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    })
  },

  async create(data: {
    projectId: string
    name: string
    description?: string | null
    startDate?: Date | null
    targetDate?: Date | null
  }) {
    return prisma.milestone.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
      },
    })
  },

  async update(id: string, data: MilestoneUpdate) {
    return prisma.milestone.update({
      where: { id },
      data,
    })
  },

  async delete(id: string) {
    return prisma.milestone.delete({ where: { id } })
  },

  async countTasksByStatus(milestoneId: string) {
    const rows = await prisma.task.groupBy({
      by: ['status'],
      where: { milestoneId },
      _count: { _all: true },
    })
    const result: Record<TaskStatus, number> = {
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    }
    for (const row of rows) {
      result[row.status] = row._count._all
    }
    return result
  },
}

export type MilestoneRepository = typeof milestoneRepository
