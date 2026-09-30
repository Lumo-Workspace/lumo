import { taskRepository } from '@/lib/repositories/task.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { privateFileRepository } from '@/lib/repositories/private-file.repository'
import { privateFileService } from '@/lib/services/private-file.service'
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { createFromAutomation, createTask } from './task-creation.service'
import {
  reopen,
  updateTask,
  updateTaskWithSideEffects,
} from './task-state.service'
import {
  linkPullRequest,
  parsePrUrl,
  unlinkPullRequest,
} from './task-pr-link.service'

export type {
  UpdateTaskInput,
  TaskUpdateResult,
  TaskDetailForUpdate,
} from './task-types'

/**
 * Split an identifier like "LUM-30" or "FOO-BAR-12" into `{teamIdentifier,
 * number}`. Returns null on malformed input. Uses lastIndexOf so team
 * identifiers themselves may contain hyphens.
 */
function splitTaskIdentifier(
  identifier: string
): { teamIdentifier: string; number: number } | null {
  const idx = identifier.lastIndexOf('-')
  if (idx === -1) return null
  const teamIdentifier = identifier.slice(0, idx).toUpperCase()
  const n = parseInt(identifier.slice(idx + 1), 10)
  if (!teamIdentifier || Number.isNaN(n)) return null
  return { teamIdentifier, number: n }
}

/**
 * Resolve a human-facing task identifier ("LUM-30") scoped to a workspace
 * into the minimal descriptor `{ id, identifier, title, status }`. Shared
 * by the CLI command paths (`session attach`, `task context`, `task
 * create`/`update`), the `/api/tasks/resolve/:identifier` route, and the
 * task-context service. Returns null if the identifier is malformed or no
 * matching task exists in the workspace — callers map that to HTTP 404.
 */
async function resolveIdentifier(workspaceId: string, identifier: string) {
  const parts = splitTaskIdentifier(identifier)
  if (!parts) return null
  const task = await taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parts.teamIdentifier,
    parts.number
  )
  if (!task) return null
  return {
    id: task.id,
    identifier: `${task.team.identifier}-${task.number}`,
    title: task.title,
    status: task.status,
  }
}

/**
 * Full task detail for the task page. Syncs open PR state from GitHub
 * before returning — if any linked PR has been merged in the meantime we
 * also flip the task's reported status to DONE in the response (the row in
 * the DB is updated by the PR sync flow).
 */
async function getTaskDetail(taskId: string) {
  const task = await taskRepository.findById(taskId)
  if (!task) return null

  // Sync PR status from GitHub
  const openPrs = task.pullRequests.filter(pr => pr.state === 'open')
  let taskStatus = task.status
  let pullRequests = task.pullRequests

  if (openPrs.length > 0) {
    const updates = await syncPullRequestStatus(
      task.project.workspaceId,
      openPrs
    )
    if (updates.size > 0) {
      pullRequests = task.pullRequests.map(pr => {
        const update = updates.get(pr.id)
        return update
          ? { ...pr, state: update.state, mergedAt: update.mergedAt }
          : pr
      })
      const states = [...updates.values()].map(u => u.state)
      const merged = states.includes('merged')
      if (merged) {
        taskStatus = 'DONE'
      }
      // Reconciliation path for lineage closure: when the poller is the first
      // to observe a PR reaching a terminal state (a missed/late webhook),
      // stamp the task's edges too — idempotent with the webhook path. A merge
      // wins over a close; the service maps the state to a verdict. Only fires
      // when a state actually changed (updates.size > 0), so it stays off the
      // hot read path.
      const terminalState = merged
        ? 'merged'
        : states.includes('closed')
          ? 'closed'
          : null
      if (terminalState) {
        stampLineageInBackground(s => s.stampForPrState(task.id, terminalState))
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
    sprintsEnabled: task.team.sprintsEnabled,
    parent: task.parent
      ? {
          id: task.parent.id,
          title: task.parent.title,
          number: task.parent.number,
          teamIdentifier: task.parent.team.identifier,
        }
      : null,
  }
}

/**
 * Hard-delete a task. Returns its workspaceId so the calling route can run
 * an auth check after the delete (we throw 404 before deleting if the row
 * doesn't exist, so a caller never sees a partial-success).
 */
async function deleteTask(taskId: string) {
  const task = await taskRepository.findWithProject(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }

  // Read before the delete: the test cases cascade away with the task.
  const hasEvidence = await privateFileRepository.taskHasTestCases(taskId)
  await taskRepository.delete(taskId)
  // LUM-916: evidence blobs used to outlive the task until the workspace was
  // deleted. Best-effort, after the commit — never fails the delete.
  if (hasEvidence) await privateFileService.deleteTaskEvidence([taskId])

  return { workspaceId: task.project.workspaceId }
}

/**
 * Public task service. Composed from focused sub-services so consumers can
 * keep using a single `taskService.foo(...)` import path even though the
 * implementations live in:
 *
 *   - `task-creation.service.ts`  — createTask, createFromAutomation
 *   - `task-state.service.ts`     — updateTask, updateTaskWithSideEffects, reopen
 *   - `task-pr-link.service.ts`   — linkPullRequest, unlinkPullRequest, parsePrUrl
 *
 * Identifier resolution + detail fetch + delete stay here because they
 * don't share concerns with any of the sub-services.
 */
export const taskService = {
  resolveIdentifier,
  createTask,
  createFromAutomation,
  reopen,
  getTaskDetail,
  updateTask,
  updateTaskWithSideEffects,
  deleteTask,
  parsePrUrl,
  linkPullRequest,
  unlinkPullRequest,
}
