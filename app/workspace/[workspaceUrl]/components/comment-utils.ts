import type { ApiComment, WorkspaceMemberInfo } from '../types'

// ── Author resolution ───────────────────────────────────────────────────────

export interface AgentActorInfo {
  actorId: string
  name: string
}

export interface CommentAuthorInfo {
  isAgent: boolean
  name: string
  initials: string
  imageUrl: string | undefined
}

export function resolveCommentAuthor(
  comment: { type?: string; authorActorId: string | null },
  members: WorkspaceMemberInfo[],
  agentActors: AgentActorInfo[]
): CommentAuthorInfo {
  const isAgent = comment.type === 'AGENT'

  if (isAgent) {
    const agentActor =
      agentActors.find(a => a.actorId === comment.authorActorId) ??
      agentActors[0]
    return {
      isAgent: true,
      name: agentActor?.name ?? 'Coding Agent',
      initials: 'CA',
      imageUrl: undefined,
    }
  }

  const author = members.find(m => m.actorId === comment.authorActorId)
  const name = author?.name ?? 'Unknown'
  return {
    isAgent: false,
    name,
    initials: name
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
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
