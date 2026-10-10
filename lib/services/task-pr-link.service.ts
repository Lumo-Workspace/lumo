import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { githubService } from '@/lib/services/github.service'
import { emitCoreEvent } from '@/lib/plugins/events'
import { requireConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import {
  fetchPullRequest,
  parsePrUrl,
  toPrState,
} from '@/lib/integrations/github/fetch-pull-request'

// Re-exported for existing importers; the implementation moved to
// lib/integrations/github/fetch-pull-request.ts (LUM-684).

/**
 * Reading a PR by URL is done as the workspace's App installation — the
 * machine identity every other GitHub read uses — never with a member's token,
 * and only for a repository the workspace has confirmed (LUM-883).
 */
async function repoTokenFor(
  workspaceId: string,
  repo: string
): Promise<string> {
  // Lazy: auth.ts loads @octokit/auth-app, which must not ride along with this
  // service into every module graph that touches tasks (same reason
  // github.service imports the integration lazily).
  const { getRepoToken } = await import('@/lib/integrations/github/auth')
  return getRepoToken(workspaceId, repo, REPO_TOKEN_PERMISSIONS.pullRequestRead)
}

export { parsePrUrl }

/**
 * Link a pull request to a task. Two entry modes:
 *
 * 1. `prId` — caller picked an existing PR row (typically from search).
 * 2. `url` — caller pasted a GitHub URL. If we already track the PR we reuse
 *    that row; otherwise we fetch it from GitHub via the workspace's stored
 *    integration token and upsert a new row.
 *
 * The result carries `sharedWithOtherWorkspaces` (LUM-929): another
 * workspace has confirmed the same repository.
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
    // LUM-883 — a PR is only linked (and so scanned) while its repository is
    // confirmed. Rows we already hold too: a repository an owner removed on
    // re-verify keeps its old PullRequest rows, and re-linking one must not
    // start pulling that repository again.
    await requireConfirmedRepository(workspaceId, pr.repo)
  } else if (input.url) {
    const parsed = parsePrUrl(input.url)
    if (!parsed) {
      throw Object.assign(new Error('Invalid GitHub PR URL'), { status: 400 })
    }
    // Before the row lookup and any GitHub read (LUM-883). LUM-889: from here
    // on the repository is the confirmed list's (GitHub's) spelling — the URL
    // may say `ACME/App`, the row written by the webhook says `acme/app`.
    const { repository: repo } = await requireConfirmedRepository(
      workspaceId,
      parsed.repo
    )

    const existing = await pullRequestRepository.findByRepoAndNumber(
      workspaceId,
      repo,
      parsed.number
    )

    // LUM-924: the lookup is this workspace's own row, so another workspace
    // tracking the same PR neither blocks nor leaks into this link.
    if (existing) {
      pr = existing
    } else {
      const token = await repoTokenFor(workspaceId, repo)

      const ghPr = await fetchPullRequest({
        token,
        repo,
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
        // Read as the App installation — there is no OAuth integration behind it.
        integrationId: null,
        // GitHub's canonical spelling, so the upsert key matches the
        // webhook's row and never forks a case-variant duplicate (LUM-889).
        repo: ghPr.base.repo?.full_name ?? repo,
        number: ghPr.number,
        title: ghPr.title,
        url: ghPr.html_url,
        state,
        authorLogin: ghPr.user.login,
        headBranch: ghPr.head.ref,
        headSha: ghPr.head.sha,
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
  // LUM-1061: plugins react to a manual link — the security plugin scans the
  // linked PR's current head once (LUM-732, any state, merged history
  // included), registering the dispatch with waitUntil itself.
  emitCoreEvent('task.prLinked', { taskId, pullRequestId: linked.id })
  // LUM-929 (user ruling 2026-10-01): a manual link is a claim of ownership.
  // It is allowed on a repository another workspace also confirmed, and the
  // task's comments mirror to the PR as usual — so the caller is told the PR
  // is shared, and the UI warns that those comments will appear on GitHub.
  const sharedWithOtherWorkspaces =
    await githubService.isRepoConfirmedElsewhere(linked.repo, workspaceId)
  return { ...linked, sharedWithOtherWorkspaces }
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
