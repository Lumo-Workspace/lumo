import { prisma } from '@/lib/db/prisma'
import type { Prisma, TaskActivityType } from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

export interface CreateActivityData {
  taskId: string
  actorId: string | null
  type: TaskActivityType
  payload: Record<string, unknown> | null
}

interface FindOptions {
  limit: number
  cursor?: { timestamp: string; id: string }
}

export interface SprintChangedPayload {
  fromSprintId: string | null
  toSprintId: string | null
  reason: 'spillover' | 'planning'
}

export interface CreateSprintChangedInput {
  taskId: string
  actorId: string | null
  payload: SprintChangedPayload
}

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const activityRepository = {
  async create(data: CreateActivityData, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.taskActivity.create({
      data: redactStoredFields(
        {
          taskId: data.taskId,
          actorId: data.actorId,
          type: data.type,
          payload: data.payload as unknown as Prisma.InputJsonValue,
        },
        STORAGE_REDACTED_FIELDS.taskActivity
      ),
    })
  },

  /**
   * All activities of one type for a task, oldest first. Read-only helper for
   * read models that fold an append-only event log (e.g. the task-status read
   * model folding STATUS_CHANGED into reopens). Only `payload`
   * and ordering are needed, so the actor relation is not joined.
   */
  async listByTaskAndType(taskId: string, type: TaskActivityType) {
    return prisma.taskActivity.findMany({
      where: { taskId, type },
      orderBy: { createdAt: 'asc' },
      select: { payload: true, createdAt: true },
    })
  },

  /** Count TASK_SPUN_OFF audit events across a workspace (LUM-511 Phase 3). */
  async countSpinoffsForWorkspace(workspaceId: string): Promise<number> {
    return prisma.taskActivity.count({
      where: {
        type: 'TASK_SPUN_OFF',
        task: { project: { workspaceId } },
      },
    })
  },

  /**
   * Task ids (within the candidate set) carrying any of the given activity-type
   * markers — LUM-511 Phase 4 judge-confirmed laundering signals folded into the
   * flywheel negative class.
   */
  async taskIdsWithMarkers(
    taskIds: string[],
    types: TaskActivityType[]
  ): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set()
    const rows = await prisma.taskActivity.findMany({
      where: { taskId: { in: taskIds }, type: { in: types } },
      select: { taskId: true },
      distinct: ['taskId'],
    })
    return new Set(rows.map(r => r.taskId))
  },

  /**
   * Every boundary-crossing disposition activity for a task, oldest first, with
   * the acting actor (LUM-450). The read model folds these to surface, on the
   * acceptance bar, that a crossing's disposition was *corrected* (from -> to,
   * by whom) rather than silently swapped. Like listByTaskAndType but it also
   * needs the actor id to attribute the change.
   */
  async listDispositionChangesByTask(taskId: string) {
    return prisma.taskActivity.findMany({
      where: { taskId, type: 'BOUNDARY_CROSSING_DISPOSITIONED' },
      orderBy: { createdAt: 'asc' },
      select: { payload: true, actorId: true, createdAt: true },
    })
  },

  async findByTaskId(taskId: string, options: FindOptions) {
    const { limit, cursor } = options
    const where: Record<string, unknown> = { taskId }
    if (cursor) {
      where.OR = [
        { createdAt: { gt: new Date(cursor.timestamp) } },
        { createdAt: new Date(cursor.timestamp), id: { gt: cursor.id } },
      ]
    }
    return prisma.taskActivity.findMany({
      where,
      include: { actor: ACTOR_SELECT },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    })
  },

  /**
   * Create a single SPRINT_CHANGED activity. Used inside sprintRepository
   * atomic methods (add/remove task). `tx` is required because every call
   * site is inside a transaction.
   */
  async createSprintChanged(
    input: CreateSprintChangedInput,
    tx: Prisma.TransactionClient
  ) {
    return tx.taskActivity.create({
      data: {
        taskId: input.taskId,
        actorId: input.actorId,
        type: 'SPRINT_CHANGED',
        payload: input.payload as unknown as Prisma.InputJsonValue,
      },
    })
  },

  /**
   * Bulk-create SPRINT_CHANGED activities during sprint close.
   * `skipDuplicates` matches the pre-refactor behavior.
   */
  async createManySprintChanged(
    inputs: CreateSprintChangedInput[],
    tx: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    return tx.taskActivity.createMany({
      data: inputs.map(i => ({
        taskId: i.taskId,
        actorId: i.actorId,
        type: 'SPRINT_CHANGED' as const,
        payload: i.payload as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
  },

  /**
   * List SPRINT_CHANGED activities whose payload.fromSprintId matches the
   * given sprint — i.e. tasks that spilled out of this sprint. Used by
   * sprintSummaryRepository.computeStatsData() to count spillover.
   */
  async listSpilloverFromSprint(
    sprintId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        payload: { path: ['fromSprintId'], equals: sprintId },
      },
      // Oldest first, so a reader folding per task sees the latest move last.
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, payload: true },
    })
  },

  /**
   * LUM-1278 attention read model: STATUS_CHANGED rows (with who made the
   * change) for the given tasks in the caller's workspace, oldest first.
   */
  async listStatusChangesByTaskIds(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) return []
    return prisma.taskActivity.findMany({
      where: {
        taskId: { in: taskIds },
        type: 'STATUS_CHANGED',
        task: { workspaceId },
      },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, actorId: true, payload: true, createdAt: true },
    })
  },
}
