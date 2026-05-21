import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import {
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'
import { dispatchUpdateTaskSideEffects } from '@/lib/services/task-notifications.service'
import type {
  UpdateTaskInput,
  TaskUpdateResult,
  TaskDetailForUpdate,
} from './task-types'

/**
 * Walk a task's children to check whether `targetId` is anywhere below
 * `ancestorId`. Used by `updateTask` to refuse circular parent references
 * (a task cannot become a descendant of itself).
 */
async function isDescendant(
  ancestorId: string,
  targetId: string
): Promise<boolean> {
  const children = await taskRepository.findChildren(ancestorId)
  if (children.length === 0) return false
  if (children.some(child => child.id === targetId)) return true
  for (const child of children) {
    if (await isDescendant(child.id, targetId)) return true
  }
  return false
}

/**
 * Update a task with full validation: status-machine transition, parent
 * project + circular-reference guard, project cross-workspace check,
 * assignee workspace membership. Writes a SPRINT_CHANGED activity
 * when `sprintId` is in the patch, and syncs tag associations when `tagIds`
 * is provided.
 *
 * Returns the updated row plus `changedFields` (only keys whose values
 * actually moved) so the caller can decide whether to fire side effects.
 * Concurrent patches that re-assert the same value no longer emit no-op
 * activity entries.
 *
 * Throws with `{ status, message }`: 404 missing task, 400 invalid input,
 * 409 invalid status transition.
 */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
  actorId?: string | null
): Promise<TaskUpdateResult> {
  const task = await taskRepository.findForUpdate(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }

  const {
    parentTaskId,
    assigneeActorId,
    projectId,
    repositoryId,
    sprintId,
    milestoneId,
    tagIds,
    ...rest
  } = input

  // Validate status transition
  if (rest.status !== undefined && rest.status !== task.status) {
    if (
      !isValidTaskTransition(
        task.status as TaskStatusValue,
        rest.status as TaskStatusValue
      )
    ) {
      throw Object.assign(
        new Error(`Invalid status transition: ${task.status} → ${rest.status}`),
        { status: 409 }
      )
    }
  }

  // Validate parent task
  if (parentTaskId !== undefined) {
    if (parentTaskId !== null) {
      if (parentTaskId === taskId) {
        throw Object.assign(new Error('A task cannot be its own parent'), {
          status: 400,
        })
      }
      const parent = await taskRepository.findProjectIdById(parentTaskId)
      if (!parent || parent.projectId !== task.projectId) {
        throw Object.assign(
          new Error('Parent task not found in this project'),
          { status: 400 }
        )
      }
      if (await isDescendant(taskId, parentTaskId)) {
        throw Object.assign(
          new Error('Cannot create circular parent reference'),
          { status: 400 }
        )
      }
    }
  }

  // Validate project
  if (projectId !== undefined) {
    const newProject = await projectRepository.findByIdSimple(projectId)
    if (!newProject || newProject.workspaceId !== task.project.workspaceId) {
      throw Object.assign(new Error('Project not found in this workspace'), {
        status: 400,
      })
    }
  }

  // Validate milestone belongs to the task's project (or the new project if
  // we're moving the task). Reject cross-project milestone assignment.
  if (milestoneId !== undefined && milestoneId !== null) {
    const milestone = await milestoneRepository.findById(milestoneId)
    const expectedProjectId = projectId ?? task.projectId
    if (!milestone || milestone.projectId !== expectedProjectId) {
      throw Object.assign(
        new Error('Milestone does not belong to this project'),
        { status: 400 }
      )
    }
  }

  // Validate assignee
  let newAssigneeType: 'HUMAN' | 'AGENT' | null = null
  if (assigneeActorId !== undefined && assigneeActorId !== null) {
    const actor = await taskRepository.findActorById(assigneeActorId)
    if (!actor || actor.workspaceId !== task.project.workspaceId) {
      throw Object.assign(new Error('Assignee is not part of this workspace'), {
        status: 400,
      })
    }
    newAssigneeType = actor.type as 'HUMAN' | 'AGENT'
  }

  // Build update data
  const data: import('@/lib/repositories/task.repository').TaskUpdateData = {}
  if (rest.title !== undefined) data.title = rest.title
  if (rest.description !== undefined) data.description = rest.description
  if (rest.spec !== undefined) data.spec = rest.spec
  if (rest.status !== undefined) data.status = rest.status
  if (rest.priority !== undefined) data.priority = rest.priority
  if (rest.order !== undefined) data.order = rest.order
  if (rest.dueDate !== undefined) data.dueDate = rest.dueDate
  if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
  if (assigneeActorId !== undefined) {
    data.assigneeActorId = assigneeActorId
    if (newAssigneeType === 'AGENT') {
      data.agentStatus = 'SUBMITTED'
      data.agentError = null
    } else {
      data.agentStatus = null
      data.agentError = null
    }
  }
  if (projectId !== undefined) data.projectId = projectId
  if (repositoryId !== undefined) data.repositoryId = repositoryId
  if (sprintId !== undefined) data.sprintId = sprintId
  if (milestoneId !== undefined) data.milestoneId = milestoneId

  // Write SPRINT_CHANGED activity when sprintId changes
  if ('sprintId' in input && sprintId !== task.sprintId) {
    await activityRepository.create({
      taskId,
      actorId: actorId ?? null,
      type: 'SPRINT_CHANGED',
      payload: {
        fromSprintId: task.sprintId ?? null,
        toSprintId: sprintId ?? null,
        reason: 'manual',
      },
    })
  }

  // Sync tag associations if tagIds provided
  if (tagIds !== undefined) {
    await tagRepository.syncTaskTags(taskId, tagIds)
  }

  const updated = await taskRepository.update(taskId, data)

  // Attach tags to response
  const tags = await tagRepository.findByTask(taskId)

  // Only report fields whose values actually changed between the pre-
  // update row and the payload. Using `Object.keys(data)` wrote no-op
  // activity entries (e.g. `STATUS_CHANGED from=TODO to=TODO`) whenever
  // two concurrent patches hit with the same status.
  const changedFields = Object.keys(data).filter(k => {
    const before = (task as Record<string, unknown>)[k]
    const after = (data as Record<string, unknown>)[k]
    return before !== after
  })

  return {
    task: { ...updated, teamIdentifier: updated.team.identifier, tags },
    changedFields,
    oldStatus: task.status,
    oldAssigneeActorId: task.assigneeActorId ?? null,
  }
}

/**
 * `updateTask` + fan-out to activity events, real-time push, and
 * notifications. The dispatch call is fire-and-forget — failures there
 * don't roll back the update.
 */
export async function updateTaskWithSideEffects(
  taskId: string,
  input: UpdateTaskInput,
  taskCheck: TaskDetailForUpdate,
  actorId: string | null,
  actorClerkId: string
): Promise<TaskUpdateResult> {
  const result = await updateTask(taskId, input, actorId)

  dispatchUpdateTaskSideEffects({
    taskId,
    input,
    result,
    taskCheck,
    actorId,
    actorClerkId,
  })

  return result
}

/**
 * Move a DONE task back to TODO and append a SENTRY_ALERT activity. No-op if
 * the task isn't currently DONE — the caller (Sentry regression handler) can
 * safely call this for every alert without first checking status.
 */
export async function reopen(
  taskId: string,
  opts: { reason: 'sentry_regression'; actorId: string | null }
) {
  const task = await taskRepository.findForUpdate(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }
  if (task.status !== 'DONE') return

  await taskRepository.update(taskId, { status: 'TODO' })
  await activityRepository.create({
    taskId,
    type: 'SENTRY_ALERT',
    actorId: opts.actorId,
    payload: { reason: opts.reason, reopened: true },
  })
}
