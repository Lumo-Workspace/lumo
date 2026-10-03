import { prisma } from '@/lib/db/prisma'
import type { Milestone, Prisma, TaskStatus } from '@prisma/client'

type MilestoneUpdate = Partial<
  Pick<
    Milestone,
    | 'name'
    | 'description'
    | 'startDate'
    | 'targetDate'
    | 'completedAt'
    | 'sortOrder'
    | 'tokenBudget'
    // LUM-643 close-gate override trail, stamped by the LUM-714 override path.
    | 'completedOverrideAt'
    | 'completedOverrideByMemberId'
    | 'completedOverrideNote'
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
   * Guarded completion write for the rollup reconciler (LUM-714): only applies
   * while the row still holds the `completedAt` the derivation was computed
   * from, so a concurrent write is never clobbered by a stale derivation.
   * Returns true when the row was updated.
   */
  async updateCompletionIfCurrent(
    id: string,
    expectedCompletedAt: Date | null,
    completedAt: Date | null
  ): Promise<boolean> {
    const result = await prisma.milestone.updateMany({
      where: { id, completedAt: expectedCompletedAt },
      data: { completedAt },
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

  /**
   * LUM-649 changelog baseline: ids of the OTHER completed milestones in the
   * same project — the reference class the changelog's headline counts are
   * baselined against. Excludes the milestone being reported so it never
   * baselines against itself. Completion is `completedAt` since LUM-714.
   */
  async listCompletedIdsInProject(
    projectId: string,
    excludeMilestoneId: string
  ): Promise<string[]> {
    const rows = await prisma.milestone.findMany({
      where: {
        projectId,
        completedAt: { not: null },
        id: { not: excludeMilestoneId },
      },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /** Per-task status rows for the LUM-650 complexity-weighted progress fold
   * (joined against TaskComplexity to weight by changedFileCount). Only the
   * two columns the snapshot needs — id to join, status to bucket DONE. */
  async taskStatusRows(milestoneId: string) {
    return prisma.task.findMany({
      where: { milestoneId },
      select: { id: true, status: true },
    })
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
   * Raw rows for the LUM-639 green-quality footnote: each DONE member task's
   * claim-faithfulness verdict when one was ever judged. An absent verdict
   * stays absent — the read model turns it into the explicit `unjudged`
   * bucket, never a zero.
   */
  async greenQualityRows(milestoneId: string) {
    return prisma.task.findMany({
      where: { milestoneId, status: 'DONE' },
      select: {
        id: true,
        status: true,
        claimFaithfulness: { select: { verdict: true } },
      },
      orderBy: { number: 'asc' },
    })
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
      // workStartedAt feeds the LUM-636 derived start date (earliest first
      // exit from TODO across member tasks) — activity truth, not a form field.
      select: {
        id: true,
        status: true,
        createdAt: true,
        sprintId: true,
        workStartedAt: true,
      },
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

  /**
   * Member task ids only — the LUM-632 delivery-stats rollup's fan-out basis
   * (PR states / complexity / session actuals are all batched off this set).
   */
  async taskIds(milestoneId: string): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { milestoneId },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-727: the member tasks' display identity (`<TEAM>-<number>` + title)
   * for the per-task cost breakdown. Same task set as {@link taskIds}, one
   * extra join to the team identifier — deliberately lighter than
   * `segmentationRows` (no tags / sprint / status), because the breakdown
   * only needs a label per row.
   */
  async taskRefs(
    milestoneId: string
  ): Promise<Array<{ id: string; ref: string; title: string }>> {
    const rows = await prisma.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
      },
    })
    return rows.map(r => ({
      id: r.id,
      ref: `${r.team.identifier}-${r.number}`,
      title: r.title,
    }))
  },

  /**
   * Raw rows for the LUM-633 per-member delivery rollup: every member task's
   * claim fields (SAME select as `outcomeRollupRows` — the member expansion
   * and the outcome section must not drift) plus the assignee-resolution
   * fields (Actor type/memberId and the agent's owning member), and the same
   * outcome-well `(taskId, kind)` signal groupBy the LUM-626 fate counts read.
   */
  async memberDeliveryRows(milestoneId: string) {
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
        assignee: {
          select: {
            type: true,
            memberId: true,
            agent: { select: { memberId: true } },
          },
        },
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
   * Raw rows for the LUM-628 segmentation rollup: every member task's
   * grouping basis (priority / sprint binding / tags) plus the ref fields
   * the drill-down rows render.
   */
  async segmentationRows(milestoneId: string) {
    return prisma.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        sprintId: true,
        team: { select: { identifier: true } },
        taskTags: { select: { tag: { select: { id: true, name: true } } } },
      },
      orderBy: { number: 'asc' },
    })
  },

  /**
   * LUM-638 risk-queue rollup rows. Crossings are deliberately NOT fetched
   * here — their read failure must degrade that one block to `unknown`
   * without taking the rest of the queue down (fail-closed).
   */
  async riskQueueRows(milestoneId: string) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        createdAt: true,
        tasks: {
          where: { deletedAt: null }, // LUM-918: relation reads skip the trash
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            createdAt: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!milestone) return null
    const tasks = milestone.tasks.map(t => ({
      id: t.id,
      ref: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
    }))
    const taskIds = tasks.map(t => t.id)
    // Aging replay only ever inspects tasks currently IN_REVIEW — fetching
    // the full milestone trail would duplicate costTrendRows' query for rows
    // the pure fn ignores.
    const inReviewIds = tasks
      .filter(t => t.status === 'IN_REVIEW')
      .map(t => t.id)
    const [edges, statusActivities] = await Promise.all([
      prisma.taskDependency.findMany({
        where: {
          blockedTaskId: { in: taskIds },
          kind: 'BLOCKS',
          blockingTask: { deletedAt: null },
        },
        select: {
          blockedTaskId: true,
          status: true,
          blockingTask: {
            select: {
              number: true,
              title: true,
              status: true,
              team: { select: { identifier: true } },
            },
          },
        },
      }),
      prisma.taskActivity.findMany({
        where: { taskId: { in: inReviewIds }, type: 'STATUS_CHANGED' },
        select: { taskId: true, payload: true, createdAt: true },
      }),
    ])
    return {
      milestoneCreatedAt: milestone.createdAt,
      tasks,
      edges: edges.map(e => ({
        blockedTaskId: e.blockedTaskId,
        status: e.status,
        blocking: {
          ref: `${e.blockingTask.team.identifier}-${e.blockingTask.number}`,
          title: e.blockingTask.title,
          status: e.blockingTask.status,
        },
      })),
      statusActivities,
    }
  },

  /**
   * LUM-645 topology rollup rows: member tasks + every dependency edge whose
   * blocked end is a member. Kind/status ride raw — the honesty filter
   * (CONFIRMED + BLOCKS only) lives in computeMilestoneTopology.
   */
  async topologyRows(milestoneId: string) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        tasks: {
          where: { deletedAt: null }, // LUM-918: relation reads skip the trash
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!milestone) return null
    const tasks = milestone.tasks.map(t => ({
      id: t.id,
      ref: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
    }))
    const edges = await prisma.taskDependency.findMany({
      where: {
        blockedTaskId: { in: tasks.map(t => t.id) },
        blockingTask: { deletedAt: null },
      },
      select: {
        blockedTaskId: true,
        blockingTaskId: true,
        kind: true,
        status: true,
        blockingTask: { select: { status: true } },
      },
    })
    return {
      tasks,
      edges: edges.map(e => ({
        blockedTaskId: e.blockedTaskId,
        blockingTaskId: e.blockingTaskId,
        kind: e.kind,
        status: e.status,
        blockingStatus: e.blockingTask.status,
      })),
    }
  },
}

export type MilestoneRepository = typeof milestoneRepository
