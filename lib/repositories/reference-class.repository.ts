import { prisma } from '@/lib/db/prisma'
import type { CrossingRow, DeliveredTask } from '@/lib/reference-class'

/**
 * LUM-497 — every Prisma read behind the reference-class anchor. Read-only by
 * contract: the anchor derives from history and never writes to it.
 *
 * "Delivered" is defined by the existence of a TaskCriteriaSnapshot row, not by
 * `Task.status`: status can be set directly, a frozen snapshot is the DB fact
 * that the task actually reached delivery. `distinct: ['taskId']` with a
 * frozenAt-desc order collapses repeat deliveries to the latest one.
 */

export interface TaskScope {
  milestoneId: string | null
  milestoneName: string | null
  projectId: string
  projectName: string
  teamId: string
  teamName: string
}

async function deliveredWhere(
  where: { task: Record<string, string> },
  take: number
): Promise<DeliveredTask[]> {
  return prisma.taskCriteriaSnapshot.findMany({
    where,
    select: { taskId: true, frozenAt: true },
    orderBy: { frozenAt: 'desc' },
    distinct: ['taskId'],
    take,
  })
}

export const referenceClassRepository = {
  /** The three scope ids + display names for the task being drafted. */
  async taskScope(taskId: string): Promise<TaskScope | null> {
    const row = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        milestoneId: true,
        projectId: true,
        teamId: true,
        milestone: { select: { name: true } },
        project: { select: { name: true } },
        team: { select: { name: true } },
      },
    })
    if (!row) return null
    return {
      milestoneId: row.milestoneId,
      milestoneName: row.milestone?.name ?? null,
      projectId: row.projectId,
      projectName: row.project.name,
      teamId: row.teamId,
      teamName: row.team.name,
    }
  },

  async deliveredByMilestone(
    milestoneId: string,
    take: number
  ): Promise<DeliveredTask[]> {
    return deliveredWhere({ task: { milestoneId } }, take)
  },

  async deliveredByProject(
    projectId: string,
    take: number
  ): Promise<DeliveredTask[]> {
    return deliveredWhere({ task: { projectId } }, take)
  },

  async deliveredByTeam(
    teamId: string,
    take: number
  ): Promise<DeliveredTask[]> {
    return deliveredWhere({ task: { teamId } }, take)
  },

  /** FAIL runs across the class — the send-back reason distribution source. */
  async rejectionRows(
    taskIds: string[]
  ): Promise<Array<{ taskId: string; rejectionReasonEnum: string | null }>> {
    if (taskIds.length === 0) return []
    return prisma.verificationRun.findMany({
      where: { taskId: { in: taskIds }, verdict: 'FAIL' },
      select: { taskId: true, rejectionReasonEnum: true },
    })
  },

  /**
   * Crossings across the class, disposition included: which dispositions count
   * is a policy decision and lives in the pure layer, not in a where-clause.
   *
   * `taskId` is nullable in the schema (LUM-640 milestone-scoped steward
   * crossings carry no task), but the WHERE pins it to the given id list, so
   * it is never null at runtime here — narrow the Prisma type back to string
   * (same pattern as `boundaryCrossingRepository.findSeverityRowsByTaskIds`).
   */
  async crossingRows(taskIds: string[]): Promise<CrossingRow[]> {
    if (taskIds.length === 0) return []
    const rows = await prisma.boundaryCrossing.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, category: true, disposition: true },
    })
    return rows.filter(
      (r): r is (typeof rows)[number] & { taskId: string } => r.taskId !== null
    )
  },

  /** Latest delivery snapshot per task — the frozen contract to replay. */
  async latestSnapshots(
    taskIds: string[]
  ): Promise<Array<{ taskId: string; criteria: unknown; frozenAt: Date }>> {
    if (taskIds.length === 0) return []
    return prisma.taskCriteriaSnapshot.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, criteria: true, frozenAt: true },
      orderBy: { frozenAt: 'desc' },
      distinct: ['taskId'],
    })
  },

  /** CRITERION_CHANGED trail across the class, for the independence signal. */
  async criterionChanges(
    taskIds: string[]
  ): Promise<Array<{ taskId: string; payload: unknown; createdAt: Date }>> {
    if (taskIds.length === 0) return []
    return prisma.taskActivity.findMany({
      where: { taskId: { in: taskIds }, type: 'CRITERION_CHANGED' },
      select: { taskId: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  },
}
