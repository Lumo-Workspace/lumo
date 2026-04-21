import type { Sprint, SprintStatus, SprintSummary } from '@prisma/client'
import type { SprintCloseDecisions } from '@/lib/validation/sprint.schema'
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

interface SprintProgress {
  total: number
  done: number
}

interface SprintWithProgress {
  sprint: Sprint
  progress: SprintProgress
}

interface SprintListResult {
  sprints: Sprint[]
  nextCursor?: string
}

export const sprintsClient = {
  listByTeam(
    teamId: string,
    opts: { status?: SprintStatus; cursor?: string; limit?: number } = {}
  ) {
    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    if (opts.cursor) params.set('cursor', opts.cursor)
    if (opts.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    const url = `${API.sprints.listByTeam(teamId)}${qs ? `?${qs}` : ''}`
    return apiFetch<SprintListResult>(url)
  },

  createDraft(
    teamId: string,
    input: { name?: string; startDate?: string; endDate?: string }
  ) {
    return apiFetch<Sprint>(API.sprints.listByTeam(teamId), {
      method: 'POST',
      body: input,
    })
  },

  get(sprintId: string) {
    return apiFetch<SprintWithProgress>(API.sprints.byId(sprintId))
  },

  getByNumber(workspaceUrl: string, number: number) {
    const qs = new URLSearchParams({
      workspaceUrl,
      number: String(number),
    }).toString()
    return apiFetch<SprintWithProgress>(`/api/sprints/by-number?${qs}`)
  },

  update(
    sprintId: string,
    input: { name?: string; startDate?: string; endDate?: string }
  ) {
    return apiFetch<Sprint>(API.sprints.byId(sprintId), {
      method: 'PATCH',
      body: input,
    })
  },

  remove(sprintId: string) {
    return apiFetch<void>(API.sprints.byId(sprintId), { method: 'DELETE' })
  },

  start(sprintId: string) {
    return apiFetch<Sprint>(API.sprints.start(sprintId), { method: 'POST' })
  },

  close(sprintId: string, decisions: SprintCloseDecisions) {
    return apiFetch<Sprint>(API.sprints.close(sprintId), {
      method: 'POST',
      body: { decisions },
    })
  },

  addTask(sprintId: string, taskId: string) {
    return apiFetch<void>(API.sprints.tasks(sprintId), {
      method: 'POST',
      body: { taskId },
    })
  },

  removeTask(sprintId: string, taskId: string) {
    return apiFetch<void>(API.sprints.taskById(sprintId, taskId), {
      method: 'DELETE',
    })
  },

  getSummary(sprintId: string) {
    return apiFetch<SprintSummary>(API.sprints.summary(sprintId))
  },

  retrySummary(sprintId: string) {
    return apiFetch<{ status: 'queued' }>(API.sprints.summaryRetry(sprintId), {
      method: 'POST',
    })
  },

  myActiveSprintIds() {
    return apiFetch<{ sprintIds: string[] }>('/api/me/active-sprints')
  },

  setCadence(
    teamId: string,
    input: {
      enabled: boolean
      durationDays?: number
      cooldownDays?: number
      startWeekday?: number
      autoCreate?: number
    }
  ) {
    return apiFetch<void>(API.sprints.cadence(teamId), {
      method: 'PATCH',
      body: input,
    })
  },
}
