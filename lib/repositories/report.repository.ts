import { prisma } from '@/lib/db/prisma'

/** One `STATUS_CHANGED → DONE` activity row. */
export interface DoneTransitionRow {
  taskId: string
  payload: unknown
  createdAt: Date
}

/** Flat task row for the report's completed-task list (no nested relations). */
export interface ReportTaskRow {
  id: string
  identifier: string
  title: string
  /** WorkspaceMember behind the assignee: the member itself, or a personal agent's owner. */
  assigneeMemberId: string | null
  /** Name of an assigned agent (null for a human assignee or no assignee). */
  assigneeAgentName: string | null
}

/**
 * LUM-1100 — reads behind `lumo usage show --tasks`. Every query is scoped to one
 * workspace; trashed tasks are excluded explicitly because relation filters
 * (`task: { … }`) bypass the soft-delete extension.
 */
export const reportRepository = {
  /**
   * Every transition into DONE at or after `since` for tasks of this
   * workspace that are DONE now and not trashed. No upper bound: the caller
   * needs a task's LAST DONE transition to decide whether it falls inside the
   * window. Served by the `[taskId, createdAt]` index after the task filter.
   */
  async listDoneTransitionsSince(input: {
    workspaceId: string
    since: Date
    projectId?: string | undefined
  }): Promise<DoneTransitionRow[]> {
    return prisma.taskActivity.findMany({
      where: {
        type: 'STATUS_CHANGED',
        createdAt: { gte: input.since },
        payload: { path: ['to'], equals: 'DONE' },
        task: {
          workspaceId: input.workspaceId,
          status: 'DONE',
          deletedAt: null,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      },
      select: { taskId: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  /** Display fields for the given tasks, restricted to this workspace. */
  async findTasksForReport(
    workspaceId: string,
    taskIds: string[]
  ): Promise<ReportTaskRow[]> {
    if (taskIds.length === 0) return []
    const rows = await prisma.task.findMany({
      where: { id: { in: taskIds }, workspaceId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
        assignee: {
          select: {
            memberId: true,
            agent: { select: { name: true, memberId: true } },
          },
        },
      },
    })
    return rows.map(r => ({
      id: r.id,
      identifier: `${r.team.identifier}-${r.number}`,
      title: r.title,
      assigneeMemberId:
        r.assignee?.memberId ?? r.assignee?.agent?.memberId ?? null,
      assigneeAgentName: r.assignee?.agent?.name ?? null,
    }))
  },

  /** Ids of every (non-trashed) task in a project of this workspace. */
  async listProjectTaskIds(
    workspaceId: string,
    projectId: string
  ): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { workspaceId, projectId },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },
}
