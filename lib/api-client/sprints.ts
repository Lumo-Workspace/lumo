import type {
  Sprint,
  SprintStatus,
  SprintSummary,
  TaskStatus,
  TaskPriority,
} from '@prisma/client'
import type { SprintCloseDecisions } from '@/lib/validation/sprint.schema'
import type { TopBlockers } from '@/types/summary'
import type { ModelCost } from '@/lib/services/model-cost'
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type {
  AttentionScope as SprintAttentionScope,
  SprintAttention as SprintAttentionResponse,
} from '@/lib/summaries/sprint-attention'

interface SprintProgress {
  total: number
  done: number
  /** 同类历史基线:该 team 已完成 sprint 的完成率样本(0..1)。空=暂无基线。 */
  priorCompletionRates: number[]
}

interface SprintWithProgress {
  sprint: Sprint
  progress: SprintProgress
  topBlockers?: TopBlockers
  /**
   * Present on the by-number response: the sprint's tasks (MyTask-shaped),
   * returned alongside the sprint so the detail page can seed the
   * tasks.bySprint cache and skip the second round trip (LUM-200).
   */
  tasks?: unknown[]
}

interface SprintListResult {
  sprints: Sprint[]
  nextCursor?: string
}

export interface SprintBurnupResponse {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  scopeTotal: number
  series: Array<{
    date: string
    scope: number
    completed: number | null
    projected: number | null
  }>
}

/**
 * LUM-1278 — the Sprint attention read model (`GET /api/sprints/[id]/attention`).
 * Wire shape = the service's return value (dates are ISO strings, durations
 * are seconds computed server-side), re-exported here as the client DTO.
 */
export type { SprintAttentionResponse, SprintAttentionScope }
export type {
  AttentionQueueItem as SprintAttentionQueueItemDto,
  AttentionTask as SprintAttentionTaskDto,
  AttentionStage as SprintAttentionStageDto,
  AttentionCost as SprintAttentionCostDto,
  AttentionPerson as SprintAttentionPersonDto,
  QueueKind as SprintAttentionQueueKind,
  ReworkTopItem as SprintAttentionReworkTopItemDto,
  SecurityTrust as SprintAttentionSecurityTrust,
} from '@/lib/summaries/sprint-attention'

/** One task in a member's Team-performance drill-down (dates as ISO wire). */
export interface SprintMemberTaskRowDto {
  taskId: string
  identifier: string
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  tokenCost: number
  activeTimeSec: number
  topModel: string | null
  /** Per-model split of this member's spend on this task (empty when the
   * sessions carry no per-model map). Feeds the row's expanded breakdown. */
  models: ModelCost[]
  updatedAt: string
}

export interface SprintMemberPerfRowDto {
  /** `null` = the explicit unattributed bucket, rendered last. */
  memberId: string | null
  label: string | null
  tasksDone: number
  tokenCost: number
  activeTimeSec: number
  runs: number
  models: ModelCost[]
  modelUnattributedTokens: number
  perTask: SprintMemberTaskRowDto[]
}

export interface SprintTeamPerformanceResponse {
  measuredTasks: number
  /** `null` = token side unmeasured (fail-closed, never a fabricated 0). */
  totalTokenCost: number | null
  totalActiveTimeSec: number
  totalRuns: number
  rows: SprintMemberPerfRowDto[]
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

  getBurnup(sprintId: string) {
    return apiFetch<SprintBurnupResponse>(API.sprints.burnup(sprintId))
  },

  getTeamPerformance(sprintId: string) {
    return apiFetch<SprintTeamPerformanceResponse>(
      API.sprints.teamPerformance(sprintId)
    )
  },

  getAttention(sprintId: string, scope: SprintAttentionScope = 'team') {
    return apiFetch<SprintAttentionResponse>(
      API.sprints.attention(sprintId, scope)
    )
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
      autoAddCompleted?: boolean
    }
  ) {
    return apiFetch<void>(API.sprints.cadence(teamId), {
      method: 'PATCH',
      body: input,
    })
  },
}
