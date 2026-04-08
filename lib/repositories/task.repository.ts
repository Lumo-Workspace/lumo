import { prisma } from '@/lib/db/prisma'

const TASK_DETAIL_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      workspaceId: true,
      defaultReviewerId: true,
      repositories: {
        orderBy: [
          { isDefault: 'desc' as const },
          { createdAt: 'asc' as const },
        ] as never,
      },
    },
  },
  team: { select: { identifier: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
  reviewer: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
    },
  },
  pullRequests: {
    select: {
      id: true,
      number: true,
      title: true,
      url: true,
      state: true,
      authorLogin: true,
      headBranch: true,
      ciStatus: true,
      mergedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  branches: {
    select: {
      id: true,
      repo: true,
      branchName: true,
      lastCommitSha: true,
      lastCommitMessage: true,
      lastCommitAuthor: true,
      lastPushedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  clarifies: {
    select: {
      id: true,
      question: true,
      context: true,
      reply: true,
      repliedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  parent: {
    select: {
      id: true,
      title: true,
      number: true,
      team: { select: { identifier: true } },
    },
  },
  children: {
    select: { id: true, title: true, number: true, status: true },
    orderBy: { number: 'asc' as const },
  },
  agentRuns: {
    select: {
      id: true,
      runNumber: true,
      status: true,
      trigger: true,
      errorCode: true,
      errorMessage: true,
      summary: true,
      steps: true,
      changedFiles: true,
      durationMs: true,
      prNumber: true,
      prUrl: true,
      branchName: true,
      startedAt: true,
      finishedAt: true,
    },
    orderBy: { runNumber: 'desc' as const },
  },
} as const

const TASK_UPDATE_INCLUDE = {
  project: {
    include: {
      defaultReviewer: { select: { id: true, clerkId: true } },
      workspace: { select: { slug: true } },
    },
  },
  team: { select: { identifier: true } },
} as const

export const taskRepository = {
  async findById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_DETAIL_INCLUDE,
    })
  },

  async findForUpdate(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_UPDATE_INCLUDE,
    })
  },

  async findWithProject(id: string) {
    return prisma.task.findUnique({ where: { id }, include: { project: true } })
  },

  async update(id: string, data: Record<string, unknown>) {
    return prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })
  },

  async delete(id: string) {
    await prisma.task.delete({ where: { id } })
  },

  async findChildren(parentId: string) {
    return prisma.task.findMany({
      where: { parentTaskId: parentId },
      select: { id: true },
    })
  },

  async isDescendant(ancestorId: string, targetId: string): Promise<boolean> {
    const children = await prisma.task.findMany({
      where: { parentTaskId: ancestorId },
      select: { id: true },
    })
    if (!children || children.length === 0) return false
    if (children.some(child => child.id === targetId)) return true
    for (const child of children) {
      if (await this.isDescendant(child.id, targetId)) return true
    }
    return false
  },

  async findStatus(id: string) {
    return prisma.task.findUnique({ where: { id }, select: { status: true } })
  },
}
