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
