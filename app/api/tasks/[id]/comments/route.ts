import { waitUntil } from '@/lib/runtime/wait-until'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
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
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (task.project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // LUM-1232 G2: each comment carries `authorName` (never just an actor id).
    const comments = await commentService.getCommentsWithAuthors(
      id,
      identity.workspaceId
    )

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
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const task = await taskRepository.findForComment(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (task.project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const authorActorId = await getHumanActorId(identity.memberId)
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
      authorClerkId: identity.clerkId,
      workspaceId: task.project.workspaceId,
      projectId: task.projectId,
      taskTitle: task.title,
      taskNumber: task.number,
      teamIdentifier: task.team?.identifier ?? '',
      workspaceSlug: task.project.workspace?.slug ?? '',
      projectName: task.project.name,
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
