import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/notifications/notifyTaskChange'
import { getHumanActorId } from '@/lib/actor'
import { pushTaskEvent, pushProjectEvent } from '@/lib/pusher/server'
import { taskService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id] — Fetch a single task with full details.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    return NextResponse.json({ task: taskDetail })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tasks/[id] — Update a task.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    // Pre-check: load task for auth
    const taskCheck = await taskService.getTaskDetail(id)
    if (!taskCheck) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskCheck.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await taskService.updateTask(id, parsed.data)

    // Push real-time events (fire-and-forget)
    waitUntil(
      Promise.all([
        pushTaskEvent(id, {
          type: 'task:updated',
          fields: result.changedFields,
        }),
        pushProjectEvent(result.task.projectId as string, {
          type: 'task:updated',
          taskId: id,
          fields: result.changedFields,
          patch: result.task,
        }),
      ])
    )

    // Notification side-effects (fire-and-forget)
    const triggerActorId = await getHumanActorId(memberResult.id)
    const ctx = buildTaskNotificationCtx(
      {
        ...taskCheck,
        assigneeActorId: result.oldAssigneeActorId,
      } as Parameters<typeof buildTaskNotificationCtx>[0],
      result.task as Parameters<typeof buildTaskNotificationCtx>[1],
      triggerActorId,
      userId
    )
    dispatchTaskUpdateNotifications({
      ctx,
      taskId: id,
      oldStatus: result.oldStatus,
      newStatus: parsed.data.status,
      oldAssigneeActorId: result.oldAssigneeActorId,
      newAssigneeActorId: parsed.data.assigneeActorId,
      updatedReviewerActorId: (result.task.reviewerActorId as string) ?? null,
      workspaceId: taskCheck.project.workspaceId,
      triggerActorId,
    })

    return NextResponse.json({ task: result.task })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id] — Delete a task.
 * Children get parentTaskId set to null (onDelete: SetNull).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await taskService.deleteTask(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
