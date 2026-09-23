import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireIdentity, type Identity } from '@/lib/auth'
import { updateCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { commentRepository } from '@/lib/repositories'
import { commentService } from '@/lib/services/comment.service'

type Params = { params: Promise<{ id: string; commentId: string }> }

async function requireCommentOwner(
  taskId: string,
  commentId: string,
  identity: Identity,
  action: string
) {
  const comment = await commentRepository.findByIdWithTask(commentId)
  // A comment with no task is an idea comment (LUM-680) — never editable here.
  // Another workspace's comment, or an already-deleted one, reads as absent.
  if (
    !comment ||
    comment.deletedAt ||
    !comment.task ||
    comment.taskId !== taskId ||
    comment.task.project.workspaceId !== identity.workspaceId
  ) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  const actorId = await getHumanActorId(identity.memberId)
  if (comment.authorActorId !== actorId) {
    return NextResponse.json(
      { error: `You can only ${action} your own comments` },
      { status: 403 }
    )
  }
  return { comment }
}

/**
 * PATCH /api/tasks/[id]/comments/[commentId] — Edit a comment (author only).
 * Browser session or CLI bearer (LUM-821: `lumo task comments edit`).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id: taskId, commentId } = await params

    const result = await requireCommentOwner(
      taskId,
      commentId,
      identity,
      'edit'
    )
    if (result instanceof NextResponse) return result

    const body = await request.json()
    const parsed = updateCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await commentService.updateCommentWithSideEffects({
      commentId,
      body: parsed.data.body,
      waitUntil,
    })
    return NextResponse.json({ comment: updated })
  } catch (error) {
    console.error('PATCH /api/tasks/[id]/comments/[commentId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id]/comments/[commentId] — Soft-delete a comment (author
 * only). Browser session or CLI bearer (LUM-821: `lumo task comments rm`).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id: taskId, commentId } = await params

    const result = await requireCommentOwner(
      taskId,
      commentId,
      identity,
      'delete'
    )
    if (result instanceof NextResponse) return result

    await commentService.deleteCommentWithSideEffects({ commentId, waitUntil })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/tasks/[id]/comments/[commentId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
