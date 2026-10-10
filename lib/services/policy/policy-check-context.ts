/**
 * Context resolver for the code-rule policy-check worker (LUM-590), split out
 * of `./policy-check-dispatch` in LUM-1063 (the dispatcher stays logger-only).
 *
 * Resolves the task's project, default linked repository, and latest open PR
 * — the four runtime parameters the pipeline worker needs. Returns null
 * (worker skips) when no repository or no open PR is linked to the task.
 */
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import type { CodePipelineInput } from './code-pipeline.service'

// ── Context resolver ──────────────────────────────────────────────────────────

/**
 * Resolve the four runtime parameters the code-rule pipeline needs for a task:
 * - projectId / workspaceId   — from the task row itself
 * - fullName                  — from the project's default linked repository
 * - prNumber                  — from the latest open PullRequest on the task
 *
 * Returns null when either the task is gone, the project has no linked repo, or
 * the task has no open PR (the worker safely skips in all three cases).
 *
 * Data plumbing (LUM-483 compliant — no prisma.* in service):
 * - taskRepository.findWithProjectWorkspaceId  → task.projectId + task.project.workspaceId
 * - projectRepository.findDefaultRepository    → project's isDefault repo fullName
 * - pullRequestRepository.findActivePr         → most recent open PR number
 */
export async function resolvePolicyCheckContext(
  taskId: string
): Promise<CodePipelineInput | null> {
  const task = await taskRepository.findWithProjectWorkspaceId(taskId)
  if (!task) return null

  const projectId = task.projectId
  const workspaceId = task.project.workspaceId

  const [defaultRepo, activePr] = await Promise.all([
    projectRepository.findDefaultRepository(projectId),
    pullRequestRepository.findActivePr(taskId),
  ])

  if (!defaultRepo) return null
  if (!activePr) return null

  return {
    taskId,
    projectId,
    workspaceId,
    fullName: defaultRepo.fullName,
    prNumber: activePr.number,
  }
}
