import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Read repository for team-level Initiatives (LUM-673). Initiatives are
 * materialised by the Spec-2 converter (LUM-671); this repo only reads them
 * back for the browse page. All queries are `teamId`-scoped so a caller can
 * never see another team's initiatives.
 */

/** List-card projection — the scalar summary plus lineage counts (ISP). */
const INITIATIVE_LIST_SELECT = {
  id: true,
  number: true,
  goalStatement: true,
  status: true,
  createdAt: true,
  _count: { select: { tasks: true, ideas: true } },
} satisfies Prisma.InitiativeSelect

export type InitiativeListRow = Prisma.InitiativeGetPayload<{
  select: typeof INITIATIVE_LIST_SELECT
}>

/**
 * Detail projection — the full initiative plus its lineage: the consumed Ideas
 * (`idea.initiativeId` backref) and the attached Tasks (`task.initiativeId`
 * backref). `teamId` is selected so the service can enforce the team boundary.
 */
const INITIATIVE_DETAIL_SELECT = {
  id: true,
  number: true,
  teamId: true,
  goalStatement: true,
  assumptionNote: true,
  status: true,
  createdAt: true,
  ideas: {
    select: { id: true, number: true, statement: true },
    orderBy: { number: 'asc' },
  },
  tasks: {
    select: { id: true, number: true, title: true, status: true },
    orderBy: { number: 'asc' },
  },
} satisfies Prisma.InitiativeSelect

export type InitiativeDetailRow = Prisma.InitiativeGetPayload<{
  select: typeof INITIATIVE_DETAIL_SELECT
}>

export const initiativeRepository = {
  /**
   * The team's initiatives, newest first. Scoped by `teamId` so a caller never
   * sees another team's initiatives.
   */
  async listByTeam(teamId: string): Promise<InitiativeListRow[]> {
    return prisma.initiative.findMany({
      where: { teamId },
      select: INITIATIVE_LIST_SELECT,
      orderBy: { number: 'desc' },
    })
  },

  /**
   * One initiative with its lineage, or `null` if no such id exists. The
   * caller (service) is responsible for the team-boundary check — this returns
   * the row regardless of team so the service can decide 404-vs-leak.
   */
  async findDetailById(id: string): Promise<InitiativeDetailRow | null> {
    return prisma.initiative.findUnique({
      where: { id },
      select: INITIATIVE_DETAIL_SELECT,
    })
  },
}
