import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import type { TaskPriority, TaskStatus } from '@prisma/client'
import { dispatchCreateTaskSideEffects } from '@/lib/services/task-notifications.service'
import { normalizeRichText } from '@/lib/utils/markdown'
import { isWorkStartedStatus } from '@/lib/task/work-started'
import { slugify } from '@/lib/utils/slugify'
import {
  taskCreateGate,
  type ProjectLifecycleLike,
} from '@/shared/src/project-lifecycle'

/**
 * LUM-1285: the project-lifecycle check on task create. A CANCELED or archived
 * project refuses (409, with the command a person runs to reopen it); a PAUSED
 * one allows the create and returns a warning for the caller to show.
 * Automation paths (crossing remediation, webhooks) pass `skip` — their task
 * records something that already happened and must not be lost.
 */
export function checkProjectAcceptsTasks(
  project: ProjectLifecycleLike & { name: string },
  opts: { skip?: boolean | undefined } = {}
): string[] {
  if (opts.skip) return []
  const gate = taskCreateGate(project)
  if (gate.kind === 'refuse') {
    const slug = slugify(project.name)
    const message =
      gate.reason === 'archived'
        ? `Project "${project.name}" is archived — new tasks can't be added. A person can restore it with \`lumo project unarchive ${slug}\`.`
        : `Project "${project.name}" is canceled — new tasks can't be added. A person can reactivate it with \`lumo project update ${slug} --status active\`.`
    throw Object.assign(new Error(message), { status: 409 })
  }
  if (gate.kind === 'warn') {
    return [
      `Project "${project.name}" is paused — the task was created, but \`lumo status --next\` skips it until the project is active again.`,
    ]
  }
  return []
}

/**
 * Create a human-authored task. Validates the milestone and assignee,
 * auto-computes order when the caller doesn't supply one, and dispatches the
 * create-task notification side effects fire-and-forget.
 *
 * Throws with `{ status, message }`: 404 for unknown project, 400 for a
 * cross-project milestone or out-of-workspace assignee, 409 for a CANCELED or
 * archived project (LUM-1285; `warnings` carries the PAUSED notice).
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
  /** LUM-1285: `automation: true` skips the project-lifecycle refusal. */
  opts: { automation?: boolean | undefined } = {}
) {
  const project = await projectRepository.findByIdWithDefaults(projectId)
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 })
  }
  const warnings = checkProjectAcceptsTasks(project, {
    skip: opts.automation,
  })

  const {
    title,
    description,
    status,
    priority,
    assigneeActorId,
    order,
    dueDate,
  } = input

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

  return { task, taskTags, warnings }
}

/**
 * Create a task from a webhook-driven flow (e.g. Sentry alert). Same as
 * `createTask` but without the human-actor notification path — the caller
 * doesn't have a human actor id to attribute the create activity to, and the
 * notification dispatch requires one. Callers that need notifications are
 * responsible for dispatching them separately.
 *
 * Also wires in tag associations atomically — useful for Sentry-issue tags.
 * LUM-1285: never refused on project status — an alert must not be dropped.
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
    agentStatus: null,
    order,
    dueDate: null,
  })

  if (input.tagIds.length > 0) {
    await tagRepository.syncTaskTags(task.id, input.tagIds)
  }

  return { task }
}
