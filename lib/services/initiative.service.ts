import {
  initiativeRepository,
  type InitiativeListRow,
  type InitiativeDetailRow,
} from '@/lib/repositories/initiative.repository'
import { getDefaultTeam } from '@/lib/team'
import type { InitiativeStatus, TaskStatus } from '@prisma/client'

/**
 * A materialised initiative as returned to callers. `identifier` is the
 * human-referenceable `<TEAM>-INIT-<number>` (e.g. `LUM-INIT-3`); the `INIT`
 * infix keeps initiative ids from colliding with task (`LUM-3`) or idea
 * (`LUM-I3`) ids in the same team namespace.
 */
export interface InitiativeListItem {
  id: string
  number: number
  identifier: string
  goalStatement: string
  status: InitiativeStatus
  taskCount: number
  ideaCount: number
  createdAt: Date
}

/** A consumed idea in an initiative's lineage (`<TEAM>-I<number>`). */
export interface InitiativeIdeaRef {
  id: string
  identifier: string
  statement: string
}

/** An attached task in an initiative's lineage (`<TEAM>-<number>`). */
export interface InitiativeTaskRef {
  id: string
  identifier: string
  title: string
  status: TaskStatus
}

export interface InitiativeDetail {
  id: string
  number: number
  identifier: string
  goalStatement: string
  assumptionNote: string | null
  status: InitiativeStatus
  createdAt: Date
  /** Ideas this initiative consumed (idea.initiativeId backref). */
  ideas: InitiativeIdeaRef[]
  /** Tasks materialised under this initiative (task.initiativeId backref). */
  tasks: InitiativeTaskRef[]
  /** Roll-up of the attached tasks for a progress read-out. */
  taskProgress: { total: number; done: number }
}

function initiativeIdentifier(teamIdentifier: string, number: number): string {
  return `${teamIdentifier}-INIT-${number}`
}

function toListItem(
  row: InitiativeListRow,
  teamIdentifier: string
): InitiativeListItem {
  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    goalStatement: row.goalStatement,
    status: row.status,
    taskCount: row._count.tasks,
    ideaCount: row._count.ideas,
    createdAt: row.createdAt,
  }
}

function toDetail(
  row: InitiativeDetailRow,
  teamIdentifier: string
): InitiativeDetail {
  const done = row.tasks.filter(t => t.status === 'DONE').length
  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    goalStatement: row.goalStatement,
    assumptionNote: row.assumptionNote,
    status: row.status,
    createdAt: row.createdAt,
    ideas: row.ideas.map(i => ({
      id: i.id,
      identifier: `${teamIdentifier}-I${i.number}`,
      statement: i.statement,
    })),
    tasks: row.tasks.map(t => ({
      id: t.id,
      identifier: `${teamIdentifier}-${t.number}`,
      title: t.title,
      status: t.status,
    })),
    taskProgress: { total: row.tasks.length, done },
  }
}

/**
 * Team-level initiative browse (LUM-673). Initiatives live above projects (no
 * projectId), so the team is resolved from the workspace's default team —
 * mirroring the idea pool. Every read is scoped to that team, so a caller
 * never sees another team's initiatives.
 *
 * Throws with `{ status }`: 404 when the initiative does not exist or belongs
 * to another team (the same response, so cross-team ids can't be probed).
 */
export const initiativeService = {
  /**
   * The caller team's initiatives (newest first). Empty when the workspace has
   * no default team — never another team's initiatives.
   */
  async listForWorkspace(args: {
    workspaceId: string
  }): Promise<InitiativeListItem[]> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) return []
    const rows = await initiativeRepository.listByTeam(team.id)
    return rows.map(row => toListItem(row, team.identifier))
  },

  /**
   * One initiative with its lineage, scoped to the caller's team. Throws 404
   * when the workspace has no default team, the id is unknown, or the
   * initiative belongs to another team.
   */
  async getDetail(args: {
    workspaceId: string
    initiativeId: string
  }): Promise<InitiativeDetail> {
    const team = await getDefaultTeam(args.workspaceId)
    const notFound = () =>
      Object.assign(new Error('Initiative not found'), { status: 404 })
    if (!team) throw notFound()

    const row = await initiativeRepository.findDetailById(args.initiativeId)
    // Fail closed on a cross-team id — same 404 as a genuinely missing row so
    // the boundary can't be probed.
    if (!row || row.teamId !== team.id) throw notFound()

    return toDetail(row, team.identifier)
  },
}
