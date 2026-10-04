/**
 * Shared types for the task service family (creation / state / pr-link).
 * Pulled out so multiple service files can reference the same shapes without
 * forcing a circular import via the entry-point `task.service.ts`.
 */

export interface UpdateTaskInput {
  title?: string | undefined
  description?: string | null | undefined
  spec?: string | null | undefined
  status?: string | undefined
  priority?: string | undefined
  order?: number | undefined
  dueDate?: string | null | undefined
  assigneeActorId?: string | null | undefined
  projectId?: string | undefined
  sprintId?: string | null | undefined
  milestoneId?: string | null | undefined
  /** LUM-646: agent-claimable triage marker (see Task.claimable). */
  claimable?: boolean | undefined
  tagIds?: string[] | undefined
  addTagIds?: string[] | undefined
  removeTagIds?: string[] | undefined
}

export interface TaskUpdateResult {
  task: {
    id: string
    projectId: string
    title: string
    number: number
    status: string
    priority: string
    assigneeActorId: string | null
    teamIdentifier: string
    team: { identifier: string }
    tags: Array<{ id: string; name: string; color: string | null }>
    [key: string]: unknown
  }
  changedFields: string[]
  oldStatus: string
  oldAssigneeActorId: string | null
  /** Pre-update milestone binding, so side effects can reconcile a milestone the task just left. */
  oldMilestoneId: string | null
}

/** Minimal shape of a task detail needed by updateTaskWithSideEffects. */
export interface TaskDetailForUpdate {
  project: {
    name: string
    workspaceId: string
    workspace?: { slug: string } | null
  }
  projectId: string
  number: number
  [key: string]: unknown
}
