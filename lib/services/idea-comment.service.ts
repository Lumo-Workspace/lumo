import { commentRepository } from '@/lib/repositories/comment.repository'
import { scanContent } from '@/lib/services/content-signals'
import { ideaActivityRepository } from '@/lib/repositories/idea-activity.repository'
import { assertSingleCommentOwner } from '@/lib/comment-owner'
import { resolveIdeaInTeam } from './idea.service'

/**
 * A flat idea comment as returned to callers (LUM-680). `replies` is always
 * empty — idea threads don't nest — but the field is kept so the shape matches
 * the shared task comment renderer (the CLI `formatCommentThread`) and the web
 * comment list can reuse one component.
 */
export interface IdeaCommentNode {
  id: string
  authorActorId: string | null
  body: string
  createdAt: Date
  replies: IdeaCommentNode[]
}

function toNode(c: {
  id: string
  authorActorId: string | null
  body: string
  createdAt: Date
}): IdeaCommentNode {
  return {
    id: c.id,
    authorActorId: c.authorActorId,
    body: c.body,
    createdAt: c.createdAt,
    replies: [],
  }
}

/**
 * Idea comments (LUM-680). Ideas reuse the polymorphic Comment table via the
 * `ideaId` FK. Every read/write resolves the idea team-scoped first (shared
 * `resolveIdeaInTeam`), so a comment can never be posted to or read from another
 * team's idea, and a missing/foreign id is a uniform 404.
 */
export const ideaCommentService = {
  /** The idea's comment thread, oldest first. */
  async listComments(args: {
    workspaceId: string
    ideaRef: string
  }): Promise<IdeaCommentNode[]> {
    const { idea } = await resolveIdeaInTeam(args.workspaceId, args.ideaRef)
    const rows = await commentRepository.findByIdeaId(idea.id)
    return rows.map(toNode)
  },

  /**
   * Post a comment on an idea and record a COMMENT_ADDED activity. The body is
   * validated at the route (Zod). Records the activity awaited so the timeline
   * reflects the comment immediately.
   */
  async createComment(args: {
    workspaceId: string
    ideaRef: string
    authorActorId: string
    body: string
  }): Promise<IdeaCommentNode> {
    const { idea } = await resolveIdeaInTeam(args.workspaceId, args.ideaRef)
    // Polymorphic-owner invariant: an idea comment sets ideaId, never taskId.
    assertSingleCommentOwner({ ideaId: idea.id })

    const comment = await commentRepository.createForIdea({
      ideaId: idea.id,
      authorActorId: args.authorActorId,
      body: args.body,
      // LUM-783: same scan as task comments — one Comment table, one rule.
      contentSignals: scanContent(args.body),
    })

    await ideaActivityRepository.create({
      ideaId: idea.id,
      actorId: args.authorActorId,
      type: 'COMMENT_ADDED',
      payload: { commentId: comment.id },
    })

    return toNode(comment)
  },
}
