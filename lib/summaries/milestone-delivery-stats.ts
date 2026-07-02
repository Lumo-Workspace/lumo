import {
  activeDurationMsBySession,
  type TaskTurnEvent,
} from '@/lib/agent-run/active-time'

/** One PR row as fetched for the rollup (taskId + state only). */
export interface DeliveryPrRow {
  taskId: string | null
  state: string
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
}

export interface DeliveryStatsInput {
  taskIds: string[]
  prRows: DeliveryPrRow[]
  complexityRows: DeliveryComplexityRow[]
  sessionRows: DeliverySessionRow[]
  turnEvents: TaskTurnEvent[]
  /** memberId → display label (best-effort; a missing id falls back to the
   * raw id so no row ever renders an empty cell). */
  memberLabels: Map<string, string>
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
  }

  // ---- Per-member active time (same stream + rounding as costRollup) ----
  const memberBySession = new Map<string, string | null>()
  for (const s of sessionRows) memberBySession.set(s.id, s.workspaceMemberId)
  const msBySession = activeDurationMsBySession(turnEvents)
  const msByMember = new Map<string | null, number>()
  let totalMs = 0
  for (const [sessionId, ms] of msBySession) {
    totalMs += ms
    // A session we can't map to a member — including the '__none__' bucket of
    // session-less events — lands in the explicit unattributed row.
    const member = memberBySession.get(sessionId) ?? null
    msByMember.set(member, (msByMember.get(member) ?? 0) + ms)
  }
  const activeTimeSec = Math.round(totalMs / 1000)

  // ---- Rows: every member with a session, plus the unattributed bucket --
  const memberKeys: Array<string | null> = [
    ...new Set([
      ...sessionRows.map(s => s.workspaceMemberId),
      ...msByMember.keys(),
    ]),
  ]
  const hasUnattributed =
    memberKeys.includes(null) &&
    ((tokenByMember.get(null) ?? 0) > 0 ||
      (msByMember.get(null) ?? 0) > 0 ||
      sessionRows.some(s => s.workspaceMemberId === null))
  const rowKeys = memberKeys.filter(
    (k): k is string | null => k !== null || hasUnattributed
  )
  const secByMember = apportionSeconds(
    rowKeys.map(k => [k, msByMember.get(k) ?? 0]),
    activeTimeSec
  )
  const rows: MilestoneDeliveryMemberRow[] = rowKeys.map(memberId => ({
    memberId,
    label:
      memberId === null ? null : (input.memberLabels.get(memberId) ?? memberId),
    tokenCost: tokenByMember.get(memberId) ?? 0,
    activeTimeSec: secByMember.get(memberId) ?? 0,
  }))
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
    perMember: {
      measuredTasks: measuredTasks.size,
      tokenCost: measuredTasks.size > 0 ? tokenSum : null,
      activeTimeSec,
      rows,
    },
  }
}
