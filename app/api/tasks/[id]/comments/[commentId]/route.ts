import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateCommentSchema } from '@/lib/validation/schemas'

type Params = { params: Promise<{ id: string; commentId: string }> }

/**
 * PATCH /api/tasks/[id]/comments/[commentId] — Edit a comment (author only).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId, commentId } = await params

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

    if (comment.authorId !== userId) {
      return NextResponse.json(
        { error: 'You can only edit your own comments' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const parsed = updateCommentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

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

    if (comment.authorId !== userId) {
      return NextResponse.json(
        { error: 'You can only delete your own comments' },
        { status: 403 }
      )
    }

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
