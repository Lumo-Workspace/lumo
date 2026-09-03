import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import {
  fetchPullRequest,
  parsePrUrl,
  toPrState,
} from '@/lib/integrations/github/fetch-pull-request'

// Re-exported for existing importers; the implementation moved to
// lib/integrations/github/fetch-pull-request.ts so the idea-evidence link path
// can share it (LUM-684).
export { parsePrUrl }

/**
 * Link a pull request to a task. Two entry modes:
 *
 * 1. `prId` — caller picked an existing PR row (typically from search).
 * 2. `url` — caller pasted a GitHub URL. If we already track the PR we reuse
 *    that row; otherwise we fetch it from GitHub via the workspace's stored
 *    integration token and upsert a new row.
 *
 * If the resolved PR is already linked to a different task, throws 409 with
 * `conflictTask` populated so the UI can prompt the user. Pass `force: true`
 * to override the conflict and re-link.
 */
export async function linkPullRequest(
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
    const parsed = parsePrUrl(input.url)
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

      const ghPr = await fetchPullRequest({
        token: decrypt(integration.accessToken),
        repo: parsed.repo,
        number: parsed.number,
      })
      if (!ghPr) {
        throw Object.assign(new Error('PR not found on GitHub'), {
          status: 404,
        })
      }

      const state = toPrState(ghPr)

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

  const linked = await pullRequestRepository.updateTaskId(pr!.id, taskId)
  // LUM-732: a manually linked PR (any state — merged history included) gets
  // one scan of its current head. Fire-and-forget; never fails the link.
  void dispatchPrSecurityScan(linked.id, 'PR_LINK')
  return linked
}

/**
 * Unlink a PR from a task. Throws 404 if the task doesn't exist or the PR
 * isn't currently linked to it (so this is safe to call from a Cancel button
 * without first checking state).
 */
export async function unlinkPullRequest(taskId: string, prId: string) {
  const task = await taskRepository.findWithProject(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }

  const pr = await pullRequestRepository.findById(prId)
  if (!pr || pr.taskId !== taskId) {
    throw Object.assign(new Error('Pull request is not linked to this task'), {
      status: 400,
    })
  }

  return pullRequestRepository.updateTaskId(prId, null)
}
