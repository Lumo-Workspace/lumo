import { waitUntil } from '@/lib/runtime/wait-until'
import { taskRepository } from '@/lib/repositories/task.repository'
import { commentService } from '@/lib/services/comment.service'
import { markdownToHtml } from '@/lib/utils/markdown'
import { sanitizeField } from '@/lib/utils/sanitize'

/**
 * Shared send-back plumbing for the FAIL verdict paths (LUM-422). Both the
 * human verdict bar and the agent CLI path turn a reviewer's note into a real
 * task comment — so @mentions, images, and the comment thread come for free
 * (milestone rule 5 ①: a human send-back carries zero structured burden; the
 * note IS the reason). The commentId is then carried in the mirror
 * VERIFICATION_RUN_RECORDED activity payload, keeping the FAIL row → comment
 * link traceable with zero schema (the VerificationRun table gains no column).
 */

/** Upper bound on the plain-text summary stored in VerificationRun.rejectionReason. */
const SUMMARY_MAX = 2_000

/**
 * Collapse a note (markdown from the CLI, or rich-text HTML from the comment
 * editor) to a sanitized single-line plain-text summary for the structured
 * VerificationRun.rejectionReason field. The full fidelity lives in the
 * comment; this is the quick-read send-back reason the agent sees back via
 * `lumo task status`. Returns null for an empty/whitespace note.
 */
export function summarizeSendBackNote(
  rawNote: string | null | undefined
): string | null {
  if (rawNote == null) return null
  // Strip tags first so HTML notes don't leak markup into the summary, then
  // collapse whitespace and run the shared control-char sanitizer.
  const text = sanitizeField(rawNote.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length === 0) return null
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
}

export interface SendBackCommentInput {
  taskId: string
  /** Raw reviewer note — markdown (agent CLI) or HTML (comment editor). */
  rawNote: string
  /** Actor id the comment is attributed to (the reviewer's HUMAN actor). */
  authorActorId: string
  authorClerkId: string
}

/**
 * Post a send-back note as a task comment with full side effects (@mention
 * notifications, realtime push, activity, mirror). Returns the new comment's
 * id, or null when the note is empty or the task can't be loaded for comment
 * context. Best-effort: a comment failure must never sink the verdict itself,
 * so the caller treats a null/throw as "no comment linked" and proceeds.
 */
export async function postSendBackComment(
  input: SendBackCommentInput
): Promise<string | null> {
  const body = markdownToHtml(input.rawNote).trim()
  if (body.length === 0) return null

  const task = await taskRepository.findForComment(input.taskId)
  if (!task) return null

  const comment = await commentService.createCommentWithSideEffects({
    taskId: input.taskId,
    authorActorId: input.authorActorId,
    body,
    parentId: null,
    quotedCommentId: null,
    authorClerkId: input.authorClerkId,
    workspaceId: task.project.workspaceId,
    projectId: task.projectId,
    taskTitle: task.title,
    taskNumber: task.number,
    teamIdentifier: task.team?.identifier ?? '',
    workspaceSlug: task.project.workspace?.slug ?? '',
    projectName: task.project.name,
    waitUntil,
  })
  return comment.id
}
