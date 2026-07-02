import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { MilestoneStatus, TaskStatus } from '@prisma/client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'

export interface ApiMilestone {
  id: string
  projectId: string
  name: string
  slug: string
  description: string | null
  status: MilestoneStatus
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** Per-status task counts. Server-enriched on list/detail responses. */
  taskCounts?: Record<TaskStatus, number>
  /**
   * Target-date health light. Server-enriched on list/detail responses.
   * `null` when no light applies (terminal status or no target date).
   */
  health?: MilestoneHealth | null
  /**
   * Staleness hints (LUM-624). Server-enriched on the detail response:
   * `statusDrift` carries the task-derived status when the stored one lags
   * behind task completion (the server self-heals it in the background);
   * `datesMissing` flags an in-flight milestone with no target date.
   */
  staleness?: {
    statusDrift: MilestoneStatus | null
    datesMissing: boolean
  }
  sprintCoverage?: {
    sprints: Array<{
      sprintId: string
      number: number
      name: string
      status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
      taskCount: number
      doneCount: number
    }>
    unsprinted: number
  } | null
  /**
   * LUM-626 outcome rollup. Server-enriched on the detail response only.
   * Fate is falsifier-shaped: rejected (≥1 well signal) or inconclusive
   * (no rejection on record) — there is no satisfied/pass state.
   */
  outcome?: {
    claims: Array<{
      taskId: string
      ref: string
      title: string
      claim: string | null
      source: string | null
    }>
    fate: {
      doneCount: number
      rejected: Array<{
        taskId: string
        ref: string
        title: string
        kinds: Array<{ kind: string; count: number }>
      }>
      inconclusiveCount: number
    }
  } | null
  /**
   * One-line key outcome from the generated retro (MilestoneSummary.tldr).
   * Server-enriched on detail responses; `null` until a retro is generated.
   */
  summaryTldr?: string | null
  /**
   * LUM-627 cost rollup over member tasks, same-source with the task-level
   * LUM-560 cost. Server-enriched on the detail response only. Fail-closed:
   * `tokenCost: null` = no member task has measured usage (没测到 ≠ 花了0);
   * `measuredTasks`/`totalTasks` is the coverage of that measurement.
   */
  costRollup?: {
    tokenCost: number | null
    activeTimeSec: number
    measuredTasks: number
    totalTasks: number
  }
  /**
   * LUM-627 cross-sprint burnup trajectory — a backward replay of the member
   * tasks' STATUS_CHANGED log per UTC day, never a snapshot. Server-enriched
   * on the detail response only. `sprintWindows` are the covering sprints'
   * calendar bands (may extend past `end`; clamp when rendering).
   */
  burnup?: {
    start: string
    end: string
    unit: 'tasks'
    scopeTotal: number
    series: Array<{ date: string; scope: number; completed: number }>
    sprintWindows: Array<{
      sprintId: string
      number: number
      name: string
      start: string
      end: string
    }>
  }
  /**
   * LUM-628 segmentation rollup. Server-enriched on the detail response only.
   * Member tasks grouped along three dimensions (sprint / priority /
   * workstream=tag); segments reference the shared `tasks` rows by id, so a
   * multi-tag task appears under each of its tags without duplicating rows.
   * `key: 'NONE'` is the explicit no-sprint / no-workstream bucket; `label`
   * is `null` where the client labels via i18n (priority + NONE buckets).
   */
  segments?: {
    tasks: Array<{
      taskId: string
      ref: string
      title: string
      status: TaskStatus
    }>
    sprint: Array<MilestoneSegmentEntry>
    priority: Array<MilestoneSegmentEntry>
    workstream: Array<MilestoneSegmentEntry>
  } | null
  /**
   * LUM-632 delivery-scale + per-member spend rollup. Server-enriched on the
   * detail response only. Scale numbers read as cost/risk (regression surface,
   * review load) — never as output. Honest buckets: no-PR tasks are counted in
   * `unlinkedTaskCount`, unmeasured change surface is fail-closed `null` with
   * its coverage stated, and member-less spend lands in an explicit
   * `memberId: null` row. Per-member token/active-time rows sum exactly to
   * `costRollup.tokenCost` / `costRollup.activeTimeSec` (same source).
   */
  deliveryStats?: {
    pr: {
      mergedPrCount: number
      multiPrTaskCount: number
      linkedTaskCount: number
      unlinkedTaskCount: number
      totalTasks: number
    }
    changedFiles: {
      total: number | null
      measuredTasks: number
      totalTasks: number
    }
    /**
     * LUM-634 line-level change volume over the member tasks' merged PRs.
     * Three-state: an unsynced PR (null columns) is excluded from the sums
     * and visible only as the coverage gap; 0 is a real zero-change PR;
     * `additions: null` means zero PRs are synced — "not synced", never 0.
     * Optional for older-server tolerance.
     */
    changeVolume?: {
      additions: number | null
      deletions: number | null
      changedFiles: number | null
      measuredPrs: number
      totalMergedPrs: number
    }
    perMember: {
      measuredTasks: number
      tokenCost: number | null
      activeTimeSec: number
      rows: Array<{
        memberId: string | null
        label: string | null
        tokenCost: number
        activeTimeSec: number
        /** LUM-634 — measured merged-PR volume attributed to this member
         * (largest-token-spender rule, same source as cost attribution).
         * `null`/absent = nothing measured attributes here — never +0/−0. */
        changeVolume?: {
          additions: number
          deletions: number
          measuredPrs: number
        } | null
      }>
    }
  } | null
}

export interface MilestoneSegmentEntry {
  key: string
  label: string | null
  taskIds: string[]
  doneCount: number
}

export interface MilestoneCreateInput {
  name: string
  description?: string | null
  startDate?: string | null
  targetDate?: string | null
}

export interface MilestoneUpdateInput {
  name?: string
  description?: string | null
  status?: MilestoneStatus
  startDate?: string | null
  targetDate?: string | null
}

/** Which milestones a list request returns, by archive state. */
export type MilestoneListFilter = 'active' | 'archived' | 'all'

export const milestonesClient = {
  listByWorkspace(filter: MilestoneListFilter = 'active') {
    const base = API.milestones.workspace
    const url = filter === 'active' ? base : `${base}?filter=${filter}`
    return apiFetch<{ milestones: ApiMilestone[] }>(url)
  },

  listByProject(projectId: string, filter: MilestoneListFilter = 'active') {
    const base = API.milestones.listByProject(projectId)
    // `active` is the server default — omit the param so the URL (and its
    // query cache key) stays stable for the common case.
    const url = filter === 'active' ? base : `${base}?filter=${filter}`
    return apiFetch<{ milestones: ApiMilestone[] }>(url)
  },

  getById(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byId(milestoneId)
    )
  },

  getByProjectAndSlug(projectId: string, slug: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byProjectAndSlug(projectId, slug)
    )
  },

  create(projectId: string, data: MilestoneCreateInput) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.listByProject(projectId),
      { method: 'POST', body: data }
    )
  },

  update(milestoneId: string, data: MilestoneUpdateInput) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byId(milestoneId),
      { method: 'PATCH', body: data }
    )
  },

  delete(milestoneId: string) {
    return apiFetch<void>(API.milestones.byId(milestoneId), {
      method: 'DELETE',
    })
  },

  reorder(projectId: string, orderedIds: string[]) {
    return apiFetch<{ ok: boolean }>(API.milestones.reorder(projectId), {
      method: 'PATCH',
      body: { orderedIds },
    })
  },

  archive(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.archive(milestoneId),
      { method: 'POST' }
    )
  },

  unarchive(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.unarchive(milestoneId),
      { method: 'POST' }
    )
  },
}
