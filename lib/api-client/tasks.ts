import { apiFetch, ApiClientError } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

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
      verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
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

  /** List a task's open (unacknowledged) boundary-crossings (LUM-426). */
  listBoundaryCrossings<T>(taskId: string) {
    return apiFetch<T>(API.tasks.boundaryCrossings(taskId), { method: 'GET' })
  },

  /**
   * Acknowledge a boundary-crossing, clearing its DONE block. Human-only — the
   * server refuses bearer (agent/CLI) identities with 403 before parse.
   */
  acknowledgeBoundaryCrossing<T>(taskId: string, crossingId: string) {
    return apiFetch<T>(API.tasks.boundaryAcknowledge(taskId), {
      method: 'POST',
      body: { crossingId },
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

  retrospective<T>(taskId: string) {
    return apiFetch<T>(API.tasks.retrospective(taskId))
  },

  progress<T>(taskId: string) {
    return apiFetch<T>(API.tasks.progress(taskId))
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
}
