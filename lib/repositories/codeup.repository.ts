import { prisma } from '@/lib/db/prisma'
import { CODEUP_PROVIDER } from '@/lib/integrations/git-provider'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpsertCodeupConnectionData {
  workspaceId: string
  organizationId: string
  /** Already encrypted (lib/crypto.ts). */
  accessToken: string
  connectedBy: string
}

export interface UpsertCodeupRepositoryData {
  connectionId: string
  repositoryId: number
  pathWithNamespace: string
  webUrl: string
  webhookId: number | null
  webhookTokenHash: string
  confirmedAt: Date
}

export interface UpsertMergeRequestData {
  workspaceId: string
  taskId: string | null
  /** The repository's full path (`org/group/repo`). */
  repo: string
  /** The merge request's iid. */
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  authorLogin: string
  headBranch: string
  /** undefined/null = not in this delivery; never clobbers a recorded sha. */
  headSha: string | null
  baseBranch: string
  isDraft: boolean
  mergedAt: Date | null
  closedAt: Date | null
}

export interface UpsertCodeupTaskBranchData {
  taskId: string
  repo: string
  branchName: string
  lastCommitSha?: string
  lastCommitMessage?: string
  lastCommitAuthor?: string
  lastPushedAt?: Date
}

const REPOSITORY_SELECT = {
  id: true,
  repositoryId: true,
  pathWithNamespace: true,
  webUrl: true,
  webhookId: true,
  confirmedAt: true,
} as const

// ── Codeup Repository ───────────────────────────────────────────────────────

export const codeupRepository = {
  /** The workspace's connection with its encrypted token and repositories. */
  async findConnectionByWorkspace(workspaceId: string) {
    return prisma.codeupConnection.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        organizationId: true,
        accessToken: true,
        repositories: {
          select: REPOSITORY_SELECT,
          orderBy: { pathWithNamespace: 'asc' },
        },
      },
    })
  },

  /** Create or replace the workspace's connection. */
  async upsertConnection(data: UpsertCodeupConnectionData) {
    return prisma.codeupConnection.upsert({
      where: { workspaceId: data.workspaceId },
      create: data,
      update: {
        organizationId: data.organizationId,
        accessToken: data.accessToken,
        connectedBy: data.connectedBy,
      },
      select: { id: true },
    })
  },

  /** Delete the connection; its repository rows cascade. */
  async deleteConnection(connectionId: string) {
    return prisma.codeupConnection.delete({ where: { id: connectionId } })
  },

  /** Drop every repository row of a connection (organization switch). */
  async deleteRepositoriesOfConnection(connectionId: string) {
    return prisma.codeupRepository.deleteMany({ where: { connectionId } })
  },

  /** Confirm a repository (create, or re-confirm with a new hook + token). */
  async upsertRepository(data: UpsertCodeupRepositoryData) {
    const { connectionId, repositoryId, ...rest } = data
    return prisma.codeupRepository.upsert({
      where: { connectionId_repositoryId: { connectionId, repositoryId } },
      create: data,
      update: rest,
      select: REPOSITORY_SELECT,
    })
  },

  /**
   * Stop treating a repository as confirmed. The token hash stays, so a
   * delivery from a hook that could not be deleted still authenticates and
   * is ignored rather than refused.
   */
  async markUnconfirmed(id: string) {
    return prisma.codeupRepository.update({
      where: { id },
      data: { confirmedAt: null, webhookId: null },
    })
  },

  /**
   * Every workspace's row for a Codeup repository — the candidates a
   * delivery's token is checked against (each workspace has its own hook).
   */
  async findDeliveryCandidates(repositoryId: number) {
    const rows = await prisma.codeupRepository.findMany({
      where: { repositoryId },
      select: {
        id: true,
        repositoryId: true,
        pathWithNamespace: true,
        webhookTokenHash: true,
        confirmedAt: true,
        connection: { select: { workspaceId: true } },
      },
    })
    return rows.map(({ connection, ...row }) => ({
      ...row,
      workspaceId: connection.workspaceId,
    }))
  },

  /** Other workspaces that have this Codeup repository confirmed (LUM-925). */
  async findOtherConfirmingWorkspaceIds(
    repositoryId: number,
    excludeWorkspaceId: string
  ): Promise<string[]> {
    const rows = await prisma.codeupRepository.findMany({
      where: {
        repositoryId,
        confirmedAt: { not: null },
        connection: { workspaceId: { not: excludeWorkspaceId } },
      },
      select: { connection: { select: { workspaceId: true } } },
    })
    return [...new Set(rows.map(r => r.connection.workspaceId))]
  },

  /**
   * LUM-1316 — the head this workspace last recorded for a merge request
   * (null: no row yet, or no head recorded).
   */
  async findMergeRequestHead(
    workspaceId: string,
    repo: string,
    number: number
  ): Promise<string | null> {
    const row = await prisma.pullRequest.findUnique({
      where: {
        workspaceId_provider_repo_number: {
          workspaceId,
          provider: CODEUP_PROVIDER,
          repo,
          number,
        },
      },
      select: { headSha: true },
    })
    return row?.headSha ?? null
  },

  /** Upsert this workspace's row for a Codeup merge request. */
  async upsertMergeRequest(data: UpsertMergeRequestData) {
    return prisma.pullRequest.upsert({
      where: {
        workspaceId_provider_repo_number: {
          workspaceId: data.workspaceId,
          provider: CODEUP_PROVIDER,
          repo: data.repo,
          number: data.number,
        },
      },
      create: {
        workspaceId: data.workspaceId,
        taskId: data.taskId,
        integrationId: null,
        provider: CODEUP_PROVIDER,
        repo: data.repo,
        number: data.number,
        title: data.title,
        url: data.url,
        state: data.state,
        authorLogin: data.authorLogin,
        headBranch: data.headBranch,
        headSha: data.headSha,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
      },
      update: {
        title: data.title,
        url: data.url,
        state: data.state,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        mergedAt: data.mergedAt,
        closedAt: data.closedAt,
        ...(data.headSha ? { headSha: data.headSha } : {}),
        ...(data.taskId ? { taskId: data.taskId } : {}),
      },
      select: { id: true, taskId: true },
    })
  },

  /** Upsert a Codeup branch on a task's branch list. */
  async upsertTaskBranch(data: UpsertCodeupTaskBranchData) {
    const { taskId, repo, branchName, ...rest } = data
    return prisma.taskBranch.upsert({
      where: {
        taskId_provider_repo_branchName: {
          taskId,
          provider: CODEUP_PROVIDER,
          repo,
          branchName,
        },
      },
      create: { taskId, provider: CODEUP_PROVIDER, repo, branchName, ...rest },
      update: rest,
    })
  },
}
