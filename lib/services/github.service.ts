import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import type { UpsertIntegrationData } from '@/lib/repositories/github.repository'

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

    // Create webhooks for newly added repos; track failures to exclude from saved list
    const failedRepos = new Set<string>()
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

        void syncRepoPRs(token, fullName, workspaceId, integration.id).catch(
          err =>
            console.error(`[github] syncRepoPRs failed for ${fullName}:`, err)
        )
      } catch (err) {
        console.error(`[github] createRepoWebhook failed for ${fullName}:`, err)
        failedRepos.add(fullName)
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

    const successfulRepos = repositories.filter(r => !failedRepos.has(r))
    const updated = await this.updateRepositories(
      integration.id,
      successfulRepos
    )
    return updated
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
