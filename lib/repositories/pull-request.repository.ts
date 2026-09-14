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

  /**
   * PRs in a project still stored as open past the stale cutoff — the
   * candidates whose state may have drifted because a `pull_request closed`
   * webhook never landed (LUM-699). Capped: the caller re-checks each one
   * against GitHub on a read path, so this must stay a handful.
   */
  async findStaleOpenByProject(projectId: string, cutoff: Date, take: number) {
    return prisma.pullRequest.findMany({
      where: { task: { projectId }, state: 'open', createdAt: { lt: cutoff } },
      select: { id: true, repo: true, number: true },
      orderBy: { createdAt: 'asc' },
      take,
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
        // LUM-623: delivery time for temporal attribution of self-reported
        // signals a multi-PR task can't place by branch.
        mergedAt: true,
      },
    })
  },

  /**
   * LUM-732: the task's PRs projected to what the security-scan read model
   * needs to label and link each row. Newest PR first.
   */
  async findManyForSecurityByTaskId(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId },
      orderBy: { number: 'desc' },
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        state: true,
        // LUM-775: the queue-exit rules key on PR state × merge time × the
        // repo's default-branch baseline.
        repo: true,
        mergedAt: true,
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
  /**
   * LUM-780: every PR linked to a task as (workspace, repo, number, state) —
   * the coordinates the re-judge needs to ask GitHub for each PR's file list.
   * Oldest first so the evidence line reads in delivery order.
   */
  async listRepoAndNumberByTask(taskId: string) {
    return prisma.pullRequest.findMany({
      where: { taskId },
      select: { workspaceId: true, repo: true, number: true, state: true },
      orderBy: { number: 'asc' },
    })
  },

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
   * Batched `(taskId, state)` rows for a task set (LUM-632 milestone delivery
   * rollup) — the minimal projection the merged-PR / multi-PR-churn /
   * unlinked-task bucketing needs, plus the LUM-634 change-volume columns
   * (null = not synced/backfilled, kept distinct from a real 0 downstream).
   * A task with no row here has no PR record and lands in the caller's
   * explicit unlinked bucket.
   */
  async listStatesByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return []
    return prisma.pullRequest.findMany({
      where: { taskId: { in: taskIds } },
      select: {
        taskId: true,
        state: true,
        additions: true,
        deletions: true,
        changedFiles: true,
      },
    })
  },

  /**
   * LUM-634 backfill candidates: merged PRs WITH a task binding (the audit
   * scope — ownerless PRs are out of scope by decision) that are missing at
   * least one change-volume column. Oldest first for stable, resumable runs.
   */
  async listMergedTaskBoundMissingChangeVolume() {
    return prisma.pullRequest.findMany({
      where: {
        state: 'merged',
        taskId: { not: null },
        OR: [{ additions: null }, { deletions: null }, { changedFiles: null }],
      },
      select: {
        id: true,
        workspaceId: true,
        taskId: true,
        repo: true,
        number: true,
        state: true,
        additions: true,
        deletions: true,
        changedFiles: true,
      },
      orderBy: { mergedAt: 'asc' },
    })
  },

  /** LUM-634 backfill write: set the three change-volume columns on one PR. */
  async updateChangeVolume(
    id: string,
    volume: { additions: number; deletions: number; changedFiles: number }
  ) {
    return prisma.pullRequest.update({
      where: { id },
      data: volume,
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

  /**
   * LUM-649 changelog: merged PRs across a set of DONE tasks, batched (one
   * query for the whole milestone instead of N). `taskId` is the join key the
   * changelog fold groups on; oldest-merged first so a task's PRs read in
   * delivery order. Tasks with no merged PR simply have no rows — the fold
   * keeps them as an explicit no-PR entry.
   */
  async listMergedByTaskIds(taskIds: string[]): Promise<
    Array<{
      taskId: string
      repo: string
      number: number
      title: string
      mergeCommitSha: string | null
    }>
  > {
    if (taskIds.length === 0) return []
    const rows = await prisma.pullRequest.findMany({
      where: { taskId: { in: taskIds }, state: 'merged' },
      select: {
        taskId: true,
        repo: true,
        number: true,
        title: true,
        mergeCommitSha: true,
      },
      orderBy: { mergedAt: 'asc' },
    })
    return rows.filter(
      (r): r is typeof r & { taskId: string } => r.taskId !== null
    )
  },

  /**
   * LUM-649 baseline sample: merged-PR count grouped per milestone, for a set
   * of prior COMPLETED milestones. PullRequest has no milestoneId, so this
   * joins through the task and folds in memory. A prior milestone with no
   * merged PR is absent — the service reads a missing group as 0.
   */
  async countMergedByMilestones(
    milestoneIds: string[]
  ): Promise<Array<{ milestoneId: string; count: number }>> {
    if (milestoneIds.length === 0) return []
    const rows = await prisma.pullRequest.findMany({
      where: {
        state: 'merged',
        task: { milestoneId: { in: milestoneIds } },
      },
      select: { task: { select: { milestoneId: true } } },
    })
    const counts = new Map<string, number>()
    for (const row of rows) {
      const mid = row.task?.milestoneId
      if (mid) counts.set(mid, (counts.get(mid) ?? 0) + 1)
    }
    return [...counts].map(([milestoneId, count]) => ({ milestoneId, count }))
  },
}
