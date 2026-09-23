import { apiCall, type ApiContext } from './test-case-api'
import type { CommentNode } from '../commands/task-comment-list'

/**
 * LUM-821: address a task comment from the terminal. `task comments list`
 * prints each comment's short id (`#` + first 8 chars); any unique prefix of
 * ≥6 chars (or the full id) selects it — the same convention as edge ids in
 * `task deps`.
 */

export const COMMENT_SHORT_ID_LEN = 8
const MIN_PREFIX = 6

export function shortCommentId(id: string): string {
  return id.slice(0, COMMENT_SHORT_ID_LEN)
}

/** Flatten a thread (top-level + one level of replies). */
export function flattenThread(comments: CommentNode[]): CommentNode[] {
  return comments.flatMap(c => [c, ...(c.replies ?? [])])
}

export type CommentPick =
  | { ok: true; comment: CommentNode; isReply: boolean }
  | { ok: false; error: string }

/** Pick one comment by id or unique prefix. Pure. */
export function pickComment(comments: CommentNode[], ref: string): CommentPick {
  const needle = ref.trim().replace(/^#/, '')
  if (needle.length < MIN_PREFIX) {
    return {
      ok: false,
      error: `comment ref "${ref}" is too short — use at least ${MIN_PREFIX} characters of the id shown by \`lumo task comments list\``,
    }
  }
  const replyIds = new Set(
    comments.flatMap(c => (c.replies ?? []).map(r => r.id))
  )
  const hits = flattenThread(comments).filter(c => c.id.startsWith(needle))
  if (hits.length === 0) {
    return { ok: false, error: `no comment matches "${ref}" on this task` }
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: `comment ref "${ref}" is ambiguous (${hits.map(h => h.id).join(', ')}) — use more characters`,
    }
  }
  return { ok: true, comment: hits[0]!, isReply: replyIds.has(hits[0]!.id) }
}

export interface ResolvedTask {
  id: string
  identifier: string
}

/** Resolve LUM-N → task DB id. null = error already printed. */
export async function resolveTaskRef(
  ctx: ApiContext,
  identifier: string
): Promise<ResolvedTask | null> {
  const r = await apiCall<ResolvedTask>(
    ctx,
    `/api/tasks/resolve/${encodeURIComponent(identifier)}`,
    {},
    `resolve ${identifier}`
  )
  return r.ok && r.data ? r.data : null
}

/** Fetch a task's comment thread. null = error already printed. */
export async function fetchThread(
  ctx: ApiContext,
  taskId: string
): Promise<CommentNode[] | null> {
  const r = await apiCall<{ comments: CommentNode[] }>(
    ctx,
    `/api/tasks/${encodeURIComponent(taskId)}/comments`,
    {},
    'comment list'
  )
  return r.ok && r.data ? r.data.comments : null
}

/** Resolve task + comment ref in one go. null = error already printed. */
export async function resolveTaskComment(
  ctx: ApiContext,
  identifier: string,
  commentRef: string
): Promise<{
  task: ResolvedTask
  comment: CommentNode
  isReply: boolean
} | null> {
  const task = await resolveTaskRef(ctx, identifier)
  if (!task) return null
  const thread = await fetchThread(ctx, task.id)
  if (!thread) return null
  const pick = pickComment(thread, commentRef)
  if (!pick.ok) {
    console.error(`Error: ${pick.error}`)
    return null
  }
  return { task, comment: pick.comment, isReply: pick.isReply }
}
