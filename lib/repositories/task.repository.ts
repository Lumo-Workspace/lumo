import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  TaskStatus,
  TaskPriority,
  AgentStatus,
} from '@prisma/client'

export const WORKSPACE_TASK_QUERY_LIMIT = 500

export interface WorkspaceTaskFilters {
  projectIds?: string[] | undefined
  milestoneIds?: string[] | undefined
  statuses?: TaskStatus[] | undefined
  priorities?: TaskPriority[] | undefined
  assigneeActorIds?: string[] | undefined
  tagIds?: string[] | undefined
}

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
  projectId?: string | undefined
  sprintId?: string | null | undefined
  milestoneId?: string | null | undefined
  claimable?: boolean | undefined
  agentStatus?: AgentStatus | null | undefined
  agentError?: string | null | undefined
  workStartedAt?: Date | null | undefined
}

/** Full detail include for single task view. Used by GET /api/tasks/[id] and task detail pages. */
const TASK_DETAIL_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      workspaceId: true,
      ownerId: true,
    },
  },
  team: { select: { identifier: true, sprintsEnabled: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
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
  sprint: {
    select: {
      id: true,
      status: true,
      name: true,
    },
  },
  milestone: {
    select: {
      id: true,
      status: true,
      name: true,
    },
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

/** Shared include for list endpoints (project, sprint, team task lists).
 * Matches the shape expected by BoardView and the Kanban board.
 */
const TASK_LIST_INCLUDE = {
  team: { select: { identifier: true } },
  // Board filtering also offers sprint / milestone, which need names not just
  // the scalar FKs. Same shape as TASK_DETAIL_INCLUDE so the JSON contract for
  // `task.sprint` / `task.milestone` is identical everywhere.
  sprint: { select: { id: true, status: true, name: true } },
  milestone: {
    select: { id: true, status: true, name: true, archivedAt: true },
  },
  // Board filtering needs each task's labels; lifted to a flat `tags` array by
  // the shapers in lib/api/task-shape.ts so the join rows never reach the client.
  taskTags: { select: { tag: true } },
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
    where: { status: 'DONE' as const },
    select: { id: true },
  },
} as const

/** Agent-state fields + workspace pointer for cancel / resume / status / confirm-spec / respond. */
const TASK_AGENT_SELECT = {
  id: true,
  status: true,
  agentStatus: true,
  inputReason: true,
  projectId: true,
  project: { select: { workspaceId: true } },
} as const

/** Title / description / identifier needed by Layer 1 memory extraction and lumo-proposal flows. */
const TASK_MEMORY_CONTEXT_SELECT = {
  id: true,
  title: true,
  description: true,
  number: true,
  projectId: true,
  project: { select: { workspaceId: true } },
  team: { select: { identifier: true } },
} as const

/** Compact shape for decompose: title + description + the workspaceId auth check. */
const TASK_DECOMPOSE_SELECT = {
  id: true,
  title: true,
  description: true,
  project: { select: { workspaceId: true } },
} as const

/** Comment-creation context: needs team identifier + workspace slug to build mention links. */
const TASK_COMMENT_SELECT = {
  id: true,
  projectId: true,
  number: true,
  title: true,
  team: { select: { identifier: true } },
  project: {
    select: {
      name: true,
      workspaceId: true,
      workspace: { select: { slug: true } },
    },
  },
} as const

/** Sprint-gate fields used by sprintRepository to validate task-sprint membership. */
const TASK_MINIMAL_SELECT = {
  id: true,
  teamId: true,
  sprintId: true,
} as const

/** Shape returned when resolving "LUM-30"-style identifiers to a task row. */
const TASK_IDENTIFIER_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  team: { select: { identifier: true } },
} as const

/** Auth check: full task row + only the project's workspaceId. Used by many tasks/[id]/* routes. */
const TASK_AUTH_INCLUDE = {
  project: { select: { workspaceId: true } },
} as const

/** Recent-tasks shape fed to the AI duplicate-check prompt. */
const TASK_DUPLICATE_CHECK_SELECT = {
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
} as const

/** Assignee-board shape: project owner actor + team identifier + parent + DONE-children count. */
const TASK_ASSIGNED_INCLUDE = {
  // Board filtering also offers sprint / milestone, which need names not just
  // the scalar FKs. Same shape as TASK_DETAIL_INCLUDE so the JSON contract for
  // `task.sprint` / `task.milestone` is identical everywhere.
  sprint: { select: { id: true, status: true, name: true } },
  milestone: {
    select: { id: true, status: true, name: true, archivedAt: true },
  },
  // See TASK_LIST_INCLUDE — same flat-`tags` contract for assigned-task lists.
  taskTags: { select: { tag: true } },
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
    where: { status: 'DONE' as const },
    select: { id: true },
  },
} as const

export const taskRepository = {
  /** Find a task by ID with full detail relations. */
  async findById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_DETAIL_INCLUDE,
    })
  },

  /**
   * Tasks eligible for claim-faithfulness judging — DONE or IN_REVIEW, newest
   * claim first. Carries claimSnapshotAt (claim-staleness axis) plus the current
   * merged-PR set (LUM-618 delivery-growth axis) so the sweep can decide both
   * freshness axes without reloading each task (judgeTask reloads full inputs).
   */
  async listFaithfulnessCandidates() {
    const rows = await prisma.task.findMany({
      where: { status: { in: ['DONE', 'IN_REVIEW'] } },
      select: {
        id: true,
        claimSnapshotAt: true,
        pullRequests: {
          where: { state: 'merged' },
          select: { number: true },
        },
      },
      orderBy: { claimSnapshotAt: 'desc' },
    })
    return rows.map(r => ({
      id: r.id,
      claimSnapshotAt: r.claimSnapshotAt,
      mergedPrNumbers: r.pullRequests.map(p => p.number),
    }))
  },

  /**
   * Lightweight status read for the lineage birth-time backfill (LUM-296).
   * Selects only `status` to avoid hydrating the full detail graph on the hot
   * session-start path. Returns null when the task doesn't exist.
   */
  async getStatus(id: string): Promise<TaskStatus | null> {
    const row = await prisma.task.findUnique({
      where: { id },
      select: { status: true },
    })
    return row?.status ?? null
  },

  /**
   * Lightweight title+status read for the fragment-usage audit (LUM-314).
   * Returns null when the task doesn't exist.
   */
  async getTitleAndStatus(taskId: string) {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, status: true },
    })
  },

  /**
   * LUM-573: freeze the synthesized task-level claim snapshot. `at` (non-null)
   * is the "snapshot synthesized" watermark the read path uses to decide a
   * field read vs the live latest-session fallback — so a null `text` (the
   * delivery session had no material) is still an authoritative, fail-closed
   * answer once `claimSnapshotAt` is set, not a cue to fall back.
   */
  async setClaimSnapshot(
    taskId: string,
    snapshot: {
      text: string | null
      // LUM-597: 'AGENT' joins the source space — the agent's own verify
      // self-report, the authoritative claim over a summarizer paraphrase.
      source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
      sessionId: string | null
      at: Date
    }
  ) {
    return prisma.task.update({
      where: { id: taskId },
      data: {
        claimSnapshot: snapshot.text,
        claimSnapshotSource: snapshot.source,
        claimSnapshotSessionId: snapshot.sessionId,
        claimSnapshotAt: snapshot.at,
      },
      select: { id: true },
    })
  },

  /**
   * LUM-573: the frozen claim snapshot for the read model. `synthesizedAt` is
   * null when no snapshot has been frozen yet (the read path then falls back to
   * the live latest-session claim). Returns null only when the task is gone.
   */
  async loadClaimSnapshot(taskId: string) {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: {
        claimSnapshot: true,
        claimSnapshotSource: true,
        claimSnapshotAt: true,
      },
    })
  },

  /** Find a task by ID with update-related relations (project + team). */
  async findForUpdate(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: TASK_UPDATE_INCLUDE,
    })
  },

  /**
   * Batch variant of {@link findForUpdate}. Returns a Map keyed by id so the
   * caller can look up each row without scanning, and skips fetching when
   * `ids` is empty. Used by quick-dispatch to pre-fetch all tasks in a batch
   * with one query instead of fetching per-action.
   */
  async findManyForUpdate(ids: string[]) {
    if (ids.length === 0) return new Map<string, never>()
    const rows = await prisma.task.findMany({
      where: { id: { in: ids } },
      include: TASK_UPDATE_INCLUDE,
    })
    return new Map(rows.map(row => [row.id, row]))
  },

  /** Find a task by ID with only the project relation (for auth checks). */
  async findWithProject(id: string) {
    return prisma.task.findUnique({ where: { id }, include: { project: true } })
  },

  /**
   * Resolve a workspace-scoped task identifier like "LUM-30" into a compact
   * record. Returns null if no matching task exists in the given workspace.
   */
  async findByWorkspaceIdentifier(
    workspaceId: string,
    teamIdentifier: string,
    number: number
  ) {
    return prisma.task.findFirst({
      where: {
        number,
        team: { identifier: teamIdentifier, workspaceId },
      },
      select: { ...TASK_IDENTIFIER_SELECT, workStartedAt: true },
    })
  },

  /**
   * Compact header (identifier parts + title + status) by cuid. Read models
   * that already resolved the task use this instead of a full detail fetch.
   */
  async findHeaderById(id: string) {
    return prisma.task.findUnique({
      where: { id },
      // The status read model resolves the machine-round cap task → workspace
      // (LUM-429); carry it alongside the identifier fields.
      select: {
        ...TASK_IDENTIFIER_SELECT,
        project: {
          select: { workspace: { select: { verificationMaxRounds: true } } },
        },
      },
    })
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
      select: TASK_AGENT_SELECT,
    })
  },

  /** Find only the projectId for a task. Used by mcp-clarify. */
  async findProjectId(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: { projectId: true },
    })
  },

  /**
   * Compact lookup for Layer 1 memory extraction: returns the fields the
   * extraction prompt needs (task title/description as context) plus the
   * project + workspace IDs needed to write Memory rows.
   */
  async findForMemoryContext(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: TASK_MEMORY_CONTEXT_SELECT,
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

  /** Update a single task's sprintId. */
  async updateSprint(
    taskId: string,
    sprintId: string | null,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.update({
      where: { id: taskId },
      data: { sprintId },
    })
  },

  /** Bulk update multiple tasks' sprintId. */
  async bulkUpdateSprint(
    taskIds: string[],
    sprintId: string | null,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.updateMany({
      where: { id: { in: taskIds } },
      data: { sprintId },
    })
  },

  /** Find all tasks assigned to an actor, with project/team/parent/children details. */
  async findAssignedTasks(
    actorId: string,
    opts: { sprintIds?: string[] } = {}
  ) {
    return prisma.task.findMany({
      where: {
        assigneeActorId: actorId,
        ...(opts.sprintIds?.length ? { sprintId: { in: opts.sprintIds } } : {}),
      },
      include: TASK_ASSIGNED_INCLUDE,
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
      select: TASK_DUPLICATE_CHECK_SELECT,
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
      include: TASK_AUTH_INCLUDE,
    })
  },

  /** Find a task by ID for decompose (title, description, project workspaceId). */
  async findForDecompose(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: TASK_DECOMPOSE_SELECT,
    })
  },

  /** Find a task with comment-creation fields (id, projectId, number, title, team, project workspace). */
  async findForComment(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: TASK_COMMENT_SELECT,
    })
  },

  /** Find all tasks for a project with full list details (for project task list).
   * @param sprintId    - undefined: no sprint filter; null: only backlog (sprintId IS NULL); string: only that sprint
   * @param milestoneId - undefined: no milestone filter; null: only tasks with no milestone; string: only that milestone
   */
  async findByProjectWithDetails(
    projectId: string,
    sprintId?: string | null,
    milestoneId?: string | null
  ) {
    const where: Prisma.TaskWhereInput = { projectId }
    if (sprintId !== undefined) {
      where.sprintId = sprintId === null ? null : sprintId
    }
    if (milestoneId !== undefined) {
      where.milestoneId = milestoneId === null ? null : milestoneId
    }
    return prisma.task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks in a workspace, optionally filtered by project, milestone, status, priority, assignee, and tags.
   * Capped at WORKSPACE_TASK_QUERY_LIMIT results, ordered by task order.
   * Used by the workspace-wide task view (LUM-224).
   */
  async findByWorkspaceWithFilters(
    workspaceId: string,
    filters: WorkspaceTaskFilters = {}
  ) {
    const where: Prisma.TaskWhereInput = {
      project: { workspaceId },
    }
    if (filters.projectIds?.length) {
      where.projectId = { in: filters.projectIds }
    }
    if (filters.milestoneIds?.length) {
      where.milestoneId = { in: filters.milestoneIds }
    }
    if (filters.statuses?.length) {
      where.status = { in: filters.statuses }
    }
    if (filters.priorities?.length) {
      where.priority = { in: filters.priorities }
    }
    if (filters.assigneeActorIds?.length) {
      where.assigneeActorId = { in: filters.assigneeActorIds }
    }
    if (filters.tagIds?.length) {
      where.taskTags = { some: { tagId: { in: filters.tagIds } } }
    }
    return prisma.task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: { order: 'asc' },
      take: WORKSPACE_TASK_QUERY_LIMIT,
    })
  },

  /** Find tasks under a milestone, optionally filtered by assignee.
   * Used by GET /api/milestones/[id]/tasks (milestone show + task list --milestone).
   */
  async findByMilestone(opts: {
    milestoneId: string
    assigneeActorId?: string
  }) {
    const where: Prisma.TaskWhereInput = { milestoneId: opts.milestoneId }
    if (opts.assigneeActorId) {
      where.assigneeActorId = opts.assigneeActorId
    }
    return prisma.task.findMany({
      where,
      include: TASK_ASSIGNED_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks for a sprint (across all projects in the team).
   * Used by GET /api/sprints/[sprintId]/tasks for the Sprint Board.
   *
   * Includes the project relation (with owner actor) so the response can
   * serve MyTask-shaped callers (TaskWorkspace view on the sprint page).
   */
  async findBySprint(sprintId: string) {
    return prisma.task.findMany({
      where: { sprintId },
      include: {
        ...TASK_LIST_INCLUDE,
        project: {
          select: {
            id: true,
            name: true,
            owner: { select: { actor: { select: { id: true } } } },
          },
        },
      },
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks for a team (across all projects).
   * @param sprintId - undefined: no sprint filter; null: only backlog (sprintId IS NULL); string: only that sprint
   * Used by GET /api/teams/[teamId]/tasks for the Backlog panel.
   */
  async findByTeamWithDetails(teamId: string, sprintId?: string | null) {
    const where: Prisma.TaskWhereInput = { teamId }
    if (sprintId !== undefined) {
      where.sprintId = sprintId === null ? null : sprintId
    }
    return prisma.task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
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
    parentTaskId: string | null
    sprintId?: string | null
    milestoneId?: string | null
    order: number | undefined
    dueDate: Date | string | null
  }) {
    const taskId = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: data.teamId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      })

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
          parentTaskId: data.parentTaskId,
          sprintId: data.sprintId ?? null,
          milestoneId: data.milestoneId ?? null,
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

  /**
   * Resolve a workspace-scoped task by cuid, returning only the fields needed
   * to reconstruct its human identifier (TEAM-N). Used by documentService when
   * the caller passes a raw cuid instead of a "LUM-N" string.
   */
  async findByIdForMention(id: string, workspaceId: string) {
    return prisma.task.findFirst({
      where: { id, team: { workspaceId } },
      select: {
        id: true,
        number: true,
        status: true,
        workStartedAt: true,
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * Lightweight lookup returning only fields sprintService needs for gate checks.
   * Used by addTaskToSprint / removeTaskFromSprint to validate team match
   * and membership without loading unrelated fields.
   */
  async findMinimalById(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.task.findUnique({
      where: { id: taskId },
      select: TASK_MINIMAL_SELECT,
    })
  },

  /**
   * Return all tasks on `sprintId` whose status is not DONE.
   * Used inside sprint close to decide which tasks need a spillover decision.
   * Must be called within a transaction — no default prisma fallback.
   */
  async findUnfinishedBySprint(sprintId: string, tx: Prisma.TransactionClient) {
    return tx.task.findMany({
      where: { sprintId, status: { not: 'DONE' } },
      select: { id: true, status: true },
    })
  },

  /**
   * Ids of every non-DONE task on `sprintId`, read outside any transaction.
   * Used by the automated sprint-close reconcile to build "all → backlog"
   * spillover decisions before delegating to the transactional close.
   */
  async listUnfinishedIdsBySprint(sprintId: string): Promise<{ id: string }[]> {
    return prisma.task.findMany({
      where: { sprintId, status: { not: 'DONE' } },
      select: { id: true },
    })
  },

  /**
   * Return the minimal task fields needed for sprint-summary stats.
   * Used by sprintSummaryRepository.computeStatsData().
   */
  async listBySprintForStats(sprintId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.task.findMany({
      where: { sprintId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })
  },

  /**
   * Lightweight task projection for a milestone, used by
   * milestoneSummaryRepository.computeStatsData().
   */
  async listByMilestoneForStats(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })
  },

  /**
   * LUM-649 changelog projection: every task in the milestone (all statuses —
   * the service filters to DONE, so the honest boundary lives in one place)
   * with the identifier parts, title, frozen claimSnapshot fields, and
   * `updatedAt` (the best-available "last moved" proxy — Task has no
   * completedAt column) for newest-first ordering.
   */
  async listByMilestoneForChangelog(milestoneId: string) {
    return prisma.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        status: true,
        number: true,
        title: true,
        updatedAt: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        claimSnapshotSessionId: true,
        claimSnapshotAt: true,
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * LUM-649 baseline sample: DONE-task count grouped per milestone, for a set
   * of prior COMPLETED milestones (the changelog headline's reference class).
   * A prior milestone with zero DONE tasks is simply absent — the service
   * reads a missing group as 0.
   */
  async countDoneByMilestones(
    milestoneIds: string[]
  ): Promise<Array<{ milestoneId: string; count: number }>> {
    if (milestoneIds.length === 0) return []
    const rows = await prisma.task.groupBy({
      by: ['milestoneId'],
      where: { milestoneId: { in: milestoneIds }, status: 'DONE' },
      _count: { _all: true },
    })
    return rows
      .filter(
        (r): r is typeof r & { milestoneId: string } => r.milestoneId !== null
      )
      .map(r => ({ milestoneId: r.milestoneId, count: r._count._all }))
  },

  /**
   * Cache the LLM-generated comment-thread summary on the task row.
   * Part of the context-injection tiering pipeline (LUM-122): comment threads
   * have no standalone entity, so the cached summary lives on Task.
   */
  async updateCommentsSummary(taskId: string, summary: string) {
    return prisma.task.update({
      where: { id: taskId },
      data: { commentsSummary: summary, commentsSummaryAt: new Date() },
    })
  },

  /**
   * Resolve a batch of `(team identifier, number)` pairs to status + PR state,
   * scoped to a single workspace. Pairs the caller can't see are simply absent
   * from the result — the mention renderer degrades those to a plain chip.
   */
  async findManyForMentionStatus(
    workspaceId: string,
    identifiers: { prefix: string; number: number }[]
  ) {
    return prisma.task.findMany({
      where: {
        project: { workspaceId },
        OR: identifiers.map(p => ({
          number: p.number,
          team: { identifier: p.prefix },
        })),
      },
      select: {
        number: true,
        status: true,
        team: { select: { identifier: true } },
        pullRequests: { select: { state: true } },
      },
    })
  },
}
