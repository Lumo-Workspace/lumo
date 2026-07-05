import { prisma } from '@/lib/db/prisma'
import type { Prisma, IdeaStatus } from '@prisma/client'

/**
 * Fields returned to the service layer. Ideas are small, but we still project
 * explicitly (ISP) so callers can't accidentally depend on columns reserved
 * for later phases (`parentId`, `updatedAt`).
 */
const IDEA_SELECT = {
  id: true,
  number: true,
  statement: true,
  status: true,
  sourceContext: true,
  sourceSessionId: true,
  sourceTaskId: true,
  proposedByMemberId: true,
  teamId: true,
  workspaceId: true,
  createdAt: true,
} satisfies Prisma.IdeaSelect

export type IdeaRow = Prisma.IdeaGetPayload<{ select: typeof IDEA_SELECT }>

/**
 * Pool-view projection: the base fields plus the materialisation lineage a
 * PLANNED idea carries — the `planRunId` of the run that consumed it and the
 * `Initiative` it fed. Both are null for a CAPTURED idea. Used by the ideas
 * pool page and `lumo idea list`, which show the whole pool (not just the
 * unprocessed slice) newest-first.
 */
const IDEA_POOL_SELECT = {
  ...IDEA_SELECT,
  planRunId: true,
  initiative: {
    select: { id: true, number: true, name: true },
  },
} satisfies Prisma.IdeaSelect

export type IdeaPoolRow = Prisma.IdeaGetPayload<{
  select: typeof IDEA_POOL_SELECT
}>

/** Prisma unique-constraint violation — a concurrent racer took our number. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

const MAX_NUMBER_ATTEMPTS = 5

export const ideaRepository = {
  /**
   * Create a CAPTURED idea with a team-scoped sequential `number`.
   *
   * Unlike Task (which has a `Team.taskSeq` counter), there is no per-team
   * counter column for ideas, so the next number is derived from the current
   * max inside a transaction. The `@@unique([teamId, number])` constraint
   * guards against a concurrent racer picking the same value; on the
   * resulting P2002 we retry with a freshly-read max (bounded).
   */
  async createCaptured(data: {
    teamId: string
    workspaceId: string
    statement: string
    sourceContext: string | null
    sourceSessionId: string | null
    sourceTaskId: string | null
    proposedByMemberId: string
  }): Promise<IdeaRow> {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const { _max } = await tx.idea.aggregate({
            where: { teamId: data.teamId },
            _max: { number: true },
          })
          const number = (_max.number ?? 0) + 1
          return tx.idea.create({
            data: { ...data, number },
            select: IDEA_SELECT,
          })
        })
      } catch (err) {
        if (isUniqueViolation(err) && attempt < MAX_NUMBER_ATTEMPTS - 1) {
          continue
        }
        throw err
      }
    }
    // Exhausted retries under sustained contention.
    throw Object.assign(new Error('Could not allocate an idea number'), {
      status: 503,
    })
  },

  /**
   * The team's unprocessed pool — CAPTURED ideas only, oldest first. Scoped by
   * `teamId` so a caller never sees another team's ideas. This is the read the
   * transformer (Spec 2) will consume.
   */
  async listCapturedByTeam(teamId: string): Promise<IdeaRow[]> {
    return prisma.idea.findMany({
      where: { teamId, status: 'CAPTURED' },
      select: IDEA_SELECT,
      orderBy: { number: 'asc' },
    })
  },

  /**
   * The team's full idea pool — every status, newest first. `number` is a
   * per-team monotonic sequence, so ordering by it descending yields
   * newest-first without a `createdAt` tiebreak. Scoped by `teamId`; a caller
   * never sees another team's ideas. Each row carries its materialisation
   * lineage (`planRunId` + `initiative`) so PLANNED ideas can link back to the
   * Initiative they fed. This is the read the pool page and `lumo idea list`
   * consume — distinct from `listCapturedByTeam` (CAPTURED-only), which the
   * Spec-2 transformer still uses.
   */
  async listPoolByTeam(teamId: string): Promise<IdeaPoolRow[]> {
    return prisma.idea.findMany({
      where: { teamId },
      select: IDEA_POOL_SELECT,
      orderBy: { number: 'desc' },
    })
  },

  /**
   * Fetch ideas by id (order unspecified — callers key by `id`). Used by the
   * gate-A board to render idea statements and by Stage-2 to build the align
   * input from the confirmed clusters. An empty `ids` short-circuits to `[]`.
   */
  async findByIds(ids: string[]): Promise<IdeaRow[]> {
    if (ids.length === 0) return []
    return prisma.idea.findMany({
      where: { id: { in: ids } },
      select: IDEA_SELECT,
    })
  },

  /**
   * Update an idea's `statement`, scoped to `teamId` so a caller can only edit
   * ideas in their own team. The `{ id, teamId }` filter goes through
   * `updateMany` (a plain `update` can't take a non-unique compound filter): a
   * zero count means the id doesn't exist in this team → returns `null` for the
   * service to map to a 404. On success the freshly-updated pool row (with
   * lineage) is returned so callers reflect the edit without a second read.
   */
  async updateStatementInTeam(data: {
    ideaId: string
    teamId: string
    statement: string
  }): Promise<IdeaPoolRow | null> {
    const { count } = await prisma.idea.updateMany({
      where: { id: data.ideaId, teamId: data.teamId },
      data: { statement: data.statement },
    })
    if (count === 0) return null
    return prisma.idea.findUnique({
      where: { id: data.ideaId },
      select: IDEA_POOL_SELECT,
    })
  },

  /**
   * Resolve one idea by its team-scoped `number` (the `<TEAM>-I<n>` id the CLI
   * references). Scoped by `teamId` via the `@@unique([teamId, number])` key so
   * a caller never resolves another team's idea; `null` when there is no such
   * number in the team.
   */
  async findByNumber(teamId: string, number: number): Promise<IdeaRow | null> {
    return prisma.idea.findUnique({
      where: { teamId_number: { teamId, number } },
      select: IDEA_SELECT,
    })
  },

  /**
   * Resolve one idea by its cuid `id`, scoped to `teamId` so the web (which
   * addresses ideas by id) can never read across teams. `null` when the id
   * doesn't exist in this team.
   */
  async findByIdInTeam(
    ideaId: string,
    teamId: string
  ): Promise<IdeaRow | null> {
    return prisma.idea.findFirst({
      where: { id: ideaId, teamId },
      select: IDEA_SELECT,
    })
  },

  /**
   * Set an idea's lifecycle status, scoped to `teamId` (the `{ id, teamId }`
   * filter goes through `updateMany` like `updateStatementInTeam` — a zero
   * count → `null` → 404). The transition's legality is enforced in the service
   * before this runs. Returns the refreshed pool row (with lineage) on success.
   */
  async updateStatusInTeam(data: {
    ideaId: string
    teamId: string
    status: IdeaStatus
  }): Promise<IdeaPoolRow | null> {
    const { count } = await prisma.idea.updateMany({
      where: { id: data.ideaId, teamId: data.teamId },
      data: { status: data.status },
    })
    if (count === 0) return null
    return prisma.idea.findUnique({
      where: { id: data.ideaId },
      select: IDEA_POOL_SELECT,
    })
  },
}
