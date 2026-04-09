import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { commentService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/comments
 * Returns only top-level comments (parentId = null), each with their replies
 * nested under a `replies` array, ordered oldest-first.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const comments = await commentService.getComments(id)

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('GET /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tasks/[id]/comments
 * Creates a comment or reply. If `parentId` is supplied it must reference a
 * top-level comment on the same task (replies cannot themselves be replied to).
 * Fires TASK_MENTIONED notifications for @mention chips in the body.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findForComment(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const authorActorId = await getHumanActorId(memberResult.id)
    if (!authorActorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 500 })
    }

    const body = await request.json()
    const parsed = createCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { body: commentBody, parentId, quotedCommentId } = parsed.data

    const comment = await commentService.createCommentWithSideEffects({
      taskId: id,
      authorActorId,
      body: commentBody,
      parentId: parentId ?? null,
      quotedCommentId: quotedCommentId ?? null,
      authorClerkId: userId,
      workspaceId: task.project.workspaceId,
      projectId: task.projectId,
      taskTitle: task.title,
      taskNumber: task.number,
      teamIdentifier: task.team?.identifier ?? '',
      workspaceSlug: task.project.workspace?.slug ?? '',
      waitUntil,
    })

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('POST /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
