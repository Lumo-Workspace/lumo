import type { TaskStatus, TaskPriority } from '@prisma/client'
import {
  type ModelCost,
  toModelCosts,
  mergeModelCosts,
  type ModelUsage,
} from '@/lib/services/model-cost'
import {
  activeDurationMsBySession,
  activeDurationMsBySessionTask,
  type AttributedTurnEvent,
} from '@/lib/agent-run/active-time'

/**
 * Sprint "Team performance" fold — per-member token / agent-time / runs rollup
 * over a sprint's task set, with a per-task drill-down and a per-model split.
 *
 * A leaner sibling of {@link computeMilestoneDeliveryStats}: it reuses the same
 * building blocks ({@link toModelCosts}/{@link mergeModelCosts},
 * {@link activeDurationMsBySession}, the largest-remainder `apportionSeconds`)
 * and the same honesty invariants, but drops the PR/change-volume/complexity
 * concerns the sprint UI doesn't render and ADDS `tasksDone`, `runs` and the
 * `perTask` drill-down the milestone rollup doesn't carry.
 *
 * Attribution axes (documented so the numbers are legible):
 * - tokens / agent-time / runs / models attribute by `workspaceMemberId` (the
 *   session SPENDER), so the per-member rows reconcile exactly with the sprint
 *   totals — the Σ-identity is same-source, not a coincidence.
 * - `tasksDone` attributes each DONE task to the member who spent the MOST
 *   tokens on that task's sessions (deterministic tiebreak: lexicographically
 *   smallest memberId), keeping a single member identity across the whole row.
 *   A DONE task with no member-attributable session lands in the explicit
 *   unattributed bucket — never silently dropped.
 *
 * Fail-closed throughout: unmeasured reads `null` (totalTokenCost) / `0` rows,
 * never a fabricated positive.
 */

export interface SprintPerfSessionRow {
  id: string
  taskId: string | null
  /** The spender. Nullable only defensively; the column is non-null. */
  workspaceMemberId: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  /** STOP-settled per-model map (LUM-298 JSON). Optional so pre-636 rows
   * degrade to "no model split". */
  usageByModel?: unknown
}

export interface SprintPerfTaskRow {
  id: string
  /** Human identifier, e.g. `LUM-42` (team prefix + number). */
  identifier: string
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  updatedAt: Date
}

export interface SprintTeamPerformanceInput {
  taskRows: SprintPerfTaskRow[]
  sessionRows: SprintPerfSessionRow[]
  /** Active-time stream; `taskId` (LUM-932) is the event's attributed task. */
  turnEvents: AttributedTurnEvent[]
  /** memberId → display label, resolved by the service. */
  memberLabels: Map<string, string>
}

export interface SprintMemberTaskRow {
  taskId: string
  identifier: string
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  /** This member's token spend on this task (flat columns, nulls → 0). */
  tokenCost: number
  /** This member's active seconds on this task — apportioned from the member
   * row so the drill-down rows sum EXACTLY to the row's `activeTimeSec`. */
  activeTimeSec: number
  /** Dominant model id for this member's spend on the task; `null` when no
   * per-model map was captured. */
  topModel: string | null
  /** Per-model split of this member's spend on this task, sorted by total
   * desc — the same fold as the member row's `models`, narrowed to one task.
   * Empty for pre-LUM-298 sessions that carry no per-model map. */
  models: ModelCost[]
  updatedAt: Date
}

export interface SprintMemberPerfRow {
  /** `null` = the explicit unattributed bucket. Always rendered last. */
  memberId: string | null
  label: string | null
  /** DONE sprint tasks where this member is the top token-spender. */
  tasksDone: number
  tokenCost: number
  activeTimeSec: number
  /** Number of sessions this member ran across the sprint's tasks. */
  runs: number
  /** Per-model split of this member's spend, sorted by total desc. */
  models: ModelCost[]
  /** `tokenCost − Σ models.total`, clamped ≥0 — the flat-columns-only
   * remainder (pre-LUM-298 sessions), stated explicitly. */
  modelUnattributedTokens: number
  perTask: SprintMemberTaskRow[]
}

export interface SprintTeamPerformance {
  /** Tasks with ≥1 usage-bearing session. 0 → token side unmeasured. */
  measuredTasks: number
  /** Σ of the rows' tokenCost; `null` when zero tasks are measured. */
  totalTokenCost: number | null
  totalActiveTimeSec: number
  totalRuns: number
  rows: SprintMemberPerfRow[]
}

const flatTokens = (s: SprintPerfSessionRow): number =>
  (s.inputTokens ?? 0) +
  (s.outputTokens ?? 0) +
  (s.cacheReadTokens ?? 0) +
  (s.cacheCreationTokens ?? 0)

/**
 * Apportion `totalSec` whole seconds across keys proportionally to their ms
 * weights (largest-remainder), so per-key seconds sum EXACTLY to `totalSec`.
 * Deterministic: ties broken by input order. (Same method as the milestone
 * fold — kept local to avoid coupling the two summaries.)
 */
function apportionSeconds<K>(
  msByKey: Array<[K, number]>,
  totalSec: number
): Map<K, number> {
  const out = new Map<K, number>()
  const totalMs = msByKey.reduce((sum, [, ms]) => sum + ms, 0)
  if (totalMs <= 0 || totalSec <= 0) {
    for (const [k] of msByKey) out.set(k, 0)
    return out
  }
  const quotas = msByKey.map(([k, ms]) => {
    const quota = (ms / totalMs) * totalSec
    const base = Math.floor(quota)
    return { k, base, frac: quota - base }
  })
  let remainder = totalSec - quotas.reduce((sum, q) => sum + q.base, 0)
  const byFrac = quotas
    .map((q, i) => ({ ...q, i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const q of byFrac) {
    out.set(q.k, q.base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }
  return out
}

export function computeSprintTeamPerformance(
  input: SprintTeamPerformanceInput
): SprintTeamPerformance {
  const { taskRows, sessionRows, turnEvents, memberLabels } = input
  const taskById = new Map(taskRows.map(t => [t.id, t]))

  // ---- Measured gate: tasks with ≥1 usage-bearing session ----------------
  const measuredTaskIds = new Set<string>()
  for (const s of sessionRows) {
    if (s.taskId !== null && s.outputTokens !== null)
      measuredTaskIds.add(s.taskId)
  }
  const measuredTasks = measuredTaskIds.size

  // ---- Per-member tokens + per-model lists -------------------------------
  const tokenByMember = new Map<string | null, number>()
  const runsByMember = new Map<string | null, number>()
  const modelListsByMember = new Map<string | null, (ModelCost[] | null)[]>()
  // (taskId, member) spend + per-model — the drill-down basis.
  const tokensByTaskMember = new Map<string, Map<string | null, number>>()
  const modelsByTaskMember = new Map<string, Map<string | null, ModelCost[]>>()

  for (const s of sessionRows) {
    const member = s.workspaceMemberId
    const tokens = flatTokens(s)
    tokenByMember.set(member, (tokenByMember.get(member) ?? 0) + tokens)
    runsByMember.set(member, (runsByMember.get(member) ?? 0) + 1)

    const models = toModelCosts(
      s.usageByModel as Record<string, ModelUsage> | null | undefined
    )
    const list = modelListsByMember.get(member) ?? []
    list.push(models)
    modelListsByMember.set(member, list)

    if (s.taskId !== null) {
      const perMember =
        tokensByTaskMember.get(s.taskId) ?? new Map<string | null, number>()
      perMember.set(member, (perMember.get(member) ?? 0) + tokens)
      tokensByTaskMember.set(s.taskId, perMember)

      const perMemberModels =
        modelsByTaskMember.get(s.taskId) ??
        new Map<string | null, ModelCost[]>()
      const merged = mergeModelCosts([
        perMemberModels.get(member) ?? [],
        models,
      ])
      perMemberModels.set(member, merged)
      modelsByTaskMember.set(s.taskId, perMemberModels)
    }
  }

  // ---- Active time (same stream + single rounding as the sprint total) ---
  const memberBySession = new Map<string, string | null>()
  const taskBySession = new Map<string, string | null>()
  for (const s of sessionRows) {
    memberBySession.set(s.id, s.workspaceMemberId)
    if (!taskBySession.has(s.id)) taskBySession.set(s.id, s.taskId)
  }
  const msBySession = activeDurationMsBySession(turnEvents)
  const msByMember = new Map<string | null, number>()
  let totalMs = 0
  for (const [sessionId, ms] of msBySession) {
    totalMs += ms
    const member = memberBySession.get(sessionId) ?? null
    msByMember.set(member, (msByMember.get(member) ?? 0) + ms)
  }
  // (member → (taskId → ms)) for the per-task active-time apportionment,
  // bucketed by each EVENT's task (LUM-932: one unattached session can span
  // several tasks); the session's task is only the fallback.
  const msByMemberTask = new Map<string | null, Map<string, number>>()
  for (const g of activeDurationMsBySessionTask(
    turnEvents,
    sessionId => taskBySession.get(sessionId) ?? null
  )) {
    if (g.taskId === null) continue
    const member = memberBySession.get(g.sessionId) ?? null
    const perTask = msByMemberTask.get(member) ?? new Map<string, number>()
    perTask.set(g.taskId, (perTask.get(g.taskId) ?? 0) + g.ms)
    msByMemberTask.set(member, perTask)
  }
  const totalActiveTimeSec = Math.round(totalMs / 1000)

  // ---- tasksDone by top token-spender ------------------------------------
  const tasksDoneByMember = new Map<string | null, number>()
  for (const t of taskRows) {
    if (t.status !== 'DONE') continue
    let attributed: string | null = null
    let best = -1
    for (const [memberId, tokens] of tokensByTaskMember.get(t.id) ?? []) {
      if (
        tokens > best ||
        (tokens === best &&
          (attributed === null || (memberId !== null && memberId < attributed)))
      ) {
        attributed = memberId
        best = tokens
      }
    }
    tasksDoneByMember.set(
      attributed,
      (tasksDoneByMember.get(attributed) ?? 0) + 1
    )
  }

  // ---- Assemble rows: every member with activity + unattributed bucket ---
  const memberKeys: Array<string | null> = [
    ...new Set<string | null>([
      ...tokenByMember.keys(),
      ...msByMember.keys(),
      ...tasksDoneByMember.keys(),
    ]),
  ]
  const secByMember = apportionSeconds(
    memberKeys.map(k => [k, msByMember.get(k) ?? 0]),
    totalActiveTimeSec
  )

  const rows: SprintMemberPerfRow[] = memberKeys.map(memberId => {
    const tokenCost = tokenByMember.get(memberId) ?? 0
    const models = mergeModelCosts(modelListsByMember.get(memberId) ?? [])
    const modelTotal = models.reduce((sum, m) => sum + m.total, 0)
    const memberActiveSec = secByMember.get(memberId) ?? 0

    // Per-task drill-down: this member's tasks, spend exact, time apportioned
    // from the member row so the rows sum to `memberActiveSec`.
    const taskIds = [...(msByMemberTask.get(memberId)?.keys() ?? [])]
    for (const [taskId] of tokensByTaskMember) {
      const spent = tokensByTaskMember.get(taskId)?.get(memberId) ?? 0
      if (spent > 0 && !taskIds.includes(taskId)) taskIds.push(taskId)
    }
    const taskMs = msByMemberTask.get(memberId) ?? new Map<string, number>()
    const secByTask = apportionSeconds(
      taskIds.map(id => [id, taskMs.get(id) ?? 0]),
      memberActiveSec
    )
    const perTask: SprintMemberTaskRow[] = taskIds
      .map(taskId => {
        const meta = taskById.get(taskId)
        if (!meta) return null
        const taskModels = modelsByTaskMember.get(taskId)?.get(memberId) ?? []
        return {
          taskId,
          identifier: meta.identifier,
          title: meta.title,
          status: meta.status,
          priority: meta.priority,
          tokenCost: tokensByTaskMember.get(taskId)?.get(memberId) ?? 0,
          activeTimeSec: secByTask.get(taskId) ?? 0,
          topModel: taskModels[0]?.model ?? null,
          models: taskModels,
          updatedAt: meta.updatedAt,
        }
      })
      .filter((r): r is SprintMemberTaskRow => r !== null)
      .sort(
        (a, b) => b.tokenCost - a.tokenCost || b.activeTimeSec - a.activeTimeSec
      )

    return {
      memberId,
      label:
        memberId === null ? null : (memberLabels.get(memberId) ?? memberId),
      tasksDone: tasksDoneByMember.get(memberId) ?? 0,
      tokenCost,
      activeTimeSec: memberActiveSec,
      runs: runsByMember.get(memberId) ?? 0,
      models,
      modelUnattributedTokens: Math.max(0, tokenCost - modelTotal),
      perTask,
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

  const totalTokenCost =
    measuredTasks === 0 ? null : rows.reduce((sum, r) => sum + r.tokenCost, 0)
  const totalRuns = sessionRows.length

  return {
    measuredTasks,
    totalTokenCost,
    totalActiveTimeSec,
    totalRuns,
    rows,
  }
}
