import { prisma } from '@/lib/db/prisma'
import type { Milestone, Prisma, TaskStatus } from '@prisma/client'

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

export type MilestoneListFilter = 'active' | 'archived' | 'all'

export const milestoneRepository = {
  async findById(id: string) {
    return prisma.milestone.findUnique({ where: { id } })
  },

  async findByProjectAndSlug(projectId: string, slug: string) {
    return prisma.milestone.findUnique({
      where: { projectId_slug: { projectId, slug } },
    })
  },

  async findByProject(
    projectId: string,
    filter: MilestoneListFilter = 'active',
    search?: string
  ) {
    const where: Prisma.MilestoneWhereInput = { projectId }
    if (filter === 'active') where.archivedAt = null
    else if (filter === 'archived') where.archivedAt = { not: null }
    const term = search?.trim()
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ]
    }
    return prisma.milestone.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  },

  async findByWorkspace(
    workspaceId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    const where: Prisma.MilestoneWhereInput = {
      project: { workspaceId },
    }
    if (filter === 'active') where.archivedAt = null
    else if (filter === 'archived') where.archivedAt = { not: null }
    return prisma.milestone.findMany({
      where,
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

  /**
   * Guarded status write for the rollup reconciler: only applies when the row
   * still holds `expectedStatus`, so a concurrent manual status change (e.g.
   * a human setting CANCELLED) is never clobbered by a stale derivation.
   * Returns true when the row was updated.
   */
  async updateStatusIfCurrent(
    id: string,
    expectedStatus: Milestone['status'],
    data: Pick<MilestoneUpdate, 'status' | 'completedAt'>
  ): Promise<boolean> {
    const result = await prisma.milestone.updateMany({
      where: { id, status: expectedStatus },
      data,
    })
    return result.count === 1
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

  async archive(id: string, archivedAt: Date) {
    return prisma.milestone.update({
      where: { id },
      data: { archivedAt },
    })
  },

  async unarchive(id: string) {
    return prisma.milestone.update({
      where: { id },
      data: { archivedAt: null },
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

  async sprintCoverageCounts(milestoneId: string) {
    const rows = await prisma.task.groupBy({
      by: ['sprintId', 'status'],
      where: { milestoneId },
      _count: { _all: true },
    })
    return rows.map(r => ({
      sprintId: r.sprintId,
      status: r.status,
      count: r._count._all,
    }))
  },

  /**
   * Raw rows for the LUM-626 outcome rollup: every member task's frozen claim
   * fields plus the outcome well's `(taskId, kind)` rejection-signal counts
   * across ALL member tasks (a reopened task keeps its signals visible).
   */
  async outcomeRollupRows(milestoneId: string) {
    const tasks = await prisma.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        team: { select: { identifier: true } },
      },
      orderBy: { number: 'asc' },
    })
    if (tasks.length === 0) {
      return { tasks, signalCounts: [] }
    }
    const grouped = await prisma.outcomeSignal.groupBy({
      by: ['taskId', 'kind'],
      where: { taskId: { in: tasks.map(t => t.id) } },
      _count: { _all: true },
    })
    return {
      tasks,
      signalCounts: grouped.map(g => ({
        taskId: g.taskId,
        kind: g.kind,
        count: g._count._all,
      })),
    }
  },

  /**
   * Raw rows for the LUM-627 cost+trend rollup: every member task's replay
   * basis (id / status / createdAt / sprintId) plus their append-only
   * STATUS_CHANGED activity trail, oldest-first — the burnup backward replay
   * and the cost rollup's task-id set both derive from this one fetch.
   */
  async costTrendRows(milestoneId: string) {
    const tasks = await prisma.task.findMany({
      where: { milestoneId },
      select: { id: true, status: true, createdAt: true, sprintId: true },
    })
    if (tasks.length === 0) {
      return { tasks, activities: [] }
    }
    const activities = await prisma.taskActivity.findMany({
      where: {
        taskId: { in: tasks.map(t => t.id) },
        type: 'STATUS_CHANGED',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { taskId: true, payload: true, createdAt: true },
    })
    return { tasks, activities }
  },
}

export type MilestoneRepository = typeof milestoneRepository
