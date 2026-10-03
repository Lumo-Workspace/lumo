import type { TaskStatus } from '@prisma/client'
import type {
  MilestoneOutcomeClaim,
  OutcomeSignalCountRow,
} from '@/lib/summaries/milestone-outcome'

/**
 * LUM-633 — milestone per-member delivery rollup.
 *
 * Answers "what did each person deliver" over the milestone's member tasks,
 * under the honest-reporting discipline: counts only (never a ratio — small-N
 * ratios are noise), quantity and quality columns produced together, explicit
 * buckets for everything that cannot be attributed.
 *
 * Attribution is by task ASSIGNEE (who is responsible for the delivery) — a
 * deliberately different 口径 from the LUM-632 spend rows (who spent the
 * tokens); the client labels both. Agent actors fold to a person in two steps:
 * a personal agent (AgentProfile.memberId set) folds to its owner; a
 * workspace-shared agent folds to the member who spent the most tokens across
 * the task's sessions (same source as the cost attribution, deterministic
 * memberId tiebreak). A task we cannot attribute lands in the explicit
 * unattributed bucket; an unassigned task lands in the explicit unassigned
 * bucket — nothing is silently dropped.
 *
 * Fate inherits the falsifier invariant (LUM-598/626): exactly two states —
 * rejected (≥1 well signal, scanned across ALL the row's tasks so a reopened
 * task keeps its rejection visible) and no-rejection-on-record for DONE tasks
 * (存疑 — never a "satisfied" state). Claim rows reuse the LUM-626 outcome
 * sourcing verbatim (frozen Task.claimSnapshot + source), so the member
 * expansion and the milestone outcome section cannot drift.
 */

/** Flat assignee-resolution fields (parent extracts from Actor/AgentProfile). */
export interface MemberDeliveryAssignee {
  /** Actor.type */
  actorType: 'HUMAN' | 'AGENT' | 'GITHUB_USER'
  /** Actor.memberId — set for member-backed (HUMAN) actors. */
  actorMemberId: string | null
  /** AgentProfile.memberId — the personal-agent owner; null = shared agent. */
  agentOwnerMemberId: string | null
}

/** One milestone task row fed into the rollup. */
export interface MemberDeliveryTaskRow {
  id: string
  /** Display reference, e.g. "LUM-283". */
  ref: string
  title: string
  status: TaskStatus
  claimSnapshot: string | null
  claimSnapshotSource: string | null
  /** `null` = unassigned (the explicit unassigned bucket). */
  assignee: MemberDeliveryAssignee | null
}

/** One PR row (taskId + state only), same shape the LUM-632 rollup reads. */
export interface MemberDeliveryPrRow {
  taskId: string | null
  state: string
}

/** One TaskComplexity row projected to the change-surface sum. */
export interface MemberDeliveryComplexityRow {
  taskId: string
  changedFileCount: number
}

/** One session's token spend — the shared-agent attribution basis. Same
 * cumulative `Session.*` columns the cost attribution sums, so "the member
 * who spent the most tokens" is same-source with the spend rows. */
export interface MemberDeliverySessionRow {
  taskId: string | null
  workspaceMemberId: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

export type MemberDeliveryBucket = 'member' | 'unassigned' | 'unattributed'

export interface MilestoneMemberDeliveryRow {
  bucket: MemberDeliveryBucket
  /** Set on 'member' rows only. */
  memberId: string | null
  /** Resolved display label; `null` on the special buckets (client labels
   * them via i18n). */
  label: string | null
  taskCount: number
  doneCount: number
  mergedPrCount: number
  /** Falsifier-shaped fate — two states, no satisfied/pass form anywhere. */
  fate: {
    /** Row tasks (ANY status — a reopened task keeps its rejection visible)
     * with ≥1 outcome-well signal. */
    rejectedTaskCount: number
    /** DONE row tasks with zero signals: no rejection on record — 存疑,
     * never "satisfied". */
    noRecordDoneCount: number
  }
  /** Delivery friction — actual struggle only, never inferred. */
  friction: {
    /** Row tasks with MORE than one linked PR (any state) — PR churn. */
    multiPrTaskCount: number
  }
  changedFiles: {
    /** Σ per-task changedFileCount over the row's measured tasks.
     * Fail-closed `null` when none is measured (没测到 ≠ 0). */
    total: number | null
    measuredTasks: number
  }
  /** The row's DONE tasks' frozen claims (LUM-626 sourcing verbatim) — a
   * DONE task without a claim stays visible as an explicit no-claim row. */
  claims: MilestoneOutcomeClaim[]
}

export interface MilestoneMemberDelivery {
  /** Member rows in FIXED member-name order (never by volume — a leaderboard
   * rendering is a send-back), then the explicit unassigned / unattributed
   * buckets last. */
  rows: MilestoneMemberDeliveryRow[]
}

export interface MemberDeliveryInput {
  tasks: MemberDeliveryTaskRow[]
  prRows: MemberDeliveryPrRow[]
  complexityRows: MemberDeliveryComplexityRow[]
  sessionRows: MemberDeliverySessionRow[]
  /** (taskId, kind) rejection-signal counts from the outcome well — the same
   * repository groupBy shape the LUM-626 outcome rollup consumes. */
  signalCounts: OutcomeSignalCountRow[]
  /** memberId → display label (missing ids fall back to the raw id). */
  memberLabels: Map<string, string>
}

const UNASSIGNED_KEY = '__unassigned__'
const UNATTRIBUTED_KEY = '__unattributed__'

/**
 * Resolve one task to its delivery bucket. Pure two-step agent folding:
 * personal agent → its owner; shared agent → the task's top token spender
 * (ties broken by ascending memberId so the pick is deterministic); no
 * attributable session → the explicit unattributed bucket.
 */
function resolveBucketKey(
  task: MemberDeliveryTaskRow,
  tokensByMember: Map<string, number> | undefined
): string {
  const a = task.assignee
  if (!a) return UNASSIGNED_KEY
  if (a.actorMemberId) return a.actorMemberId
  if (a.actorType === 'AGENT') {
    if (a.agentOwnerMemberId) return a.agentOwnerMemberId
    if (tokensByMember && tokensByMember.size > 0) {
      let winner: string | null = null
      let best = -1
      for (const [memberId, tokens] of tokensByMember) {
        if (
          tokens > best ||
          (tokens === best && winner !== null && memberId < winner)
        ) {
          winner = memberId
          best = tokens
        }
      }
      return winner as string
    }
    return UNATTRIBUTED_KEY
  }
  // GITHUB_USER actors (and any member-less non-agent actor) have no person
  // to credit — explicit bucket, never a silent drop.
  return UNATTRIBUTED_KEY
}

/**
 * Derive the milestone's per-member delivery rollup. Pure and deterministic —
 * a fold over pre-fetched rows so the honest bucketing is unit-testable
 * without a database. Rows for foreign taskIds are ignored; zero/negative
 * signal counts are dropped (same as the outcome rollup).
 */
export function computeMilestoneMemberDelivery(
  input: MemberDeliveryInput
): MilestoneMemberDelivery {
  const { tasks, prRows, complexityRows, sessionRows } = input
  const taskIdSet = new Set(tasks.map(t => t.id))

  // Shared-agent attribution basis: per-task token spend per member.
  const spendByTask = new Map<string, Map<string, number>>()
  for (const s of sessionRows) {
    if (s.taskId === null || !taskIdSet.has(s.taskId)) continue
    if (s.workspaceMemberId === null) continue
    const byMember = spendByTask.get(s.taskId) ?? new Map<string, number>()
    byMember.set(
      s.workspaceMemberId,
      (byMember.get(s.workspaceMemberId) ?? 0) +
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheCreationTokens ?? 0)
    )
    spendByTask.set(s.taskId, byMember)
  }

  // Per-task lookups the per-row fold reads.
  const prCountByTask = new Map<string, number>()
  const mergedByTask = new Map<string, number>()
  for (const pr of prRows) {
    if (pr.taskId === null || !taskIdSet.has(pr.taskId)) continue
    prCountByTask.set(pr.taskId, (prCountByTask.get(pr.taskId) ?? 0) + 1)
    if (pr.state === 'merged') {
      mergedByTask.set(pr.taskId, (mergedByTask.get(pr.taskId) ?? 0) + 1)
    }
  }

  const changedFilesByTask = new Map<string, number>()
  for (const row of complexityRows) {
    if (!taskIdSet.has(row.taskId) || changedFilesByTask.has(row.taskId)) {
      continue
    }
    changedFilesByTask.set(row.taskId, row.changedFileCount)
  }

  const rejectedTasks = new Set<string>()
  for (const row of input.signalCounts) {
    if (row.count <= 0 || !taskIdSet.has(row.taskId)) continue
    rejectedTasks.add(row.taskId)
  }

  // Group tasks into buckets, preserving input (task-number) order per row.
  const tasksByKey = new Map<string, MemberDeliveryTaskRow[]>()
  for (const task of tasks) {
    const key = resolveBucketKey(task, spendByTask.get(task.id))
    const list = tasksByKey.get(key) ?? []
    list.push(task)
    tasksByKey.set(key, list)
  }

  const buildRow = (
    key: string,
    rowTasks: MemberDeliveryTaskRow[]
  ): MilestoneMemberDeliveryRow => {
    const bucket: MemberDeliveryBucket =
      key === UNASSIGNED_KEY
        ? 'unassigned'
        : key === UNATTRIBUTED_KEY
          ? 'unattributed'
          : 'member'
    let doneCount = 0
    let mergedPrCount = 0
    let multiPrTaskCount = 0
    let rejectedTaskCount = 0
    let noRecordDoneCount = 0
    let changedFilesSum = 0
    let measuredTasks = 0
    const claims: MilestoneOutcomeClaim[] = []
    for (const task of rowTasks) {
      if (task.status === 'DONE') {
        doneCount++
        // Claim sourcing identical to computeMilestoneOutcome (LUM-626): the
        // frozen snapshot or an explicit no-claim row, source only with claim.
        const hasClaim = (task.claimSnapshot?.trim().length ?? 0) > 0
        claims.push({
          taskId: task.id,
          ref: task.ref,
          title: task.title,
          claim: hasClaim ? task.claimSnapshot : null,
          source: hasClaim ? task.claimSnapshotSource : null,
        })
        if (!rejectedTasks.has(task.id)) noRecordDoneCount++
      }
      if (rejectedTasks.has(task.id)) rejectedTaskCount++
      mergedPrCount += mergedByTask.get(task.id) ?? 0
      if ((prCountByTask.get(task.id) ?? 0) > 1) multiPrTaskCount++
      const changed = changedFilesByTask.get(task.id)
      if (changed !== undefined) {
        measuredTasks++
        changedFilesSum += changed
      }
    }
    const memberId = bucket === 'member' ? key : null
    return {
      bucket,
      memberId,
      label:
        memberId === null
          ? null
          : (input.memberLabels.get(memberId) ?? memberId),
      taskCount: rowTasks.length,
      doneCount,
      mergedPrCount,
      fate: { rejectedTaskCount, noRecordDoneCount },
      friction: { multiPrTaskCount },
      changedFiles: {
        total: measuredTasks > 0 ? changedFilesSum : null,
        measuredTasks,
      },
      claims,
    }
  }

  const memberRows: MilestoneMemberDeliveryRow[] = []
  const tailRows: MilestoneMemberDeliveryRow[] = []
  for (const [key, rowTasks] of tasksByKey) {
    const row = buildRow(key, rowTasks)
    if (row.bucket === 'member') memberRows.push(row)
    else tailRows.push(row)
  }
  // FIXED name order — presentation must never read as a leaderboard.
  memberRows.sort(
    (a, b) =>
      (a.label ?? '').localeCompare(b.label ?? '') ||
      (a.memberId ?? '').localeCompare(b.memberId ?? '')
  )
  // Unassigned before unattributed, both always last.
  tailRows.sort(
    (a, b) =>
      (a.bucket === 'unassigned' ? 0 : 1) - (b.bucket === 'unassigned' ? 0 : 1)
  )

  return { rows: [...memberRows, ...tailRows] }
}
