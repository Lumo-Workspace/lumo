import { githubRepository } from '@/lib/repositories/github.repository'
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
