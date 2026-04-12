import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import type { TaskStatus, TaskPriority } from '@prisma/client'
import {
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import {
  dispatchCreateTaskSideEffects,
  dispatchUpdateTaskSideEffects,
} from '@/lib/services/task-notifications.service'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if targetId is a descendant of ancestorId (recursive). Used to prevent circular parent references. */
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

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateTaskInput {
  title?: string | undefined
  description?: string | null | undefined
  spec?: string | null | undefined
  status?: string | undefined
  priority?: string | undefined
  order?: number | undefined
  dueDate?: string | null | undefined
  parentTaskId?: string | null | undefined
  assigneeActorId?: string | null | undefined
  reviewerActorId?: string | null | undefined
  projectId?: string | undefined
  repositoryId?: string | null | undefined
  tagIds?: string[] | undefined
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
    reviewerActorId: string | null
    teamIdentifier: string
    team: { identifier: string }
    tags: Array<{ id: string; name: string; color: string | null }>
    [key: string]: unknown
  }
  changedFields: string[]
  oldStatus: string
  oldAssigneeActorId: string | null
}

/** Minimal shape of a task detail needed by updateTaskWithSideEffects */
export interface TaskDetailForUpdate {
  project: {
    workspaceId: string
    workspace?: { slug: string } | null
  }
  projectId: string
  number: number
  [key: string]: unknown
}

// ── Task Service ────────────────────────────────────────────────────────────

export const taskService = {
  /**
   * Create a task with ordering, notifications, and activity dispatch.
   * Throws on validation errors with { status, error } shape.
   */
  async createTask(
    projectId: string,
    input: {
      title: string
      description?: string | null | undefined
      status: TaskStatus
      priority: TaskPriority
      assigneeActorId?: string | null | undefined
      parentTaskId?: string | null | undefined
      repositoryId?: string | null | undefined
      order?: number | undefined
      dueDate?: string | null | undefined
    },
    actorId: string,
    actorClerkId: string
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
      parentTaskId,
      repositoryId,
      order,
      dueDate,
    } = input

    // Validate parentTaskId belongs to the same project
    if (parentTaskId) {
      const parent = await taskRepository.findWithProject(parentTaskId)
      if (!parent || parent.projectId !== projectId) {
        throw Object.assign(
          new Error('Parent task not found in this project'),
          { status: 400 }
        )
      }
    }

    // Auto-calculate order if not provided
    let taskOrder = order
    if (taskOrder === undefined) {
      const maxOrderTask = await taskRepository.findMaxOrder(
        projectId,
        parentTaskId ?? null
      )
      taskOrder = (maxOrderTask?.order ?? 0) + 1
    }

    // Validate assigneeActorId belongs to the same workspace
    let assigneeIsAgent = false
    if (assigneeActorId) {
      const actor = await taskRepository.findActorById(assigneeActorId)
      if (!actor || actor.workspaceId !== project.workspaceId) {
        throw Object.assign(
          new Error('Assignee is not part of this workspace'),
          { status: 400 }
        )
      }
      assigneeIsAgent = actor.type === 'AGENT'
    }

    const task = await taskRepository.createWithSequence({
      projectId,
      teamId: project.teamId,
      title,
      description: description ?? null,
      status,
      priority,
      assigneeActorId: assigneeActorId ?? null,
      agentStatus: assigneeIsAgent ? 'SUBMITTED' : null,
      reviewerActorId: null,
      parentTaskId: parentTaskId ?? null,
      repositoryId: repositoryId ?? null,
      order: taskOrder,
      dueDate: dueDate ?? null,
      defaultReviewerMemberId: project.defaultReviewer?.id ?? null,
    })

    // Fire-and-forget side-effects
    dispatchCreateTaskSideEffects({
      task: {
        id: task.id,
        title: task.title,
        teamIdentifier: task.teamIdentifier,
        number: task.number,
      },
      projectId,
      workspaceId: project.workspaceId,
      workspaceSlug: project.workspace?.slug ?? '',
      actorId,
      actorClerkId,
      assigneeActorId: assigneeActorId ?? null,
    })

    return { task }
  },

  /**
   * Get full task detail with PR status sync.
   * Returns null if task not found.
   */
  async getTaskDetail(taskId: string) {
    const task = await taskRepository.findById(taskId)
    if (!task) return null

    // Sync PR status from GitHub
    const openPrs = task.pullRequests.filter(pr => pr.state === 'open')
    let taskStatus = task.status
    let pullRequests = task.pullRequests

    if (openPrs.length > 0) {
      const updates = await syncPullRequestStatus(openPrs)
      if (updates.size > 0) {
        pullRequests = task.pullRequests.map(pr => {
          const update = updates.get(pr.id)
          return update
            ? { ...pr, state: update.state, mergedAt: update.mergedAt }
            : pr
        })
        if ([...updates.values()].some(u => u.state === 'merged')) {
          taskStatus = 'DONE'
        }
      }
    }

    // Fetch tag associations
    const tags = await tagRepository.findByTask(task.id)

    return {
      ...task,
      status: taskStatus,
      pullRequests,
      tags,
      teamIdentifier: task.team.identifier,
      parent: task.parent
        ? {
            id: task.parent.id,
            title: task.parent.title,
            number: task.parent.number,
            teamIdentifier: task.parent.team.identifier,
          }
        : null,
    }
  },

  /**
   * Update a task with validation.
   * Returns the updated task and metadata for notification dispatch.
   * Throws on validation errors with { status, error } shape.
   */
  async updateTask(
    taskId: string,
    input: UpdateTaskInput
  ): Promise<TaskUpdateResult> {
    const task = await taskRepository.findForUpdate(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const {
      parentTaskId,
      assigneeActorId,
      reviewerActorId,
      projectId,
      repositoryId,
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
          new Error(
            `Invalid status transition: ${task.status} → ${rest.status}`
          ),
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

    // Validate assignee
    let newAssigneeType: 'HUMAN' | 'AGENT' | null = null
    if (assigneeActorId !== undefined && assigneeActorId !== null) {
      const actor = await taskRepository.findActorById(assigneeActorId)
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        throw Object.assign(
          new Error('Assignee is not part of this workspace'),
          { status: 400 }
        )
      }
      newAssigneeType = actor.type as 'HUMAN' | 'AGENT'
    }

    // Validate reviewer
    if (reviewerActorId !== undefined && reviewerActorId !== null) {
      const actor = await taskRepository.findActorById(reviewerActorId)
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        throw Object.assign(
          new Error('Reviewer is not part of this workspace'),
          { status: 400 }
        )
      }
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
    if (reviewerActorId !== undefined) data.reviewerActorId = reviewerActorId
    if (projectId !== undefined) data.projectId = projectId
    if (repositoryId !== undefined) data.repositoryId = repositoryId

    // Sync tag associations if tagIds provided
    if (tagIds !== undefined) {
      await tagRepository.syncTaskTags(taskId, tagIds)
    }

    const updated = await taskRepository.update(taskId, data)

    // Attach tags to response
    const tags = await tagRepository.findByTask(taskId)

    return {
      task: { ...updated, teamIdentifier: updated.team.identifier, tags },
      changedFields: Object.keys(data),
      oldStatus: task.status,
      oldAssigneeActorId: task.assigneeActorId ?? null,
    }
  },

  /**
   * Update a task and dispatch all side effects (activity events,
   * real-time push, notifications). Returns the update result.
   */
  async updateTaskWithSideEffects(
    taskId: string,
    input: UpdateTaskInput,
    taskCheck: TaskDetailForUpdate,
    actorId: string | null,
    actorClerkId: string
  ): Promise<TaskUpdateResult> {
    const result = await this.updateTask(taskId, input)

    dispatchUpdateTaskSideEffects({
      taskId,
      input,
      result,
      taskCheck,
      actorId,
      actorClerkId,
    })

    return result
  },

  /**
   * Delete a task.
   * Returns the task's workspaceId (for auth check by caller).
   */
  async deleteTask(taskId: string) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    await taskRepository.delete(taskId)

    return { workspaceId: task.project.workspaceId }
  },

  /**
   * Parse a GitHub PR URL into repo and number.
   */
  parsePrUrl(url: string): { repo: string; number: number } | null {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (!match) return null
    return { repo: match[1]!, number: Number(match[2]) }
  },

  /**
   * Link a PR to a task.
   * Supports two modes: by prId (from search) or by URL (paste).
   */
  async linkPullRequest(
    taskId: string,
    input: { prId?: string; url?: string; force?: boolean }
  ) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    const workspaceId = task.project.workspaceId

    let pr: Awaited<ReturnType<typeof pullRequestRepository.findById>>

    if (input.prId) {
      pr = await pullRequestRepository.findById(input.prId)
      if (!pr) {
        throw Object.assign(new Error('Pull request not found'), {
          status: 404,
        })
      }
      if (pr.workspaceId !== workspaceId) {
        throw Object.assign(
          new Error('Pull request belongs to a different workspace'),
          { status: 403 }
        )
      }
    } else if (input.url) {
      const parsed = this.parsePrUrl(input.url)
      if (!parsed) {
        throw Object.assign(new Error('Invalid GitHub PR URL'), { status: 400 })
      }

      const existing = await pullRequestRepository.findByRepoAndNumber(
        parsed.repo,
        parsed.number
      )

      if (existing) {
        if (existing.workspaceId !== workspaceId) {
          throw Object.assign(
            new Error('Pull request belongs to a different workspace'),
            { status: 403 }
          )
        }
        pr = existing
      } else {
        const integration = await githubRepository.findIntegrationByRepo(
          workspaceId,
          parsed.repo
        )
        if (!integration) {
          throw Object.assign(
            new Error('GitHub integration not configured for this repository'),
            { status: 400 }
          )
        }

        const token = decrypt(integration.accessToken)
        const res = await fetch(
          `https://api.github.com/repos/${parsed.repo}/pulls/${parsed.number}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        )
        if (!res.ok) {
          throw Object.assign(new Error('PR not found on GitHub'), {
            status: 404,
          })
        }

        const ghPr = (await res.json()) as {
          number: number
          title: string
          html_url: string
          state: string
          merged: boolean
          draft: boolean
          user: { login: string }
          head: { ref: string }
          base: { ref: string }
          merged_at: string | null
          closed_at: string | null
        }

        const state = ghPr.merged
          ? 'merged'
          : ghPr.state === 'closed'
            ? 'closed'
            : 'open'

        const upserted = await githubRepository.upsertPullRequest({
          workspaceId,
          taskId: null,
          integrationId: integration.id,
          repo: parsed.repo,
          number: ghPr.number,
          title: ghPr.title,
          url: ghPr.html_url,
          state,
          authorLogin: ghPr.user.login,
          headBranch: ghPr.head.ref,
          baseBranch: ghPr.base.ref,
          isDraft: ghPr.draft,
          mergedAt: ghPr.merged_at ? new Date(ghPr.merged_at) : null,
          closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
        })

        pr = { ...upserted, workspaceId, task: null } as typeof pr
      }
    } else {
      throw Object.assign(new Error('Provide prId or url'), { status: 400 })
    }

    // Check for conflict
    if (pr!.taskId && pr!.taskId !== taskId && !input.force) {
      const conflictTask = pr!.task
      throw Object.assign(new Error('PR already linked to another task'), {
        status: 409,
        conflictTask: conflictTask
          ? {
              id: conflictTask.id,
              number: conflictTask.number,
              title: conflictTask.title,
              teamIdentifier: conflictTask.team.identifier,
            }
          : null,
      })
    }

    return pullRequestRepository.updateTaskId(pr!.id, taskId)
  },

  /**
   * Unlink a PR from a task.
   */
  async unlinkPullRequest(taskId: string, prId: string) {
    const task = await taskRepository.findWithProject(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const pr = await pullRequestRepository.findById(prId)
    if (!pr || pr.taskId !== taskId) {
      throw Object.assign(
        new Error('Pull request is not linked to this task'),
        { status: 400 }
      )
    }

    return pullRequestRepository.updateTaskId(prId, null)
  },
}
