import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'

type Params = { params: Promise<{ id: string; commentId: string }> }

async function requireCommentOwner(
  taskId: string,
  commentId: string,
  userId: string,
  action: string
) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      task: { select: { project: { select: { workspaceId: true } } } },
    },
  })
  if (!comment || comment.taskId !== taskId) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  const memberResult = await requireWorkspaceMember(
    comment.task.project.workspaceId,
    userId
  )
  if (memberResult instanceof NextResponse) return memberResult
  const actorId = await getHumanActorId(memberResult.id)
  if (comment.authorActorId !== actorId) {
    return NextResponse.json(
      { error: `You can only ${action} your own comments` },
      { status: 403 }
    )
  }
  return { comment, member: memberResult }
}

/**
 * PATCH /api/tasks/[id]/comments/[commentId] — Edit a comment (author only).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId, commentId } = await params

    const result = await requireCommentOwner(taskId, commentId, userId, 'edit')
    if (result instanceof NextResponse) return result

    const body = await request.json()
    const parsed = updateCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { body: parsed.data.body },
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
 * DELETE /api/tasks/[id]/comments/[commentId] — Delete a comment (author only).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId, commentId } = await params

    const result = await requireCommentOwner(
      taskId,
      commentId,
      userId,
      'delete'
    )
    if (result instanceof NextResponse) return result

    await prisma.comment.delete({ where: { id: commentId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/tasks/[id]/comments/[commentId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
