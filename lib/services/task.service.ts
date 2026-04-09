import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { getGithubInstallationToken } from '@/lib/github/auth'
import {
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'

// ── Types ───────────────────────────────────────────────────────────────────

interface PrStatusUpdate {
  state: string
  mergedAt: Date | null
}

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
  task: Record<string, unknown>
  changedFields: string[]
  oldStatus: string
  oldAssigneeActorId: string | null
}

// ── PR Sync (private) ───────────────────────────────────────────────────────

async function syncPullRequestStatus(
  openPrs: { id: string; number: number; url: string; state: string }[]
): Promise<Map<string, PrStatusUpdate>> {
  const updates = new Map<string, PrStatusUpdate>()
  try {
    const token = await getGithubInstallationToken()

    for (const pr of openPrs) {
      const match = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)
      if (!match) continue
      const repo = match[1]

      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!res.ok) continue

      const ghPr = (await res.json()) as {
        state: string
        merged: boolean
        merged_at: string | null
        closed_at: string | null
        draft: boolean
      }

      const newState = ghPr.merged
        ? 'merged'
        : ghPr.state === 'closed'
          ? 'closed'
          : 'open'

      if (newState === pr.state) continue

      const mergedAt = ghPr.merged_at ? new Date(ghPr.merged_at) : null

      await pullRequestRepository.updateState(pr.id, {
        state: newState,
        mergedAt,
        closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
        isDraft: ghPr.draft,
      })

      updates.set(pr.id, { state: newState, mergedAt })
    }
  } catch (_err) {
    // Non-critical: PR state may be slightly stale
  }
  return updates
}

// ── Task Service ────────────────────────────────────────────────────────────

export const taskService = {
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
        if (await taskRepository.isDescendant(taskId, parentTaskId)) {
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
    const data: Record<string, unknown> = {}
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
}
