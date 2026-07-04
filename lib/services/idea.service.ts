import {
  ideaRepository,
  type IdeaRow,
} from '@/lib/repositories/idea.repository'
import { getDefaultTeam } from '@/lib/team'
import type { CaptureIdeaInput } from '@/lib/validation/idea'
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
   * The caller's team pool of unprocessed (CAPTURED) ideas. Empty when the
   * workspace has no default team — never another team's ideas.
   */
  async listUnprocessed(args: {
    workspaceId: string
  }): Promise<CapturedIdea[]> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) return []
    const ideas = await ideaRepository.listCapturedByTeam(team.id)
    return ideas.map(idea => toCapturedIdea(idea, team.identifier))
  },
}
