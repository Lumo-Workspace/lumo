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
  integrationId: string
  repo: string
  number: number
  title: string
  url: string
  state: string
  authorLogin: string
  headBranch: string
  baseBranch: string
  isDraft: boolean
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

  /** Find all integrations for a workspace (repos only). */
  async findIntegrationsByWorkspace(workspaceId: string) {
    return prisma.gitHubIntegration.findMany({
      where: { workspaceId },
      select: { repositories: true },
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
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
      },
      update: {
        title: data.title,
        state: data.state,
        isDraft: data.isDraft,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
        ...(data.taskId ? { taskId: data.taskId } : {}),
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

  /** Upsert a task branch record. */
  async upsertTaskBranch(data: UpsertTaskBranchData) {
    const { taskId, repo, branchName, ...rest } = data
    return prisma.taskBranch.upsert({
      where: { taskId_repo_branchName: { taskId, repo, branchName } },
      create: { taskId, repo, branchName, ...rest },
      update: rest,
    })
  },

  /** Create a task branch record. */
  async createTaskBranch(taskId: string, repo: string, branchName: string) {
    return prisma.taskBranch.create({
      data: { taskId, repo, branchName },
    })
  },

  /** Find a task branch by ID. */
  async findTaskBranch(branchId: string) {
    return prisma.taskBranch.findUnique({
      where: { id: branchId },
    })
  },

  /** Delete a task branch record by ID. */
  async deleteTaskBranch(branchId: string) {
    return prisma.taskBranch.delete({
      where: { id: branchId },
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
        project: { select: { defaultReviewerId: true, workspaceId: true } },
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
}
