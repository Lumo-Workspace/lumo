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
    | 'sortOrder'
  >
>

export const milestoneRepository = {
  async findById(id: string) {
    return prisma.milestone.findUnique({ where: { id } })
  },

  async findByProjectAndSlug(projectId: string, slug: string) {
    return prisma.milestone.findUnique({
      where: { projectId_slug: { projectId, slug } },
    })
  },

  async findByProject(projectId: string) {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  },

  async findSlugsByProject(projectId: string): Promise<string[]> {
    const rows = await prisma.milestone.findMany({
      where: { projectId },
      select: { slug: true },
    })
    return rows.map(r => r.slug)
  },

  async create(data: {
    projectId: string
    name: string
    slug: string
    description?: string | null
    startDate?: Date | null
    targetDate?: Date | null
    sortOrder?: number
  }) {
    return prisma.milestone.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
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

  async getMaxSortOrder(projectId: string): Promise<number | null> {
    const top = await prisma.milestone.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    return top ? top.sortOrder : null
  },

  async reorder(projectId: string, orderedIds: string[]) {
    return prisma.$transaction(async tx => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.milestone.update({
          where: { id: orderedIds[i]!, projectId },
          data: { sortOrder: i },
        })
      }
    })
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
