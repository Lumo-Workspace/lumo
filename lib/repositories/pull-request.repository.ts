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

  /**
   * Find the delivery (a merged PR on a DONE task, in this workspace) whose
   * merge commit is `sha`. Drives the LUM-607 webhook revert feed: a later
   * commit's `This reverts commit <sha>` trailer maps back to the delivery
   * here, with no git checkout. Mirrors the backfill script's delivery filter
   * (state merged · mergeCommitSha set · task DONE).
   */
  async findMergedDeliveryByMergeCommitSha(workspaceId: string, sha: string) {
    return prisma.pullRequest.findFirst({
      where: {
        workspaceId,
        state: 'merged',
        mergeCommitSha: sha,
        taskId: { not: null },
        task: { status: 'DONE' },
      },
      select: { taskId: true, workspaceId: true },
    })
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

  /**
   * The most recent PR for a repo + head branch (LUM-617) — used at webhook time
   * to resolve which PR a CI commit belongs to when the event carries the branch
   * (status events) rather than a PR list. Returns just the number.
   */
  async findByHeadBranch(repo: string, headBranch: string) {
    return prisma.pullRequest.findFirst({
      where: { repo, headBranch },
      orderBy: { updatedAt: 'desc' },
      select: { number: true },
    })
  },

  /**
   * All PRs linked to a task (LUM-617), newest-first, projected to the fields
   * the per-PR gate audit needs to group and label signals. ISP: only the
   * grouping/display columns, nothing else.
   */
  async findManyByTaskId(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId },
      orderBy: { number: 'desc' },
      select: {
        number: true,
        title: true,
        state: true,
        headBranch: true,
      },
    })
  },

  /**
   * Find a PR by task + number for the context-tiering retrieval route
   * (LUM-122). Scoped to the task so the API route's workspace check on the
   * task transitively secures the PR. Returns full structured PR fields.
   */
  async findByTaskAndNumber(taskId: string, number: number) {
    return prisma.pullRequest.findFirst({
      where: { taskId, number },
      orderBy: { updatedAt: 'desc' },
    })
  },

  /**
   * All PRs linked to a task, newest first, shaped for the context-tiering
   * renderer (LUM-122): the inline-card fields plus the cuid `id` so the
   * task-context fragment manifest can reference each PR (LUM-274).
   */
  async listByTask(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId },
      select: {
        id: true,
        number: true,
        title: true,
        state: true,
        ciStatus: true,
      },
      orderBy: { updatedAt: 'desc' },
    })
  },

  /**
   * Minimal PR rows for the send-back lifecycle window match (LUM-511 Phase 5):
   * the number/url to display + createdAt to test against the
   * [send-back → resolving PASS] window. Oldest-first.
   */
  async listForLifecycle(
    taskId: string
  ): Promise<Array<{ number: number; url: string; createdAt: Date }>> {
    return prisma.pullRequest.findMany({
      where: { taskId },
      select: { number: true, url: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * `(id, number)` for every PR linked to a task, newest first. The id is the
   * join key for fetching mirrored review comments; the number labels todos
   * when a task spans more than one PR. Lighter than `listByTask` (no
   * title/state/ci) — the review-todo builder only needs the join key + number.
   */
  async listIdAndNumberByTask(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId },
      select: { id: true, number: true },
      orderBy: { updatedAt: 'desc' },
    })
  },

  /**
   * Merged PRs for a task, oldest-first, with the fields the claim-faithfulness
   * GitHub-API delivery resolver needs (workspaceId + repo + number to fetch the
   * diff, mergeCommitSha for the delivery shas, title for commitSubjects).
   */
  async listMergedByTask(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId, state: 'merged' },
      select: {
        workspaceId: true,
        repo: true,
        number: true,
        mergeCommitSha: true,
        title: true,
      },
      orderBy: { mergedAt: 'asc' },
    })
  },
}
