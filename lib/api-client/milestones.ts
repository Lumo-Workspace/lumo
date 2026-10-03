import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { TaskStatus } from '@prisma/client'
import type { MilestoneCompletionChange } from '@/lib/summaries/milestone-rollup'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'
import type { MilestoneWeightedProgress } from '@/lib/summaries/milestone-weighted-progress'

export interface ApiMilestone {
  id: string
  projectId: string
  name: string
  slug: string
  description: string | null
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  archivedAt: string | null
  /**
   * LUM-644 advisory token budget set on the milestone row; `null` = no
   * budget. Optional for older-server tolerance.
   */
  tokenBudget?: number | null
  createdAt: string
  updatedAt: string
  /** Per-status task counts. Server-enriched on list/detail responses. */
  taskCounts?: Record<TaskStatus, number>
  /**
   * LUM-650 complexity-weighted progress reading for the Overview ring — the
   * dual-read alongside `taskCounts`. A current-status snapshot weighting DONE
   * tasks by `TaskComplexity.changedFileCount`; `pct`/weights are `null` and
   * `measuredTasks < totalTasks` when complexity data is missing (unmeasured ≠
   * 0). Server-enriched on the detail response only; optional for
   * older-server tolerance.
   */
  weightedProgress?: MilestoneWeightedProgress | null
  /**
   * Target-date health light. Server-enriched on list/detail responses.
   * `null` when no light applies (completed, archived, or no target date).
   */
  health?: MilestoneHealth | null
  /**
   * Staleness hints (LUM-624, reshaped by LUM-714). Server-enriched on the
   * detail response: `completionDrift` carries the transition the task counts
   * call for when the stored `completedAt` disagrees with them (the server
   * self-heals it in the background); `datesMissing` flags an in-flight
   * milestone with no target date.
   */
  staleness?: {
    completionDrift: MilestoneCompletionChange | null
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
    /**
     * LUM-639 acceptance-quality footnote — the claim-faithfulness verdict
     * distribution over the DONE tasks, never a merged score. Optional so
     * pre-LUM-639 payloads stay valid.
     */
    greenQuality?: {
      doneCount: number
      faithfulness: {
        faithful: number
        overstated: number
        underReported: number
        unjudged: number
      }
    }
  } | null
  /**
   * One-line key outcome from the generated retro (MilestoneSummary.tldr).
   * Server-enriched on detail responses; `null` until a retro is generated.
   */
  summaryTldr?: string | null
  /**
   * LUM-636 derived start: the earliest first-exit-from-TODO across member
   * tasks (min `Task.workStartedAt`). Server-enriched on detail responses.
   * Activity truth for the hero's Start date when no explicit `startDate`
   * was set; `null` until some member task actually starts.
   */
  derivedStartDate?: string | null
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
    /**
     * LUM-636 per-model split of the same measured spend
     * (`Session.usageByModel`), sorted by total desc. Optional for
     * older-server tolerance; empty when no measured session carries a map —
     * the client renders no bars rather than fabricating a split.
     */
    models?: MilestoneModelUsage[]
    /** Spend not attributable to a model (pre-LUM-298 sessions) — rendered
     * as an explicit line when > 0, keeping Σ(models) + this == tokenCost. */
    modelUnattributedTokens?: number
  }
  /**
   * LUM-644 advisory burn-vs-budget block. Server-enriched on the detail
   * response only; `null`/absent when no budget is set (the UI then renders
   * no budget content at all). Fail-closed like the rollup it reads:
   * `exceeded: null` = burn unmeasured (unknown, never an all-clear or a
   * fabricated alert); `true` only when a MEASURED burn strictly exceeds
   * the budget. Advisory only — nothing is gated on it.
   */
  budget?: {
    tokenBudget: number
    tokenCost: number | null
    usedRatio: number | null
    exceeded: boolean | null
    overBy: number | null
  } | null
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
        /** LUM-636 per-model split of this member's measured spend (same
         * gate as tokenCost). Optional for older-server tolerance. */
        models?: MilestoneModelUsage[]
        /** Flat-only remainder (pre-LUM-298 sessions), stated explicitly. */
        modelUnattributedTokens?: number
      }>
    }
    /**
     * LUM-727 BY TASK breakdown behind the metric chips: one row per member
     * task carrying ANY signal (measured spend / active time / a linked PR).
     * Signal-free tasks are absent rather than zero-filled — the coverage
     * counts elsewhere in the payload say how many those are. Optional for
     * older-server tolerance; the client then renders no per-task panel.
     */
    perTask?: {
      rows: Array<{
        taskId: string
        /** `<TEAM>-<number>` + title; `null` when unlabelled (id still shows). */
        ref: string | null
        title: string | null
        /** `null` = no usage-bearing session on this task (没测到 ≠ 花了0). */
        tokenCost: number | null
        models?: MilestoneModelUsage[]
        modelUnattributedTokens?: number
        activeTimeSec: number
        prCount: number
        multiPr: boolean
        /** `null` = no measured merged PR here — never a fabricated +0/−0. */
        changeVolume: {
          additions: number
          deletions: number
          measuredPrs: number
        } | null
      }>
      /** Active seconds mapping to no member task; stated so rows + this
       * reconcile with `perMember.activeTimeSec`. */
      unattributedActiveTimeSec: number
    }
  } | null
  /**
   * LUM-633 per-member delivery rollup. Server-enriched on the detail
   * response only. Attribution is by task ASSIGNEE (agent deliveries folded
   * to a person) — a different 口径 from `deliveryStats.perMember` (session
   * spender); label both when rendering. Counts only, never a ratio; member
   * rows arrive in fixed name order with the explicit unassigned /
   * unattributed buckets last. Fate is falsifier-shaped (rejected vs
   * no-rejection-on-record — no satisfied state); `changedFiles.total` is
   * fail-closed `null` when none of the row's tasks is measured.
   */
  memberDelivery?: {
    rows: Array<{
      bucket: 'member' | 'unassigned' | 'unattributed'
      memberId: string | null
      label: string | null
      taskCount: number
      doneCount: number
      mergedPrCount: number
      fate: { rejectedTaskCount: number; noRecordDoneCount: number }
      friction: { multiPrTaskCount: number }
      changedFiles: { total: number | null; measuredTasks: number }
      claims: Array<{
        taskId: string
        ref: string
        title: string
        claim: string | null
        source: string | null
      }>
    }>
  } | null
  /**
   * LUM-638 risk queue rollup. Server-enriched on the detail response only.
   * Fail-closed: `crossings: { known: false }` when the boundary-crossing
   * read failed — never coerced to zero counts.
   */
  riskQueue?: {
    blocked: Array<{
      taskId: string
      ref: string
      title: string
      blockingRef: string
      blockingStatus: TaskStatus
    }>
    awaitingVerdict: Array<{
      taskId: string
      ref: string
      title: string
      agingSec: number | null
    }>
    crossings:
      | {
          known: true
          bySeverity: { high: number; medium: number; low: number }
          tasks: Array<{
            taskId: string
            ref: string
            title: string
            high: number
            medium: number
            low: number
          }>
        }
      | { known: false }
    scopeBaseline: { initial: number; current: number; addedLater: number }
  } | null
  /**
   * LUM-645 dependency topology rollup (CONFIRMED BLOCKS edges only):
   * layered order, unweighted critical path, and the recommended next batch.
   * Cycles are reported explicitly, never silently dropped.
   */
  topology?: {
    edgeCount: number
    levels: string[][]
    criticalPath: Array<{
      taskId: string
      ref: string
      title: string
      status: TaskStatus
    }>
    cycleRefs: string[]
    nextBatch: Array<{
      taskId: string
      ref: string
      title: string
      status: TaskStatus
      unblocksCount: number
      onCriticalPath: boolean
    }>
    blockedOpenCount: number
  } | null
}

export interface MilestoneSegmentEntry {
  key: string
  label: string | null
  taskIds: string[]
  doneCount: number
}

/** One model's share of a milestone/member token spend (LUM-636) — the
 * STOP-settled `Session.usageByModel` merged over measured sessions. */
export interface MilestoneModelUsage {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
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
  startDate?: string | null
  targetDate?: string | null
  /** LUM-644 advisory token budget; null clears it. */
  tokenBudget?: number | null
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
