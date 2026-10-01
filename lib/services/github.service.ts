import { githubRepository } from '@/lib/repositories/github.repository'
import type { UpsertIntegrationData } from '@/lib/repositories/github.repository'
import { githubAppInstallationRepository } from '@/lib/repositories'
import { logger } from '@/lib/logger'
import {
  parseBranchIdentifier,
  splitIdentifier,
} from '@/lib/integrations/github/branch'
import type { RecentPullRequest } from '@/lib/integrations/github/sync'

// ── GitHub Service ──────────────────────────────────────────────────────────

export const githubService = {
  /** Get integration status for a workspace member. */
  async getIntegrationStatus(workspaceId: string, memberId: string) {
    const integration = await githubRepository.findIntegrationStatus(
      workspaceId,
      memberId
    )
    if (!integration) {
      return { connected: false } as const
    }
    return {
      connected: true,
      githubLogin: integration.githubLogin,
      githubUserId: integration.githubUserId,
      repositories: integration.repositories,
    } as const
  },

  /** Find integration for a workspace member or throw 404. */
  async requireIntegration(workspaceId: string, memberId: string) {
    const integration = await githubRepository.findIntegration(
      workspaceId,
      memberId
    )
    if (!integration) {
      throw Object.assign(new Error('GitHub not connected'), { status: 404 })
    }
    return integration
  },

  /** Find integration with webhooks for a workspace member or throw 404. */
  async requireIntegrationWithWebhooks(workspaceId: string, memberId: string) {
    const integration = await githubRepository.findIntegrationWithWebhooks(
      workspaceId,
      memberId
    )
    if (!integration) {
      throw Object.assign(new Error('GitHub not connected'), { status: 404 })
    }
    return integration
  },

  /** Upsert integration from OAuth callback data. */
  async upsertIntegration(data: UpsertIntegrationData) {
    return githubRepository.upsertIntegration(data)
  },

  /** Delete integration by id. */
  async deleteIntegration(id: string) {
    return githubRepository.deleteIntegration(id)
  },

  // ── Webhooks ────────────────────────────────────────────────────────────

  /** Upsert a webhook record. */
  async upsertWebhook(
    integrationId: string,
    repo: string,
    githubHookId: number
  ) {
    return githubRepository.upsertWebhook(integrationId, repo, githubHookId)
  },

  /** Delete a webhook record. */
  async deleteWebhook(integrationId: string, repo: string) {
    return githubRepository.deleteWebhook(integrationId, repo)
  },

  /** Find webhooks by repo (for webhook signature verification). */
  async findWebhooksByRepo(repo: string) {
    return githubRepository.findWebhooksByRepo(repo)
  },

  // ── Pull Requests ─────────────────────────────────────────────────────

  /** Upsert a pull request from webhook data. */
  async upsertPullRequest(
    ...args: Parameters<typeof githubRepository.upsertPullRequest>
  ) {
    return githubRepository.upsertPullRequest(...args)
  },

  /** Update CI status for one workspace's pull requests. */
  async updatePullRequestCiStatus(
    workspaceId: string,
    repo: string,
    prNumbers: number[],
    ciStatus: string
  ) {
    return githubRepository.updatePullRequestCiStatus(
      workspaceId,
      repo,
      prNumbers,
      ciStatus
    )
  },

  // ── Task Branches ─────────────────────────────────────────────────────

  /** Upsert a task branch record. */
  async upsertTaskBranch(
    ...args: Parameters<typeof githubRepository.upsertTaskBranch>
  ) {
    return githubRepository.upsertTaskBranch(...args)
  },

  // ── Task lookup ───────────────────────────────────────────────────────

  /**
   * Find a task by parsed branch identifier.
   *
   * LUM-925: with `repo`, the lookup is for a branch in that repository, which
   * several workspaces may have confirmed (LUM-924 hands each of them the
   * event). Team identifiers are only unique inside a workspace, so when any
   * other workspace that confirmed the repository also has this identifier,
   * the branch cannot be placed and no workspace's task is returned — linking
   * the wrong one would mirror its comments onto someone else's PR.
   */
  async findTaskByIdentifier(
    teamIdentifier: string,
    taskNumber: number,
    workspaceId: string,
    repo?: string
  ) {
    const task = await githubRepository.findTaskByIdentifier(
      teamIdentifier,
      taskNumber,
      workspaceId
    )
    if (!task || !repo) return task

    const others = await githubRepository.findOtherWorkspaceIdsWithTask(
      teamIdentifier,
      taskNumber,
      workspaceId
    )
    // The confirmed list is what LUM-924 routes deliveries by. Read it straight
    // from the repository: the install service pulls in the octokit client,
    // which the webhook handlers keep off their static graph (LUM-616).
    const target = repo.toLowerCase()
    for (const other of others) {
      const install =
        await githubAppInstallationRepository.findByWorkspace(other)
      if (install?.repositories.some(name => name.toLowerCase() === target)) {
        logger.warn(
          `[github] ${teamIdentifier}-${taskNumber} in ${repo} matches tasks in more than one workspace — not linking it automatically`
        )
        return null
      }
    }
    return task
  },

  /**
   * LUM-929 — which task a PR event belongs to. The branch match wins; when
   * the branch lookup comes back empty (no identifier, or ambiguous across
   * workspaces sharing the repository) the PR row's existing link stands. A
   * link made while the repository was unshared, or made by hand, stays the
   * PR's owner after another workspace confirms the repository: ambiguity
   * only stops a NEW link, never an existing one.
   */
  async resolvePullRequestTask<T>(
    branchTask: T | null,
    linkedTaskId: string | null
  ) {
    if (branchTask) return branchTask
    return linkedTaskId ? githubRepository.findTaskById(linkedTaskId) : null
  },

  /**
   * LUM-929 — whether any other workspace has confirmed this repository, i.e.
   * the same PR may be tracked (and discussed) by another team as well.
   */
  async isRepoConfirmedElsewhere(
    repo: string,
    workspaceId: string
  ): Promise<boolean> {
    const target = repo.toLowerCase()
    const others =
      await githubAppInstallationRepository.findConfirmedListsExcept(
        workspaceId
      )
    return others.some(o =>
      o.repositories.some(name => name.toLowerCase() === target)
    )
  },

  /**
   * Install / re-verify backfill (LUM-929): upsert this workspace's row for
   * each listed PR and link it to a task by branch name through the same
   * ambiguity-checked lookup the webhook uses. An unmatched or ambiguous
   * branch leaves any existing link alone.
   */
  async backfillPullRequests(
    workspaceId: string,
    repo: string,
    prs: RecentPullRequest[]
  ): Promise<void> {
    for (const pr of prs) {
      const identifier = parseBranchIdentifier(pr.head.ref)
      const parts = identifier ? splitIdentifier(identifier) : null
      const task = parts
        ? await githubService.findTaskByIdentifier(
            parts.teamIdentifier,
            parts.number,
            workspaceId,
            repo
          )
        : null

      // merged_at being set is the reliable indicator of a merged PR
      const state = pr.merged_at
        ? 'merged'
        : pr.state === 'closed'
          ? 'closed'
          : 'open'

      await githubRepository.upsertPullRequest({
        workspaceId,
        taskId: task?.id ?? null,
        // Backfill runs off the App installation, not an OAuth integration.
        integrationId: null,
        repo,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state,
        authorLogin: pr.user.login,
        headBranch: pr.head.ref,
        headSha: pr.head.sha,
        baseBranch: pr.base.ref,
        isDraft: pr.draft,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      })

      if (task) {
        await githubRepository.upsertTaskBranch({
          taskId: task.id,
          repo,
          branchName: pr.head.ref,
        })
      }
    }
    logger.debug(`[github/sync] synced ${prs.length} PRs for ${repo}`)
  },

  /** Find workspace slug. */
  async findWorkspaceSlug(workspaceId: string) {
    const workspace = await githubRepository.findWorkspaceSlug(workspaceId)
    return workspace?.slug ?? ''
  },
}
