import { prisma } from '@/lib/db/prisma'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpsertIntegrationData {
  workspaceId: string
  memberId: string
  accessToken: string
  tokenType: string
  githubUserId: string
  githubLogin: string
}

export interface UpsertPullRequestData {
  workspaceId: string
  taskId: string | null
  /** null when the PR reached us over the App webhook rather than an OAuth repo hook. */
  integrationId: string | null
  repo: string
  number: number
  title: string
  url: string
  state: string
  authorLogin: string
  headBranch: string
  // LUM-801: the PR's current head commit. GitHub's PR payload always carries
  // head.sha. undefined = this caller does not know it (e.g. a check_suite
  // event) — the update path then omits the key entirely rather than nulling
  // a recorded sha, same contract as mergeCommitSha below.
  headSha?: string | undefined
  baseBranch: string
  isDraft: boolean
  mergeCommitSha?: string | null
  // LUM-634: change volume from the webhook payload. null = the payload did
  // not carry the field — the update path then leaves any existing (e.g.
  // backfilled) value untouched; 0 is a real zero-change PR.
  additions?: number | null
  deletions?: number | null
  changedFiles?: number | null
  mergedAt: Date | null
  closedAt: Date | null
}

export interface UpsertTaskBranchData {
  taskId: string
  repo: string
  branchName: string
  lastCommitSha?: string
  lastCommitMessage?: string
  lastCommitAuthor?: string
  lastPushedAt?: Date
}

// ── GitHub Repository ───────────────────────────────────────────────────────

export const githubRepository = {
  /** Find integration by workspace + member compound key. */
  async findIntegration(workspaceId: string, memberId: string) {
    return prisma.gitHubIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },

  /** Find integration by workspace + member with select. */
  async findIntegrationStatus(workspaceId: string, memberId: string) {
    return prisma.gitHubIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      select: { githubLogin: true, githubUserId: true, repositories: true },
    })
  },

  /** Find integration by workspace + member including webhooks. */
  async findIntegrationWithWebhooks(workspaceId: string, memberId: string) {
    return prisma.gitHubIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      include: { webhooks: true },
    })
  },

  /** Upsert integration (used during OAuth callback). */
  async upsertIntegration(data: UpsertIntegrationData) {
    return prisma.gitHubIntegration.upsert({
      where: {
        workspaceId_memberId: {
          workspaceId: data.workspaceId,
          memberId: data.memberId,
        },
      },
      create: {
        workspaceId: data.workspaceId,
        memberId: data.memberId,
        accessToken: data.accessToken,
        tokenType: data.tokenType,
        githubUserId: data.githubUserId,
        githubLogin: data.githubLogin,
        repositories: [],
      },
      update: {
        accessToken: data.accessToken,
        tokenType: data.tokenType,
        githubUserId: data.githubUserId,
        githubLogin: data.githubLogin,
      },
    })
  },

  /** Update integration fields by id. */
  async updateIntegration(
    id: string,
    data: { webhookSecret?: string; repositories?: string[] }
  ) {
    return prisma.gitHubIntegration.update({
      where: { id },
      data,
    })
  },

  /** Update integration repositories and return selected fields. */
  async updateIntegrationRepositories(id: string, repositories: string[]) {
    return prisma.gitHubIntegration.update({
      where: { id },
      data: { repositories },
      select: { repositories: true },
    })
  },

  /** Delete integration by id (cascade deletes webhooks). */
  async deleteIntegration(id: string) {
    return prisma.gitHubIntegration.delete({ where: { id } })
  },

  // ── Webhooks ────────────────────────────────────────────────────────────

  /** Find webhooks by repo name, including integration details. */
  async findWebhooksByRepo(repo: string) {
    return prisma.gitHubWebhook.findMany({
      where: { repo },
      include: {
        integration: {
          select: { id: true, workspaceId: true, webhookSecret: true },
        },
      },
    })
  },

  /** Upsert a webhook for an integration + repo. */
  async upsertWebhook(
    integrationId: string,
    repo: string,
    githubHookId: number
  ) {
    return prisma.gitHubWebhook.upsert({
      where: { integrationId_repo: { integrationId, repo } },
      create: { integrationId, repo, githubHookId },
      update: { githubHookId },
    })
  },

  /** Delete a webhook by integration + repo. */
  async deleteWebhook(integrationId: string, repo: string) {
    return prisma.gitHubWebhook.delete({
      where: { integrationId_repo: { integrationId, repo } },
    })
  },

  // ── Pull Requests ─────────────────────────────────────────────────────

  /** Upsert a pull request by repo + number. */
  async upsertPullRequest(data: UpsertPullRequestData) {
    return prisma.pullRequest.upsert({
      where: { repo_number: { repo: data.repo, number: data.number } },
      create: {
        workspaceId: data.workspaceId,
        taskId: data.taskId,
        integrationId: data.integrationId,
        repo: data.repo,
        number: data.number,
        title: data.title,
        url: data.url,
        state: data.state,
        authorLogin: data.authorLogin,
        headBranch: data.headBranch,
        headSha: data.headSha ?? null,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        mergeCommitSha: data.mergeCommitSha ?? null,
        additions: data.additions ?? null,
        deletions: data.deletions ?? null,
        changedFiles: data.changedFiles ?? null,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
      },
      update: {
        title: data.title,
        state: data.state,
        isDraft: data.isDraft,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
        // Only set on merge; never clobber a recorded SHA back to null on a
        // later non-merge event for the same PR.
        ...(data.mergeCommitSha ? { mergeCommitSha: data.mergeCommitSha } : {}),
        // LUM-801: same rule for the head SHA — an event that does not carry a
        // PR head object (check_suite) must leave the recorded value alone,
        // otherwise TestCaseRun freshness silently degrades to `unknown`.
        ...(data.headSha ? { headSha: data.headSha } : {}),
        ...(data.taskId ? { taskId: data.taskId } : {}),
        // LUM-634: write change volume only when the payload carried it (0 is
        // a legitimate value — the guard is `!= null`, not falsiness), so a
        // field-less event never clobbers a backfilled column back to null.
        ...(data.additions != null ? { additions: data.additions } : {}),
        ...(data.deletions != null ? { deletions: data.deletions } : {}),
        ...(data.changedFiles != null
          ? { changedFiles: data.changedFiles }
          : {}),
      },
    })
  },

  /** Bulk-update CI status for pull requests. */
  async updatePullRequestCiStatus(
    repo: string,
    prNumbers: number[],
    ciStatus: string
  ) {
    return prisma.pullRequest.updateMany({
      where: { repo, number: { in: prNumbers } },
      data: { ciStatus },
    })
  },

  // ── Task Branches ─────────────────────────────────────────────────────

  /** Upsert a task branch record (used by webhook handlers to sync remote branch metadata). */
  async upsertTaskBranch(data: UpsertTaskBranchData) {
    const { taskId, repo, branchName, ...rest } = data
    return prisma.taskBranch.upsert({
      where: { taskId_repo_branchName: { taskId, repo, branchName } },
      create: { taskId, repo, branchName, ...rest },
      update: rest,
    })
  },

  /** Find integration by workspace that has a specific repo authorized. */
  async findIntegrationByRepo(workspaceId: string, repo: string) {
    return prisma.gitHubIntegration.findFirst({
      where: {
        workspaceId,
        repositories: { has: repo },
      },
    })
  },

  // ── Task lookup (used by webhook handlers) ────────────────────────────

  /** Find a task by team identifier + number within a workspace. */
  async findTaskByIdentifier(
    teamIdentifier: string,
    taskNumber: number,
    workspaceId: string
  ) {
    return prisma.task.findFirst({
      where: {
        number: taskNumber,
        team: { identifier: teamIdentifier, workspaceId },
      },
      include: {
        project: { select: { name: true, ownerId: true, workspaceId: true } },
        team: { select: { identifier: true } },
      },
    })
  },

  /** Find workspace slug by id. */
  async findWorkspaceSlug(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    })
  },

  /** Find integration by workspace + GitHub login (for inbound webhook actor lookup). */
  async findIntegrationByLogin(workspaceId: string, githubLogin: string) {
    return prisma.gitHubIntegration.findFirst({
      where: { workspaceId, githubLogin },
      include: { member: { include: { actor: { select: { id: true } } } } },
    })
  },

  /** Find integration by workspace + member (for outbound actor resolution). */
  async findIntegrationByUserAndWorkspace(
    workspaceId: string,
    memberId: string
  ) {
    return prisma.gitHubIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },
}
