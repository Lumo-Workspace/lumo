import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import type { TaskPriority, TaskStatus } from '@prisma/client'
import { dispatchCreateTaskSideEffects } from '@/lib/services/task-notifications.service'
import { normalizeRichText } from '@/lib/utils/markdown'
import { isWorkStartedStatus } from '@/lib/task/work-started'

/**
 * Create a human-authored task. Validates the milestone and assignee,
 * auto-computes order when the caller doesn't supply one, and dispatches the
 * create-task notification side effects fire-and-forget.
 *
 * Throws with `{ status, message }`: 404 for unknown project, 400 for a
 * cross-project milestone or out-of-workspace assignee.
 */
export async function createTask(
  projectId: string,
  input: {
    title: string
    description?: string | null | undefined
    status: TaskStatus
    priority: TaskPriority
    assigneeActorId?: string | null | undefined
    sprintId?: string | null | undefined
    milestoneId?: string | null | undefined
    order?: number | undefined
    dueDate?: string | null | undefined
    tagIds?: string[] | undefined
  },
  actorId: string,
  actorClerkId: string,
  /**
   * LUM-1283: the WorkspaceMember creating the task, recorded as its creator.
   * Always the calling user — an agent creating through the CLI is recorded as
   * the member whose API key ran it. Null only when no member is known.
   */
  creatorMemberId: string | null
) {
  const project = await projectRepository.findByIdWithDefaults(projectId)
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 })
  }

  const {
    title,
    description,
    status,
    priority,
    assigneeActorId,
    order,
    dueDate,
  } = input

  // LUM-1282: CANCELED is a ruling on an existing task, never a birth state.
  if (status === 'CANCELED') {
    throw Object.assign(new Error('A task cannot be created as CANCELED'), {
      status: 400,
    })
  }

  const resolvedSprintId: string | null = input.sprintId ?? null

  // Validate milestoneId belongs to the same project
  const resolvedMilestoneId: string | null =
    input.milestoneId !== undefined ? (input.milestoneId ?? null) : null
  if (resolvedMilestoneId) {
    const milestone = await milestoneRepository.findById(resolvedMilestoneId)
    if (!milestone || milestone.projectId !== projectId) {
      throw Object.assign(
        new Error('Milestone does not belong to this project'),
        { status: 400 }
      )
    }
    if (milestone.archivedAt) {
      throw Object.assign(
        new Error('Cannot bind a task to an archived milestone'),
        { status: 409 }
      )
    }
  }

  // Auto-calculate order if not provided
  let taskOrder = order
  if (taskOrder === undefined) {
    const maxOrderTask = await taskRepository.findMaxOrder(projectId)
    taskOrder = (maxOrderTask?.order ?? 0) + 1
  }

  // Validate assigneeActorId belongs to the same workspace
  let assigneeIsAgent = false
  if (assigneeActorId) {
    const actor = await taskRepository.findActorById(
      assigneeActorId,
      project.workspaceId
    )
    if (!actor || actor.workspaceId !== project.workspaceId) {
      throw Object.assign(new Error('Assignee is not part of this workspace'), {
        status: 400,
      })
    }
    assigneeIsAgent = actor.type === 'AGENT'
  }

  const task = await taskRepository.createWithSequence({
    workspaceId: project.workspaceId,
    projectId,
    teamId: project.teamId,
    title,
    description: normalizeRichText(description),
    status,
    priority,
    assigneeActorId: assigneeActorId ?? null,
    createdByMemberId: creatorMemberId,
    agentStatus: assigneeIsAgent ? 'SUBMITTED' : null,
    sprintId: resolvedSprintId,
    milestoneId: resolvedMilestoneId,
    order: taskOrder,
    dueDate: dueDate ?? null,
    // A task born already started is stamped immediately (LUM-437); one born
    // in BACKLOG or TODO is not (LUM-1057).
    ...(status && isWorkStartedStatus(status)
      ? { workStartedAt: new Date() }
      : {}),
    // LUM-1282: a task born DONE is completed at birth.
    ...(status === 'DONE' ? { completedAt: new Date() } : {}),
  })

  if (input.tagIds && input.tagIds.length > 0) {
    await tagRepository.syncTaskTags(task.id, input.tagIds)
  }

  const taskTags =
    input.tagIds && input.tagIds.length > 0
      ? await tagRepository.findByTask(task.id)
      : []

  // Fire-and-forget side-effects
  dispatchCreateTaskSideEffects({
    task: {
      id: task.id,
      title: task.title,
      teamIdentifier: task.teamIdentifier,
      number: task.number,
    },
    projectId,
    projectName: project.name,
    workspaceId: project.workspaceId,
    workspaceSlug: project.workspace?.slug ?? '',
    actorId,
    actorClerkId,
    assigneeActorId: assigneeActorId ?? null,
  })

  return { task, taskTags }
}

/**
 * Create a task from a webhook-driven flow (e.g. Sentry alert). Same as
 * `createTask` but without the human-actor notification path — the caller
 * doesn't have a human actor id to attribute the create activity to, and the
 * notification dispatch requires one. Callers that need notifications are
 * responsible for dispatching them separately.
 *
 * Also wires in tag associations atomically — useful for Sentry-issue tags.
 */
export async function createFromAutomation(
  projectId: string,
  input: {
    title: string
    description: string | null
    priority: TaskPriority
    assigneeActorId: string | null
    tagIds: string[]
  }
) {
  const project = await projectRepository.findByIdWithDefaults(projectId)
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 })
  }

  const maxOrderTask = await taskRepository.findMaxOrder(projectId)
  const order = (maxOrderTask?.order ?? 0) + 1

  const task = await taskRepository.createWithSequence({
    workspaceId: project.workspaceId,
    projectId,
    teamId: project.teamId,
    title: input.title,
    description: normalizeRichText(input.description),
    status: 'TODO',
    priority: input.priority,
    assigneeActorId: input.assigneeActorId,
    // LUM-1283: no user creates an automation task, so the creator is null.
    createdByMemberId: null,
    agentStatus: null,
    order,
    dueDate: null,
  })

  if (input.tagIds.length > 0) {
    await tagRepository.syncTaskTags(task.id, input.tagIds)
  }

  return { task }
}
