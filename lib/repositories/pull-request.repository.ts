import { prisma } from '@/lib/db/prisma'

interface PrStateUpdate {
  state: string
  mergedAt: Date | null
  closedAt: Date | null
  isDraft: boolean
}

/** LUM-788 / LUM-1189 — the PR columns the scan read-out prints. */
const SCAN_READOUT_PR_SELECT = {
  id: true,
  repo: true,
  number: true,
  title: true,
  url: true,
  state: true,
  headSha: true,
  mergedAt: true,
  task: {
    select: { number: true, team: { select: { identifier: true } } },
  },
} as const

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

  /**
   * LUM-925 — how many workspaces have this PR linked to one of their tasks.
   * Each workspace holds its own row for a shared repository's PR (LUM-924);
   * more than one task-linked row means the PR cannot belong to all of them.
   */
  async countTaskLinkedWorkspaces(repo: string, number: number) {
    // LUM-929: count workspaces, not rows — the unique key is case-sensitive,
    // so one workspace can hold case-variant rows for the same PR.
    const rows = await prisma.pullRequest.findMany({
      where: {
        repo: { equals: repo, mode: 'insensitive' },
        number,
        taskId: { not: null },
      },
      select: { workspaceId: true },
      distinct: ['workspaceId'],
    })
    return rows.length
  },

  /**
   * This workspace's row for a PR, with task info. LUM-924: a PR is unique per
   * workspace, not globally — workspaces sharing a GitHub App installation can
   * each hold their own row for the same repository and number.
   */
  async findByRepoAndNumber(workspaceId: string, repo: string, number: number) {
    return prisma.pullRequest.findUnique({
      where: { workspaceId_repo_number: { workspaceId, repo, number } },
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

  /**
   * LUM-924 — every workspace's row for one PR, oldest first. Only for callers
   * whose proof of ownership is the repository itself (a GitHub Actions OIDC
   * SARIF push), where each workspace holding the PR gets its own copy.
   */
  async findAllByRepoAndNumber(repo: string, number: number) {
    return prisma.pullRequest.findMany({
      where: { repo, number },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        taskId: true,
        repo: true,
        number: true,
      },
    })
  },

  /**
   * LUM-788 — the PR(s) a workspace knows under `number`, for the by-number
   * scan read-out (`lumo pr show`). Scoped by workspace so a number that
   * belongs to another workspace is simply not found (no existence leak);
   * `repo` narrows to one row when the same number exists in several repos.
   * The task join is optional — an unlinked PR is readable too.
   */
  async findByNumberInWorkspace(
    workspaceId: string,
    number: number,
    repo: string | null
  ) {
    return prisma.pullRequest.findMany({
      where: { workspaceId, number, ...(repo ? { repo } : {}) },
      orderBy: { repo: 'asc' },
      select: SCAN_READOUT_PR_SELECT,
    })
  },

  /**
   * LUM-1189 — every PR linked to a task in this workspace, in the same shape
   * as `findByNumberInWorkspace`, for the task-level scan read-out
   * (`lumo task scans`). The workspace filter is belt and braces: the route
   * already resolved the task inside the caller's workspace.
   */
  async findManyForScanReadoutByTaskId(workspaceId: string, taskId: string) {
    return prisma.pullRequest.findMany({
      where: { workspaceId, taskId },
      orderBy: [{ number: 'desc' }, { repo: 'asc' }],
      select: SCAN_READOUT_PR_SELECT,
    })
  },

  /** LUM-879 — the workspace and repository a PR row belongs to. */
  async findRepoScope(id: string) {
    return prisma.pullRequest.findUnique({
      where: { id },
      select: { workspaceId: true, repo: true },
    })
  },

  /** LUM-879 — ids of the workspace's PRs in these stored repo spellings. */
  async findIdsByRepos(workspaceId: string, repos: string[]) {
    if (repos.length === 0) return []
    const rows = await prisma.pullRequest.findMany({
      where: { workspaceId, repo: { in: repos } },
      select: { id: true },
    })
    return rows.map(row => row.id)
  },

  /**
   * LUM-1131: the state ('open' | 'closed' | 'merged') of each PR, pinned to
   * the workspace. A missing id is simply absent from the map.
   */
  async findStatesByIds(
    workspaceId: string,
    ids: string[]
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.pullRequest.findMany({
      where: { workspaceId, id: { in: ids } },
      select: { id: true, state: true },
    })
    return new Map(rows.map(r => [r.id, r.state]))
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
  async findByHeadBranch(
    workspaceId: string,
    repo: string,
    headBranch: string
  ) {
    return prisma.pullRequest.findFirst({
      where: { workspaceId, repo, headBranch },
      orderBy: { updatedAt: 'desc' },
      select: { number: true },
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
        headSha: true,
        // LUM-775: the queue-exit rules key on PR state × merge time × the
        // repo's default-branch baseline.
        repo: true,
        mergedAt: true,
        // LUM-892: the workspace's scan switch is read per task.
        workspaceId: true,
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
   * Minimal PR rows for the task-status struggle trail (PR cycles, LUM-561):
   * number/url to display + createdAt. Oldest-first.
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
        // LUM-923: a relation filter skips the default trash filter.
        task: { milestoneId: { in: milestoneIds }, deletedAt: null },
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
