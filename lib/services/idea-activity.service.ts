import { ideaActivityRepository } from '@/lib/repositories/idea-activity.repository'
import { resolveIdeaInTeam } from './idea.service'
import type { IdeaActivityType } from '@prisma/client'

/**
 * One entry on an idea's activity timeline (LUM-680), flattened for the web /
 * API. `payload` shape depends on `type` (see the IdeaActivityType enum doc):
 * STATUS_CHANGED carries `{from,to}` (+ `planRunId`/`initiativeId` when the
 * transition was a plan-run materialisation), COMMENT_ADDED carries
 * `{commentId}`, the rest carry null.
 */
export interface IdeaActivityEntry {
  id: string
  type: IdeaActivityType
  payload: Record<string, unknown> | null
  actorId: string | null
  createdAt: Date
}

export const ideaActivityService = {
  /** The idea's activity timeline, oldest first. Team-scoped via the resolver. */
  async listForIdea(args: {
    workspaceId: string
    ideaRef: string
  }): Promise<IdeaActivityEntry[]> {
    const { idea } = await resolveIdeaInTeam(args.workspaceId, args.ideaRef)
    const rows = await ideaActivityRepository.listByIdea(idea.id)
    return rows.map(r => ({
      id: r.id,
      type: r.type,
      payload: (r.payload ?? null) as Record<string, unknown> | null,
      actorId: r.actorId,
      createdAt: r.createdAt,
    }))
  },
}
