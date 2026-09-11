import { apiFetch, ApiClientError } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { CriteriaSetItemInput } from '@/app/workspace/[workspaceUrl]/types'

export interface WorkspaceTaskFilterArgs {
  projectIds?: string[]
  milestoneIds?: string[]
  statuses?: string[]
  priorities?: string[]
  assigneeActorIds?: string[]
  tagIds?: string[]
}

export const tasksClient = {
  listMine<T>(opts: { sprintIds?: string[] } = {}) {
    const q = new URLSearchParams()
    if (opts.sprintIds?.length) q.set('sprintIds', opts.sprintIds.join(','))
    const path = q.toString() ? `${API.tasks.me}?${q}` : API.tasks.me
    return apiFetch<T>(path)
  },

  /**
   * Fetch tasks for a project, with optional sprintId / milestoneId filters.
   * - sprintId: string  → tasks in that sprint
   * - sprintId: null    → backlog tasks (sprintId IS NULL)
   * - sprintId omitted  → all tasks (no sprint filter)
   * - milestoneId: string → tasks attached to that milestone
   */
  listByProject<T>(
    projectId: string,
    opts: { sprintId?: string | null; milestoneId?: string } = {}
  ) {
    const params = new URLSearchParams()
    if (opts.sprintId !== undefined) {
      params.set('sprintId', opts.sprintId === null ? 'null' : opts.sprintId)
    }
    if (opts.milestoneId !== undefined) {
      params.set('milestoneId', opts.milestoneId)
    }
    const qs = params.toString()
    const url = `${API.projects.tasks(projectId)}${qs ? `?${qs}` : ''}`
    return apiFetch<T>(url)
  },

  /**
   * Fetch all tasks in a sprint (across all projects in the team).
   * Used by the Sprint Board.
   */
  listBySprint<T>(sprintId: string) {
    return apiFetch<T>(API.sprints.tasks(sprintId))
  },

  /**
   * Fetch all tasks attached to a milestone (MyTask-shaped, single project).
   * Used by the Milestone detail task workspace.
   */
  listByMilestone<T>(milestoneId: string) {
    return apiFetch<T>(API.milestones.tasks(milestoneId))
  },

  /**
   * Fetch tasks for a team (across all projects), with optional sprintId filter.
   * - sprintId: string  → tasks in that sprint
   * - sprintId: null    → backlog tasks (sprintId IS NULL)
   * - sprintId omitted  → all tasks (no sprint filter)
   * Used by the Backlog panel.
   */
  listByTeam<T>(teamId: string, opts: { sprintId?: string | null } = {}) {
    const params = new URLSearchParams()
    if (opts.sprintId !== undefined) {
      params.set('sprintId', opts.sprintId === null ? 'null' : opts.sprintId)
    }
    const qs = params.toString()
    const url = `${API.teams.tasks(teamId)}${qs ? `?${qs}` : ''}`
    return apiFetch<T>(url)
  },

  listWorkspace<T>(filters: WorkspaceTaskFilterArgs = {}) {
    const q = new URLSearchParams()
    if (filters.projectIds?.length)
      q.set('projectIds', filters.projectIds.join(','))
    if (filters.milestoneIds?.length)
      q.set('milestoneIds', filters.milestoneIds.join(','))
    if (filters.statuses?.length) q.set('statuses', filters.statuses.join(','))
    if (filters.priorities?.length)
      q.set('priorities', filters.priorities.join(','))
    if (filters.assigneeActorIds?.length)
      q.set('assigneeActorIds', filters.assigneeActorIds.join(','))
    if (filters.tagIds?.length) q.set('tagIds', filters.tagIds.join(','))
    const qs = q.toString()
    return apiFetch<T>(
      qs ? `${API.tasks.workspace}?${qs}` : API.tasks.workspace
    )
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.tasks.byId(id))
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.tasks.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.tasks.byId(id), { method: 'DELETE' })
  },

  listComments<T>(taskId: string) {
    return apiFetch<T>(API.tasks.comments(taskId))
  },

  createComment<T>(taskId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comments(taskId), {
      method: 'POST',
      body: data,
    })
  },

  updateComment<T>(taskId: string, commentId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comment(taskId, commentId), {
      method: 'PATCH',
      body: data,
    })
  },

  deleteComment(taskId: string, commentId: string) {
    return apiFetch<void>(API.tasks.comment(taskId, commentId), {
      method: 'DELETE',
    })
  },

  /**
   * Record a human adjudication of the task's acceptance contract. Only
   * reachable from a Clerk browser session — the server refuses bearer
   * (agent/CLI) identities with 403 (milestone rule 5).
   */
  submitHumanVerdict<T>(
    taskId: string,
    data: {
      verdict: 'PASS' | 'FAIL'
      // LUM-422 ① de-enumeration: no rejection-reason enum on the human path —
      // a FAIL's `note` is the send-back reason (posted as a comment).
      note?: string
      // LUM-425: narrow the verdict to specific criteria; omitted = the whole
      // contract (the legacy task-level "pass all / send back all").
      criterionIds?: string[]
    }
  ) {
    return apiFetch<T>(API.tasks.humanVerdict(taskId), {
      method: 'POST',
      body: data,
    })
  },

  /**
   * Undo (withdraw) the most recent human verdict on a task (LUM-586). Only
   * reachable from a Clerk browser session — the server refuses bearer
   * (agent/CLI) identities with 403 (same red line as submitHumanVerdict).
   */
  undoHumanVerdict<T>(taskId: string) {
    return apiFetch<T>(API.tasks.humanVerdict(taskId), { method: 'DELETE' })
  },

  /**
   * Apply a human contract revision from the web tab (HUMAN_EDIT). `criteria` is
   * the desired final list — items with `id` keep/update, omitted existing ones
   * are deleted (soft-deleted if they carry runs). Clerk-session only; the server
   * derives source (REVIEW_ADDED in review, else HUMAN_EDIT) and attributes it
   * "via web". No causeTag — humans bear zero structured burden.
   */
  reviseCriteria<T>(taskId: string, criteria: CriteriaSetItemInput[]) {
    return apiFetch<T>(API.tasks.criteria(taskId), {
      method: 'PUT',
      body: { source: 'HUMAN_EDIT', criteria },
    })
  },

  /** List ALL of a task's boundary-crossings, open and dispositioned (LUM-435). */
  listBoundaryCrossings<T>(taskId: string) {
    return apiFetch<T>(API.tasks.boundaryCrossings(taskId), { method: 'GET' })
  },

  /**
   * Disposition — or RE-disposition (LUM-450) — a boundary-crossing. A first
   * disposition (FALSE_POSITIVE | CONFIRMED) clears its DONE block (LUM-435); a
   * later call changes it, and `OPEN` reverts it to undispositioned (re-blocking
   * the gate). Human-only — the server refuses bearer (agent/CLI) identities
   * with 403 before parse. The note is optional.
   */
  dispositionBoundaryCrossing<T>(
    taskId: string,
    crossingId: string,
    disposition: 'FALSE_POSITIVE' | 'CONFIRMED' | 'OPEN',
    dispositionNote?: string,
    // LUM-751: opt a FALSE_POSITIVE into a per-repository suppression rule.
    options?: { suppressSimilarInProject?: boolean; suppressionReason?: string }
  ) {
    return apiFetch<T>(API.tasks.boundaryDisposition(taskId), {
      method: 'POST',
      body: {
        crossingId,
        disposition,
        ...(dispositionNote ? { dispositionNote } : {}),
        ...(options?.suppressSimilarInProject
          ? {
              suppressSimilarInProject: true,
              ...(options.suppressionReason
                ? { suppressionReason: options.suppressionReason }
                : {}),
            }
          : {}),
      },
    })
  },

  /**
   * How many existing crossings in this repository a suppression rule built
   * from this crossing would dispose (LUM-759) — read-only, Clerk-session only.
   * Returns { suppressible, count, capped, cap }; shown next to the opt-in so
   * the human sees the blast radius before committing the ruling.
   */
  previewCrossingSuppressionScope<T>(taskId: string, crossingId: string) {
    return apiFetch<T>(API.tasks.boundarySuppressionPreview(taskId, crossingId))
  },

  /**
   * Soft-revoke a repository suppression rule (LUM-751), which since LUM-759
   * also returns the crossings it had suppressed to the open queue.
   * Clerk-session only — the server refuses bearer (agent) identities. Returns
   * { ruleId, revokedAt, reopenedCount }.
   */
  revokeCrossingSuppressionRule<T>(taskId: string, ruleId: string) {
    return apiFetch<T>(API.tasks.boundarySuppressionRule(taskId, ruleId), {
      method: 'DELETE',
    })
  },

  /**
   * Generate (and cache) a plain-language SYSTEM explanation for a boundary
   * crossing (LUM-590). Clerk-session only — the server refuses bearer (agent)
   * identities. Returns { explanation: string }. Advisory only: never changes
   * disposition or the DONE gate.
   */
  explainBoundaryCrossing<T>(taskId: string, crossingId: string) {
    return apiFetch<T>(API.tasks.boundarySystemExplain(taskId, crossingId), {
      method: 'POST',
      body: {},
    })
  },

  /**
   * Spawn a remediation follow-up task from a crossing (LUM-435): pre-links the
   * crossing and adds a dependency edge to the original task. Ordinary
   * authenticated write (not the disposition redline).
   */
  spawnBoundaryRemediation<T>(taskId: string, crossingId: string) {
    return apiFetch<T>(API.tasks.boundaryRemediation(taskId, crossingId), {
      method: 'POST',
      body: {},
    })
  },

  suggestPriority<T>(data: unknown, signal?: AbortSignal) {
    return apiFetch<T>('/api/tasks/suggest-priority', {
      method: 'POST',
      body: data,
      signal,
    })
  },

  parseQuickDispatch<T>(data: unknown, signal?: AbortSignal) {
    return apiFetch<T>(API.tasks.quickDispatchParse, {
      method: 'POST',
      body: data,
      signal,
    })
  },

  executeQuickDispatch<T>(data: unknown) {
    return apiFetch<T>(API.tasks.quickDispatchExecute, {
      method: 'POST',
      body: data,
    })
  },

  getAgentRuns<T>(taskId: string) {
    return apiFetch<T>(API.tasks.agentRuns(taskId))
  },

  // Lineage endpoint is keyed by task identifier (LUM-42), not the cuid.
  getLineage<T>(identifier: string) {
    return apiFetch<T>(API.tasks.lineage(encodeURIComponent(identifier)))
  },

  // Acceptance-status read model (LUM-344). resolveTaskParam accepts either the
  // identifier (LUM-42) or the cuid, so the read-only tab keys it by identifier.
  getStatus<T>(identifier: string) {
    return apiFetch<T>(API.tasks.status(encodeURIComponent(identifier)))
  },

  forecast<T>(taskId: string) {
    return apiFetch<T>(API.tasks.forecast(taskId))
  },

  progress<T>(taskId: string) {
    return apiFetch<T>(API.tasks.progress(taskId))
  },

  gates<T>(taskId: string) {
    return apiFetch<T>(API.tasks.gates(taskId))
  },

  /** LUM-732: latest security scan per linked PR + DONE-blocking count. */
  securityScans<T>(taskId: string) {
    return apiFetch<T>(API.tasks.securityScans(taskId))
  },

  /** LUM-732: human-only disposition of one security finding. */
  dispositionSecurityFinding<T>(
    taskId: string,
    findingId: string,
    body: { disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK'; note?: string }
  ) {
    return apiFetch<T>(
      API.tasks.securityFindingDisposition(taskId, findingId),
      {
        method: 'POST',
        body,
      }
    )
  },

  getTimeline<T>(taskId: string, cursor?: string | null, limit?: number) {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    const url = `${API.tasks.timeline(taskId)}${qs ? `?${qs}` : ''}`
    return apiFetch<T>(url)
  },

  searchPrs<T>(workspaceId: string, query: string, limit?: number) {
    const params = new URLSearchParams({ q: query, workspaceId })
    if (limit) params.set('limit', String(limit))
    return apiFetch<T>(`${API.pullRequests.search}?${params}`)
  },

  async linkPr(
    taskId: string,
    data: { prId?: string; url?: string; force?: boolean }
  ) {
    const url = API.pullRequests.link(taskId)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
      const err = new ApiClientError(json.error ?? 'Link failed', res.status)
      if (json.conflictTask) {
        ;(err as ApiClientError & { conflictTask: unknown }).conflictTask =
          json.conflictTask
      }
      throw err
    }
    return json
  },

  unlinkPr(taskId: string, prId: string) {
    return apiFetch<void>(API.pullRequests.unlink(taskId, prId), {
      method: 'POST',
    })
  },

  listDependencies<T>(taskId: string) {
    return apiFetch<T>(API.tasks.dependencies(taskId))
  },

  addDependency<T>(
    taskId: string,
    data: {
      blockedBy: string
      kind?: 'BLOCKS' | 'RELATES'
      direction?: 'BLOCKED_BY' | 'BLOCKS'
    }
  ) {
    return apiFetch<T>(API.tasks.dependencies(taskId), {
      method: 'POST',
      body: data,
    })
  },

  patchDependency<T>(
    taskId: string,
    depId: string,
    data: { action: 'confirm' | 'dismiss'; reverse?: boolean }
  ) {
    return apiFetch<T>(API.tasks.dependency(taskId, depId), {
      method: 'PATCH',
      body: data,
    })
  },

  removeDependency(taskId: string, depId: string) {
    return apiFetch<void>(API.tasks.dependency(taskId, depId), {
      method: 'DELETE',
    })
  },
}
