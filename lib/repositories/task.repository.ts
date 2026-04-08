import { prisma } from '@/lib/db/prisma'

/** Full detail include for single task view. Used by GET /api/tasks/[id] and task detail pages. */
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
        ] as unknown as { isDefault: 'desc'; createdAt: 'asc' }[],
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

/** Include for task update operations (lighter than full detail). */
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
  /** Find a task by ID with full detail relations. */
  async findById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_DETAIL_INCLUDE,
    })
  },

  /** Find a task by ID with update-related relations (project + team). */
  async findForUpdate(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_UPDATE_INCLUDE,
    })
  },

  /** Find a task by ID with only the project relation (for auth checks). */
  async findWithProject(id: string) {
    return prisma.task.findUnique({ where: { id }, include: { project: true } })
  },

  /** Update a task's fields. */
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

  /** Delete a task by ID. */
  async delete(id: string) {
    await prisma.task.delete({ where: { id } })
  },

  /** Find all children of a task (direct descendants only). */
  async findChildren(parentId: string) {
    return prisma.task.findMany({
      where: { parentTaskId: parentId },
      select: { id: true },
    })
  },

  /** Check if targetId is a descendant of ancestorId (recursive). Used to prevent circular parent references. */
  async isDescendant(ancestorId: string, targetId: string): Promise<boolean> {
    const children = await prisma.task.findMany({
      where: { parentTaskId: ancestorId },
      select: { id: true },
    })
    if (children.length === 0) return false
    if (children.some(child => child.id === targetId)) return true
    for (const child of children) {
      if (await this.isDescendant(child.id, targetId)) return true
    }
    return false
  },

  /** Find task status by ID (lightweight query for state machine). */
  async findStatus(id: string) {
    return prisma.task.findUnique({ where: { id }, select: { status: true } })
  },

  /** Find a task with agent-related fields and workspace check. Used by cancel, resume, status, confirm-spec, and respond routes. */
  async findForAgent(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        agentStatus: true,
        inputReason: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    })
  },

  /** Find a task with agent + repo fields. Used by execute and retry routes. */
  async findForAgentExecute(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        agentStatus: true,
        repositoryId: true,
        project: {
          select: {
            workspaceId: true,
            repositories: {
              where: { isDefault: true },
              select: { fullName: true },
              take: 1,
            },
          },
        },
      },
    })
  },

  /** Find only the projectId for a task. Used by mcp-clarify. */
  async findProjectId(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: { projectId: true },
    })
  },

  /** Clear agentError on a task. */
  async clearAgentError(id: string) {
    return prisma.task.update({
      where: { id },
      data: { agentError: null },
    })
  },

  /** Save a confirmed spec and clear agentError. */
  async updateSpec(id: string, spec: string) {
    return prisma.task.update({
      where: { id },
      data: { spec, agentError: null },
    })
  },
}
