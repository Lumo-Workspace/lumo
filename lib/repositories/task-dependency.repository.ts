import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

/** 渲染边时需要的对端任务字段。 */
const EDGE_TASK_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  team: { select: { identifier: true } },
} as const

const EDGE_INCLUDE = {
  blockedTask: { select: EDGE_TASK_SELECT },
  blockingTask: { select: EDGE_TASK_SELECT },
} as const

/**
 * LUM-918: an edge with either end in the trash is hidden from every read —
 * relation filters bypass the soft-delete extension, so it is spelled here.
 */
const BOTH_ENDS_LIVE = {
  blockedTask: { deletedAt: null },
  blockingTask: { deletedAt: null },
} as const

export interface UpdateTaskDependencyInput {
  status?: 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED' | undefined
  blockedTaskId?: string | undefined
  blockingTaskId?: string | undefined
  confirmedAt?: Date | null | undefined
}

export interface SuggestedEdgeRow {
  workspaceId: string
  blockedTaskId: string
  blockingTaskId: string
  reason: string
  detail?: Prisma.InputJsonValue | undefined
}

export const taskDependencyRepository = {
  /** 任务两个方向的全部边(渲染 deps list)。 */
  async findEdgesForTask(taskId: string) {
    return prisma.taskDependency.findMany({
      where: {
        OR: [{ blockedTaskId: taskId }, { blockingTaskId: taskId }],
        ...BOTH_ENDS_LIVE,
      },
      include: EDGE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    })
  },

  async findById(id: string) {
    return prisma.taskDependency.findUnique({
      where: { id },
      include: EDGE_INCLUDE,
    })
  },

  async findByPair(blockedTaskId: string, blockingTaskId: string) {
    return prisma.taskDependency.findUnique({
      where: {
        blockedTaskId_blockingTaskId: { blockedTaskId, blockingTaskId },
      },
    })
  },

  /** DFS 防环用:workspace 内全部已确认 BLOCKS 边(只取两端 id)。 */
  async findConfirmedBlocksEdges(workspaceId: string) {
    return prisma.taskDependency.findMany({
      where: {
        workspaceId,
        status: 'CONFIRMED',
        kind: 'BLOCKS',
        ...BOTH_ENDS_LIVE,
      },
      select: { blockedTaskId: true, blockingTaskId: true },
    })
  },

  /** 候选去重用:给定无序 pair 集合,返回任一方向已存在的边。 */
  async findPairsAmong(pairs: Array<{ a: string; b: string }>) {
    if (pairs.length === 0) return []
    return prisma.taskDependency.findMany({
      where: {
        OR: pairs.flatMap(({ a, b }) => [
          { blockedTaskId: a, blockingTaskId: b },
          { blockedTaskId: b, blockingTaskId: a },
        ]),
      },
      select: { blockedTaskId: true, blockingTaskId: true },
    })
  },

  async create(data: {
    workspaceId: string
    blockedTaskId: string
    blockingTaskId: string
    kind: 'BLOCKS' | 'RELATES'
    source: 'MANUAL' | 'DETECTED'
    status: 'SUGGESTED' | 'CONFIRMED'
    confirmedAt?: Date | null
  }) {
    return prisma.taskDependency.create({ data, include: EDGE_INCLUDE })
  },

  /** 检测器写入口:固定 DETECTED/SUGGESTED/BLOCKS,撞 unique 静默跳过。 */
  async createManySuggested(rows: SuggestedEdgeRow[]) {
    if (rows.length === 0) return { count: 0 }
    return prisma.taskDependency.createMany({
      data: rows.map(r => ({
        workspaceId: r.workspaceId,
        blockedTaskId: r.blockedTaskId,
        blockingTaskId: r.blockingTaskId,
        kind: 'BLOCKS' as const,
        source: 'DETECTED' as const,
        status: 'SUGGESTED' as const,
        reason: r.reason,
        detail: r.detail ?? Prisma.JsonNull,
      })),
      skipDuplicates: true,
    })
  },

  async update(id: string, data: UpdateTaskDependencyInput) {
    // exactOptionalPropertyTypes: 显式 undefined 不能直接喂给生成类型，逐键收窄。
    const patch: Prisma.TaskDependencyUpdateInput = {}
    if (data.status !== undefined) patch.status = data.status
    if (data.blockedTaskId !== undefined)
      patch.blockedTask = { connect: { id: data.blockedTaskId } }
    if (data.blockingTaskId !== undefined)
      patch.blockingTask = { connect: { id: data.blockingTaskId } }
    if (data.confirmedAt !== undefined) patch.confirmedAt = data.confirmedAt
    return prisma.taskDependency.update({
      where: { id },
      data: patch,
      include: EDGE_INCLUDE,
    })
  },

  async delete(id: string) {
    return prisma.taskDependency.delete({ where: { id } })
  },

  /** 告警用:本任务的活 blocker(已确认 BLOCKS 且 blocker 未 DONE),带 open PR。 */
  async findLiveBlockersForTask(taskId: string) {
    return prisma.taskDependency.findMany({
      where: {
        blockedTaskId: taskId,
        status: 'CONFIRMED',
        kind: 'BLOCKS',
        blockingTask: { status: { not: 'DONE' }, deletedAt: null },
      },
      select: {
        blockingTask: {
          select: {
            ...EDGE_TASK_SELECT,
            pullRequests: {
              where: { state: 'open' },
              select: { number: true, isDraft: true },
            },
          },
        },
      },
    })
  },

  async countSuggestedForTask(taskId: string) {
    return prisma.taskDependency.count({
      where: { blockedTaskId: taskId, status: 'SUGGESTED' },
    })
  },

  /** mention 校验:ids 中真实属于该 workspace 的任务 id。 */
  async findTaskIdsInWorkspace(ids: string[], workspaceId: string) {
    if (ids.length === 0) return []
    const rows = await prisma.task.findMany({
      where: { id: { in: ids }, project: { workspaceId } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /** sweep 用:未 DONE 任务的方向启发元数据。 */
  async findOpenTasksMeta(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.task.findMany({
      where: { id: { in: ids }, status: { not: 'DONE' } },
      select: { id: true, createdAt: true },
    })
  },

  /** LUM-645 `lumo next` 拓扑感知:触及给定任务任一端的已确认 BLOCKS 边,带两端状态。 */
  async findConfirmedBlocksEdgesTouching(taskIds: string[]) {
    if (taskIds.length === 0) return []
    return prisma.taskDependency.findMany({
      where: {
        status: 'CONFIRMED',
        kind: 'BLOCKS',
        OR: [
          { blockedTaskId: { in: taskIds } },
          { blockingTaskId: { in: taskIds } },
        ],
        ...BOTH_ENDS_LIVE,
      },
      select: {
        blockedTaskId: true,
        blockingTaskId: true,
        blockedTask: { select: { status: true } },
        blockingTask: { select: { status: true } },
      },
    })
  },
}
