/**
 * LUM-1278 — the Sprint "attention" read model, as a pure fold over batched
 * reads: who is waiting on people (the queue), per-task trust + verified,
 * stage counts with median dwell, and cost / output.
 *
 * Pure: no prisma, no repository, no `new Date()` — the service passes `now`
 * so every duration is computed once, server-side.
 *
 * Product rulings baked in (LUM-1278 brief):
 * - Only collaborative waits are queued: PR awaiting review, crossing awaiting
 *   a ruling, task awaiting DONE confirmation. No per-person session state.
 * - Waiting durations are neutral facts; stage dwell is a median on calendar
 *   time, never a mean.
 * - "mine" = items on tasks assigned to the viewer, minus PR-awaiting-review
 *   (requested reviewers are not persisted, so "mine" can't be known).
 */
import type { TaskStatus } from '@prisma/client'
import {
  isTaskVerified,
  summarizeTestTrust,
  type GateState,
  type TestTrust,
  type VerifiedCaseInput,
} from '@/lib/summaries/sprint-verified'
import { parseStatusPayload } from '@/lib/summaries/burnup-replay'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

// ─── Inputs (structural minimums of the repository rows) ────────────────────

export interface AttentionTaskRow {
  id: string
  identifier: string
  title: string
  status: TaskStatus
  createdAt: Date
  assigneeActorId: string | null
}

export interface AttentionPrRow extends TaskPullRequestSnapshot {
  taskId: string
  repo: string
  isDraft: boolean
  createdAt: Date
  mergedAt: Date | null
}

/** An undispositioned crossing. */
export interface AttentionCrossingRow {
  id: string
  number: number | null
  taskId: string
  category: string
  severity: string
  advisory: boolean
  detectedAt: Date
}

export interface AttentionCaseRow extends VerifiedCaseInput {
  taskId: string
  latestRun:
    | (NonNullable<VerifiedCaseInput['latestRun']> & {
        failureAttribution: string | null
        disposition: unknown | null
      })
    | null
}

export interface AttentionStatusChange {
  taskId: string
  actorId: string | null
  payload: unknown
  createdAt: Date
}

export interface AttentionReworkSignal {
  taskId: string
  kind: string
}

export interface AttentionTokenRow {
  taskId: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

/** The security plane for one task: what the plugin said, or unreadable. */
export type SecurityPlane =
  | { state: 'read'; present: boolean; blocking: number; checked: boolean }
  | { state: 'unknown' }

export interface SprintAttentionInput {
  now: Date
  tasks: AttentionTaskRow[]
  pullRequests: AttentionPrRow[]
  openCrossings: AttentionCrossingRow[]
  testCases: AttentionCaseRow[]
  statusChanges: AttentionStatusChange[]
  reworkSignals: AttentionReworkSignal[]
  tokenRows: AttentionTokenRow[]
  /** taskId → security plane; a missing task reads `unknown`. */
  security: ReadonlyMap<string, SecurityPlane>
  /** The workspace boundary gate switch (crossings block when on, or HIGH). */
  crossingGateEnabled: boolean
  /** actorId → display name (best effort). */
  actorNames: ReadonlyMap<string, string>
}

// ─── Output ─────────────────────────────────────────────────────────────────

export type AttentionScope = 'team' | 'mine'

export type QueueKind = 'crossingRuling' | 'prReview' | 'doneConfirmation'

export interface AttentionPerson {
  actorId: string
  name: string | null
}

interface QueueItemBase {
  taskId: string
  identifier: string
  title: string
  assignee: AttentionPerson | null
  /** ISO timestamp the wait started. */
  waitingSince: string
  /** `now − waitingSince` in seconds, computed server-side. */
  waitingSec: number
}

export type AttentionQueueItem =
  | (QueueItemBase & {
      kind: 'prReview'
      pr: { repo: string; number: number; title: string; url: string }
    })
  | (QueueItemBase & {
      kind: 'crossingRuling'
      crossing: {
        id: string
        number: number | null
        category: string
        severity: string
      }
    })
  | (QueueItemBase & { kind: 'doneConfirmation' })

export type SecurityTrust = 'blocked' | 'clear' | 'notScanned' | 'unknown'

export interface AttentionTask {
  taskId: string
  identifier: string
  title: string
  status: TaskStatus
  assignee: AttentionPerson | null
  trust: {
    testsPassing: number
    testsTotal: number
    testsFresh: number
    crossingsBlocking: number
    security: SecurityTrust
  }
  verified: boolean
  /** The task's most pressing queue entry, if any. */
  waitingOn: QueueKind | null
  /** Who moved the task to DONE (latest such change); null otherwise. */
  confirmedBy: AttentionPerson | null
}

export interface AttentionStage {
  key: TaskStatus
  count: number
  /** Median of `now − entered this status` over the stage's tasks; null when empty. */
  medianDwellSec: number | null
}

export interface ReworkTopItem {
  taskId: string
  identifier: string
  title: string
  reopens: number
  reverts: number
}

export interface AttentionCost {
  /** Σ measured tokens over the sprint's tasks ÷ verified tasks; null when
   *  nothing is verified or nothing is measured. */
  tokensPerVerifiedTask: number | null
  /** Reworked tasks ÷ tasks; null for an empty sprint. */
  reworkShare: number | null
  reworkTop: ReworkTopItem[]
}

export interface SprintAttentionFold {
  /** Team-wide queue, oldest wait first. Scope with {@link scopeQueue}. */
  queue: AttentionQueueItem[]
  tasks: AttentionTask[]
  stages: AttentionStage[]
  cost: AttentionCost
}

/** The full response: the fold, scoped, plus the previous sprint's cost. */
export interface SprintAttention extends SprintAttentionFold {
  scope: AttentionScope
  /** ISO `now` every duration in this response was computed against. */
  asOf: string
  cost: AttentionCost & {
    previousSprint: {
      sprintId: string
      number: number
      name: string
      tokensPerVerifiedTask: number | null
      reworkShare: number | null
    } | null
  }
}

// ─── Rules ──────────────────────────────────────────────────────────────────

// LUM-1282: CANCELED is not a pipeline stage — canceled tasks are left out.
export const STAGE_ORDER: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
]

/** Same reopen rule as `task-status.service.ts` (LUM-561). */
const REOPEN_FROM = new Set<string>(['IN_REVIEW', 'DONE'])
const REOPEN_TO = new Set<string>(['IN_PROGRESS', 'TODO', 'BACKLOG'])

const REWORK_TOP_LIMIT = 3

/** Tie-break order when a task sits in more than one queue. */
const QUEUE_PRIORITY: QueueKind[] = [
  'crossingRuling',
  'prReview',
  'doneConfirmation',
]

/** The DONE gate's crossing rule: not advisory, and the gate is on or HIGH. */
export function isBlockingCrossing(
  c: Pick<AttentionCrossingRow, 'advisory' | 'severity'>,
  gateEnabled: boolean
): boolean {
  return !c.advisory && (gateEnabled || c.severity === 'HIGH')
}

/** Latest run is an undispositioned IMPLEMENTATION_DEFECT (LUM-812 rule). */
function isBlockingTestRun(c: AttentionCaseRow): boolean {
  const run = c.latestRun
  return (
    !!run &&
    run.failureAttribution === 'IMPLEMENTATION_DEFECT' &&
    run.disposition == null
  )
}

export function securityTrust(plane: SecurityPlane | undefined): SecurityTrust {
  if (!plane || plane.state === 'unknown') return 'unknown'
  if (plane.blocking > 0) return 'blocked'
  return plane.checked ? 'clear' : 'notScanned'
}

/** The DONE gate in one word. Blocked wins over unknown: a known blocker is
 *  a fact even when another plane could not be read. */
export function deriveGateState(input: {
  crossingsBlocking: number
  testsBlocking: number
  security: SecurityPlane | undefined
}): GateState {
  const sec = input.security
  const securityBlocking = sec && sec.state === 'read' ? sec.blocking : 0
  if (input.crossingsBlocking + input.testsBlocking + securityBlocking > 0)
    return 'blocked'
  return !sec || sec.state === 'unknown' ? 'unknown' : 'clear'
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

function secondsBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000))
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

function flatTokens(r: AttentionTokenRow): number {
  return (
    (r.inputTokens ?? 0) +
    (r.outputTokens ?? 0) +
    (r.cacheReadTokens ?? 0) +
    (r.cacheCreationTokens ?? 0)
  )
}

function person(
  actorId: string | null,
  names: ReadonlyMap<string, string>
): AttentionPerson | null {
  return actorId ? { actorId, name: names.get(actorId) ?? null } : null
}

// ─── Queue ──────────────────────────────────────────────────────────────────

/**
 * Awaiting DONE confirmation: not DONE, gate clear, and every PR that is not
 * closed-unmerged is merged (at least one). Waiting since the latest merge.
 */
function doneConfirmationSince(
  task: AttentionTaskRow,
  prs: AttentionPrRow[],
  gate: GateState
): Date | null {
  // LUM-1282: a closed task (DONE, or CANCELED by a human) awaits nothing.
  if (isClosedTaskStatus(task.status) || gate !== 'clear') return null
  const live = prs.filter(p => p.state !== 'closed')
  if (live.length === 0 || live.some(p => p.state !== 'merged')) return null
  let latest: Date | null = null
  for (const p of live) {
    const at = p.mergedAt ?? p.createdAt
    if (!latest || at > latest) latest = at
  }
  return latest
}

/** Keep the items a scope shows. `mine` drops PR review (reviewer unknown). */
export function scopeQueue(
  queue: AttentionQueueItem[],
  scope: AttentionScope,
  viewerActorId: string | null
): AttentionQueueItem[] {
  if (scope === 'team') return queue
  if (!viewerActorId) return []
  return queue.filter(
    q => q.kind !== 'prReview' && q.assignee?.actorId === viewerActorId
  )
}

// ─── Stages ─────────────────────────────────────────────────────────────────

/**
 * Per status: how many tasks sit in it and the median time since they
 * entered it (latest STATUS_CHANGED into that status, else task creation).
 */
export function computeStages(
  tasks: AttentionTaskRow[],
  changesByTask: ReadonlyMap<string, AttentionStatusChange[]>,
  now: Date
): AttentionStage[] {
  const dwell = new Map<TaskStatus, number[]>(STAGE_ORDER.map(k => [k, []]))
  for (const t of tasks) {
    let enteredAt = t.createdAt
    for (const c of changesByTask.get(t.id) ?? []) {
      const p = parseStatusPayload(c.payload)
      if (p?.to === t.status && c.createdAt <= now) enteredAt = c.createdAt
    }
    dwell.get(t.status)?.push(secondsBetween(enteredAt, now))
  }
  return STAGE_ORDER.map(key => {
    const values = dwell.get(key) ?? []
    return { key, count: values.length, medianDwellSec: median(values) }
  })
}

// ─── Rework ─────────────────────────────────────────────────────────────────

/**
 * Rework per task: reopens (STATUS_CHANGED back from IN_REVIEW/DONE, or a
 * REOPENED outcome signal — the larger, since one reopen may record both) and
 * reverts (REVERTED outcome signals).
 */
export function computeRework(
  tasks: AttentionTaskRow[],
  changesByTask: ReadonlyMap<string, AttentionStatusChange[]>,
  signals: AttentionReworkSignal[]
): Pick<AttentionCost, 'reworkShare' | 'reworkTop'> {
  const signalsByTask = groupBy(signals, s => s.taskId)
  const reworked: ReworkTopItem[] = []
  for (const t of tasks) {
    const statusReopens = (changesByTask.get(t.id) ?? []).filter(c => {
      const p = parseStatusPayload(c.payload)
      return !!p && REOPEN_FROM.has(p.from) && REOPEN_TO.has(p.to)
    }).length
    const sig = signalsByTask.get(t.id) ?? []
    const reopenSignals = sig.filter(s => s.kind === 'REOPENED').length
    const reverts = sig.filter(s => s.kind === 'REVERTED').length
    const reopens = Math.max(statusReopens, reopenSignals)
    if (reopens + reverts > 0) {
      reworked.push({
        taskId: t.id,
        identifier: t.identifier,
        title: t.title,
        reopens,
        reverts,
      })
    }
  }
  reworked.sort(
    (a, b) =>
      b.reopens + b.reverts - (a.reopens + a.reverts) ||
      a.identifier.localeCompare(b.identifier)
  )
  return {
    reworkShare: tasks.length === 0 ? null : reworked.length / tasks.length,
    reworkTop: reworked.slice(0, REWORK_TOP_LIMIT),
  }
}

/** Σ tokens of measured tasks (a task is measured once any of its sessions
 *  reports output tokens — the retrospective loaders' gate); null if none. */
export function measuredTokenTotal(
  taskIds: ReadonlySet<string>,
  rows: AttentionTokenRow[]
): number | null {
  const measured = new Set<string>()
  for (const r of rows) {
    if (r.taskId && taskIds.has(r.taskId) && r.outputTokens !== null)
      measured.add(r.taskId)
  }
  if (measured.size === 0) return null
  let sum = 0
  for (const r of rows) {
    if (r.taskId && measured.has(r.taskId)) sum += flatTokens(r)
  }
  return sum
}

// ─── Fold ───────────────────────────────────────────────────────────────────

export function computeSprintAttention(
  input: SprintAttentionInput
): SprintAttentionFold {
  const { now, actorNames } = input
  const prsByTask = groupBy(input.pullRequests, p => p.taskId)
  const prsById = new Map(input.pullRequests.map(p => [p.id, p]))
  const crossingsByTask = groupBy(input.openCrossings, c => c.taskId)
  const casesByTask = groupBy(input.testCases, c => c.taskId)
  const changesByTask = groupBy(input.statusChanges, c => c.taskId)

  const queue: AttentionQueueItem[] = []
  const tasks: AttentionTask[] = []
  let verifiedCount = 0

  for (const t of input.tasks) {
    const assignee = person(t.assigneeActorId, actorNames)
    const base = (since: Date) => ({
      taskId: t.id,
      identifier: t.identifier,
      title: t.title,
      assignee,
      waitingSince: since.toISOString(),
      waitingSec: secondsBetween(since, now),
    })
    const prs = prsByTask.get(t.id) ?? []
    const cases = casesByTask.get(t.id) ?? []
    const blockingCrossings = (crossingsByTask.get(t.id) ?? []).filter(c =>
      isBlockingCrossing(c, input.crossingGateEnabled)
    )
    const security = input.security.get(t.id)
    const gate = deriveGateState({
      crossingsBlocking: blockingCrossings.length,
      testsBlocking: cases.filter(isBlockingTestRun).length,
      security,
    })
    const tests: TestTrust = summarizeTestTrust(cases, prsById)
    const verified = isTaskVerified({ status: t.status, gate, tests })
    if (verified) verifiedCount++

    const kinds = new Set<QueueKind>()
    for (const c of blockingCrossings) {
      kinds.add('crossingRuling')
      queue.push({
        ...base(c.detectedAt),
        kind: 'crossingRuling',
        crossing: {
          id: c.id,
          number: c.number,
          category: c.category,
          severity: c.severity,
        },
      })
    }
    for (const p of prs) {
      if (p.state !== 'open' || p.isDraft) continue
      kinds.add('prReview')
      queue.push({
        ...base(p.createdAt),
        kind: 'prReview',
        pr: { repo: p.repo, number: p.number, title: p.title, url: p.url },
      })
    }
    const doneSince = doneConfirmationSince(t, prs, gate)
    if (doneSince) {
      kinds.add('doneConfirmation')
      queue.push({ ...base(doneSince), kind: 'doneConfirmation' })
    }

    let confirmedBy: AttentionPerson | null = null
    if (t.status === 'DONE') {
      for (const c of changesByTask.get(t.id) ?? []) {
        if (parseStatusPayload(c.payload)?.to === 'DONE')
          confirmedBy = person(c.actorId, actorNames)
      }
    }

    tasks.push({
      taskId: t.id,
      identifier: t.identifier,
      title: t.title,
      status: t.status,
      assignee,
      trust: {
        testsPassing: tests.passing,
        testsTotal: tests.total,
        testsFresh: tests.fresh,
        crossingsBlocking: blockingCrossings.length,
        security: securityTrust(security),
      },
      verified,
      waitingOn: QUEUE_PRIORITY.find(k => kinds.has(k)) ?? null,
      confirmedBy,
    })
  }

  queue.sort(
    (a, b) =>
      a.waitingSince.localeCompare(b.waitingSince) ||
      a.identifier.localeCompare(b.identifier)
  )

  const tokenTotal = measuredTokenTotal(
    new Set(input.tasks.map(t => t.id)),
    input.tokenRows
  )
  return {
    queue,
    tasks,
    stages: computeStages(input.tasks, changesByTask, now),
    cost: {
      tokensPerVerifiedTask:
        tokenTotal === null || verifiedCount === 0
          ? null
          : Math.round(tokenTotal / verifiedCount),
      ...computeRework(input.tasks, changesByTask, input.reworkSignals),
    },
  }
}
