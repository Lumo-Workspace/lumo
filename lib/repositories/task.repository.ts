import { prisma } from '@/lib/db/prisma'
import type { TaskStatus, TaskPriority, AgentStatus } from '@prisma/client'

export interface TaskUpdateData {
  title?: string | undefined
  description?: string | null | undefined
  spec?: string | null | undefined
  status?: TaskStatus | string | undefined
  priority?: TaskPriority | string | undefined
  order?: number | undefined
  dueDate?: string | Date | null | undefined
  parentTaskId?: string | null | undefined
  assigneeActorId?: string | null | undefined
  reviewerActorId?: string | null | undefined
  projectId?: string | undefined
  repositoryId?: string | null | undefined
  agentStatus?: AgentStatus | null | undefined
  agentError?: string | null | undefined
}

/** Full detail include for single task view. Used by GET /api/tasks/[id] and task detail pages. */
const TASK_DETAIL_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      workspaceId: true,
      ownerId: true,
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
      owner: { select: { id: true, clerkId: true } },
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
  async update(id: string, data: TaskUpdateData) {
    return prisma.task.update({
      where: { id },
      data: data as Parameters<typeof prisma.task.update>[0]['data'],
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

  /** Find all tasks assigned to an actor, with project/team/parent/children details. */
  async findAssignedTasks(actorId: string) {
    return prisma.task.findMany({
      where: { assigneeActorId: actorId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            owner: { select: { actor: { select: { id: true } } } },
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
        parent: {
          select: {
            id: true,
            title: true,
            number: true,
            team: { select: { identifier: true } },
          },
        },
        _count: { select: { children: true } },
        children: {
          where: { status: 'DONE' },
          select: { id: true },
        },
      },
      orderBy: { order: 'asc' },
    })
  },

  /** Lightweight summary of tasks assigned to an actor — for Quick Dispatch AI context. */
  async findAssignedTasksSummary(actorId: string) {
    return prisma.task.findMany({
      where: { assigneeActorId: actorId },
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        team: { select: { identifier: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
  },

  /** Find tasks for duplicate checking (recent 200 tasks in a project). */
  async findForDuplicateCheck(projectId: string) {
    return prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        priority: true,
        team: { select: { identifier: true } },
        assignee: {
          select: {
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
  },

  /** Find recent tasks in a project (for AI context). */
  async findRecentByProject(projectId: string, take: number) {
    return prisma.task.findMany({
      where: { projectId },
      select: { title: true, description: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

  /** Find historical tasks with priority info (for AI priority suggestion). */
  async findHistoricalByProject(projectId: string, take: number) {
    return prisma.task.findMany({
      where: { projectId },
      select: { id: true, number: true, title: true, priority: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

  /** Find a task by ID with only project workspaceId (for auth checks). */
  async findWithProjectWorkspaceId(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: { project: { select: { workspaceId: true } } },
    })
  },

  /** Find a task by ID for decompose (title, description, project workspaceId). */
  async findForDecompose(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        project: { select: { workspaceId: true } },
      },
    })
  },

  /** Find a task with comment-creation fields (id, projectId, number, title, team, project workspace). */
  async findForComment(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
        project: {
          select: {
            workspaceId: true,
            workspace: { select: { slug: true } },
          },
        },
      },
    })
  },

  /** Find all tasks for a project with full list details (for project task list). */
  async findByProjectWithDetails(projectId: string) {
    return prisma.task.findMany({
      where: { projectId },
      include: {
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
        parent: {
          select: {
            id: true,
            title: true,
            number: true,
            team: { select: { identifier: true } },
          },
        },
        _count: { select: { children: true } },
        children: {
          where: { status: 'DONE' },
          select: { id: true },
        },
      },
      orderBy: { order: 'asc' },
    })
  },

  /** Find tasks by IDs within a project (for batch parent validation). */
  async findByIds(ids: string[], projectId: string) {
    return prisma.task.findMany({
      where: { id: { in: ids }, projectId },
      select: { id: true },
    })
  },

  /** Find the max order among sibling tasks. */
  async findMaxOrder(projectId: string, parentTaskId: string | null) {
    return prisma.task.findFirst({
      where: { projectId, parentTaskId },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
  },

  /** Find a task by ID with only id and projectId (for lightweight validation). */
  async findProjectIdById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    })
  },

  /** Find an actor by ID (for assignee validation). */
  async findActorById(actorId: string) {
    return prisma.actor.findUnique({
      where: { id: actorId },
      select: { type: true, workspaceId: true },
    })
  },

  /** Find an actor by ID with member clerkId (for notification). */
  async findActorWithMember(actorId: string) {
    return prisma.actor.findUnique({
      where: { id: actorId },
      select: { type: true, member: { select: { clerkId: true } } },
    })
  },

  /** Create a task in a transaction (with team seq increment). Returns the created task with team + assignee. */
  async createWithSequence(data: {
    projectId: string
    teamId: string
    title: string
    description: string | null
    status: TaskStatus
    priority: TaskPriority
    assigneeActorId: string | null
    agentStatus: AgentStatus | null
    reviewerActorId: string | null
    parentTaskId: string | null
    repositoryId: string | null
    order: number | undefined
    dueDate: Date | string | null
    ownerMemberId: string | null
  }) {
    const taskId = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: data.teamId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      })

      // Resolve default reviewer to actor
      let ownerActorId: string | null = null
      if (data.ownerMemberId) {
        const reviewerActor = await tx.actor.findUnique({
          where: { memberId: data.ownerMemberId },
        })
        ownerActorId = reviewerActor?.id ?? null
      }

      const task = await tx.task.create({
        data: {
          projectId: data.projectId,
          teamId: data.teamId,
          number: taskSeq,
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          assigneeActorId: data.assigneeActorId,
          agentStatus: data.agentStatus,
          reviewerActorId: ownerActorId,
          parentTaskId: data.parentTaskId,
          repositoryId: data.repositoryId,
          ...(data.order !== undefined ? { order: data.order } : {}),
          dueDate: data.dueDate,
        },
      })

      return task.id
    })

    // Re-fetch with includes outside transaction for proper type inference
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
      },
    })

    return {
      ...task,
      teamIdentifier: task.team.identifier,
    }
  },

  /** Batch-create tasks in a transaction (with team seq increment). */
  async batchCreateWithSequence(
    projectId: string,
    teamId: string,
    taskInputs: {
      title: string
      status: TaskStatus
      priority: TaskPriority
      assigneeActorId?: string | null | undefined
      parentTaskId: string
    }[]
  ) {
    const createdIds = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: teamId },
        data: { taskSeq: { increment: taskInputs.length } },
        select: { taskSeq: true },
      })

      const parentIds = [...new Set(taskInputs.map(t => t.parentTaskId))]
      const siblingCounts = new Map<string, number>()
      for (const parentId of parentIds) {
        const count = await tx.task.count({
          where: { parentTaskId: parentId },
        })
        siblingCounts.set(parentId, count)
      }

      const ids: string[] = []
      for (let i = 0; i < taskInputs.length; i++) {
        const input = taskInputs[i]!
        const siblingCount = siblingCounts.get(input.parentTaskId) ?? 0

        const task = await tx.task.create({
          data: {
            projectId,
            teamId,
            number: taskSeq - taskInputs.length + 1 + i,
            title: input.title,
            status: input.status,
            priority: input.priority,
            assigneeActorId: input.assigneeActorId ?? null,
            parentTaskId: input.parentTaskId,
            order: siblingCount + i,
          },
        })

        ids.push(task.id)
        siblingCounts.set(input.parentTaskId, siblingCount + i + 1)
      }

      return ids
    })

    // Re-fetch with includes outside transaction for proper type inference
    const tasks = await prisma.task.findMany({
      where: { id: { in: createdIds } },
      include: {
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
      },
    })

    return tasks.map(task => ({
      ...task,
      teamIdentifier: task.team.identifier,
    }))
  },
}
