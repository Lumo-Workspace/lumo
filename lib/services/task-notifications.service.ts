import { waitUntil } from '@vercel/functions'
import { taskRepository } from '@/lib/repositories/task.repository'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { dispatchEvents } from '@/lib/events/dispatcher'
import { pushTaskEvent, pushProjectEvent } from '@/lib/integrations/pusher'
import { sendChannelNotification } from '@/lib/integrations/slack'
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/services/notification.service'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { dependencyDetectionService } from '@/lib/services/dependency-detection.service'
import { htmlToPreview } from '@/lib/utils/htmlToPreview'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'
import type {
  UpdateTaskInput,
  TaskUpdateResult,
  TaskDetailForUpdate,
} from '@/lib/services/task.service'

// ── Create-task side-effects ────────────────────────────────────────────────

/**
 * Fire-and-forget side-effects after a task is created:
 * activity event, Slack channel notification, and assignee notification.
 */
export function dispatchCreateTaskSideEffects(opts: {
  task: {
    id: string
    title: string
    teamIdentifier: string
    number: number
  }
  projectId: string
  projectName: string
  workspaceId: string
  workspaceSlug: string
  actorId: string
  actorClerkId: string
  assigneeActorId: string | null | undefined
}) {
  const {
    task,
    projectId,
    projectName,
    workspaceId,
    workspaceSlug,
    actorId,
    actorClerkId,
    assigneeActorId,
  } = opts

  // ── Fire-and-forget: task created activity event ────────────────────────
  waitUntil(
    dispatchEvents([
      {
        type: 'task:created',
        taskId: task.id,
        projectId,
        actorId: actorId ?? '',
      } satisfies TaskActivityEvent,
    ])
  )

  // ── Fire-and-forget: task_created Slack channel notification ─────────────
  const taskIdentifier = buildTaskIdentifier(task.teamIdentifier, task.number)
  const taskUrl = buildTaskUrl(
    workspaceSlug,
    projectName,
    task.teamIdentifier,
    task.number
  )
  waitUntil(
    sendChannelNotification(
      workspaceId,
      'task_created',
      {
        taskId: task.id,
        taskTitle: task.title,
        taskIdentifier,
        taskUrl,
      },
      projectId
    )
  )

  // ── Fire-and-forget: notify assignee if task was created with one ─────────
  if (assigneeActorId) {
    taskRepository
      .findActorWithMember(assigneeActorId)
      .then(actor => {
        if (!actor || actor.type !== 'HUMAN' || !actor.member) return
        if (actor.member.clerkId === actorClerkId) return
        return notificationRepository.create({
          workspaceId,
          recipientActorId: assigneeActorId,
          type: 'TASK_ASSIGNED' as const,
          taskId: task.id,
          triggerActorId: actorId,
        })
      })
      .catch(err =>
        console.error('[notify] TASK_ASSIGNED (create) failed:', err)
      )
  }
}

// ── Update-task side-effects ────────────────────────────────────────────────

/**
 * Build TaskActivityEvent[] from changed fields in a task update.
 */
export function buildActivityEvents(
  taskId: string,
  projectId: string,
  input: UpdateTaskInput,
  result: TaskUpdateResult,
  taskCheck: TaskDetailForUpdate,
  triggerActorId: string | null
): TaskActivityEvent[] {
  const activityEvents: TaskActivityEvent[] = []

  if (input.status !== undefined && result.changedFields.includes('status')) {
    activityEvents.push({
      type: 'task:status_changed_activity',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      from: result.oldStatus,
      to: input.status,
    })
  }
  if (
    input.priority !== undefined &&
    result.changedFields.includes('priority')
  ) {
    activityEvents.push({
      type: 'task:priority_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      from: (taskCheck as any).priority ?? null,
      to: input.priority,
    })
  }
  if (input.title !== undefined && result.changedFields.includes('title')) {
    activityEvents.push({
      type: 'task:title_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      from: (taskCheck as any).title ?? null,
      to: input.title,
    })
  }
  if (
    input.assigneeActorId !== undefined &&
    result.changedFields.includes('assigneeActorId')
  ) {
    activityEvents.push({
      type: 'task:assignee_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      fromActorId: result.oldAssigneeActorId,
      toActorId: input.assigneeActorId ?? null,
      toName: null,
    })
  }
  if (
    input.description !== undefined &&
    result.changedFields.includes('description')
  ) {
    activityEvents.push({
      type: 'task:description_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      from: null,
      to: null,
    })
  }
  if (input.dueDate !== undefined && result.changedFields.includes('dueDate')) {
    activityEvents.push({
      type: 'task:due_date_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      from: (taskCheck as any).dueDate ?? null,
      to: input.dueDate ?? null,
    })
  }
  if (
    input.parentTaskId !== undefined &&
    result.changedFields.includes('parentTaskId')
  ) {
    activityEvents.push({
      type: 'task:parent_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      fromTaskId: (taskCheck as any).parentTaskId ?? null,
      toTaskId: input.parentTaskId ?? null,
      toTitle: null,
    })
  }
  // Bulk replace (tagIds) always records; incremental add/remove (the CLI's
  // --add-tag / --remove-tag) records only a real change — before LUM-821 it
  // left no trace in the history at all.
  const incrementalTags =
    (input.addTagIds?.length ?? 0) > 0 || (input.removeTagIds?.length ?? 0) > 0
  if (input.tagIds !== undefined || incrementalTags) {
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
    if (
      input.tagIds === undefined &&
      added.length === 0 &&
      removed.length === 0
    ) {
      return activityEvents
    }
    activityEvents.push({
      type: 'task:tags_changed',
      taskId,
      projectId,
      actorId: triggerActorId ?? '',
      added,
      removed,
    })
  }

  return activityEvents
}

/**
 * Dispatch all side-effects after a task update:
 * activity events, real-time push, and notifications.
 */
export function dispatchUpdateTaskSideEffects(opts: {
  taskId: string
  input: UpdateTaskInput
  result: TaskUpdateResult
  taskCheck: TaskDetailForUpdate
  actorId: string | null
  actorClerkId: string
}) {
  const { taskId, input, result, taskCheck, actorId, actorClerkId } = opts
  const triggerActorId = actorId
  const projectId = result.task.projectId as string

  // Build and dispatch activity events
  const activityEvents = buildActivityEvents(
    taskId,
    projectId,
    input,
    result,
    taskCheck,
    triggerActorId
  )

  if (activityEvents.length > 0) {
    waitUntil(dispatchEvents(activityEvents))
  }

  // ── Fire-and-forget: notify users newly @-mentioned in the description ────
  // Same guard as the task:description_changed activity event. The helper
  // no-ops when the old/new mention sets are equal, so no extra equality
  // check is needed here.
  if (
    input.description !== undefined &&
    result.changedFields.includes('description')
  ) {
    const newHtml = input.description
    waitUntil(
      (async () => {
        const ws = await workspaceRepository.findNameAndSlug(
          taskCheck.project.workspaceId
        )
        if (!ws?.slug) return
        const taskUrl = buildTaskUrl(
          ws.slug,
          taskCheck.project.name,
          result.task.team.identifier,
          result.task.number
        )
        await notifyMentionDelta({
          oldHtml: (taskCheck.description as string | null | undefined) ?? '',
          newHtml,
          authorClerkId: actorClerkId,
          authorActorId: actorId ?? '',
          workspaceId: taskCheck.project.workspaceId,
          notificationType: 'TASK_MENTIONED',
          ref: { taskId },
          slackEvent: 'comment_mention',
          slackPayload: {
            taskTitle: result.task.title,
            taskUrl,
            commentBody: htmlToPreview(newHtml),
          },
          waitUntil,
        })
      })().catch(() => {})
    )
    // ── Fire-and-forget: task→task mention 候选依赖边(LUM-172) ────────────
    waitUntil(
      dependencyDetectionService
        .detectMentionEdges({
          taskId,
          workspaceId: taskCheck.project.workspaceId,
          html: newHtml ?? '',
          surface: 'description',
        })
        .catch(() => {})
    )
  }

  // Push real-time events (fire-and-forget)
  waitUntil(
    Promise.all([
      pushTaskEvent(taskId, {
        type: 'task:updated',
        fields: result.changedFields,
      }),
      pushProjectEvent(result.task.projectId as string, {
        type: 'task:updated',
        taskId,
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
    actorClerkId
  )
  dispatchTaskUpdateNotifications({
    ctx,
    taskId,
    oldStatus: result.oldStatus,
    newStatus: input.status,
    oldAssigneeActorId: result.oldAssigneeActorId,
    newAssigneeActorId: input.assigneeActorId,
    workspaceId: taskCheck.project.workspaceId,
    triggerActorId,
  })
}
