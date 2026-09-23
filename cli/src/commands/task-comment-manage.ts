import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'
import { resolveTaskComment, shortCommentId } from '../lib/comment-ref'
import { commentPlainText } from './task-comment-list'

/**
 * LUM-821: edit / soft-delete your own task comment from the terminal.
 * Author-only is enforced server-side (403 for anyone else).
 */

const EXCERPT_LEN = 120

function excerpt(html: string): string {
  const text = commentPlainText(html).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_LEN ? `${text.slice(0, EXCERPT_LEN)}…` : text
}

/** `lumo task comments edit <LUM-N> <comment> <body>` */
export async function taskCommentEdit(
  identifier: string,
  commentRef: string,
  body: string
): Promise<number | void> {
  if (!body || body.trim().length === 0) {
    console.error('Error: missing <body> — the new comment text')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const hit = await resolveTaskComment(ctx, identifier, commentRef)
  if (!hit) return 1

  const r = await apiCall<{ comment: { id: string } }>(
    ctx,
    `/api/tasks/${encodeURIComponent(hit.task.id)}/comments/${encodeURIComponent(hit.comment.id)}`,
    { method: 'PATCH', json: { body } },
    'comment edit'
  )
  if (!r.ok) return 1
  process.stdout.write(
    `Edited comment #${shortCommentId(hit.comment.id)} on ${hit.task.identifier}\n`
  )
}

/** The changes[] block for the rm confirmation envelope. */
export function describeCommentRm(
  identifier: string,
  comment: { id: string; body: string; replies?: unknown[] },
  isReply: boolean
): string[] {
  const lines = [
    `Will delete ${isReply ? 'reply' : 'comment'} #${shortCommentId(comment.id)} on ${identifier}: "${sanitizeField(excerpt(comment.body))}"`,
  ]
  const replies = comment.replies?.length ?? 0
  if (!isReply && replies > 0) {
    lines.push(
      `Its ${replies} ${replies === 1 ? 'reply is' : 'replies are'} hidden with it (the thread only shows replies under a live comment)`
    )
  }
  lines.push(
    'Soft delete: hidden from the thread; only your own comments can be deleted'
  )
  return lines
}

/** `lumo task comments rm <LUM-N> <comment> [--confirm]` */
export async function taskCommentRm(
  identifier: string,
  commentRef: string,
  options: { confirm?: boolean }
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const hit = await resolveTaskComment(ctx, identifier, commentRef)
  if (!hit) return 1

  if (!isConfirmed(options)) {
    return emitConfirmation({
      command: 'task comments rm',
      changes: describeCommentRm(hit.task.identifier, hit.comment, hit.isReply),
    })
  }

  const r = await apiCall<{ success: boolean }>(
    ctx,
    `/api/tasks/${encodeURIComponent(hit.task.id)}/comments/${encodeURIComponent(hit.comment.id)}`,
    { method: 'DELETE' },
    'comment delete'
  )
  if (!r.ok) return 1
  process.stdout.write(
    `Deleted comment #${shortCommentId(hit.comment.id)} on ${hit.task.identifier}\n`
  )
}
