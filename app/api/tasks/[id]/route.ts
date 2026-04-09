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
import { pushTaskEvent, pushProjectEvent } from '@/lib/integrations/pusher'
import { taskService } from '@/lib/services'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

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
    const triggerActorId = await getHumanActorId(memberResult.id)

    // Build activity events from changed fields
    const activityEvents: TaskActivityEvent[] = []
    const projectId = result.task.projectId as string

    if (
      parsed.data.status !== undefined &&
      result.changedFields.includes('status')
    ) {
      activityEvents.push({
        type: 'task:status_changed_activity',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        from: result.oldStatus,
        to: parsed.data.status,
      })
    }
    if (
      parsed.data.priority !== undefined &&
      result.changedFields.includes('priority')
    ) {
      activityEvents.push({
        type: 'task:priority_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        from: (taskCheck as any).priority ?? null,
        to: parsed.data.priority,
      })
    }
    if (
      parsed.data.title !== undefined &&
      result.changedFields.includes('title')
    ) {
      activityEvents.push({
        type: 'task:title_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        from: (taskCheck as any).title ?? null,
        to: parsed.data.title,
      })
    }
    if (
      parsed.data.assigneeActorId !== undefined &&
      result.changedFields.includes('assigneeActorId')
    ) {
      activityEvents.push({
        type: 'task:assignee_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        fromActorId: result.oldAssigneeActorId,
        toActorId: parsed.data.assigneeActorId ?? null,
        toName: null,
      })
    }
    if (
      parsed.data.reviewerActorId !== undefined &&
      result.changedFields.includes('reviewerActorId')
    ) {
      activityEvents.push({
        type: 'task:reviewer_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        fromActorId: (taskCheck as any).reviewerActorId ?? null,
        toActorId: parsed.data.reviewerActorId ?? null,
        toName: null,
      })
    }
    if (
      parsed.data.description !== undefined &&
      result.changedFields.includes('description')
    ) {
      activityEvents.push({
        type: 'task:description_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        from: null,
        to: null,
      })
    }
    if (
      parsed.data.dueDate !== undefined &&
      result.changedFields.includes('dueDate')
    ) {
      activityEvents.push({
        type: 'task:due_date_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        from: (taskCheck as any).dueDate ?? null,
        to: parsed.data.dueDate ?? null,
      })
    }
    if (
      parsed.data.parentTaskId !== undefined &&
      result.changedFields.includes('parentTaskId')
    ) {
      activityEvents.push({
        type: 'task:parent_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        fromTaskId: (taskCheck as any).parentTaskId ?? null,
        toTaskId: parsed.data.parentTaskId ?? null,
        toTitle: null,
      })
    }
    if (
      parsed.data.repositoryId !== undefined &&
      result.changedFields.includes('repositoryId')
    ) {
      activityEvents.push({
        type: 'task:repository_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        fromRepoId: (taskCheck as any).repositoryId ?? null,
        toRepoId: parsed.data.repositoryId ?? null,
        toName: null,
      })
    }
    if (parsed.data.tagIds !== undefined) {
      const oldTagNames = ((taskCheck as any).tags ?? []).map(
        (t: { name: string }) => t.name
      )
      const newTagNames = ((result.task as any).tags ?? []).map(
        (t: { name: string }) => t.name
      )
      const oldSet = new Set(oldTagNames as string[])
      const newSet = new Set(newTagNames as string[])
      const added = (newTagNames as string[]).filter(n => !oldSet.has(n))
      const removed = (oldTagNames as string[]).filter(n => !newSet.has(n))
      activityEvents.push({
        type: 'task:tags_changed',
        taskId: id,
        projectId,
        actorId: triggerActorId ?? '',
        added,
        removed,
      })
    }

    // Fire-and-forget activity recording
    if (activityEvents.length > 0) {
      waitUntil(dispatchEvents(activityEvents))
    }

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
