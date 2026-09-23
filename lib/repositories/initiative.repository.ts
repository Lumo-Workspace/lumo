import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Repository for team-level Initiatives (LUM-673). Initiatives are either
 * materialised by the Spec-2 converter (LUM-671) or created directly here; this
 * repo reads them back for the browse page and allocates the team-scoped
 * `number` for a direct create. All queries are `teamId`-scoped so a caller can
 * never see another team's initiatives.
 */

/** Prisma unique-constraint violation — a concurrent racer took our number. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

const MAX_NUMBER_ATTEMPTS = 5

/** Scalar projection for a freshly-created initiative (no lineage yet). */
const INITIATIVE_CREATED_SELECT = {
  id: true,
  number: true,
  name: true,
  assumptionNote: true,
  status: true,
  createdAt: true,
} satisfies Prisma.InitiativeSelect

export type InitiativeCreatedRow = Prisma.InitiativeGetPayload<{
  select: typeof INITIATIVE_CREATED_SELECT
}>

/** List-card projection — the scalar summary plus lineage counts (ISP). */
const INITIATIVE_LIST_SELECT = {
  id: true,
  number: true,
  name: true,
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
  name: true,
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

/**
 * Composition projection (LUM-678) — the two-layer contents of an initiative:
 * its Milestones (each with its own tasks) and ALL of its initiative-linked
 * Tasks (both directly-attached and any that also sit under a milestone). The
 * de-dup (a task under a milestone is not a "direct" task) is a service-layer
 * decision, so `milestoneId` is selected on the flat `tasks` list for it to
 * partition on — the repository stays query-only (no business logic).
 */
const INITIATIVE_COMPOSITION_SELECT = {
  id: true,
  number: true,
  teamId: true,
  name: true,
  milestones: {
    select: {
      id: true,
      name: true,
      slug: true,
      completedAt: true,
      archivedAt: true,
      tasks: {
        select: { id: true, number: true, title: true, status: true },
        orderBy: { number: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
  tasks: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      milestoneId: true,
    },
    orderBy: { number: 'asc' },
  },
} satisfies Prisma.InitiativeSelect

export type InitiativeCompositionRow = Prisma.InitiativeGetPayload<{
  select: typeof INITIATIVE_COMPOSITION_SELECT
}>

/** Progress-post projection (LUM-821). */
const INITIATIVE_UPDATE_SELECT = {
  id: true,
  authorMemberId: true,
  body: true,
  health: true,
  createdAt: true,
} satisfies Prisma.InitiativeUpdateSelect

export type InitiativeUpdateRow = Prisma.InitiativeUpdateGetPayload<{
  select: typeof INITIATIVE_UPDATE_SELECT
}>

export const initiativeRepository = {
  /** Id + team of the initiative with this team-scoped number, or null (LUM-821). */
  async findRefByTeamNumber(
    teamId: string,
    number: number
  ): Promise<{ id: string; teamId: string } | null> {
    return prisma.initiative.findUnique({
      where: { teamId_number: { teamId, number } },
      select: { id: true, teamId: true },
    })
  },

  /** Id + team by primary key, or null — the service checks the team. */
  async findRefById(
    id: string
  ): Promise<{ id: string; teamId: string } | null> {
    return prisma.initiative.findUnique({
      where: { id },
      select: { id: true, teamId: true },
    })
  },

  /** Patch scalar fields; returns the list-card projection (LUM-821). */
  async update(
    id: string,
    data: Prisma.InitiativeUpdateInput
  ): Promise<InitiativeListRow> {
    return prisma.initiative.update({
      where: { id },
      data,
      select: INITIATIVE_LIST_SELECT,
    })
  },

  /** Append a progress post (LUM-821). */
  async createProgressUpdate(data: {
    initiativeId: string
    authorMemberId: string
    body: string
    health: 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | null
  }): Promise<InitiativeUpdateRow> {
    return prisma.initiativeUpdate.create({
      data,
      select: INITIATIVE_UPDATE_SELECT,
    })
  },

  /** An initiative's progress posts, newest first. */
  async listProgressUpdates(
    initiativeId: string,
    take: number
  ): Promise<InitiativeUpdateRow[]> {
    return prisma.initiativeUpdate.findMany({
      where: { initiativeId },
      select: INITIATIVE_UPDATE_SELECT,
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

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

  /**
   * One initiative's two-layer contents (LUM-678): its milestones (each with
   * their tasks) plus its initiative-linked tasks. Returns the row regardless
   * of team — the service enforces the team boundary (cf. `findDetailById`).
   */
  async findCompositionById(
    id: string
  ): Promise<InitiativeCompositionRow | null> {
    return prisma.initiative.findUnique({
      where: { id },
      select: INITIATIVE_COMPOSITION_SELECT,
    })
  },

  /**
   * Create a team-level Initiative directly (no plan run): `planRunId` is null
   * and `status` starts ACTIVE. Like Idea, there is no per-team counter column,
   * so the next `number` is derived from the current max inside a transaction;
   * the `@@unique([teamId, number])` constraint guards a concurrent racer and a
   * resulting P2002 retries with a freshly-read max (bounded).
   */
  async create(data: {
    teamId: string
    workspaceId: string
    name: string
    assumptionNote: string | null
  }): Promise<InitiativeCreatedRow> {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const { _max } = await tx.initiative.aggregate({
            where: { teamId: data.teamId },
            _max: { number: true },
          })
          const number = (_max.number ?? 0) + 1
          return tx.initiative.create({
            data: {
              teamId: data.teamId,
              workspaceId: data.workspaceId,
              number,
              planRunId: null,
              // LUM-678: `name` is the initiative's goal text. A directly-created
              // initiative starts ACTIVE.
              name: data.name,
              assumptionNote: data.assumptionNote,
              status: 'ACTIVE',
            },
            select: INITIATIVE_CREATED_SELECT,
          })
        })
      } catch (err) {
        if (isUniqueViolation(err) && attempt < MAX_NUMBER_ATTEMPTS - 1) {
          continue
        }
        throw err
      }
    }
    // Exhausted retries under sustained contention on the initiative number.
    throw Object.assign(new Error('Could not allocate an initiative number'), {
      status: 503,
    })
  },
}
