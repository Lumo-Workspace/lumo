import type { ApiComment, WorkspaceMemberInfo } from '../types'

// ── Author resolution ───────────────────────────────────────────────────────

export interface AgentActorInfo {
  actorId: string
  name: string
}

export interface CommentAuthorInfo {
  isAgent: boolean
  name: string
  imageUrl: string | undefined
}

/**
 * Non-agent comments resolve as: workspace member (keeps avatar + current
 * name) → the API's `authorName` (e.g. `@uselumo[bot]` on PR-mirrored
 * comments, LUM-1238) → `fallbackName`, a localized label from the caller.
 */
export function resolveCommentAuthor(
  comment: {
    type?: string
    authorActorId: string | null
    authorName?: string | null
  },
  members: WorkspaceMemberInfo[],
  agentActors: AgentActorInfo[],
  fallbackName: string
): CommentAuthorInfo {
  const isAgent = comment.type === 'AGENT'

  if (isAgent) {
    const agentActor =
      agentActors.find(a => a.actorId === comment.authorActorId) ??
      agentActors[0]
    return {
      isAgent: true,
      name: agentActor?.name ?? 'Coding Agent',
      imageUrl: undefined,
    }
  }

  const author = members.find(m => m.actorId === comment.authorActorId)
  const name = author?.name ?? (comment.authorName || fallbackName)
  return {
    isAgent: false,
    name,
    imageUrl: author?.imageUrl ?? undefined,
  }
}

// ── Comment tree manipulation ───────────────────────────────────────────────

export function mapCommentTree(
  prev: ApiComment[],
  commentId: string,
  fn: (c: ApiComment) => ApiComment | null
): ApiComment[] {
  const result: ApiComment[] = []
  for (const c of prev) {
    if (c.id === commentId) {
      const mapped = fn(c)
      if (mapped) result.push(mapped)
    } else {
      const updatedReplies = c.replies
        ? mapCommentTree(c.replies, commentId, fn)
        : c.replies
      if (updatedReplies !== c.replies) {
        const updated = { ...c } as ApiComment
        updated.replies = updatedReplies as ApiComment[]
        result.push(updated)
      } else {
        result.push(c)
      }
    }
  }
  return result
}
