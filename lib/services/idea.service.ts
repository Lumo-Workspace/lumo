import {
  ideaRepository,
  type IdeaRow,
  type IdeaPoolRow,
} from '@/lib/repositories/idea.repository'
import { getDefaultTeam } from '@/lib/team'
import type { CaptureIdeaInput, UpdateIdeaInput } from '@/lib/validation/idea'
import { canTransitionIdeaStatus } from '@/lib/idea-status'
import type { IdeaStatus } from '@prisma/client'

/**
 * An idea as returned to callers — the stored row plus a human-referenceable
 * `identifier` (`<TEAM>-I<number>`, e.g. `LUM-I42`). The `I` prefix keeps idea
 * ids from colliding with task ids (`LUM-42`) in the same team namespace.
 */
export interface CapturedIdea {
  id: string
  number: number
  identifier: string
  statement: string
  status: IdeaStatus
  sourceContext: string | null
  sourceSessionId: string | null
  sourceTaskId: string | null
  proposedByMemberId: string
  createdAt: Date
}

/** The Initiative a PLANNED idea was materialised into (lineage back-link). */
export interface IdeaInitiativeRef {
  id: string
  number: number
  name: string
}

/**
 * A pool-view idea: a `CapturedIdea` plus its materialisation lineage. For a
 * CAPTURED idea `planRunId` and `initiative` are null; for a PLANNED one they
 * point at the run that consumed it and the Initiative it fed.
 */
export interface PooledIdea extends CapturedIdea {
  planRunId: string | null
  initiative: IdeaInitiativeRef | null
}

function ideaIdentifier(teamIdentifier: string, number: number): string {
  return `${teamIdentifier}-I${number}`
}

function toCapturedIdea(idea: IdeaRow, teamIdentifier: string): CapturedIdea {
  return {
    id: idea.id,
    number: idea.number,
    identifier: ideaIdentifier(teamIdentifier, idea.number),
    statement: idea.statement,
    status: idea.status,
    sourceContext: idea.sourceContext,
    sourceSessionId: idea.sourceSessionId,
    sourceTaskId: idea.sourceTaskId,
    proposedByMemberId: idea.proposedByMemberId,
    createdAt: idea.createdAt,
  }
}

function toPooledIdea(row: IdeaPoolRow, teamIdentifier: string): PooledIdea {
  return {
    ...toCapturedIdea(row, teamIdentifier),
    planRunId: row.planRunId,
    initiative: row.initiative
      ? {
          id: row.initiative.id,
          number: row.initiative.number,
          name: row.initiative.name,
        }
      : null,
  }
}

/**
 * Team-level idea capture. Ideas live above projects (no projectId), so the
 * team is resolved from the workspace's default team rather than a project.
 * The proposer is the authenticated member.
 *
 * Throws with `{ status }`: 400 for a blank statement, 404 when the workspace
 * has no default team.
 */
export const ideaService = {
  async capture(args: {
    workspaceId: string
    memberId: string
    input: CaptureIdeaInput
  }): Promise<CapturedIdea> {
    const statement = args.input.statement.trim()
    if (!statement) {
      throw Object.assign(new Error('Idea statement is required'), {
        status: 400,
      })
    }

    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }

    const idea = await ideaRepository.createCaptured({
      teamId: team.id,
      workspaceId: args.workspaceId,
      statement,
      sourceContext: args.input.sourceContext?.trim() || null,
      sourceSessionId: args.input.sourceSessionId?.trim() || null,
      sourceTaskId: args.input.sourceTaskId?.trim() || null,
      proposedByMemberId: args.memberId,
    })

    return toCapturedIdea(idea, team.identifier)
  },

  /**
   * The caller's team idea pool — every status, newest first, each idea
   * carrying its materialisation lineage (`planRunId` + `initiative`). Empty
   * when the workspace has no default team — never another team's ideas. This
   * is the read the ideas pool page and `lumo idea list` consume.
   */
  async listPool(args: { workspaceId: string }): Promise<PooledIdea[]> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) return []
    const rows = await ideaRepository.listPoolByTeam(team.id)
    return rows.map(row => toPooledIdea(row, team.identifier))
  },

  /**
   * Edit a captured idea's statement from the detail slide-over (LUM-683).
   * Team-scoped: the idea is only editable through the caller's default team,
   * so an id in another team is indistinguishable from a missing one — both
   * throw 404 rather than leaking cross-team existence. The trimmed statement
   * is validated at the route (Zod); this layer re-trims defensively and
   * rejects an empty result with 400. Returns the updated pool-view idea.
   *
   * Throws with `{ status }`: 400 for a blank statement, 404 when the workspace
   * has no default team or the idea isn't in it.
   */
  async updateStatement(args: {
    workspaceId: string
    ideaId: string
    input: UpdateIdeaInput
  }): Promise<PooledIdea> {
    const statement = args.input.statement.trim()
    if (!statement) {
      throw Object.assign(new Error('Idea statement is required'), {
        status: 400,
      })
    }

    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('Idea not found'), { status: 404 })
    }

    const row = await ideaRepository.updateStatementInTeam({
      ideaId: args.ideaId,
      teamId: team.id,
      statement,
    })
    if (!row) {
      throw Object.assign(new Error('Idea not found'), { status: 404 })
    }

    return toPooledIdea(row, team.identifier)
  },

  /**
   * Manually move an idea through its lifecycle (LUM-679). `ideaRef` is either
   * the cuid `id` (the web addresses ideas by id) or the human `<TEAM>-I<n>`
   * identifier / bare `<n>` (the CLI). Resolves the caller's default team, looks
   * the idea up team-scoped, and enforces the transition rules in
   * `lib/idea-status.ts` before writing. Returns the updated pool-view idea
   * (same projection as `updateStatement`).
   *
   * Throws with `{ status }`: 400 for a disallowed transition, 404 when the
   * workspace has no default team or the idea isn't in it.
   */
  async updateStatus(args: {
    workspaceId: string
    ideaRef: string
    status: IdeaStatus
  }): Promise<PooledIdea> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('Idea not found'), { status: 404 })
    }

    // Resolve by team-scoped number when the ref looks like `<TEAM>-I<n>` / a
    // bare number (CLI), otherwise treat it as a cuid id (web).
    const number = parseIdeaNumber(args.ideaRef)
    const current =
      number !== null
        ? await ideaRepository.findByNumber(team.id, number)
        : await ideaRepository.findByIdInTeam(args.ideaRef, team.id)
    if (!current) {
      throw Object.assign(new Error('Idea not found'), { status: 404 })
    }

    if (!canTransitionIdeaStatus(current.status, args.status)) {
      throw Object.assign(
        new Error(
          `Cannot move ${team.identifier}-I${current.number} from ${current.status} to ${args.status}`
        ),
        { status: 400 }
      )
    }

    const updated = await ideaRepository.updateStatusInTeam({
      ideaId: current.id,
      teamId: team.id,
      status: args.status,
    })
    if (!updated) {
      throw Object.assign(new Error('Idea not found'), { status: 404 })
    }

    return toPooledIdea(updated, team.identifier)
  },
}

/**
 * Extract the team-scoped idea number from a reference. Accepts the full
 * `<TEAM>-I<n>` identifier (case-insensitive `I`) or a bare `<n>`. Returns
 * `null` for anything else (e.g. a cuid id, which the caller resolves by id).
 */
function parseIdeaNumber(ref: string): number | null {
  const trimmed = ref.trim()
  const withPrefix = trimmed.match(/-I(\d+)$/i)
  if (withPrefix) return Number(withPrefix[1])
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return null
}
