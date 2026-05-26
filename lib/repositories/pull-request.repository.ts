import { prisma } from '@/lib/db/prisma'

interface PrStateUpdate {
  state: string
  mergedAt: Date | null
  closedAt: Date | null
  isDraft: boolean
}

export const pullRequestRepository = {
  /** Update a PR's state and timestamps. */
  async updateState(id: string, data: PrStateUpdate) {
    return prisma.pullRequest.update({ where: { id }, data })
  },

  /** Find the most recent open PR for a task. */
  async findActivePr(taskId: string) {
    return prisma.pullRequest.findFirst({
      where: { taskId, state: 'open' },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** Search PRs in a workspace by number or title. */
  async searchByWorkspace(workspaceId: string, query: string, limit: number) {
    const numericQuery = /^\d+$/.test(query) ? Number(query) : null
    return prisma.pullRequest.findMany({
      where: {
        workspaceId,
        ...(numericQuery !== null
          ? { number: numericQuery }
          : { title: { contains: query, mode: 'insensitive' as const } }),
      },
      select: {
        id: true,
        repo: true,
        number: true,
        title: true,
        url: true,
        state: true,
        ciStatus: true,
        authorLogin: true,
        headBranch: true,
        createdAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },

  /** Find a PR by repo + number compound key, with task info. */
  async findByRepoAndNumber(repo: string, number: number) {
    return prisma.pullRequest.findUnique({
      where: { repo_number: { repo, number } },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  },

  /** Find a PR by ID with task info. */
  async findById(id: string) {
    return prisma.pullRequest.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  },

  /** Update the task association for a PR. Pass null to unlink. */
  async updateTaskId(prId: string, taskId: string | null) {
    return prisma.pullRequest.update({ where: { id: prId }, data: { taskId } })
  },

  /** Find the most recently updated PR linked to a task. */
  async findByTaskId(taskId: string) {
    return prisma.pullRequest.findFirst({
      where: { taskId },
      orderBy: { updatedAt: 'desc' },
    })
  },
}
