import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import type { UpsertIntegrationData } from '@/lib/repositories/github.repository'

const GH_API = 'https://api.github.com'
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

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

  /** Set webhook secret on integration if not already set. */
  async ensureWebhookSecret(
    integrationId: string,
    currentSecret: string | null
  ) {
    if (currentSecret) return currentSecret
    const { randomBytes } = await import('crypto')
    const webhookSecret = randomBytes(32).toString('hex')
    await githubRepository.updateIntegration(integrationId, { webhookSecret })
    return webhookSecret
  },

  /** Update the list of authorized repositories. */
  async updateRepositories(integrationId: string, repositories: string[]) {
    return githubRepository.updateIntegrationRepositories(
      integrationId,
      repositories
    )
  },

  /** Delete integration by id. */
  async deleteIntegration(id: string) {
    return githubRepository.deleteIntegration(id)
  },

  /** Get all authorized repos across all integrations in a workspace. */
  async getAuthorizedRepos(workspaceId: string) {
    const integrations =
      await githubRepository.findIntegrationsByWorkspace(workspaceId)
    const allRepos = integrations.flatMap(i => i.repositories)
    const unique = [...new Set(allRepos)]
    return unique.map(fullName => ({
      fullName,
      name: fullName.split('/')[1] ?? fullName,
      private: false,
    }))
  },

  /**
   * Update authorized repos: create webhooks for added repos, delete for removed.
   * Returns the updated repository list.
   */
  async updateAuthorizedRepos(
    workspaceId: string,
    memberId: string,
    repositories: string[]
  ) {
    const integration = await githubRepository.findIntegrationWithWebhooks(
      workspaceId,
      memberId
    )
    if (!integration) {
      throw Object.assign(new Error('GitHub not connected'), { status: 404 })
    }

    const token = decrypt(integration.accessToken)

    // Generate + persist webhook secret if not yet set
    const webhookSecret = await this.ensureWebhookSecret(
      integration.id,
      integration.webhookSecret
    )

    const oldRepos = integration.repositories
    const addedRepos = repositories.filter(r => !oldRepos.includes(r))
    const removedRepos = oldRepos.filter(r => !repositories.includes(r))
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/github`

    const { createRepoWebhook, deleteRepoWebhook, syncRepoPRs } =
      await import('@/lib/integrations/github')

    // Create webhooks for newly added repos
    for (const fullName of addedRepos) {
      const slash = fullName.indexOf('/')
      const owner = fullName.slice(0, slash)
      const repo = fullName.slice(slash + 1)
      try {
        const hookId = await createRepoWebhook(
          token,
          owner,
          repo,
          webhookUrl,
          webhookSecret
        )
        await this.upsertWebhook(integration.id, fullName, hookId)

        // Backfill PRs that existed before the webhook was registered
        void syncRepoPRs(token, fullName, workspaceId, integration.id).catch(
          err =>
            console.error(`[github] syncRepoPRs failed for ${fullName}:`, err)
        )
      } catch (err) {
        // Log but don't fail: repo is saved even if webhook creation fails
        console.error(`[github] createRepoWebhook failed for ${fullName}:`, err)
      }
    }

    // Delete webhooks for removed repos
    for (const fullName of removedRepos) {
      const slash = fullName.indexOf('/')
      const owner = fullName.slice(0, slash)
      const repo = fullName.slice(slash + 1)
      const hook = integration.webhooks.find(h => h.repo === fullName)
      if (hook) {
        await deleteRepoWebhook(token, owner, repo, hook.githubHookId)
        await this.deleteWebhook(integration.id, fullName)
      }
    }

    const updated = await this.updateRepositories(integration.id, repositories)
    return updated
  },

  /**
   * Create a GitHub branch from main for a task.
   * Validates the repo is connected, creates the branch via GitHub API,
   * and records the branch in the database.
   */
  async createBranchForTask(
    taskId: string,
    repo: string,
    branchName: string,
    workspaceId: string
  ) {
    // Find a GitHub integration for this workspace that has the repo authorized
    const integration = await githubRepository.findIntegrationByRepo(
      workspaceId,
      repo
    )
    if (!integration) {
      throw Object.assign(
        new Error('Repository not connected. Add it in Integrations settings.'),
        { status: 422 }
      )
    }

    const token = decrypt(integration.accessToken)
    const slash = repo.indexOf('/')
    const owner = repo.slice(0, slash)
    const repoName = repo.slice(slash + 1)
    const headers = GH_HEADERS(token)

    // Get SHA of main branch
    const refRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs/heads/main`,
      { headers }
    )
    if (!refRes.ok) {
      const err = await refRes.json().catch(() => ({}))
      throw Object.assign(
        new Error(
          (err as { message?: string }).message ??
            'Could not find main branch on GitHub'
        ),
        { status: 422 }
      )
    }
    const refData = await refRes.json()
    const sha: string | undefined = refData?.object?.sha
    if (!sha) {
      throw Object.assign(new Error('Could not find main branch on GitHub'), {
        status: 422,
      })
    }

    // Create the branch
    const createRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      }
    )
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      throw Object.assign(
        new Error(
          (err as { message?: string }).message ?? 'Failed to create branch'
        ),
        { status: 422 }
      )
    }

    const createdBranch = await githubRepository.createTaskBranch(
      taskId,
      repo,
      branchName
    )

    const url = `https://github.com/${repo}/tree/${branchName}`
    return { branchName, url, branch: createdBranch }
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

  /** Update CI status for pull requests. */
  async updatePullRequestCiStatus(
    repo: string,
    prNumbers: number[],
    ciStatus: string
  ) {
    return githubRepository.updatePullRequestCiStatus(repo, prNumbers, ciStatus)
  },

  // ── Task Branches ─────────────────────────────────────────────────────

  /** Upsert a task branch record. */
  async upsertTaskBranch(
    ...args: Parameters<typeof githubRepository.upsertTaskBranch>
  ) {
    return githubRepository.upsertTaskBranch(...args)
  },

  // ── Task lookup ───────────────────────────────────────────────────────

  /** Find a task by parsed branch identifier. */
  async findTaskByIdentifier(
    teamIdentifier: string,
    taskNumber: number,
    workspaceId: string
  ) {
    return githubRepository.findTaskByIdentifier(
      teamIdentifier,
      taskNumber,
      workspaceId
    )
  },

  /** Find workspace slug. */
  async findWorkspaceSlug(workspaceId: string) {
    const workspace = await githubRepository.findWorkspaceSlug(workspaceId)
    return workspace?.slug ?? ''
  },
}
