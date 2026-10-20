import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, TaskStatus, Prisma } from '@prisma/client'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { calendarDayKey } from '@/lib/services/sprint-date'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type SpilloverDecision = 'moveToNext' | 'backToBacklog'
export type SprintCloseDecisions = Record<string, SpilloverDecision>

export interface CreateSprintInput {
  teamId: string
  number: number
  name: string
  startDate: Date
  endDate: Date
}

export interface UpdateSprintInput {
  name?: string
  startDate?: Date
  endDate?: Date
  status?: SprintStatus
  startedAt?: Date | null
  closedAt?: Date | null
}

export const sprintRepository = {
  async findById(sprintId: string) {
    return prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            sprintsEnabled: true,
          },
        },
      },
    })
  },

  /**
   * Resolve a workspace-scoped sprint URL like `/workspace/:url/sprints/:number`.
   * Assumes at most one sprints-enabled team per workspace, so the
   * (workspaceId, number) pair is effectively unique.
   */
  async findByWorkspaceAndNumber(workspaceId: string, number: number) {
    return prisma.sprint.findFirst({
      where: { number, team: { workspaceId } },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            sprintsEnabled: true,
          },
        },
      },
    })
  },

  async findActiveByTeam(teamId: string) {
    return prisma.sprint.findFirst({
      where: { teamId, status: 'ACTIVE' },
    })
  },

  /**
   * IDs of every ACTIVE sprint on any team `memberId` belongs to. Drives the
   * "you're currently in N active sprints" indicator surfaced to the user.
   * Returns an empty array when the member is on no teams.
   */
  async findActiveIdsForMember(memberId: string): Promise<string[]> {
    const rows = await prisma.sprint.findMany({
      where: {
        status: 'ACTIVE',
        team: { members: { some: { memberId } } },
      },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Bulk-fetch minimal sprint metadata by id, used to label a milestone's
   * sprint coverage. `teamId` is an optional defensive scope guard. Returns
   * `[]` without querying when `sprintIds` is empty.
   */
  async findByIds(sprintIds: string[], teamId?: string) {
    if (sprintIds.length === 0) return []
    return prisma.sprint.findMany({
      where: { id: { in: sprintIds }, ...(teamId ? { teamId } : {}) },
      // Calendar window rides along for the milestone burnup's cross-sprint
      // bands (LUM-627); coverage consumers just ignore the extra fields.
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    })
  },

  async listByTeam(
    teamId: string,
    opts: { status?: SprintStatus; limit?: number; cursor?: string } = {}
  ) {
    const { status, limit = 20, cursor } = opts
    return prisma.sprint.findMany({
      where: { teamId, ...(status ? { status } : {}) },
      orderBy: { number: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async nextNumberForTeam(teamId: string): Promise<number> {
    const agg = await prisma.sprint.aggregate({
      where: { teamId },
      _max: { number: true },
    })
    return (agg._max.number ?? 0) + 1
  },

  async create(input: CreateSprintInput) {
    return prisma.sprint.create({ data: input })
  },

  async update(sprintId: string, data: UpdateSprintInput) {
    return prisma.sprint.update({ where: { id: sprintId }, data })
  },

  /** Row lock inside a transaction. Used for serialising start/close/task-membership. */
  async lockForUpdate(tx: Prisma.TransactionClient, sprintId: string) {
    const rows = await tx.$queryRaw<{ id: string; status: SprintStatus }[]>`
      SELECT id, status FROM sprints WHERE id = ${sprintId} FOR UPDATE
    `
    return rows[0] ?? null
  },

  async remove(sprintId: string) {
    return prisma.sprint.delete({ where: { id: sprintId } })
  },

  /** Sprint progress counts; BACKLOG is unscheduled and never counted (LUM-1057). */
  async countTasks(sprintId: string, filter: { status?: TaskStatus } = {}) {
    return prisma.task.count({
      where: {
        sprintId,
        status: filter.status ?? { not: 'BACKLOG' },
      },
    })
  },

  /**
   * Lean task rows for the sprint "Team performance" rollup: id + human
   * identifier (team prefix + number) + status/priority/updatedAt, no bodies.
   * The `@@index([sprintId])` covers the scan. Identifier is composed here so
   * the pure fold stays DB-free.
   */
  async taskRowsForPerformance(sprintId: string) {
    const rows = await prisma.task.findMany({
      where: { sprintId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        updatedAt: true,
        team: { select: { identifier: true } },
      },
    })
    return rows.map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      priority: t.priority,
      updatedAt: t.updatedAt,
    }))
  },

  /**
   * 该 team 已 CLOSED sprint(排除当前)各自的完成率 done/total(0..1)。
   * total=0 的 sprint 跳过(无意义样本)。用作完成率的同类历史基线(LUM-508)。
   */
  async completedCompletionRates(
    teamId: string,
    excludeSprintId: string
  ): Promise<number[]> {
    const closed = await prisma.sprint.findMany({
      where: { teamId, status: 'CLOSED', id: { not: excludeSprintId } },
      select: { id: true },
    })
    if (closed.length === 0) return []
    const ids = closed.map(s => s.id)
    const grouped = await prisma.task.groupBy({
      by: ['sprintId', 'status'],
      where: { sprintId: { in: ids }, status: { not: 'BACKLOG' } },
      _count: { _all: true },
    })
    const totals = new Map<string, { done: number; total: number }>()
    for (const g of grouped) {
      if (!g.sprintId) continue
      const acc = totals.get(g.sprintId) ?? { done: 0, total: 0 }
      acc.total += g._count._all
      if (g.status === 'DONE') acc.done += g._count._all
      totals.set(g.sprintId, acc)
    }
    const rates: number[] = []
    for (const { done, total } of totals.values()) {
      if (total > 0) rates.push(done / total)
    }
    return rates
  },

  /**
   * Transition a DRAFT sprint to ACTIVE, checking there isn't already an
   * ACTIVE sprint on the team. Throws httpError with status 404/409 on
   * pre-condition failures. P2002 from a racing peer maps to 409.
   */
  async startAtomically(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
      async tx => {
        const locked = await sprintRepository.lockForUpdate(tx, sprintId)
        if (!locked) httpError(404, 'sprint not found')
        if (locked.status !== 'DRAFT')
          httpError(409, `cannot start sprint in ${locked.status} state`)

        const active = await sprintRepository.findActiveByTeam(sprint.teamId)
        if (active && active.id !== sprintId) {
          httpError(409, `team already has ACTIVE sprint ${active.id}`)
        }

        try {
          return await sprintRepository.update(sprintId, {
            status: 'ACTIVE',
            startedAt: new Date(),
          })
        } catch (err) {
          if (isPrismaUniqueViolation(err))
            httpError(409, 'team already has ACTIVE sprint')
          throw err
        }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * Transition an ACTIVE sprint to CLOSED, routing unfinished tasks per
   * `decisions`. Each unfinished task MUST appear in `decisions` with either
   * 'moveToNext' (goes to the next DRAFT sprint) or 'backToBacklog' (sprintId
   * cleared). Creates SPRINT_CHANGED activities and a pending GenerationJob
   * for retro summary generation.
   */
  async closeAtomically(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actorId: string | null
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
      async tx => {
        const locked = await sprintRepository.lockForUpdate(tx, sprintId)
        if (!locked) httpError(404, 'sprint not found')
        if (locked.status !== 'ACTIVE')
          httpError(409, `cannot close sprint in ${locked.status} state`)

        const unfinished = await taskRepository.findUnfinishedBySprint(
          sprintId,
          tx
        )
        const unfinishedIds = new Set(unfinished.map(t => t.id))
        const decisionIds = new Set(Object.keys(decisions))

        for (const id of unfinishedIds) {
          if (!decisionIds.has(id)) {
            httpError(400, `decision missing for task ${id}`)
          }
        }
        for (const id of decisionIds) {
          if (!unfinishedIds.has(id)) {
            httpError(409, 'sprint membership changed; reopen close dialog')
          }
        }

        let nextSprintId: string | null = null
        const needsNext = Object.values(decisions).some(d => d === 'moveToNext')
        if (needsNext) {
          const drafts = await sprintRepository.listByTeam(sprint.teamId, {
            status: 'DRAFT',
            limit: 1,
          })
          if (drafts.length > 0 && drafts[0]) {
            nextSprintId = drafts[0].id
          } else {
            httpError(
              409,
              'no draft sprint to receive spillover; create one first'
            )
          }
        }

        const toNext: string[] = []
        const toBacklog: string[] = []
        for (const [taskId, d] of Object.entries(decisions)) {
          if (d === 'moveToNext') toNext.push(taskId)
          else toBacklog.push(taskId)
        }
        if (toNext.length) {
          await taskRepository.bulkUpdateSprint(toNext, nextSprintId!, tx)
        }
        if (toBacklog.length) {
          await taskRepository.bulkUpdateSprint(toBacklog, null, tx)
        }

        const activities = [
          ...toNext.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: nextSprintId,
              reason: 'spillover' as const,
            },
          })),
          ...toBacklog.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: null,
              reason: 'spillover' as const,
            },
          })),
        ]
        if (activities.length) {
          await activityRepository.createManySprintChanged(activities, tx)
        }

        const closed = await sprintRepository.update(sprintId, {
          status: 'CLOSED',
          closedAt: new Date(),
        })

        await generationJobRepository.createSprintPending(sprintId, tx)

        return closed
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * Whether `sprint` still accepts task-membership changes, judged on its
   * calendar window rather than the DB `status` enum (LUM-705).
   *
   * Open: CURRENT and UPCOMING windows, plus the team's most recently ended
   * sprint — exactly the set the task sprint picker offers (the just-ended
   * one is the spillover target, LUM-155). Everything that ended earlier is
   * frozen.
   *
   * `status` is deliberately not consulted: a sprint closed early because all
   * its work landed is still the window the team is living in, and freezing it
   * a day before the next sprint opens leaves no sprint to file work against.
   *
   * Both comparisons run in the UTC calendar-day frame — there is no viewer on
   * the server, same rule as `reconcileSprintStates` (LUM-700). A client an
   * hour or two west of UTC may still call a just-ended sprint CURRENT; the
   * just-ended exception below covers that skew, so the picker never offers an
   * option this rejects.
   */
  async isOpenForTaskMembership(
    sprint: { teamId: string; startDate: Date; endDate: Date },
    now: Date = new Date()
  ): Promise<boolean> {
    const today = calendarDayKey(now)
    // `endDate` is the inclusive last day at UTC midnight, so a sprint counts
    // as ended only once today's key is strictly past it.
    if (calendarDayKey(sprint.endDate) >= today) return true
    // Ended — open only when nothing else of this team ended later.
    const endedLater = await prisma.sprint.count({
      where: {
        teamId: sprint.teamId,
        endDate: { gt: sprint.endDate, lt: new Date(today) },
      },
    })
    return endedLater === 0
  },

  /**
   * Move `taskId` into `sprintId`, with pre-condition checks (task exists,
   * sprint exists, team matches, sprint window still open). Idempotent when
   * the task is already on the target sprint. Emits a SPRINT_CHANGED activity.
   */
  async addTaskAtomically(
    taskId: string,
    sprintId: string,
    actorId: string | null
  ) {
    const task = await taskRepository.findMinimalById(taskId)
    if (!task) httpError(404, 'task not found')
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (task.teamId !== sprint.teamId)
      httpError(400, 'task and sprint belong to different teams')
    if (!(await sprintRepository.isOpenForTaskMembership(sprint)))
      httpError(409, 'sprint has already ended')

    return prisma.$transaction(
      async tx => {
        await sprintRepository.lockForUpdate(tx, sprintId)
        const fromSprintId = task.sprintId
        // No-op when the task is already in this sprint — avoids writing
        // a SPRINT_CHANGED activity with fromSprintId === toSprintId when
        // two concurrent planning actions race.
        if (fromSprintId === sprintId) return { taskId, sprintId }
        await taskRepository.bulkUpdateSprint([taskId], sprintId, tx)
        await activityRepository.createSprintChanged(
          {
            taskId,
            actorId,
            payload: {
              fromSprintId,
              toSprintId: sprintId,
              reason: 'planning',
            },
          },
          tx
        )
        return { taskId, sprintId }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * Remove `taskId` from whatever sprint it's on (sets sprintId=null).
   * No-op when the task has no sprint. Refuses when the sprint it sits on has
   * already ended (same window rule as `addTaskAtomically`, LUM-705). Emits a
   * SPRINT_CHANGED activity when a move occurs.
   */
  async removeTaskAtomically(taskId: string, actorId: string | null) {
    const task = await taskRepository.findMinimalById(taskId)
    if (!task) httpError(404, 'task not found')
    if (!task.sprintId) return { taskId, sprintId: null }

    const sprint = await sprintRepository.findById(task.sprintId)
    if (sprint && !(await sprintRepository.isOpenForTaskMembership(sprint))) {
      httpError(409, 'cannot remove task from a sprint that has already ended')
    }

    return prisma.$transaction(
      async tx => {
        if (task.sprintId)
          await sprintRepository.lockForUpdate(tx, task.sprintId)
        await taskRepository.bulkUpdateSprint([taskId], null, tx)
        await activityRepository.createSprintChanged(
          {
            taskId,
            actorId,
            payload: {
              fromSprintId: task.sprintId,
              toSprintId: null,
              reason: 'planning',
            },
          },
          tx
        )
        return { taskId, sprintId: null }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * LUM-1278 attention read model: the sprint's live (non-trashed) tasks in
   * the caller's workspace, with what the queue / trust / stage folds read.
   */
  async taskRowsForAttention(sprintId: string, workspaceId: string) {
    const rows = await prisma.task.findMany({
      where: { sprintId, workspaceId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        createdAt: true,
        assigneeActorId: true,
        team: { select: { identifier: true } },
      },
      orderBy: { number: 'asc' },
    })
    return rows.map(t => ({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
      assigneeActorId: t.assigneeActorId,
    }))
  },

  /** LUM-1278: the team's sprint just before `number` (highest number below). */
  async findPreviousInTeam(teamId: string, number: number) {
    return prisma.sprint.findFirst({
      where: { teamId, number: { lt: number } },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, name: true },
    })
  },
}
