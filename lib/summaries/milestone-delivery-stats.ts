import {
  activeDurationMsByRunTask,
  runKeyOf,
  type AttributedTurnEvent,
} from '@/lib/agent-run/active-time'
import {
  mergeModelCosts,
  toModelCosts,
  type ModelCost,
  type ModelUsage,
} from '@/lib/services/model-cost'

/** One PR row as fetched for the rollup. */
export interface DeliveryPrRow {
  taskId: string | null
  state: string
  /** LUM-634 change-volume columns. `null`/absent = not synced/backfilled —
   * excluded from sums and counted against coverage, NEVER read as 0
   * (0 is a real zero-change PR). Optional so pre-634 rows degrade to
   * "unsynced" instead of breaking callers. */
  additions?: number | null
  deletions?: number | null
  changedFiles?: number | null
}

/** One TaskComplexity row projected to the change-surface sum. */
export interface DeliveryComplexityRow {
  taskId: string
  changedFileCount: number
}

/** One session row projected to the per-member attribution basis. */
export interface DeliverySessionRow {
  id: string
  taskId: string | null
  /** Attribution key (the actual spender, never the assignee). Nullable
   * defensively — a row we cannot attribute lands in the explicit
   * unattributed bucket, it is never dropped. */
  workspaceMemberId: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  /** STOP-settled per-model map (`Session.usageByModel`, LUM-298 JSON).
   * Optional so pre-636 callers/fixtures degrade to "no model split". */
  usageByModel?: unknown
}

export interface MilestoneDeliveryMemberRow {
  /** `null` = the explicit unattributed bucket (member-less sessions plus
   * session-less hook events). Always rendered last. */
  memberId: string | null
  /** Display label resolved by the service; `null` only for the
   * unattributed row (the client labels it via i18n). */
  label: string | null
  tokenCost: number
  activeTimeSec: number
  /** LUM-634 — change volume of the measured merged PRs attributed to this
   * member (task → the member with the largest token spend on that task's
   * sessions, same source as the cost attribution; deterministic tiebreak by
   * memberId). `null` = no measured merged PR attributes here (unsynced PRs
   * or no delivery) — fail-closed, never a fabricated `+0/−0`. */
  changeVolume: {
    additions: number
    deletions: number
    measuredPrs: number
  } | null
  /** LUM-636 per-model split of this member's measured-session spend
   * (same gate as `tokenCost`), sorted by total desc. Empty when none of
   * the member's sessions carries a usageByModel map. */
  models: ModelCost[]
  /** `tokenCost − Σ models.total`, clamped ≥0 — the flat-columns-only
   * remainder (pre-LUM-298 sessions), stated explicitly, never folded
   * into a model row. */
  modelUnattributedTokens: number
}

/**
 * LUM-727 — one member task's slice of the milestone's spend and delivery,
 * the basis for the metric strip's BY TASK panels. Same sources and the same
 * measured gates as the aggregate blocks above, so a panel's rows reconcile
 * with the chip they hang under.
 */
export interface MilestoneTaskCostRow {
  taskId: string
  /** `<TEAM>-<number>` / title, resolved by the service. `null` when the task
   * row could not be labelled — the id still renders, never an empty cell. */
  ref: string | null
  title: string | null
  /** `null` = no usage-bearing session on this task (没测到 ≠ 花了0). */
  tokenCost: number | null
  /** Per-model split of this task's measured sessions; empty when none of
   * them carries a `usageByModel` map. */
  models: ModelCost[]
  /** `tokenCost − Σ models.total`, clamped ≥0 — the flat-columns-only
   * remainder, stated rather than folded into a model row. */
  modelUnattributedTokens: number
  /** Whole seconds, apportioned from the single round-once total the chip
   * renders — the largest-remainder split keeps the Σ-identity exact. */
  activeTimeSec: number
  /** PRs of any state linked to this task. */
  prCount: number
  /** `prCount > 1` — the same churn reading as `pr.multiPrTaskCount`. */
  multiPr: boolean
  /** `null` = no measured merged PR here — never a fabricated `+0/−0`. */
  changeVolume: {
    additions: number
    deletions: number
    measuredPrs: number
  } | null
}

export interface MilestoneDeliveryStats {
  pr: {
    /** PRs with state 'merged' across member tasks. */
    mergedPrCount: number
    /** Tasks with >1 linked PR of any state — the same churn reading the
     * task layer's extraPrCycles (`pullRequests.length - 1`) uses. */
    multiPrTaskCount: number
    /** Tasks with ≥1 PR record. */
    linkedTaskCount: number
    /** Explicit bucket: tasks with NO PR record — never silently folded
     * into a zero. */
    unlinkedTaskCount: number
    totalTasks: number
  }
  changedFiles: {
    /** Σ per-task changedFileCount. A file touched by several tasks counts
     * once per task — a review-surface sum, not a distinct-file count.
     * Fail-closed `null` when no task has a complexity row (没测到 ≠ 0). */
    total: number | null
    measuredTasks: number
    totalTasks: number
  }
  /** LUM-634 — line-level change volume summed over the member tasks' merged
   * PRs. Three-state fail-closed: a PR with null columns is UNSYNCED (excluded
   * from the sums, counted against coverage), a 0 is a real zero-change PR
   * (included), and a milestone with zero measured PRs reads `null` totals —
   * never a fabricated 0. Audit semantics: change exposure / review load,
   * never output. */
  changeVolume: {
    additions: number | null
    deletions: number | null
    changedFiles: number | null
    /** Merged PRs with all three columns synced (the sum basis). */
    measuredPrs: number
    /** All merged PRs of member tasks — the coverage denominator. */
    totalMergedPrs: number
  }
  perMember: {
    /** Same measured gate as the LUM-627 costRollup: tasks with ≥1
     * usage-bearing session. 0 → the token side is unmeasured as a whole. */
    measuredTasks: number
    /** Σ of the rows' tokenCost — reconciles exactly with
     * `costRollup.tokenCost` (same columns, same measured gate).
     * Fail-closed `null` when zero tasks are measured. */
    tokenCost: number | null
    /** Σ of the rows' activeTimeSec — reconciles exactly with
     * `costRollup.activeTimeSec` (same event stream, same rounding). */
    activeTimeSec: number
    rows: MilestoneDeliveryMemberRow[]
  }
  /**
   * LUM-727 BY TASK breakdown — one row per member task that carries ANY
   * signal (measured spend, active time, or a linked PR). Tasks with no
   * signal are left out rather than rendered as fabricated zeros; the
   * coverage counts above state how many of the milestone's tasks that is.
   */
  perTask: {
    rows: MilestoneTaskCostRow[]
    /** Active seconds that map to no member task (session-less hook events,
     * sessions bound to a task outside the milestone). Stated so the rows'
     * Σ + this reconciles with `perMember.activeTimeSec`. */
    unattributedActiveTimeSec: number
  }
}

export interface DeliveryStatsInput {
  taskIds: string[]
  prRows: DeliveryPrRow[]
  complexityRows: DeliveryComplexityRow[]
  sessionRows: DeliverySessionRow[]
  /** Active-time stream. `taskId` (LUM-932) is the event's attributed task;
   * per-task time buckets by it, falling back to the session's task. */
  turnEvents: AttributedTurnEvent[]
  /** memberId → display label (best-effort; a missing id falls back to the
   * raw id so no row ever renders an empty cell). */
  memberLabels: Map<string, string>
  /** LUM-727 taskId → `<TEAM>-<number>` + title for the BY TASK rows.
   * Optional so pre-727 callers/fixtures degrade to id-only labels. */
  taskLabels?: Map<string, { ref: string; title: string }>
}

/**
 * Apportion `totalSec` whole seconds across keys proportionally to their
 * millisecond weights (largest-remainder method), so the per-key seconds sum
 * EXACTLY to `totalSec` — the Σ-identity with `sumActiveDurationSec`'s
 * round-once total survives the per-row split. Deterministic: ties broken by
 * input order.
 */
function apportionSeconds<K>(
  msByKey: Array<[K, number]>,
  totalSec: number
): Map<K, number> {
  const out = new Map<K, number>()
  const totalMs = msByKey.reduce((s, [, ms]) => s + ms, 0)
  if (totalMs <= 0 || totalSec <= 0) {
    for (const [k] of msByKey) out.set(k, 0)
    return out
  }
  const quotas = msByKey.map(([k, ms]) => {
    const quota = (ms / totalMs) * totalSec
    const base = Math.floor(quota)
    return { k, base, frac: quota - base }
  })
  let remainder = totalSec - quotas.reduce((s, q) => s + q.base, 0)
  const byFrac = quotas
    .map((q, i) => ({ ...q, i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const q of byFrac) {
    out.set(q.k, q.base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }
  return out
}

/**
 * LUM-632 delivery-scale + per-member spend rollup — a pure fold over
 * pre-fetched rows, so honest bucketing is unit-testable without a database.
 *
 * Honesty invariants (the acceptance contract):
 * - explicit buckets, nothing silently dropped: no-PR tasks → `unlinked`,
 *   no-complexity tasks → unmeasured coverage, member-less sessions and
 *   session-less events → the unattributed row;
 * - multi-PR rework counts only tasks with MORE than one PR;
 * - Σ-identity: per-member token/active-time rows (incl. unattributed) sum
 *   exactly to the LUM-627 costRollup totals — same columns, same per-task
 *   measured gate, same event stream and single rounding;
 * - fail-closed: zero measurement reads `null`, never a fabricated 0.
 */
export function computeMilestoneDeliveryStats(
  input: DeliveryStatsInput
): MilestoneDeliveryStats {
  const { taskIds, prRows, complexityRows, sessionRows, turnEvents } = input
  const taskIdSet = new Set(taskIds)

  // ---- PR buckets -------------------------------------------------------
  let mergedPrCount = 0
  const prCountByTask = new Map<string, number>()
  for (const pr of prRows) {
    if (pr.state === 'merged') mergedPrCount++
    if (pr.taskId === null || !taskIdSet.has(pr.taskId)) continue
    prCountByTask.set(pr.taskId, (prCountByTask.get(pr.taskId) ?? 0) + 1)
  }
  const linkedTaskCount = prCountByTask.size
  let multiPrTaskCount = 0
  for (const count of prCountByTask.values()) {
    if (count > 1) multiPrTaskCount++
  }

  // ---- Change volume (LUM-634): three-state fail-closed ------------------
  // A merged PR is "measured" only when ALL THREE columns are synced (webhook
  // and backfill always write them together). Unsynced PRs are excluded from
  // the sums and show up as the coverage gap; 0 is a real zero and IS summed.
  let totalMergedPrs = 0
  let measuredPrs = 0
  let addSum = 0
  let delSum = 0
  let filesSum = 0
  const volumeByTask = new Map<
    string,
    { additions: number; deletions: number; measuredPrs: number }
  >()
  for (const pr of prRows) {
    if (pr.state !== 'merged') continue
    if (pr.taskId === null || !taskIdSet.has(pr.taskId)) continue
    totalMergedPrs++
    const { additions, deletions, changedFiles } = pr
    if (additions == null || deletions == null || changedFiles == null) {
      continue
    }
    measuredPrs++
    addSum += additions
    delSum += deletions
    filesSum += changedFiles
    const acc = volumeByTask.get(pr.taskId) ?? {
      additions: 0,
      deletions: 0,
      measuredPrs: 0,
    }
    acc.additions += additions
    acc.deletions += deletions
    acc.measuredPrs++
    volumeByTask.set(pr.taskId, acc)
  }

  // ---- Change surface ---------------------------------------------------
  const measuredComplexity = new Set<string>()
  let changedFilesSum = 0
  for (const row of complexityRows) {
    if (!taskIdSet.has(row.taskId) || measuredComplexity.has(row.taskId)) {
      continue
    }
    measuredComplexity.add(row.taskId)
    changedFilesSum += row.changedFileCount
  }

  // ---- Per-member tokens (same gate as loadActualsForTasks) -------------
  const measuredTasks = new Set<string>()
  for (const s of sessionRows) {
    if (s.taskId !== null && s.outputTokens !== null)
      measuredTasks.add(s.taskId)
  }
  const tokenByMember = new Map<string | null, number>()
  const modelListsByMember = new Map<string | null, (ModelCost[] | null)[]>()
  for (const s of sessionRows) {
    if (s.taskId === null || !measuredTasks.has(s.taskId)) continue
    const key = s.workspaceMemberId
    tokenByMember.set(
      key,
      (tokenByMember.get(key) ?? 0) +
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheCreationTokens ?? 0)
    )
    // Per-model split rides the SAME measured gate (LUM-636): sessions
    // without a usageByModel map contribute nothing here — their spend stays
    // flat-only and surfaces as the row's explicit unattributed remainder.
    const lists = modelListsByMember.get(key) ?? []
    lists.push(
      toModelCosts(s.usageByModel as Record<string, ModelUsage> | null)
    )
    modelListsByMember.set(key, lists)
  }

  // ---- Per-member active time (same stream + rounding as costRollup) ----
  // LUM-1237: timed per RUN (a root session + its subagents) and task — a
  // background subagent's turns count on their own, a foreground one inside a
  // parent turn on the same task counts once. One grouping feeds the total,
  // the per-member rows and the per-task rows, so they reconcile exactly.
  // The session map is only the fallback for events that carry no task.
  const taskBySession = new Map<string, string | null>()
  for (const s of sessionRows) {
    if (!taskBySession.has(s.id)) taskBySession.set(s.id, s.taskId)
  }
  // A run's member: any of its sessions' (a family has one spender).
  const memberByRun = new Map<string, string | null>()
  for (const s of sessionRows) {
    const run = runKeyOf(s.id)
    if ((memberByRun.get(run) ?? null) === null)
      memberByRun.set(run, s.workspaceMemberId)
  }
  const runTaskMs = activeDurationMsByRunTask(
    turnEvents,
    sessionId => taskBySession.get(sessionId) ?? null
  )
  const msByMember = new Map<string | null, number>()
  let totalMs = 0
  for (const g of runTaskMs) {
    totalMs += g.ms
    // A run we can't map to a member — including the '__none__' bucket of
    // session-less events — lands in the explicit unattributed row.
    const member = memberByRun.get(g.runKey) ?? null
    msByMember.set(member, (msByMember.get(member) ?? 0) + g.ms)
  }
  const activeTimeSec = Math.round(totalMs / 1000)

  // ---- Change-volume attribution (LUM-634) -------------------------------
  // Same-source with the cost attribution: a task's measured merged-PR volume
  // goes to the member with the LARGEST token spend on that task's sessions
  // (deterministic tiebreak: lexicographically smallest memberId). A task
  // with no member-attributable session lands in the explicit unattributed
  // bucket — never silently dropped, so the per-member Σ always reconciles
  // with the summary totals.
  const tokensByTaskMember = new Map<string, Map<string, number>>()
  for (const s of sessionRows) {
    if (s.taskId === null || s.workspaceMemberId === null) continue
    const perMemberTokens =
      tokensByTaskMember.get(s.taskId) ?? new Map<string, number>()
    perMemberTokens.set(
      s.workspaceMemberId,
      (perMemberTokens.get(s.workspaceMemberId) ?? 0) +
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheCreationTokens ?? 0)
    )
    tokensByTaskMember.set(s.taskId, perMemberTokens)
  }
  const volumeByMember = new Map<
    string | null,
    { additions: number; deletions: number; measuredPrs: number }
  >()
  for (const [taskId, volume] of volumeByTask) {
    let attributed: string | null = null
    let best = -1
    for (const [memberId, tokens] of tokensByTaskMember.get(taskId) ?? []) {
      if (
        tokens > best ||
        (tokens === best && (attributed === null || memberId < attributed))
      ) {
        attributed = memberId
        best = tokens
      }
    }
    const acc = volumeByMember.get(attributed) ?? {
      additions: 0,
      deletions: 0,
      measuredPrs: 0,
    }
    acc.additions += volume.additions
    acc.deletions += volume.deletions
    acc.measuredPrs += volume.measuredPrs
    volumeByMember.set(attributed, acc)
  }

  // ---- Rows: every member with a session, plus the unattributed bucket --
  const memberKeys: Array<string | null> = [
    ...new Set([
      ...sessionRows.map(s => s.workspaceMemberId),
      ...msByMember.keys(),
      ...volumeByMember.keys(),
    ]),
  ]
  const hasUnattributed =
    memberKeys.includes(null) &&
    ((tokenByMember.get(null) ?? 0) > 0 ||
      (msByMember.get(null) ?? 0) > 0 ||
      (volumeByMember.get(null)?.measuredPrs ?? 0) > 0 ||
      sessionRows.some(s => s.workspaceMemberId === null))
  const rowKeys = memberKeys.filter(
    (k): k is string | null => k !== null || hasUnattributed
  )
  const secByMember = apportionSeconds(
    rowKeys.map(k => [k, msByMember.get(k) ?? 0]),
    activeTimeSec
  )
  const rows: MilestoneDeliveryMemberRow[] = rowKeys.map(memberId => {
    const tokenCost = tokenByMember.get(memberId) ?? 0
    const models = mergeModelCosts(modelListsByMember.get(memberId) ?? [])
    const modelTotal = models.reduce((sum, m) => sum + m.total, 0)
    return {
      memberId,
      label:
        memberId === null
          ? null
          : (input.memberLabels.get(memberId) ?? memberId),
      tokenCost,
      activeTimeSec: secByMember.get(memberId) ?? 0,
      changeVolume: volumeByMember.get(memberId) ?? null,
      models,
      modelUnattributedTokens: Math.max(0, tokenCost - modelTotal),
    }
  })
  rows.sort((a, b) => {
    // Unattributed reads last, always.
    if ((a.memberId === null) !== (b.memberId === null)) {
      return a.memberId === null ? 1 : -1
    }
    return (
      b.tokenCost - a.tokenCost ||
      b.activeTimeSec - a.activeTimeSec ||
      (a.label ?? '').localeCompare(b.label ?? '')
    )
  })

  let tokenSum = 0
  for (const v of tokenByMember.values()) tokenSum += v

  // ---- Per-task rows (LUM-727) ------------------------------------------
  // Same measured gate, same event stream, same rounding as the aggregates:
  // the panels a chip expands into must reconcile with the chip itself.
  const tokenByTask = new Map<string, number>()
  const modelListsByTask = new Map<string, (ModelCost[] | null)[]>()
  for (const s of sessionRows) {
    if (s.taskId === null || !measuredTasks.has(s.taskId)) continue
    tokenByTask.set(
      s.taskId,
      (tokenByTask.get(s.taskId) ?? 0) +
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheCreationTokens ?? 0)
    )
    const lists = modelListsByTask.get(s.taskId) ?? []
    lists.push(
      toModelCosts(s.usageByModel as Record<string, ModelUsage> | null)
    )
    modelListsByTask.set(s.taskId, lists)
  }

  // LUM-932: bucket by each EVENT's task — one unattached session can carry
  // turns inferred onto several tasks (it then appears once per task in
  // sessionRows, so a session→task map would be last-wins).
  const msByTask = new Map<string | null, number>()
  for (const g of runTaskMs) {
    // A group we can't map to a member task — including the '__none__'
    // bucket of session-less events — lands in the explicit remainder.
    const key = g.taskId !== null && taskIdSet.has(g.taskId) ? g.taskId : null
    msByTask.set(key, (msByTask.get(key) ?? 0) + g.ms)
  }
  // Apportion over the same total the chip renders (the remainder key
  // included), so Σ(rows) + unattributed == activeTimeSec exactly.
  const secByTask = apportionSeconds([...msByTask.entries()], activeTimeSec)

  // A task earns a row when it carries ANY signal — measured spend, active
  // time, or a linked PR. Signal-free tasks are omitted, never zero-filled.
  const perTaskIds = [
    ...new Set([
      ...tokenByTask.keys(),
      ...[...msByTask.keys()].filter((k): k is string => k !== null),
      ...prCountByTask.keys(),
    ]),
  ].filter(id => taskIdSet.has(id))

  const perTaskRows: MilestoneTaskCostRow[] = perTaskIds
    .map(taskId => {
      const label = input.taskLabels?.get(taskId) ?? null
      const measured = measuredTasks.has(taskId)
      const tokenCost = measured ? (tokenByTask.get(taskId) ?? 0) : null
      const models = measured
        ? mergeModelCosts(modelListsByTask.get(taskId) ?? [])
        : []
      const modelTotal = models.reduce((sum, m) => sum + m.total, 0)
      const prCount = prCountByTask.get(taskId) ?? 0
      return {
        taskId,
        ref: label?.ref ?? null,
        title: label?.title ?? null,
        tokenCost,
        models,
        modelUnattributedTokens: Math.max(0, (tokenCost ?? 0) - modelTotal),
        activeTimeSec: secByTask.get(taskId) ?? 0,
        prCount,
        multiPr: prCount > 1,
        changeVolume: volumeByTask.get(taskId) ?? null,
      }
    })
    .filter(r => r.tokenCost !== null || r.activeTimeSec > 0 || r.prCount > 0)
  perTaskRows.sort(
    (a, b) =>
      (b.tokenCost ?? 0) - (a.tokenCost ?? 0) ||
      b.activeTimeSec - a.activeTimeSec ||
      (a.ref ?? a.taskId).localeCompare(b.ref ?? b.taskId)
  )

  return {
    pr: {
      mergedPrCount,
      multiPrTaskCount,
      linkedTaskCount,
      unlinkedTaskCount: taskIds.length - linkedTaskCount,
      totalTasks: taskIds.length,
    },
    changedFiles: {
      total: measuredComplexity.size > 0 ? changedFilesSum : null,
      measuredTasks: measuredComplexity.size,
      totalTasks: taskIds.length,
    },
    changeVolume: {
      additions: measuredPrs > 0 ? addSum : null,
      deletions: measuredPrs > 0 ? delSum : null,
      changedFiles: measuredPrs > 0 ? filesSum : null,
      measuredPrs,
      totalMergedPrs,
    },
    perMember: {
      measuredTasks: measuredTasks.size,
      tokenCost: measuredTasks.size > 0 ? tokenSum : null,
      activeTimeSec,
      rows,
    },
    perTask: {
      rows: perTaskRows,
      unattributedActiveTimeSec: secByTask.get(null) ?? 0,
    },
  }
}
